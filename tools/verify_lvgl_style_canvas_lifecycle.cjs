"use strict";

// Focused regression for the current upstream-style LVGL canvas preview.
// This deliberately does not require the removed custom Style Sample UI.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");
const { action, autorun, makeObservable, observable } = require("mobx");

const root = path.join(__dirname, "..");
const runtime = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/page-runtime.ts"),
    "utf8"
).replace(/\r\n/g, "\n");
const styleView = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/style.tsx"),
    "utf8"
).replace(/\r\n/g, "\n");

const classStart = runtime.indexOf("export class LVGLStylesEditorRuntime");
assert(classStart !== -1, "Style runtime must exist");
const previewRuntime = runtime.slice(classStart);
assert(
    previewRuntime.includes("canvas: observable.ref,"),
    "Canvas identity must be observable so remounting a tab redraws the selected style"
);
assert(
    previewRuntime.includes("if (this.wasm != wasm || !this.isMounted)"),
    "Late WASM initialization must not restart an unmounted preview"
);
assert(
    styleView.includes("<canvas") &&
        styleView.includes("ref={this.canvasRef}"),
    "Keep the original native LVGL canvas in the Style preview"
);

// Run the actual setSelectedStyle method inside a minimal MobX harness.
const selectionStart = previewRuntime.indexOf("    setSelectedStyle(");
const selectionEnd = previewRuntime.indexOf(
    "\n}\n\n////////////////////////////////////////////////////////////////////////////////",
    selectionStart
);
assert(selectionStart >= 0 && selectionEnd > selectionStart);
const selectionMethod = previewRuntime.slice(selectionStart, selectionEnd);
const selectionTypeScript =
    "class PreviewSelectionHarness {\n" +
    "    selectedStyle = undefined;\n" +
    "    canvas = null;\n" +
    "    constructor() {\n" +
    "        makeObservable(this, {\n" +
    "            selectedStyle: observable,\n" +
    "            canvas: observable.ref,\n" +
    "            setSelectedStyle: action\n" +
    "        });\n" +
    "    }\n" +
    selectionMethod +
    "\n}\nmodule.exports = PreviewSelectionHarness;";
const selectionJS = stripTypeScriptTypes(selectionTypeScript, {
    mode: "transform"
});
const selectionSandbox = {
    module: { exports: {} },
    makeObservable,
    observable,
    action
};
vm.runInNewContext(selectionJS, selectionSandbox);
const preview = new selectionSandbox.module.exports();
const values = [];
const stop = autorun(() => {
    values.push({
        style: preview.selectedStyle?.name,
        canvas: preview.canvas
    });
});
const selectedStyle = { name: "selected_button_style" };
const firstCanvas = { id: 1 };
const secondCanvas = { id: 2 };
preview.setSelectedStyle(selectedStyle, firstCanvas);
preview.setSelectedStyle(selectedStyle, secondCanvas);
preview.setSelectedStyle(selectedStyle, null);
preview.setSelectedStyle(undefined, null);
stop();
assert.strictEqual(values.length, 5, "Initial + style + canvas remount + unmount + clear must each react");
assert.strictEqual(values[2].canvas, secondCanvas, "New canvas must trigger the preview reaction");
assert.strictEqual(values[3].style, selectedStyle.name, "Canvas removal must not discard current style selection");
assert.strictEqual(values[4].style, undefined, "Final unmount must clear the selected style");

// Rapid Style changes must invalidate the reaction without replacing the
// current canvas or leaking stale selections.
const rapidPreview = new selectionSandbox.module.exports();
let rapidRuns = 0;
const stopRapid = autorun(() => {
    rapidPreview.selectedStyle;
    rapidPreview.canvas;
    rapidRuns++;
});
for (let i = 0; i < 20; i++) {
    rapidPreview.setSelectedStyle(
        { name: "rapid_style_" + i },
        secondCanvas
    );
}
assert.strictEqual(rapidRuns, 21, "Twenty different selections must trigger twenty updates");
const oldRuns = rapidRuns;
rapidPreview.setSelectedStyle(rapidPreview.selectedStyle, rapidPreview.canvas);
assert.strictEqual(rapidRuns, oldRuns, "Unchanged selection and canvas must not redraw again");
stopRapid();

// Execute the actual animation-frame method to catch callbacks racing with unmount.
const tickStart = previewRuntime.indexOf("    tick = () => {");
const tickEnd = previewRuntime.indexOf("\n    unmount() {", tickStart);
assert(tickStart >= 0 && tickEnd > tickStart);
let frameRequests = 0;
const tickSandbox = {
    module: { exports: {} },
    Uint8ClampedArray,
    ImageData: class {
        constructor(data, width, height) {
            this.data = data;
            this.width = width;
            this.height = height;
        }
    },
    window: {
        requestAnimationFrame() {
            frameRequests++;
            return frameRequests;
        }
    }
};
vm.runInNewContext(
    "class PreviewTickHarness {\n" +
        previewRuntime.slice(tickStart, tickEnd) +
        "\n}\nmodule.exports = PreviewTickHarness;",
    tickSandbox
);
const runner = new tickSandbox.module.exports();
let wasmFrames = 0;
let canvasDraws = 0;
runner.displayWidth = 2;
runner.displayHeight = 2;
runner.wasm = {
    _mainLoop() { wasmFrames++; },
    _getSyncedBuffer() { return 1; },
    HEAPU8: new Uint8Array(17)
};
runner.canvas = {
    getContext() {
        return { putImageData() { canvasDraws++; } };
    }
};

runner.isMounted = false;
runner.requestAnimationFrameId = 123;
runner.tick();
assert.strictEqual(runner.requestAnimationFrameId, undefined);
assert.strictEqual(wasmFrames, 0);
assert.strictEqual(frameRequests, 0);

runner.isMounted = true;
runner.tick();
assert.strictEqual(wasmFrames, 1);
assert.strictEqual(canvasDraws, 1);
assert.strictEqual(frameRequests, 1);

runner.isMounted = false;
runner.tick();
assert.strictEqual(wasmFrames, 1, "Unmounted WASM must not run another frame");
assert.strictEqual(frameRequests, 1, "Unmounted preview must not queue another animation frame");
assert.strictEqual(runner.requestAnimationFrameId, undefined);

console.log(
    "LVGL Style canvas lifecycle passed: canvas remount is reactive; " +
    "late WASM initialization and obsolete animation frames are guarded."
);
