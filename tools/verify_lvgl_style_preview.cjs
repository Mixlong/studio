"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
    makeObservable,
    observable,
    action,
    autorun,
    runInAction
} = require("mobx");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/page-runtime.ts"),
    "utf8"
);
const view = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/style.tsx"),
    "utf8"
);
const runtimeStart = runtime.indexOf("export class LVGLStylesEditorRuntime");
assert(runtimeStart > 0);
const runtimeSource = runtime.slice(runtimeStart);
assert(
    runtimeSource.includes("canvas: observable.ref,") &&
    runtimeSource.includes("selectedStyle: observable,") &&
    runtimeSource.includes("setSelectedStyle: action"),
    "Changing a preview canvas must be reactive along with style selection"
);
assert(
    runtimeSource.includes('component.type === "LVGLButtonWidget"') &&
    runtimeSource.includes("component.left = Math.max(0") &&
    runtimeSource.includes("component.top = Math.max(0"),
    "Preview-only widget samples must be centered for visibility"
);
assert(
    view.includes('Style Sample: {selectedStyle.name}') &&
    view.includes('selectedStyle.forWidgetType.replace(/^LVGL/, "")') &&
    view.includes("Select a style to preview it.") &&
    view.includes("Preview is unavailable for this widget type"),
    "Style preview must identify the sample type and describe empty/unsupported states"
);
assert(
    runtimeSource.includes('(component as LVGLLabelWidget).text = "Aa Sample";') &&
    runtimeSource.includes("previewError: observable,") &&
    view.includes("Style sample failed: {runtime.previewError}"),
    "Label examples must show visible sample text and runtime failures must be explained"
);
assert(
    runtimeSource.includes("previewFrameReady: observable,") &&
    runtimeSource.includes("previewObjectReady: observable,") &&
    runtimeSource.includes("this.wasm._lvglObjInvalidate(") &&
    view.includes('"Approximate preview - " +') &&
    view.includes("runtime.previewStage") &&
    view.includes('"Rendering..."') &&
    view.includes('"Ready"') &&
    view.includes("minHeight: runtime.displayHeight") &&
    view.includes('aria-label="Approximate style sample while LVGL loads"') &&
    view.includes('sampleStyle?.bg_color') &&
    view.includes('"Aa Sample"'),
    "Preview must remain visible during LVGL startup and expose its state"
);
assert(
    runtimeSource.includes("private initializationTimeout:") &&
    runtimeSource.includes("this.reportPreviewError(error);") &&
    runtimeSource.includes("LVGL preview timed out during ") &&
    runtimeSource.includes("this.previewStage.toLowerCase()") &&
    runtimeSource.includes("LVGL frame rendering failed during ") &&
    runtimeSource.includes("previewStage: observable,") &&
    runtimeSource.includes("clearTimeout(this.initializationTimeout);"),
    "WASM initialization errors and stalls must surface rather than hanging forever"
);
const styleSource = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/widgets/Base.tsx"),
    "utf8"
);
assert(
    styleSource.includes("if (this._useStyleForStylePreview) {\n            return undefined;"),
    "Style preview marker must not alter normal widget style selection"
);
assert(
    runtimeSource.includes("width: LVGLStylesEditorRuntime.PREVIEW_WIDTH,") &&
    runtimeSource.includes("height: LVGLStylesEditorRuntime.PREVIEW_HEIGHT,"),
    "Synthetic page and renderer must use identical framebuffer dimensions"
);
const styleRebuild = runtimeSource.indexOf("this.createPreviewStyles(selectedStyle);");
const widgetRebuild = runtimeSource.indexOf("const nativeSample = selectedWidget");
const explicitStyleApply = runtimeSource.indexOf("this.selectedStyle.lvglAddStyleToObject(");
assert(styleRebuild >= 0 && styleRebuild < widgetRebuild,
    "Selected style must be compiled before creating the sample");
assert(explicitStyleApply > widgetRebuild,
    "Selected style must be attached to the actual native or synthetic widget");
assert(
    runtimeSource.includes("createNativeStyleSample(") &&
    runtimeSource.includes("nativeSample.widgetObj") &&
    runtimeSource.includes("nativeSample.screenObj") &&
    runtimeSource.includes("this.createPreviewStyles(selectedStyle);"),
    "Button/Label preview must bypass the fragile synthetic widget creator"
);
const oldScreenRelease = runtimeSource.indexOf("this.wasm._lvglDeleteObject(this.page._lvglObj);");
const oldStyleRelease = runtimeSource.indexOf("this.deleteStyles();");
assert(oldScreenRelease >= 0 && oldStyleRelease > oldScreenRelease,
    "Old style allocations must not be freed while their prior screen still uses them");

