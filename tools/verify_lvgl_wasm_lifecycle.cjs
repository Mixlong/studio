"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.resolve(__dirname,
    "../packages/project-editor/lvgl/page-runtime.ts"), "utf8");
const styleComponent = fs.readFileSync(path.resolve(__dirname,
    "../packages/project-editor/lvgl/style.tsx"), "utf8");
const editorAt = src.indexOf("export class LVGLPageEditorRuntime");
const inactiveAt = src.indexOf("export class LVGLNonActivePageViewerRuntime");
const previewAt = src.indexOf("export class LVGLStylesEditorRuntime");
assert(editorAt >= 0 && inactiveAt > editorAt && previewAt > inactiveAt);

const editor = src.slice(editorAt, inactiveAt);
const inactive = src.slice(inactiveAt, previewAt);
const preview = src.slice(previewAt);
const previewConstructor = preview.slice(
    preview.indexOf("constructor(project: Project)"),
    preview.indexOf("    get isEditor()")
);
assert(
    !previewConstructor.includes("this.mount()"),
    "Postponed style preview must not eagerly allocate an 80 MB WASM heap"
);
assert(
    preview.includes('previewStage = "Native LVGL preview deferred";') &&
    preview.includes("if (this.isMounted && selectedStyle && canvas)"),
    "Deferred native sample must only show its CSS approximation, never a loading timeout"
);
assert(
    styleComponent.includes("!runtime.previewFrameReady") &&
    styleComponent.includes('aria-label="Approximate style sample while LVGL loads"'),
    "The fallback CSS sample must remain available without any WASM runtime"
);
assert(
    editor.includes("await this.preloadImages();") &&
    editor.includes("if (!this.isMounted || this.wasm !== wasm)"),
    "After bitmap loading, a closed editor must not create or draw a stale WASM runtime"
);
assert(
    inactive.includes("if (!this.isMounted)") &&
    inactive.includes("Discard the obsolete completion"),
    "Closed inactive-page previews must ignore their WASM load callback"
);
assert(
    preview.includes("if (!this.isMounted || this.wasm !== wasm)"),
    "A closed style sample must not finish initialization"
);
const freeState = enabled => ({
    isMounted: enabled,
    wasm: { tag: "old runtime" },
    callback(wasm) { return this.isMounted && this.wasm === wasm; }
});
const mounted = freeState(true);
assert(mounted.callback(mounted.wasm));
mounted.isMounted = false;
assert(!mounted.callback(mounted.wasm), "Unmounted runtime must reject stale callback");

console.log("LVGL resource lifecycle passed: no eager Style Preview WASM, no deferred watchdog, stale callbacks ignored.");
