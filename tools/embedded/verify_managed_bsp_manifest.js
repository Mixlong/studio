"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");

const sourcePath = path.join(
    __dirname,
    "../../packages/project-editor/features/embedded-platform/managed-bsp-manifest.ts"
);
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = stripTypeScriptTypes(source, { mode: "transform" }).replace(
    /^export /gm,
    ""
);
const context = { module: { exports: {} }, require };
vm.runInNewContext(
    `${transpiled}\nmodule.exports = { readManagedBspConfiguration };`,
    context
);
const { readManagedBspConfiguration } = context.module.exports;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "eez-managed-bsp-"));
try {
    fs.mkdirSync(path.join(root, "cmake"), { recursive: true });
    fs.mkdirSync(path.join(root, "build"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "bsp-manifest.json"),
        JSON.stringify({
            schemaVersion: "1.0",
            bsp: { categoryCode: "BC350", version: "1.0.0" },
            build: {
                system: "cmake",
                sourceDir: ".",
                cmakeLists: "CMakeLists.txt",
                toolchainFile: "cmake/arm-none-eabi.cmake",
                generator: "Ninja",
                extraArgs: ["-DDEMO=1"],
                artifacts: [
                    { role: "firmware", format: "bin", path: "build/firmware.bin" }
                ]
            },
            download: {
                target: "cortex_m",
                interface: "SWD",
                frequencyHz: 500000,
                flashAddress: "0x08001000"
            }
        })
    );

    const resolved = readManagedBspConfiguration(root, path.join(root, "project-build"));
    assert.equal(resolved.manifestPath, path.join(root, "bsp-manifest.json"));
    assert.equal(resolved.sourceDirectory, root);
    assert.equal(resolved.cmakeListsPath, path.join(root, "CMakeLists.txt"));
    assert.equal(
        resolved.toolchainFile,
        path.join(root, "cmake", "arm-none-eabi.cmake")
    );
    assert.equal(JSON.stringify(resolved.extraArguments), JSON.stringify(["-DDEMO=1"]));
    assert.equal(resolved.download.target, "cortex_m");
    assert.equal(resolved.download.interface, "SWD");
    assert.equal(resolved.download.frequency, "500000");
    assert.equal(resolved.download.address, "0x08001000");
    assert(resolved.firmwareCandidates.includes(path.join(root, "build", "firmware.bin")));

    fs.writeFileSync(
        path.join(root, "bsp-manifest.json"),
        JSON.stringify({ build: { sourceDir: "../outside" } })
    );
    assert.throws(
        () => readManagedBspConfiguration(root),
        /unsafe path/i,
        "managed BSP paths must not escape the installed BSP root"
    );

    console.log("Managed BSP manifest resolution verified.");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
