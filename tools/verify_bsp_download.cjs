/* Controlled BSP download, SHA-256 verification, safe ZIP extraction & install registry regression. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const Module = require("node:module");
const AdmZip = require("adm-zip");

const { DigiwisePublicApi } = require("../packages/main/digiwise-auth-api.ts");

(async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digi-bsp-dl-"));
    const storeRoot = path.join(tmpRoot, "bsp-store");

    // Create a valid BSP zip archive.
    const validZip = new AdmZip();
    validZip.addFile("manifest.json", Buffer.from(JSON.stringify({ board: "BC350", version: "1.0.0" }), "utf8"));
    validZip.addFile("boards/bc350.json", Buffer.from("{}", "utf8"));
    const validBuffer = validZip.toBuffer();
    const validSha = crypto.createHash("sha256").update(validBuffer).digest("hex");

    // Create a real zip-slip archive (AdmZip normalizes "../" in addFile, so set raw entryName directly).
    const evilZip = new AdmZip();
    evilZip.addFile("xx/escape.txt", Buffer.from("bad", "utf8"));
    evilZip.getEntries()[0].entryName = "../escape.txt";
    const evilBuffer = evilZip.toBuffer();
    const evilSha = crypto.createHash("sha256").update(evilBuffer).digest("hex");

    let serveMode = "valid";
    const server = http.createServer((req, res) => {
        if (req.url === "/valid.zip") {
            const body = serveMode === "corrupt" ? Buffer.alloc(validBuffer.length, 0x42) : validBuffer;
            res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": String(body.length) });
            res.end(body);
            return;
        }
        if (req.url === "/evil.zip") {
            res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": String(evilBuffer.length) });
            res.end(evilBuffer);
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    // 1. Test DigiwisePublicApi.prepareBspDownload contract validation
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const api = new DigiwisePublicApi(`http://127.0.0.1:${port}/api/ide/v1`, async url => {
        assert.match(url, /\/bsp\/101\/download$/);
        return new Response(JSON.stringify({
            code: "OK",
            data: {
                bspId: 101,
                modelId: 42,
                downloadUrl: `http://127.0.0.1:${port}/valid.zip`,
                expiresAt,
                fileName: "bc350-1.0.0.zip",
                fileSize: validBuffer.length,
                sha256: validSha,
                version: "1.0.0",
                modelCode: "BC350",
                categoryCode: "BC350"
            }
        }), { status: 200 });
    });
    const meta = await api.prepareBspDownload("ide_token", 101);
    assert.equal(meta.bspId, 101);
    assert.equal(meta.modelId, 42);
    assert.equal(meta.sha256, validSha);
    await assert.rejects(api.prepareBspDownload("ide_token", 0), { code: "INVALID_REQUEST" });

    // 2. Load compiled Main BSP catalog handler with mocked electron/auth
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "electron") {
            return { app: { getPath: () => tmpRoot }, ipcMain: { handle() {} } };
        }
        if (request === "main/digiwise-auth") {
            return {
                callDigiwisePublicApiWithSession: async () => ({ ok: false }),
                getDigiwiseAuthGuard: () => ({ authenticated: true, generation: 1, userId: "7" })
            };
        }
        return originalLoad.apply(this, arguments);
    };
    let installVerifiedBsp, scanInstalledBsps;
    try {
        ({ installVerifiedBsp, scanInstalledBsps } = require("../build/main/digiwise-bsp-catalog.js"));
    } finally {
        Module._load = originalLoad;
    }

    try {
        // 3. Valid download, SHA-256 verify, safe extract, install registry
        const stages = [];
        const installed = await installVerifiedBsp(storeRoot, 101, meta, p => stages.push(p.stage));
        assert.equal(installed.categoryCode, "BC350");
        assert.equal(installed.version, "1.0.0");
        assert.equal(installed.sha256, validSha);
        assert.ok(fs.existsSync(path.join(installed.installPath, "manifest.json")));
        assert.ok(fs.existsSync(path.join(installed.installPath, "boards", "bc350.json")));
        assert.ok(stages.includes("downloading") && stages.includes("verifying") && stages.includes("extracting") && stages.includes("completed"));

        const scanned = await scanInstalledBsps(storeRoot);
        assert.equal(scanned.length, 1);
        assert.equal(scanned[0].bspId, 101);

        // 4. Corrupted download must fail with BSP_FILE_INTEGRITY_FAILED and clean temp files
        serveMode = "corrupt";
        await assert.rejects(
            installVerifiedBsp(storeRoot, 101, { ...meta, version: "1.0.1" }, () => {}),
            err => err.code === "BSP_FILE_INTEGRITY_FAILED"
        );
        assert.equal(fs.existsSync(path.join(storeRoot, "BC350", "1.0.1")), false);
        serveMode = "valid";

        // 5. Non-loopback plain HTTP download URL must be rejected
        await assert.rejects(
            installVerifiedBsp(storeRoot, 101, { ...meta, version: "1.0.2", downloadUrl: "http://example.com/bsp.zip" }, () => {}),
            err => err.code === "BSP_DOWNLOAD_FAILED"
        );

        // 6. Zip-slip archive must be rejected with BSP_ARCHIVE_INVALID
        await assert.rejects(
            installVerifiedBsp(storeRoot, 102, {
                ...meta,
                bspId: 102,
                version: "1.0.3",
                downloadUrl: `http://127.0.0.1:${port}/evil.zip`,
                fileSize: evilBuffer.length,
                sha256: evilSha
            }, () => {}),
            err => err.code === "BSP_ARCHIVE_INVALID"
        );
        assert.equal(fs.existsSync(path.join(tmpRoot, "escape.txt")), false);

        console.log("PASS: BSP download API, streaming SHA-256 verification, safe ZIP extraction, zip-slip & integrity guards");
    } finally {
        server.close();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
