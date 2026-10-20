"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const versions = ["8.4.0", "9.2.2", "9.3.0", "9.4.0", "9.5.0"];
const root = path.resolve(__dirname, "..");

const testChild = String.raw`
    "use strict";
    globalThis.window = {};
    globalThis.document = { currentScript: null };
    process.type = "renderer";
    let fetchCount = 0;
    globalThis.fetch = async () => {
        fetchCount++;
        throw new Error("Browser fetch is unavailable for local WASM files");
    };
    const version = process.argv[1];
    const path = require("node:path");
    const file = path.resolve(process.cwd(),
        "build/project-editor/flow/runtime/wasm/lvgl_runtime_v" +
        version + ".js");
    let initialized = false;
    let wasm;
    process.on("unhandledRejection", error => {
        console.error("Unexpected WASM load failure", error);
        process.exit(1);
    });
    wasm = require(file)(() => {
        try {
            initialized = true;
            wasm._init(0, 0, 0, 0, 260, 160, false, 0, false);
            const screen = wasm._lvglCreateScreen(0, 0, 0, 0, 260, 160);
            const button = version.startsWith("9.")
                ? wasm._lv_button_create(screen)
                : wasm._lv_btn_create(screen);
            assert.ok(screen > 0);
            assert.ok(button > 0);
            wasm._lv_obj_set_size(button, 160, 56);
            wasm._lv_obj_set_pos(button, 50, 52);
            wasm._lvglScreenLoad(-1, screen);
            wasm._mainLoop();
            assert.ok(wasm._getSyncedBuffer() > 0);
            assert.equal(fetchCount, 0,
                "WASM must load via local Node fs, never browser fetch");
            console.log(version + ": Electron renderer WASM initialized and rendered");
            process.exit(0);
        } catch (error) {
            console.error(error);
            process.exit(2);
        }
    });
    setTimeout(() => {
        if (!initialized) {
            console.error(version + ": WASM init callback did not run");
            process.exit(3);
        }
    }, 4500);
`;
for (const version of versions) {
    const child = spawnSync(process.execPath, ["-e", testChild, version], {
        cwd: root, encoding: "utf8", timeout: 7000
    });
    assert.equal(child.status, 0,
        version + " failed: " + (child.stderr || child.stdout));
    console.log(child.stdout.trim());
}
console.log("All five Electron renderer-mode WASM loading regressions passed.");