// Demonstrate why the previous plain canvas reference was insufficient:
// when only the actual DOM canvas changes, the autorun must be invalidated.
class PreviewModel {
    canvas = null;
    selectedStyle = undefined;
    constructor() {
        makeObservable(this, {
            canvas: observable.ref,
            selectedStyle: observable,
            setSelectedStyle: action
        });
    }
    setSelectedStyle(style, canvas) {
        this.selectedStyle = style;
        this.canvas = canvas;
    }
}
const preview = new PreviewModel();
let runs = 0;
const stop = autorun(() => {
    preview.selectedStyle;
    preview.canvas;
    runs++;
});
const style = { name: "my_back_button" };
const canvas1 = {};
const canvas2 = {};
preview.setSelectedStyle(style, canvas1);
assert.equal(runs, 2);
preview.setSelectedStyle(style, canvas2);
assert.equal(runs, 3, "Canvas remount with same style must retrigger draw");
preview.setSelectedStyle(style, null);
assert.equal(runs, 4, "Canvas unmount must invalidate preview draw");
stop();


// Execute the actual runtime selection block in isolation. In the previous
// implementation the entire palette was mounted and hidden, causing black
// previews when an unrelated widget's creation failed or overlapped the sample.
const { stripTypeScriptTypes } = require("module");
const vm = require("vm");
const sampleBlockStart = runtimeSource.indexOf("const screen = this.page.lvglScreenWidget!;");
const sampleBlockEnd = runtimeSource.indexOf("const nativeSample = selectedWidget", sampleBlockStart);
assert(sampleBlockStart >= 0 && sampleBlockEnd > sampleBlockStart);
const sampleTs = "function renderSelectedSample() {\n" +
    runtimeSource.slice(sampleBlockStart, sampleBlockEnd) +
    "\n}\nmodule.exports = renderSelectedSample;";
const sampleJs = stripTypeScriptTypes(sampleTs, { mode: "transform" });
const sandbox = { module: { exports: {} }, runInAction };
vm.runInNewContext(sampleJs, sandbox);
const renderSelectedSample = sandbox.module.exports;
const screen = { children: [], type: "LVGLScreenWidget" };
const label = { type: "LVGLLabelWidget", text: "Text", states: "" };
const button = { type: "LVGLButtonWidget", states: "" };
const sampleRuntime = {
    page: { lvglScreenWidget: screen },
    lvglWidgetsMap: new Map([
        [screen.type, screen],
        [label.type, label],
        [button.type, button]
    ]),
    selectedStyle: { name: "main_tab_label_menu", forWidgetType: label.type },
    project: { _store: { uiStateStore: { lvglState: "DEFAULT" } } }
};
renderSelectedSample.call(sampleRuntime);
assert.equal(screen.children.length, 1);
assert.equal(screen.children[0], label, "Only the selected label must be rendered");
assert.equal(label._useStyleForStylePreview, "main_tab_label_menu");
assert.equal(label.text, "Text", "Label sample must have visible sample text");
const sameChildren = screen.children;
sampleRuntime.selectedStyle = { name: "another_label", forWidgetType: label.type };
renderSelectedSample.call(sampleRuntime);
assert.equal(screen.children, sameChildren, "Same sample type must not remount widget tree");
assert.equal(label._useStyleForStylePreview, "another_label");
sampleRuntime.selectedStyle = { name: "my_back_button", forWidgetType: button.type };
renderSelectedSample.call(sampleRuntime);
assert.equal(screen.children.length, 1);
assert.equal(screen.children[0], button, "Button sample must replace the label");
assert.equal(button._useStyleForStylePreview, "my_back_button");
sampleRuntime.selectedStyle = undefined;
renderSelectedSample.call(sampleRuntime);
assert.equal(screen.children.length, 0, "No selection must clear preview widgets");
assert.equal(button._useStyleForStylePreview, "");
assert(
    !runtimeSource.includes("createStyles(styles:"),
    "Style preview must not change the shared LVGL createStyles API"
);

console.log(
    "LVGL style preview test passed: selected-only LVGL widget mounting, matching sample style, visible label text, responsive canvas and error reporting."
);
