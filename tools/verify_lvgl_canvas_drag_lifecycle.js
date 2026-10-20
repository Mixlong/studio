"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const file = path.join(
    __dirname,
    "../packages/project-editor/lvgl/Page.tsx"
);
const source = fs.readFileSync(file, "utf8");
const start = source.indexOf("        componentDidUpdate() {");
const end = source.indexOf("\n        componentWillUnmount()", start);
assert(start >= 0 && end > start, "LVGLPage update lifecycle not found");

const snippet = source.slice(start, end);
const context = { module: { exports: {} } };
vm.runInNewContext(
    "class Harness {\n" + snippet + "\n}\nmodule.exports = Harness;",
    context
);
const Harness = context.module.exports;

const configs = {
    page: {},
    width: 960,
    height: 640,
    version: "9.2.2",
    darkTheme: false,
    runtimeMode: false,
    expanded: true
};

let activeConfig = { ...configs };
let retired = 0;
let mounted = 0;
const target = new Harness();
target.runtimeConfig = { ...configs };
target.runtime = { unmount() { retired++; } };
target.getRuntimeConfig = () => activeConfig;
target.createPageRuntime = () => {
    mounted++;
    target.runtimeConfig = { ...activeConfig };
    target.runtime = { unmount() { retired++; } };
};

// Dragging/selecting child nodes may trigger repeated React updates without
// changing preview geometry. Those must not restart the LVGL frame loop.
for (let i = 0; i < 100; i++) target.componentDidUpdate();
assert.equal(retired, 0);
assert.equal(mounted, 0);

// A real geometry change requires one restart to resize the WASM framebuffer.
activeConfig = { ...activeConfig, height: 948 };
target.componentDidUpdate();
assert.equal(retired, 1);
assert.equal(mounted, 1);
for (let i = 0; i < 40; i++) target.componentDidUpdate();
assert.equal(retired, 1, "WASM must not continually restart on drag");

// Switching device-mode, LVGL version, or page still needs a new renderer.
for (const updated of [
    { expanded: false, height: 640 },
    { version: "9.4.0" },
    { page: {} }
]) {
    activeConfig = { ...activeConfig, ...updated };
    target.componentDidUpdate();
}
assert.equal(retired, 4);
assert.equal(mounted, 4);
// A WASM frame buffer is allocated at _init. Dragging an item may grow
// the editor's virtual content height before React commits a new runtime.
// The old instance must keep reading its original buffer dimensions.
const runtimeSource = fs.readFileSync(
    path.join(__dirname, "../packages/project-editor/lvgl/page-runtime.ts"),
    "utf8"
);
const getWidthStart = runtimeSource.indexOf(
    "    get displayWidth() {",
    runtimeSource.indexOf("export class LVGLPageEditorRuntime")
);
const mountStart = runtimeSource.indexOf("    mount() {", getWidthStart);
assert(getWidthStart > 0 && mountStart > getWidthStart);
const runtimeGetters = runtimeSource.slice(getWidthStart, mountStart);
const dimensionsContext = {
    module: { exports: {} },
    getLVGLEditorPreviewHeight: page => page.expandedHeight
};
vm.runInNewContext(
    "class RuntimeDimensions {\n" + runtimeGetters +
        "\n}\nmodule.exports = RuntimeDimensions;",
    dimensionsContext
);
const frames = new dimensionsContext.module.exports();
frames.page = { width: 960, height: 640, expandedHeight: 940 };
frames.isExpandedEditorPreview = true;
assert.equal(frames.displayWidth, 960);
assert.equal(frames.displayHeight, 940);
frames.initializedDisplayWidth = frames.displayWidth;
frames.initializedDisplayHeight = frames.displayHeight;
frames.page.width = 1024;
frames.page.expandedHeight = 1400;
assert.equal(frames.displayWidth, 960, "Old WASM buffer width must stay fixed");
assert.equal(frames.displayHeight, 940, "Old WASM buffer height must stay fixed");
frames.initializedDisplayWidth = undefined;
frames.initializedDisplayHeight = undefined;
assert.equal(frames.displayWidth, 1024);
assert.equal(frames.displayHeight, 1400);

console.log("LVGL canvas drag lifecycle verified: 140 drag updates do not restart WASM; framebuffer dimensions remain fixed until remount.");
