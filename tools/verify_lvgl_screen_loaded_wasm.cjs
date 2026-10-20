"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

const factory = require(path.resolve(__dirname,
    "../packages/project-editor/flow/runtime/wasm/lvgl_runtime_v8.4.0.js"
));
const observed = [];
globalThis.lvglOnEventHandler = (moduleId, obj, eventCode, event) => {
    observed.push({ moduleId, obj, eventCode, event });
};
globalThis.lvglScreenTick = () => {};
globalThis.lvglDeleteScreen = () => {};
globalThis.lvglCreateScreen = () => {};

let wasm;
let completed = false;
wasm = factory(() => {
    try {
        wasm._init(0, 0, 0, 0, 260, 160, false, 0, false);
        const screen = wasm._lvglCreateScreen(0, 0, 0, 0, 260, 160);
        assert(screen > 0, "WASM must create an LVGL screen");
        wasm._lvglAddEventHandler(screen);
        wasm._lvglAddScreenLoadedEventHandler(screen);
        wasm._lvglScreenLoad(-1, screen);
        for (let i = 0; i < 5; i++) wasm._mainLoop();

        for (const [code, name] of [
            [38, "SCREEN_LOAD_START"],
            [39, "SCREEN_LOADED"]
        ]) {
            assert(
                observed.some(e => e.obj === screen && e.eventCode === code),
                name + " must be dispatched from the Screen object"
            );
        }
        assert(
            observed.every(e => e.moduleId === 0),
            "LVGL event callbacks should retain the runtime module id"
        );
        completed = true;
        console.log(
            "Native LVGL screen event test passed: Screen emits LOAD_START (38) and LOADED (39)."
        );
    } catch (error) {
        console.error(error.stack || error);
        process.exitCode = 1;
    }
});
setTimeout(() => {
    if (!completed) {
        console.error("Native WASM screen event callback timed out");
        process.exitCode = 1;
    }
}, 2000).unref();
