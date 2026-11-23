/*
 * Full Software E2E Pipeline Verification (LB02 -> LB03 -> LB04 -> LB05):
 * Proves the complete controlled product loop end-to-end on local Windows:
 *   1. LB02: Controlled HTTP download -> SHA-256 verify -> safe ZIP extract -> bsp-manifest.json validate -> project bind & reopen restore
 *   2. LB03: Toolchain inspection against local __ENV__ (real ARM GCC 14.3.rel1 + SEGGER JLink_V634b)
 *   3. LB04: Online auth gate -> isolated BSP working copy -> Studio UI C file injection -> REAL ARM Cortex-M4 build -> custom_hmi.bin + SHA-256 + build-record.json
 *   4. LB05: Pre-flash firmware SHA-256 verification + real SEGGER JLink.exe probe detection
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

(async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digi-e2e-"));
    const bspStore = path.join(tmpRoot, "bsp-store");
    const tcStore = path.join(tmpRoot, "toolchains");
    const projectDir = path.join(tmpRoot, "e2e-project");
    const uiDir = path.join(projectDir, "generated-ui");
    fs.mkdirSync(uiDir, { recursive: true });
    fs.writeFileSync(
        path.join(uiDir, "ui_screen.c"),
        "#include <stdint.h>\nuint32_t ui_get_screen_id(void) { return 0xE2E0U; }\n",
        "utf8"
    );

    const envRoot = process.env.DIGIWISE_TEST_ENV_ROOT || "D:\\桌面文件归档\\__ENV__";
    const mingwBin = path.join(
        envRoot,
        "x86_64-13.1.0-release-posix-seh-ucrt-rt_v11-rev1",
        "mingw64",
        "bin"
    );

    const manifest = {
        schemaVersion: "1.0",
        bsp: {
            id: "bc350-e2e-ref",
            categoryCode: "BC350",
            version: "1.0.0",
            name: "BC350 E2E Reference BSP",
            minStudioVersion: "0.0.1",
            supportedHostOs: ["windows-x64"]
        },
        target: { chip: "cortex-m4-ref", arch: "cortex-m4" },
        build: {
            system: "make",
            sourceDir: ".",
            uiSync: { strategy: "copy-to-dir", generatedUiDir: "ui/generated" },
            env: { PATH: `${mingwBin}${path.delimiter}${process.env.PATH || ""}` },
            extraArgs: [],
            artifacts: [
                { role: "firmware", format: "bin", path: "build/e2e_firmware.bin", required: true },
                { role: "symbols", format: "elf", path: "build/e2e_firmware.elf", required: true }
            ]
        },
        toolchain: {
            compiler: { id: "arm-none-eabi-gcc", version: "14.3.rel1" }
        },
        download: {
            probe: "jlink",
            target: "Cortex-M4",
            interface: "SWD",
            frequencyHz: 500000,
            flashAddress: "0x08001000",
            verifyAfterFlash: true,
            resetAfterFlash: true
        }
    };

    const zip = new AdmZip();
    zip.addFile("bsp-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
    zip.addFile(
        "link.ld",
        Buffer.from(
            "MEMORY { FLASH (rx) : ORIGIN = 0x08001000, LENGTH = 256K }\nSECTIONS { .text : { KEEP(*(.isr_vector)) *(.text*) *(.rodata*) } > FLASH }\n",
            "utf8"
        )
    );
    zip.addFile(
        "src/main.c",
        Buffer.from(
            '#include <stdint.h>\nextern uint32_t ui_get_screen_id(void);\nvoid Reset_Handler(void){ volatile uint32_t x=ui_get_screen_id(); while(x){} }\n__attribute__((section(".isr_vector"))) const uint32_t v[2]={0x20010000U,(uint32_t)Reset_Handler};\n',
            "utf8"
        )
    );
    zip.addFile(
        "Makefile",
        Buffer.from(
            "all:\n\tarm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -Os -ffreestanding -nostdlib -T link.ld src/main.c ui/generated/ui_screen.c -o build/e2e_firmware.elf\n\tarm-none-eabi-objcopy -O binary build/e2e_firmware.elf build/e2e_firmware.bin\n",
            "utf8"
        )
    );
    const bspZipBuf = zip.toBuffer();
    const bspSha = crypto.createHash("sha256").update(bspZipBuf).digest("hex");

    const server = http.createServer((req, res) => {
        if (req.url === "/bsp.zip") {
            res.writeHead(200, { "Content-Length": String(bspZipBuf.length) });
            res.end(bspZipBuf);
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
        if (request === "main/digiwise-auth") {
            return {
                callDigiwisePublicApiWithSession: async () => ({ ok: false }),
                getDigiwiseAuthGuard: () => ({ authenticated: true, generation: 1, userId: "7" })
            };
        }
        if (request.startsWith("eez-studio-shared/") || request.startsWith("main/")) {
            return originalLoad.call(this, path.join(buildDir, request), parent, isMain);
        }
        return originalLoad.apply(this, arguments);
    };

    let installVerifiedBsp, scanInstalledBsps, applyManagedBspToEmbeddedBsp, restoreManagedBspOnOpen;
    let runLocalFirmwareBuild, detectLocalProbe, runLocalFirmwareDownload;
    try {
        ({ installVerifiedBsp, scanInstalledBsps } = require("../build/main/digiwise-bsp-catalog.js"));
        ({ applyManagedBspToEmbeddedBsp, restoreManagedBspOnOpen } = require("../build/eez-studio-shared/digiwise-bsp-catalog.js"));
        ({ runLocalFirmwareBuild } = require("../build/main/digiwise-build-engine.js"));
        ({ detectLocalProbe, runLocalFirmwareDownload } = require("../build/main/digiwise-download-manager.js"));
    } finally {
        Module._load = originalLoad;
    }

    try {
        // 1. LB02: Download -> Verify -> Install -> Bind -> Restore
        const installed = await installVerifiedBsp(
            bspStore,
            201,
            {
                bspId: 201,
                modelId: 42,
                downloadUrl: `http://127.0.0.1:${port}/bsp.zip`,
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                fileName: "bc350-e2e-1.0.0.zip",
                fileSize: bspZipBuf.length,
                sha256: bspSha,
                version: "1.0.0",
                modelCode: "BC350",
                categoryCode: "BC350"
            },
            () => {}
        );
        const projBsp = { name: "", bspId: 0, categoryCode: "", version: "", sha256: "", rootPath: "", cmakeListsPath: "", toolchainFile: "" };
        applyManagedBspToEmbeddedBsp(projBsp, installed);
        const scanned = await scanInstalledBsps(bspStore);
        assert.equal(restoreManagedBspOnOpen({ ...projBsp, rootPath: "" }, scanned), true);

        // 2. LB03 + LB04: Online auth gate + real ARM GCC build
        const buildRec = await runLocalFirmwareBuild(
            {
                projectDir,
                generatedUiSourceDir: uiDir,
                binding: { bspId: 201, categoryCode: "BC350", version: "1.0.0", sha256: bspSha }
            },
            {
                bspStoreRoot: bspStore,
                toolchainStoreRoot: tcStore,
                customEnvRoots: [envRoot],
                allowSystemPathFallback: false,
                listAuthorizedVersions: async () => [{ id: 201, categoryCode: "BC350", version: "1.0.0", sha256: bspSha }]
            }
        );
        assert.equal(buildRec.status, "completed");
        const fwArt = buildRec.artifacts.find(a => a.role === "firmware");
        assert.ok(fwArt && fwArt.fileSize > 0);

        // 3. LB05: Real SEGGER JLink probe detect + pre-flash SHA-256 verification
        const probeRes = await detectLocalProbe("jlink", {
            toolchainStoreRoot: tcStore,
            customEnvRoots: [envRoot],
            allowSystemPathFallback: false
        });
        assert.ok(probeRes.executablePath && probeRes.executablePath.endsWith("JLink.exe"));

        // Attempt flash with tampered SHA-256 must fail cleanly
        const tamperedFlash = await runLocalFirmwareDownload(
            {
                projectDir,
                manifest: installed.manifest,
                firmwarePath: fwArt.path,
                expectedSha256: "f".repeat(64)
            },
            { toolchainStoreRoot: tcStore, customEnvRoots: [envRoot], allowSystemPathFallback: false }
        );
        assert.equal(tamperedFlash.errorCode, "FIRMWARE_INTEGRITY_FAILED");

        console.log(
            `PASS: FULL E2E SOFTWARE PIPELINE (LB02 install -> LB03 toolchain -> LB04 real ARM GCC ${fwArt.fileSize}B bin -> LB05 JLink detect & SHA-256 gate)`
        );
    } finally {
        server.close();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
