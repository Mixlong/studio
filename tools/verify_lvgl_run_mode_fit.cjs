"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");
const root = path.resolve(__dirname, "..");
const { fitRunCanvas } = require(
    "../build/project-editor/flow/runtime-viewer/run-layout.js"
);

function inside(width, height, deviceW, deviceH, preferred = 1) {
    const result = fitRunCanvas(width, height, deviceW, deviceH, preferred);
    assert(Number.isFinite(result.scale) && result.scale > 0);
    assert(result.x >= 0 && result.y >= 0);
    assert(result.x + deviceW * result.scale <= width + 0.1);
    assert(result.y + deviceH * result.scale <= height + 0.1);
    return result;
}
const small = inside(640, 360, 960, 640);
assert(small.scale < 1 && small.scale > 0.5, "Oversized screen must shrink");
assert(small.x >= 0 && small.y >= 0);
const large = inside(1440, 1000, 960, 640);
assert.equal(large.scale, 1, "Normal Run viewport must preserve 1:1 device pixels");
assert.equal(large.x, 240);
assert.equal(large.y, 180);
const preferred = inside(900, 650, 960, 640, 0.67);
assert.equal(preferred.scale, 0.67, "Existing smaller zoom is preserved");
inside(375, 260, 1920, 1080);
inside(750, 350, 400, 900);
const initial = fitRunCanvas(1, 1, 960, 640, 1);
assert.equal(initial.scale, 1, "Unmeasured layout must have a safe fallback");

const viewer = fs.readFileSync(path.join(root,
    "packages/project-editor/flow/runtime-viewer/viewer.tsx"),"utf8");
const runtime = fs.readFileSync(path.join(root,
    "packages/project-editor/flow/runtime/wasm-runtime.tsx"),"utf8");
assert(viewer.includes("const layout = fitRunCanvas(") &&
       viewer.includes("scale = layout.scale;") &&
       viewer.includes('transformOrigin: fittedRunDisplay') &&
       viewer.includes('"top left"') &&
       viewer.includes(".isLVGL &&") &&
       viewer.includes(".isEezGuiLite &&"),
       "LVGL and GUI Lite Run modes must use fitted viewport layout");
const start = runtime.indexOf("        sendPointerEvent(event: PointerEvent) {");
const end = runtime.indexOf("\n        onPointerDown =", start);
assert(start >= 0 && end > start);
const classSource = stripTypeScriptTypes(
    "class PointerHarness {\n" + runtime.slice(start,end) +
    "\n}\nmodule.exports = PointerHarness;", { mode: "transform" }
);
const ctx = { module: { exports: {} } };
vm.runInNewContext(classSource, ctx);
const pointer = new ctx.module.exports();
let received;
const wasmRuntime = {
    selectedPage: { left: 10, top: 20, width: 640, height: 480 },
    displayWidth: 960, displayHeight: 640,
    isDebuggerActive: false,
    pointerEvents: { push(point) { received = point; } }
};
pointer.context = { runtime: wasmRuntime };
pointer.canvasRef = { current: {
    width: 960,
    height: 640,
    getBoundingClientRect() {
        return { left: 10, top: 15, width: 480, height: 320 };
    }
} };
const event = {
    clientX: 250,
    clientY: 175,
    buttons: 1,
    preventDefault() {},
    stopPropagation() {}
};
pointer.sendPointerEvent(event);
assert.equal(received.x, 310,
    "Scaled device offset must be subtracted after converting to logical pixels");
assert.equal(received.y, 220,
    "Y offset in device coordinates must not be multiplied by CSS scaling");
assert.equal(received.pressed, 1);
wasmRuntime.isDebuggerActive = true;
pointer.sendPointerEvent(event);
assert.equal(received.x, 480);
assert.equal(received.y, 320);
console.log("Run fit regression passed: oversized screens fit, 1:1 normal screens, zoom, correct scaled pointer events.");
