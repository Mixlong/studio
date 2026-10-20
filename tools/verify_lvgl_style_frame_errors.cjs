"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { runInAction } = require("mobx");
const file = path.join(__dirname, "../packages/project-editor/lvgl/page-runtime.ts");
const source = fs.readFileSync(file, "utf8");
const begin = source.indexOf("    tick = () => {", source.indexOf("export class LVGLStylesEditorRuntime"));
const end = source.indexOf("\n    unmount() {", begin);
assert(begin > 0 && end > begin, "Locate actual Style Preview tick function");
const snippet = source.slice(begin, end);
const scope = {
    module: { exports: {} }, runInAction,
    ImageData: class ImageData {
        constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
    },
    window: { requestAnimationFrame(callback) { this.next = callback; return 1; } },
    clearTimeout() {}, Uint8ClampedArray
};
vm.runInNewContext("class TickHarness {\n" + snippet + "\n}\nmodule.exports = TickHarness;", scope);
const TickHarness = scope.module.exports;
function createHarness(mainLoop) {
    const obj = new TickHarness();
    const size = 260 * 160 * 4;
    const mem = new Uint8Array(size + 2);
    for (let i = 1; i < size + 1; i += 4) mem.set([245,245,245,255],i);
    for (let y = 52; y < 108; y++) for (let x = 50; x < 210; x++) {
        const off = 1 + (y * 260 + x) * 4;
        mem.set([92,107,119,255], off);
    }
    obj.isMounted = true;
    obj.previewError = undefined;
    obj.previewStage = "Waiting for LVGL frame";
    obj.previewFrameReady = false;
    obj.previewObjectReady = true;
    obj.displayWidth = 260;
    obj.displayHeight = 160;
    obj.canvas = { getContext: () => ({ putImageData() { obj.drawCount++; } }) };
    obj.drawCount = 0;
    obj.wasm = { HEAPU8: mem, _mainLoop: mainLoop || (() => {}), _getSyncedBuffer: () => 1 };
    obj.reportPreviewError = err => { obj.previewError = err.message; obj.previewStage = "Failed"; };
    return obj;
}
const normal = createHarness();
normal.tick();
assert.equal(normal.previewFrameReady, true);
assert.equal(normal.previewStage, "Ready");
assert.equal(normal.drawCount, 1);
assert.equal(normal.previewError, undefined);
const throwing = createHarness(() => { throw new Error("native wasm failure"); });
throwing.tick();
assert.equal(throwing.previewStage, "Failed");
assert.match(throwing.previewError, /LVGL frame rendering failed during waiting for lvgl frame: (?:Error: )?native wasm failure/);
assert.equal(throwing.requestAnimationFrameId, undefined);
throwing.previewError = undefined;
throwing.wasm._mainLoop = () => {};
throwing.tick();
assert.equal(throwing.previewFrameReady, true, "Recovered LVGL frame should be drawable");
assert.equal(throwing.previewStage, "Ready");
assert(
    source.includes("if (!this.requestAnimationFrameId) {") &&
    source.includes("window.requestAnimationFrame(this.tick);"),
    "Successful style selection must restart frame loop after a failure"
);
// Regression: selecting a second style after Ready must still start a new
// watchdog. Previously previewFrameReady was true here, so it was skipped.
const styleClassStart = source.indexOf("export class LVGLStylesEditorRuntime");
const setStart = source.indexOf("    setSelectedStyle(", styleClassStart);
const setEnd = source.indexOf("\n}\n\n////////////////////////////////////////////////////////////////////////////////", setStart);
assert(setStart > 0 && setEnd > setStart);
const { stripTypeScriptTypes } = require("module");
const selectionClass = stripTypeScriptTypes(
    "class SelectionHarness {\n" + source.slice(setStart, setEnd) +
    "\n}\nmodule.exports = SelectionHarness;",
    { mode: "transform" }
);
const scheduled = [];
const timerSandbox = {
    module: { exports: {} },
    setTimeout(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimeout() {}
};
vm.runInNewContext(selectionClass, timerSandbox);
const selection = new timerSandbox.module.exports();
const sharedCanvas = {};
selection.selectedStyle = { name: "previous" };
selection.canvas = sharedCanvas;
selection.previewFrameReady = true;
selection.previewError = undefined;
selection.previewStage = "Waiting for LVGL frame";
selection.reportPreviewError = error => { selection.previewError = error.message; };
const nextStyle = { name: "new" };
selection.setSelectedStyle(nextStyle, sharedCanvas);
assert.equal(scheduled.length, 1, "New style must arm watchdog even after previous Ready");
assert.equal(scheduled[0].delay, 10000);
// The real MobX rebuild resets readiness after the new style is selected.
selection.previewFrameReady = false;
scheduled[0].callback();
assert.match(selection.previewError, /timed out during waiting for lvgl frame/);
console.log("Preview tests passed: pixel rendering, error handling, redraw recovery and style-switch watchdog.");
