/*
 * T04-LB02 (#28) End-to-End Regression Suite:
 * - Controlled BSP download API contract
 * - Streaming SHA-256 verification & safe ZIP extraction
 * - bsp-manifest.json validation (valid vs corrupt/unsafe)
 * - In-flight download cancellation & temp cleanup
 * - Immutable version cache + project binding persistence & auto-restore
 * - Online authorization gate before Build (local cache cannot bypass revocation)
 */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");

const { buildReferenceBspZip } = require("./create_reference_bsp.cjs");

(async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digi-lb02-"));
    const storeRoot = path.join(tmpRoot, "bsp-store");

    // 1. Build a valid Reference BSP ZIP conforming to bsp-manifest.json v1.0
    const refBsp = buildReferenceBspZip({ categoryCode: "BC350", version: "1.0.0" });

    // 2. Build a zip-slip archive
    const evilZip = new AdmZip();
    evilZip.addFile("xx/escape.txt", Buffer.from("bad", "utf8"));
    evilZip.getEntries()[0].entryName = "../escape.txt";
    const evilBuffer = evilZip.toBuffer();
    const evilSha = crypto.createHash("sha256").update(evilBuffer).digest("hex");

    // 3. Build an archive with an unsafe bsp-manifest.json (path traversal in sourceDir)
    const badManifestZip = new AdmZip();
    badManifestZip.addFile(
        "bsp-manifest.json",
        Buffer.from(
            JSON.stringify({
                ...refBsp.manifest,
                bsp: { ...refBsp.manifest.bsp, version: "1.0.4" },
                build: { ...refBsp.manifest.build, sourceDir: "../outside" }
            }),
            "utf8"
        )
    );
    const badManifestBuf = badManifestZip.toBuffer();
    const badManifestSha = crypto.createHash("sha256").update(badManifestBuf).digest("hex");

    let serveMode = "valid";
    const server = http.createServer((req, res) => {
        if (req.url === "/valid.zip") {
            const body =
                serveMode === "corrupt"
                    ? Buffer.alloc(refBsp.buffer.length, 0x42)
                    : refBsp.buffer;
            res.writeHead(200, {
                "Content-Type": "application/zip",
                "Content-Length": String(body.length)
            });
            res.end(body);
            return;
        }
        if (req.url === "/slow.zip") {
            res.writeHead(200, {
                "Content-Type": "application/zip",
                "Content-Length": String(refBsp.buffer.length)
            });
            res.write(refBsp.buffer.subarray(0, 64));
            // Keep open briefly so cancellation triggers mid-stream
            setTimeout(() => {
                if (!res.writableEnded) res.end(refBsp.buffer.subarray(64));
            }, 3000);
            return;
        }
        if (req.url === "/evil.zip") {
            res.writeHead(200, {
                "Content-Type": "application/zip",
                "Content-Length": String(evilBuffer.length)
            });
            res.end(evilBuffer);
            return;
        }
        if (req.url === "/bad-manifest.zip") {
            res.writeHead(200, {
                "Content-Type": "application/zip",
                "Content-Length": String(badManifestBuf.length)
            });
            res.end(badManifestBuf);
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    // Load compiled modules from build/ with mocked electron & auth
    const buildDir = path.resolve(__dirname, "..", "build");
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === "electron") {
            return { app: { getPath: () => tmpRoot }, ipcMain: { handle() {} } };
        }
        if (request === "main/digiwise-auth") {
            return {
                callDigiwisePublicApiWithSession: async () => ({ ok: false }),
                getDigiwiseAuthGuard: () => ({ authenticated: true, generation: 1, userId: "7" })
            };
        }
        if (
            request.startsWith("eez-studio-shared/") ||
            request.startsWith("main/") ||
            request.startsWith("project-editor/")
        ) {
            return originalLoad.call(this, path.join(buildDir, request), parent, isMain);
        }
        return originalLoad.apply(this, arguments);
    };

    let DigiwisePublicApi;
    let installVerifiedBsp, scanInstalledBsps, verifyBspBuildAccess;
    let applyManagedBspToEmbeddedBsp, restoreManagedBspOnOpen;
    try {
        ({ DigiwisePublicApi } = require("../build/main/digiwise-auth-api.js"));
        ({
            installVerifiedBsp,
            scanInstalledBsps,
            verifyBspBuildAccess
        } = require("../build/main/digiwise-bsp-catalog.js"));
        ({
            applyManagedBspToEmbeddedBsp,
            restoreManagedBspOnOpen
        } = require("../build/eez-studio-shared/digiwise-bsp-catalog.js"));
    } finally {
        Module._load = originalLoad;
    }

    try {
        // Test 1: DigiwisePublicApi.prepareBspDownload contract validation
        const expiresAt = new Date(Date.now() + 300_000).toISOString();
        const api = new DigiwisePublicApi(`http://127.0.0.1:${port}/api/ide/v1`, async url => {
            assert.match(url, /\/bsp\/101\/download$/);
            return new Response(
                JSON.stringify({
                    code: "OK",
                    data: {
                        bspId: 101,
                        modelId: 42,
                        downloadUrl: `http://127.0.0.1:${port}/valid.zip`,
                        expiresAt,
                        fileName: "bc350-ref-1.0.0.zip",
                        fileSize: refBsp.buffer.length,
                        sha256: refBsp.sha256,
                        version: "1.0.0",
                        modelCode: "BC350",
                        categoryCode: "BC350"
                    }
                }),
                { status: 200 }
            );
        });
        const meta = await api.prepareBspDownload("ide_token", 101);
        assert.equal(meta.bspId, 101);
        assert.equal(meta.sha256, refBsp.sha256);
        await assert.rejects(api.prepareBspDownload("ide_token", 0), { code: "INVALID_REQUEST" });

        // Test 2: Valid download, SHA-256 verify, safe extract, manifest parse, immutable cache
        const stages = [];
        const installed = await installVerifiedBsp(storeRoot, 101, meta, p => stages.push(p.stage));
        assert.equal(installed.categoryCode, "BC350");
        assert.equal(installed.version, "1.0.0");
        assert.equal(installed.sha256, refBsp.sha256);
        assert.equal(installed.manifest.schemaVersion, "1.0");
        assert.equal(installed.manifest.toolchain.compiler.version, "14.3.rel1");
        assert.ok(fs.existsSync(path.join(installed.installPath, "bsp-manifest.json")));
        assert.ok(fs.existsSync(path.join(installed.installPath, "CMakeLists.txt")));
        assert.ok(
            stages.includes("downloading") &&
                stages.includes("verifying") &&
                stages.includes("extracting") &&
                stages.includes("completed")
        );

        const scanned = await scanInstalledBsps(storeRoot);
        assert.equal(scanned.length, 1);
        assert.equal(scanned[0].bspId, 101);

        // Test 3: Corrupt download rejected & leaves no dirty BSP
        serveMode = "corrupt";
        await assert.rejects(
            installVerifiedBsp(storeRoot, 101, { ...meta, version: "1.0.1" }, () => {}),
            err => err.code === "BSP_FILE_INTEGRITY_FAILED"
        );
        assert.equal(fs.existsSync(path.join(storeRoot, "BC350", "1.0.1")), false);
        serveMode = "valid";

        // Test 4: Zip-slip rejected & leaves no escaped file
        await assert.rejects(
            installVerifiedBsp(
                storeRoot,
                102,
                {
                    ...meta,
                    bspId: 102,
                    version: "1.0.3",
                    downloadUrl: `http://127.0.0.1:${port}/evil.zip`,
                    fileSize: evilBuffer.length,
                    sha256: evilSha
                },
                () => {}
            ),
            err => err.code === "BSP_ARCHIVE_INVALID"
        );
        assert.equal(fs.existsSync(path.join(tmpRoot, "escape.txt")), false);

        // Test 5: Unsafe bsp-manifest.json rejected & leaves no dirty BSP
        await assert.rejects(
            installVerifiedBsp(
                storeRoot,
                103,
                {
                    ...meta,
                    bspId: 103,
                    version: "1.0.4",
                    downloadUrl: `http://127.0.0.1:${port}/bad-manifest.zip`,
                    fileSize: badManifestBuf.length,
                    sha256: badManifestSha
                },
                () => {}
            ),
            err => err.code === "BSP_MANIFEST_INVALID"
        );
        assert.equal(fs.existsSync(path.join(storeRoot, "BC350", "1.0.4")), false);

        // Test 6: In-flight download cancellation aborts cleanly and leaves no dirty files
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 80);
        await assert.rejects(
            installVerifiedBsp(
                storeRoot,
                104,
                {
                    ...meta,
                    bspId: 104,
                    version: "1.0.5",
                    downloadUrl: `http://127.0.0.1:${port}/slow.zip`
                },
                () => {},
                fetch,
                controller.signal
            ),
            err => err.code === "BSP_DOWNLOAD_CANCELLED"
        );
        assert.equal(fs.existsSync(path.join(storeRoot, "BC350", "1.0.5")), false);

        // Test 7: Project BSP binding persistence & auto-restore on reopen
        const projectBsp = {
            name: "Generic BSP",
            bspId: 0,
            categoryCode: "",
            version: "",
            sha256: "",
            rootPath: "",
            cmakeListsPath: "",
            toolchainFile: ""
        };
        applyManagedBspToEmbeddedBsp(projectBsp, installed);
        assert.equal(projectBsp.bspId, 101);
        assert.equal(projectBsp.categoryCode, "BC350");
        assert.equal(projectBsp.version, "1.0.0");
        assert.equal(projectBsp.sha256, refBsp.sha256);
        assert.ok(projectBsp.cmakeListsPath.endsWith("CMakeLists.txt"));
        assert.ok(projectBsp.toolchainFile.endsWith("cmake/arm-none-eabi.cmake"));

        // Simulate reopening project on a fresh machine/path with only persisted binding fields
        const reopenedBsp = {
            name: "",
            bspId: projectBsp.bspId,
            categoryCode: projectBsp.categoryCode,
            version: projectBsp.version,
            sha256: projectBsp.sha256,
            rootPath: "",
            cmakeListsPath: "",
            toolchainFile: ""
        };
        const restored = restoreManagedBspOnOpen(reopenedBsp, scanned);
        assert.equal(restored, true);
        assert.equal(reopenedBsp.rootPath, installed.installPath);

        // Test 8: Online authorization gate before Build (cache cannot bypass revocation!)
        const gatePass = await verifyBspBuildAccess(
            storeRoot,
            {
                bspId: 101,
                categoryCode: "BC350",
                version: "1.0.0",
                sha256: refBsp.sha256
            },
            async () => [
                { id: 101, categoryCode: "BC350", version: "1.0.0", sha256: refBsp.sha256 }
            ]
        );
        assert.equal(gatePass.authorized, true);
        assert.equal(gatePass.manifest.bsp.categoryCode, "BC350");

        // Revoked / unpublished on server => MUST fail even though local cache exists!
        await assert.rejects(
            verifyBspBuildAccess(
                storeRoot,
                {
                    bspId: 101,
                    categoryCode: "BC350",
                    version: "1.0.0",
                    sha256: refBsp.sha256
                },
                async () => []
            ),
            err => err.code === "BSP_NOT_AUTHORIZED"
        );

        // Ensure no leftover temp files in storeRoot
        const leftovers = fs
            .readdirSync(storeRoot)
            .filter(name => name.startsWith(".tmp-") || name.startsWith(".stage-"));
        assert.deepEqual(leftovers, []);

        console.log(
            "PASS: T04-LB02 full regression (download, SHA-256, zip-slip, manifest validation, cancel/cleanup, project bind/restore, online build gate)"
        );
    } finally {
        server.close();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
