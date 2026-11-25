/*
 * T04-LB03 (#29) Toolchain Manager End-to-End Regression Suite:
 * - Portable toolchain download, SHA-256 verification, safe ZIP extract & uninstall
 * - Multi-version coexistence & zero cross-pollution when switching BSP manifests
 * - Scoped subprocess PATH injection (never mutates process.env.PATH)
 * - SEGGER J-Link vs Java JDK jlink.exe disambiguation & vendor-driver guidance
 * - Missing tool / version mismatch blocking with recovery hints
 * - Optional live probe against local customEnvRoots if DIGIWISE_TEST_ENV_ROOT is provided
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

function createFakeToolZip(exeName, binRelDir = "bin") {
    const zip = new AdmZip();
    const entryPath = binRelDir && binRelDir !== "." ? `${binRelDir}/${exeName}` : exeName;
    zip.addFile(entryPath, Buffer.from("mock-binary", "utf8"));
    const buffer = zip.toBuffer();
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    return { buffer, sha256 };
}

(async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digi-lb03-"));
    const storeRoot = path.join(tmpRoot, "toolchains");
    const isWin = process.platform === "win32";
    const gccExe = isWin ? "arm-none-eabi-gcc.exe" : "arm-none-eabi-gcc";

    const gcc14 = createFakeToolZip(gccExe, "bin");
    const gcc13 = createFakeToolZip(gccExe, "bin");

    const evilZip = new AdmZip();
    evilZip.addFile("a/b.txt", Buffer.from("evil", "utf8"));
    evilZip.getEntries()[0].entryName = "../evil.txt";
    const evilBuf = evilZip.toBuffer();
    const evilSha = crypto.createHash("sha256").update(evilBuf).digest("hex");

    const server = http.createServer((req, res) => {
        if (req.url === "/gcc-14.zip") {
            res.writeHead(200, { "Content-Length": String(gcc14.buffer.length) });
            res.end(gcc14.buffer);
            return;
        }
        if (req.url === "/gcc-13.zip") {
            res.writeHead(200, { "Content-Length": String(gcc13.buffer.length) });
            res.end(gcc13.buffer);
            return;
        }
        if (req.url === "/evil.zip") {
            res.writeHead(200, { "Content-Length": String(evilBuf.length) });
            res.end(evilBuf);
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    const buildDir = path.resolve(__dirname, "..", "build");
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === "electron") {
            return { app: { getPath: () => tmpRoot }, ipcMain: { handle() {} } };
        }
        if (
            request.startsWith("eez-studio-shared/") ||
            request.startsWith("main/")
        ) {
            return originalLoad.call(this, path.join(buildDir, request), parent, isMain);
        }
        return originalLoad.apply(this, arguments);
    };

    let installToolchainPackage,
        removeToolchainPackage,
        inspectToolchainEnvironment,
        resolveBspToolchainRequirements,
        buildScopedToolchainEnv,
        isAuthenticSeggerJLinkExecutable;
    try {
        ({
            installToolchainPackage,
            removeToolchainPackage,
            inspectToolchainEnvironment,
            resolveBspToolchainRequirements,
            buildScopedToolchainEnv,
            isAuthenticSeggerJLinkExecutable
        } = require("../build/main/digiwise-toolchain-manager.js"));
    } finally {
        Module._load = originalLoad;
    }

    try {
        // Test 1: Install two versions of arm-none-eabi-gcc side-by-side (version coexistence)
        const stages = [];
        const rec14 = await installToolchainPackage(
            storeRoot,
            {
                id: "arm-none-eabi-gcc",
                version: "14.3.rel1",
                downloadUrl: `http://127.0.0.1:${port}/gcc-14.zip`,
                fileSize: gcc14.buffer.length,
                sha256: gcc14.sha256,
                binRelativeDir: "bin"
            },
            p => stages.push(p.stage)
        );
        const rec13 = await installToolchainPackage(
            storeRoot,
            {
                id: "arm-none-eabi-gcc",
                version: "13.2.rel1",
                downloadUrl: `http://127.0.0.1:${port}/gcc-13.zip`,
                fileSize: gcc13.buffer.length,
                sha256: gcc13.sha256,
                binRelativeDir: "bin"
            },
            () => {}
        );
        assert.ok(stages.includes("downloading") && stages.includes("verifying") && stages.includes("ready"));
        assert.notEqual(rec14.binDir, rec13.binDir);

        // Test 2: Corrupt SHA-256 rejected & leaves no dirty install
        await assert.rejects(
            installToolchainPackage(
                storeRoot,
                {
                    id: "arm-none-eabi-gcc",
                    version: "15.0.rel1",
                    downloadUrl: `http://127.0.0.1:${port}/gcc-14.zip`,
                    fileSize: gcc14.buffer.length,
                    sha256: "0".repeat(64),
                    binRelativeDir: "bin"
                },
                () => {}
            ),
            err => err.code === "TOOLCHAIN_INTEGRITY_FAILED"
        );
        assert.equal(fs.existsSync(path.join(storeRoot, "arm-none-eabi-gcc", "15.0.rel1")), false);

        // Test 3: Zip-slip rejected
        await assert.rejects(
            installToolchainPackage(
                storeRoot,
                {
                    id: "cmake",
                    version: "3.28.0",
                    downloadUrl: `http://127.0.0.1:${port}/evil.zip`,
                    fileSize: evilBuf.length,
                    sha256: evilSha
                },
                () => {}
            ),
            err => err.code === "TOOLCHAIN_ARCHIVE_INVALID"
        );
        assert.equal(fs.existsSync(path.join(tmpRoot, "evil.txt")), false);

        // Test 4: Switching BSP manifests resolves exact version without cross-pollution
        const originalPathEnv = process.env.PATH;
        const rep14 = await inspectToolchainEnvironment(
            storeRoot,
            [{ id: "arm-none-eabi-gcc", category: "compiler", required: true, exactVersion: "14.3.rel1" }],
            { allowSystemPathFallback: false }
        );
        const rep13 = await inspectToolchainEnvironment(
            storeRoot,
            [{ id: "arm-none-eabi-gcc", category: "compiler", required: true, exactVersion: "13.2.rel1" }],
            { allowSystemPathFallback: false }
        );
        assert.equal(rep14.ready, true);
        assert.equal(rep13.ready, true);
        assert.ok(rep14.resolvedExecutables["arm-none-eabi-gcc"].includes("14.3.rel1"));
        assert.ok(rep13.resolvedExecutables["arm-none-eabi-gcc"].includes("13.2.rel1"));

        // Scoped env prepends only this BSP's binDir and does NOT mutate global process.env.PATH
        const scoped14 = buildScopedToolchainEnv(rep14, { PATH: "C:\\Windows\\System32" });
        assert.ok(scoped14.PATH.startsWith(rec14.binDir));
        assert.equal(process.env.PATH, originalPathEnv);

        // Test 5: Java JDK jlink.exe MUST NOT be confused with SEGGER J-Link
        const fakeJdkBin = path.join(tmpRoot, "jdk-21", "bin");
        fs.mkdirSync(fakeJdkBin, { recursive: true });
        const fakeJdkJlink = path.join(fakeJdkBin, isWin ? "jlink.exe" : "JLinkExe");
        fs.writeFileSync(fakeJdkJlink, "jdk-jlink", "utf8");
        assert.equal(isAuthenticSeggerJLinkExecutable(fakeJdkJlink), false);

        const jlinkReportBlocked = await inspectToolchainEnvironment(
            storeRoot,
            [{ id: "jlink", category: "flasher", required: true }],
            { allowSystemPathFallback: true, systemPathEnv: fakeJdkBin }
        );
        assert.equal(jlinkReportBlocked.ready, false);
        assert.equal(jlinkReportBlocked.blockingIssues[0].code, "VENDOR_INSTALLER_REQUIRED");

        // Authentic SEGGER directory with JLinkARM.dll MUST be recognized
        const fakeSeggerDir = path.join(tmpRoot, "SEGGER", "JLink_V634b");
        fs.mkdirSync(fakeSeggerDir, { recursive: true });
        const fakeSeggerExe = path.join(fakeSeggerDir, isWin ? "JLink.exe" : "JLinkExe");
        fs.writeFileSync(fakeSeggerExe, "segger", "utf8");
        fs.writeFileSync(path.join(fakeSeggerDir, "JLinkARM.dll"), "dll", "utf8");
        assert.equal(isAuthenticSeggerJLinkExecutable(fakeSeggerExe), true);

        const jlinkReportOk = await inspectToolchainEnvironment(
            storeRoot,
            [{ id: "jlink", category: "flasher", required: true }],
            { customEnvRoots: [path.join(tmpRoot, "SEGGER")], allowSystemPathFallback: false }
        );
        assert.equal(jlinkReportOk.ready, true);
        assert.equal(jlinkReportOk.tools[0].detectedVersion, "634b");

        // Test 6: Reference BSP manifest requirement resolution & uninstall
        const refBsp = buildReferenceBspZip({ categoryCode: "BC350", version: "1.0.0" });
        const reqs = resolveBspToolchainRequirements(refBsp.manifest);
        assert.ok(reqs.some(r => r.id === "arm-none-eabi-gcc" && r.exactVersion === "14.3.rel1"));
        assert.ok(reqs.some(r => r.id === "cmake"));
        assert.ok(reqs.some(r => r.id === "pyocd"));

        await removeToolchainPackage(storeRoot, "arm-none-eabi-gcc", "13.2.rel1");
        assert.equal(fs.existsSync(path.join(storeRoot, "arm-none-eabi-gcc", "13.2.rel1")), false);

        // Test 7 (optional live check): probe custom local environment root when passed via env var
        const liveEnvRoot = process.env.DIGIWISE_TEST_ENV_ROOT;
        if (liveEnvRoot && fs.existsSync(liveEnvRoot)) {
            const liveRep = await inspectToolchainEnvironment(
                storeRoot,
                [
                    { id: "arm-none-eabi-gcc", category: "compiler", required: true, exactVersion: "14.3.rel1" },
                    { id: "jlink", category: "flasher", required: true },
                    { id: "ffmpeg", category: "resource-tool", required: false }
                ],
                { customEnvRoots: [liveEnvRoot], allowSystemPathFallback: false }
            );
            assert.equal(liveRep.ready, true, `Live probe failed: ${JSON.stringify(liveRep.blockingIssues)}`);
            console.log(
                "LIVE __ENV__ PROBE PASS:",
                liveRep.tools.map(t => `${t.id}=${t.detectedVersion} (${t.source})`).join(", ")
            );
        }

        console.log(
            "PASS: T04-LB03 Toolchain Manager full regression (portable install, SHA-256, zip-slip, multi-version isolation, scoped PATH, SEGGER vs JDK jlink guard, uninstall)"
        );
    } finally {
        server.close();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
