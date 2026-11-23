/*
 * T04-LB04 (#30) Local Build Engine & Firmware Artifact Manager End-to-End Regression Suite:
 * - REAL ARM Cortex-M4 firmware compilation (arm-none-eabi-gcc + arm-none-eabi-objcopy) when local __ENV__ is present
 * - Studio LVGL UI asset injection into isolated BSP working copy (never mutates immutable bsp-store)
 * - Manifest-driven artifact collection + SHA-256 + build-record.json + log persistence
 * - Online authorization gate rejection (never runs unauthorized build or reuses stale firmware)
 * - Missing toolchain blocking (TOOLCHAIN_NOT_READY)
 * - Compiler failure & GCC diagnostic line/column parsing
 */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");

(async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "digi-lb04-"));
    const bspStore = path.join(tmpRoot, "bsp-store");
    const tcStore = path.join(tmpRoot, "toolchains");
    const projectDir = path.join(tmpRoot, "sample-project");
    const uiSourceDir = path.join(projectDir, "src-ui");
    fs.mkdirSync(uiSourceDir, { recursive: true });
    fs.writeFileSync(
        path.join(uiSourceDir, "ui_screen.c"),
        `#include <stdint.h>\nuint32_t ui_get_screen_id(void) { return 0x350U; }\n`,
        "utf8"
    );

    const envRoot = process.env.DIGIWISE_TEST_ENV_ROOT || "D:\\桌面文件归档\\__ENV__";
    const mingwBin = path.join(
        envRoot,
        "x86_64-13.1.0-release-posix-seh-ucrt-rt_v11-rev1",
        "mingw64",
        "bin"
    );
    const hasRealArmGcc =
        fs.existsSync(
            path.join(
                envRoot,
                "arm-gnu-toolchain-14.3.rel1-mingw-w64-x86_64-arm-none-eabi",
                "bin",
                "arm-none-eabi-gcc.exe"
            )
        ) && fs.existsSync(path.join(mingwBin, "mingw32-make.exe"));

    assert.ok(hasRealArmGcc, `Real ARM GCC + mingw32-make expected under ${envRoot}`);

    // Build a real Make-based Reference BSP ZIP that compiles src/main.c + injected ui/generated/ui_screen.c
    const manifest = {
        schemaVersion: "1.0",
        bsp: {
            id: "bc350-ref-make",
            categoryCode: "BC350",
            version: "1.0.0",
            name: "BC350 Reference Make BSP",
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
                { role: "firmware", format: "bin", path: "build/custom_hmi.bin", required: true },
                { role: "symbols", format: "elf", path: "build/custom_hmi.elf", required: true }
            ]
        },
        toolchain: {
            compiler: { id: "arm-none-eabi-gcc", version: "14.3.rel1" }
        },
        download: {
            probe: "pyocd",
            target: "cortex_m",
            interface: "SWD",
            frequencyHz: 500000,
            flashAddress: "0x08001000"
        }
    };

    const linkerLd = `MEMORY { FLASH (rx) : ORIGIN = 0x08001000, LENGTH = 256K }
SECTIONS {
  .text : { KEEP(*(.isr_vector)) *(.text*) *(.rodata*) } > FLASH
}
`;
    const mainC = `#include <stdint.h>
extern uint32_t ui_get_screen_id(void);
void Reset_Handler(void) {
    volatile uint32_t id = ui_get_screen_id();
    while (id) {}
}
__attribute__((section(".isr_vector")))
const uint32_t g_vectors[2] = { 0x20010000U, (uint32_t)Reset_Handler };
`;
    const makefile = `all:
\tarm-none-eabi-gcc -mcpu=cortex-m4 -mthumb -Os -ffreestanding -nostdlib -T link.ld src/main.c ui/generated/ui_screen.c -o build/custom_hmi.elf
\tarm-none-eabi-objcopy -O binary build/custom_hmi.elf build/custom_hmi.bin
`;

    // Install the BSP into bspStore with bsp-install-meta.json
    const zip = new AdmZip();
    zip.addFile("bsp-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
    zip.addFile("link.ld", Buffer.from(linkerLd, "utf8"));
    zip.addFile("src/main.c", Buffer.from(mainC, "utf8"));
    zip.addFile("Makefile", Buffer.from(makefile, "utf8"));
    const zipBuf = zip.toBuffer();
    const bspSha = crypto.createHash("sha256").update(zipBuf).digest("hex");

    const installedDir = path.join(bspStore, "BC350", "1.0.0");
    zip.extractAllTo(installedDir, true);
    fs.writeFileSync(
        path.join(installedDir, "bsp-install-meta.json"),
        JSON.stringify(
            {
                bspId: 101,
                modelId: 42,
                modelCode: "BC350",
                categoryCode: "BC350",
                version: "1.0.0",
                fileName: "bc350-ref-1.0.0.zip",
                fileSize: zipBuf.length,
                sha256: bspSha,
                installPath: installedDir,
                installedAt: new Date().toISOString(),
                manifest
            },
            null,
            2
        ),
        "utf8"
    );

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

    let runLocalFirmwareBuild, parseCompilerDiagnostics;
    try {
        ({
            runLocalFirmwareBuild,
            parseCompilerDiagnostics
        } = require("../build/main/digiwise-build-engine.js"));
    } finally {
        Module._load = originalLoad;
    }

    const binding = { bspId: 101, categoryCode: "BC350", version: "1.0.0", sha256: bspSha };
    const authorizedList = async () => [{ id: 101, categoryCode: "BC350", version: "1.0.0", sha256: bspSha }];

    try {
        // Test 1: REAL ARM Cortex-M4 build producing custom_hmi.bin + custom_hmi.elf
        const stagesSeen = [];
        const okRecord = await runLocalFirmwareBuild(
            { projectDir, binding, generatedUiSourceDir: uiSourceDir },
            {
                bspStoreRoot: bspStore,
                toolchainStoreRoot: tcStore,
                customEnvRoots: [envRoot],
                allowSystemPathFallback: false,
                listAuthorizedVersions: authorizedList,
                onLog: ev => stagesSeen.push(ev.stage)
            }
        );
        assert.equal(okRecord.status, "completed", `Build failed: ${okRecord.errorCode} ${okRecord.errorMessage}`);
        assert.equal(okRecord.artifacts.length, 2);
        const binArt = okRecord.artifacts.find(a => a.format === "bin");
        assert.ok(binArt && binArt.fileSize > 0 && /^[0-9a-f]{64}$/.test(binArt.sha256));
        assert.ok(fs.existsSync(binArt.path));
        assert.ok(fs.existsSync(okRecord.recordPath));
        assert.ok(fs.existsSync(okRecord.logPath));
        // Immutable BSP store MUST NOT be mutated with ui/generated or build/
        assert.equal(fs.existsSync(path.join(installedDir, "ui", "generated")), false);
        assert.ok(stagesSeen.includes("auth-gate") && stagesSeen.includes("toolchain-check") && stagesSeen.includes("completed"));
        console.log(
            `REAL ARM GCC BUILD PASS: ${path.basename(binArt.path)} (${binArt.fileSize} bytes, sha256=${binArt.sha256.slice(0, 16)}...)`
        );

        // Test 2: Online authorization revoked => MUST refuse before build & return 0 artifacts
        const deniedRecord = await runLocalFirmwareBuild(
            { projectDir, binding, generatedUiSourceDir: uiSourceDir },
            {
                bspStoreRoot: bspStore,
                toolchainStoreRoot: tcStore,
                customEnvRoots: [envRoot],
                allowSystemPathFallback: false,
                listAuthorizedVersions: async () => []
            }
        );
        assert.equal(deniedRecord.status, "failed");
        assert.equal(deniedRecord.errorCode, "BSP_NOT_AUTHORIZED");
        assert.equal(deniedRecord.artifacts.length, 0);

        // Test 3: Missing toolchain => MUST block with TOOLCHAIN_NOT_READY
        const missingTcRecord = await runLocalFirmwareBuild(
            { projectDir, binding, generatedUiSourceDir: uiSourceDir },
            {
                bspStoreRoot: bspStore,
                toolchainStoreRoot: tcStore,
                customEnvRoots: [],
                allowSystemPathFallback: false,
                listAuthorizedVersions: authorizedList
            }
        );
        assert.equal(missingTcRecord.status, "failed");
        assert.equal(missingTcRecord.errorCode, "TOOLCHAIN_NOT_READY");

        // Test 4: Compiler error => MUST fail with BUILD_COMMAND_FAILED, capture diagnostics, and NOT reuse stale firmware
        fs.writeFileSync(path.join(uiSourceDir, "ui_screen.c"), "int broken_syntax( { ;\n", "utf8");
        const failRecord = await runLocalFirmwareBuild(
            { projectDir, binding, generatedUiSourceDir: uiSourceDir },
            {
                bspStoreRoot: bspStore,
                toolchainStoreRoot: tcStore,
                customEnvRoots: [envRoot],
                allowSystemPathFallback: false,
                listAuthorizedVersions: authorizedList
            }
        );
        assert.equal(failRecord.status, "failed");
        assert.equal(failRecord.errorCode, "BUILD_COMMAND_FAILED");
        assert.equal(failRecord.artifacts.length, 0);
        assert.ok(failRecord.diagnostics.length > 0, "Expected GCC error diagnostics to be parsed");
        assert.equal(failRecord.diagnostics[0].severity, "error");

        // Test 5: Diagnostic parser unit check
        const parsed = parseCompilerDiagnostics("src/main.c:12:5: error: expected ';' before '}' token");
        assert.deepEqual(parsed, {
            file: "src/main.c",
            line: 12,
            column: 5,
            severity: "error",
            message: "expected ';' before '}' token"
        });

        console.log(
            "PASS: T04-LB04 Local Build Engine full regression (real ARM GCC firmware.bin, UI injection, immutable BSP store, auth gate, toolchain block, compiler diagnostics)"
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
