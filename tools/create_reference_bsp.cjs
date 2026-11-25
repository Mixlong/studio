/*
 * Generates a buildable Reference BSP ZIP conforming to T04-LB01 bsp-manifest.json v1.0.
 * Intended for software integration testing (#28 LB02 - #31 LB05) before the real BC350 BSP is uploaded.
 *
 * Usage:
 *   node tools/create_reference_bsp.cjs [--category BC350] [--version 1.0.0] [--out ./bc350-ref-1.0.0.zip]
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");

function buildReferenceBspZip({ categoryCode = "BC350", version = "1.0.0" } = {}) {
    const manifest = {
        schemaVersion: "1.0",
        bsp: {
            id: `${categoryCode.toLowerCase()}-reference`,
            categoryCode,
            version,
            name: `${categoryCode} Reference BSP (Software Integration)`,
            minStudioVersion: "0.0.1",
            supportedHostOs: ["windows-x64"]
        },
        target: {
            chip: "cortex-m4-ref",
            arch: "cortex-m4",
            display: { width: 800, height: 480, colorBpp: 16 }
        },
        build: {
            system: "cmake",
            sourceDir: ".",
            cmakeLists: "CMakeLists.txt",
            preConfigureScript: null,
            toolchainFile: "cmake/arm-none-eabi.cmake",
            generator: "Ninja",
            uiSync: {
                strategy: "cmake-include-marker",
                generatedUiDir: "ui/generated",
                resourceManifest: "build/generated/embedded-resources.json"
            },
            env: {},
            extraArgs: [],
            artifacts: [
                { role: "firmware", format: "bin", path: "build/firmware.bin", required: true },
                { role: "symbols", format: "elf", path: "build/firmware.elf", required: false }
            ]
        },
        toolchain: {
            compiler: { id: "arm-none-eabi-gcc", version: "14.3.rel1" },
            cmake: { minVersion: "3.25.0" },
            ninja: { minVersion: "1.11.0" },
            python: { minVersion: "3.10.0", requirementsFile: null }
        },
        download: {
            probe: "pyocd",
            target: "cortex_m",
            interface: "SWD",
            frequencyHz: 500000,
            flashAddress: "0x08001000",
            pack: null,
            script: null,
            verifyAfterFlash: true,
            resetAfterFlash: true
        }
    };

    const cmakeLists = `cmake_minimum_required(VERSION 3.20)
project(digiwise_ref_firmware C)

set(CMAKE_C_STANDARD 11)
add_executable(firmware.elf src/main.c)

if(CMAKE_OBJCOPY)
    add_custom_command(TARGET firmware.elf POST_BUILD
        COMMAND \${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:firmware.elf> \${CMAKE_BINARY_DIR}/firmware.bin
        COMMENT "Generating firmware.bin"
    )
endif()

# >>> eez-studio embedded resources >>>
# <<< eez-studio embedded resources <<<
`;

    const toolchainCmake = `set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_OBJCOPY arm-none-eabi-objcopy)
set(CMAKE_C_FLAGS_INIT "-mcpu=cortex-m4 -mthumb -Os -ffreestanding -nostdlib")
`;

    const mainC = `#include <stdint.h>

void Reset_Handler(void) {
    volatile uint32_t counter = 0;
    while (1) {
        counter++;
    }
}

__attribute__((section(".isr_vector")))
const uint32_t g_vectors[2] = {
    0x20010000U,
    (uint32_t)Reset_Handler
};
`;

    const zip = new AdmZip();
    zip.addFile("bsp-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"));
    zip.addFile("CMakeLists.txt", Buffer.from(cmakeLists, "utf8"));
    zip.addFile("cmake/arm-none-eabi.cmake", Buffer.from(toolchainCmake, "utf8"));
    zip.addFile("src/main.c", Buffer.from(mainC, "utf8"));
    const buffer = zip.toBuffer();
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    return { buffer, sha256, manifest };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    let categoryCode = "BC350";
    let version = "1.0.0";
    let outPath = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--category") categoryCode = args[++i];
        else if (args[i] === "--version") version = args[++i];
        else if (args[i] === "--out") outPath = args[++i];
    }
    const targetFile = path.resolve(
        outPath || `${categoryCode.toLowerCase()}-ref-${version}.zip`
    );
    const { buffer, sha256 } = buildReferenceBspZip({ categoryCode, version });
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, buffer);
    console.log(
        JSON.stringify(
            { file: targetFile, categoryCode, version, fileSize: buffer.length, sha256 },
            null,
            2
        )
    );
}

module.exports = { buildReferenceBspZip };
