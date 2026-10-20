"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");
const { autorun, makeObservable, observable, runInAction } = require("mobx");
const { createNativeStyleSample } = require("../build/project-editor/lvgl/style-sample-native.js");

const src = fs.readFileSync(
    path.join(__dirname, "../packages/project-editor/lvgl/page-runtime.ts"), "utf8"
);
const classAt = src.indexOf("export class LVGLStylesEditorRuntime");
const begin = src.indexOf("                this.autorRunDispose = autorun(() => {", classAt);
const end = src.indexOf("\n                });\n                } catch (error)", begin);
assert(begin > 0 && end > begin, "Find production preview reaction");
const source = src.slice(begin, end + "\n                });".length);
const tickStart = src.indexOf("    tick = () => {", classAt);
const tickEnd = src.indexOf("    unmount() {", tickStart);
assert(tickStart > 0 && tickEnd > tickStart);
const tickSource = src.slice(tickStart, tickEnd);
const typeStripped = stripTypeScriptTypes(
    "class PreviewReactionHarness {\n"
    + "run() {\n" + source + "\n}\n" + tickSource + "\n}\n"
    + "module.exports = PreviewReactionHarness;",
    { mode: "transform" }
);
const sandbox = {
    module: { exports: {} }, autorun, runInAction,
    createNativeStyleSample,
    LVGLPageRuntime: {}, Uint8ClampedArray,
    ImageData: class ImageData {
        constructor(data, width, height) {
            this.data = data;
            this.width = width;
            this.height = height;
        }
    },
    clearTimeout() {}, console, window: { requestAnimationFrame() { return 7; } }
};
vm.runInNewContext(typeStripped, sandbox);
const Harness = sandbox.module.exports;

function actualStyle(wasm) {
    return {
        name: "my_back_button",
        forWidgetType: "LVGLButtonWidget",
        lvglCreateStyles() {
            const obj = wasm._lvglStyleCreate();
            wasm._lvglStyleSetPropColor(obj, 32, 0x5c6b77);
            return { MAIN: { DEFAULT: obj } };
        },
        lvglAddStyleToObject(runtime, obj) {
            const style = runtime.styleObjMap.get(this);
            assert(style);
            wasm._lvglObjAddStyle(obj, style.MAIN.DEFAULT, 0);
        }
    };
}

async function run() {
    const constructor = require("../packages/project-editor/flow/runtime/wasm/lvgl_runtime_v8.4.0.js");
    let wasm;
    await new Promise((resolve, reject) => {
        wasm = constructor(() => {
            try {
                wasm._init(0, 0, 0, 0, 260, 160, false, 0, false);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });

    const screen = { type: "LVGLScreenWidget", children: [] };
    const button = {
        type: "LVGLButtonWidget", _lvglObj: undefined, states: "", _useStyleForStylePreview: ""
    };
    makeObservable(screen, { children: observable.ref });
    makeObservable(button, { _lvglObj: observable, states: observable });
    const harness = new Harness();
    harness.isMounted = true;
    harness.wasm = wasm;
    harness.lvglVersion = "8.4.0";
    harness.selectedStyle = undefined;
    harness.previewError = undefined;
    harness.previewStage = "Initializing LVGL";
    harness.lastFrame = null;
    harness.canvas = {
        getContext() {
            return { putImageData(imageData) {
                harness.lastFrame = Uint8Array.from(imageData.data);
            } };
        }
    };
    harness.reportPreviewError = err => { harness.previewError = String(err); };
    harness.previewFrameReady = false;
    harness.previewObjectReady = false;
    harness.lvglWidgetsMap = new Map([[screen.type, screen], [button.type, button]]);
    harness.page = { lvglScreenWidget: screen, _lvglWidgets: [button], _lvglObj: undefined,
        lvglCreate() { return wasm._lvglCreateScreen(0, 0, 0, 0, 260, 160); } };
    harness.project = { _store: { uiStateStore: { lvglState: "DEFAULT" } } };
    harness.displayWidth = 260;
    harness.displayHeight = 160;
    harness.styleObjMap = new Map();
    harness.oldStyleObjMap = new Map();
    harness.freeAllButtonMatrixBuffers = () => {};
    harness.freeAllMsgboxBuffers = () => {};
    harness.createPreviewStyles = style => {
        for (const [key, value] of harness.styleObjMap) harness.oldStyleObjMap.set(key, value);
        harness.styleObjMap.clear();
        if (style) harness.styleObjMap.set(style, style.lvglCreateStyles(harness));
    };
    harness.deleteStyles = () => {
        for (const values of harness.oldStyleObjMap.values()) {
            for (const part of Object.values(values)) for (const style of Object.values(part))
                wasm._lvglStyleDelete(style);
        }
        harness.oldStyleObjMap.clear();
    };
    harness.reportPreviewError = err => { harness.previewError = String(err); };
    makeObservable(harness, { selectedStyle: observable.ref, previewObjectReady: observable,
        previewStage: observable, previewError: observable, previewFrameReady: observable });

    harness.run();
    assert.equal(harness.previewError, undefined, "Initial unselected preview");
    const style = actualStyle(wasm);
    runInAction(() => harness.selectedStyle = style);
    assert.equal(harness.previewError, undefined, "Selecting a style should create native objects");
    assert.equal(harness.previewObjectReady, true);
    assert(harness.page._lvglObj > 0);
    assert(button._lvglObj > 0);
    harness.tick();
    assert.equal(harness.previewFrameReady, true, "Real LVGL frame must make native preview Ready");
    assert.equal(harness.previewStage, "Ready");
    assert(harness.lastFrame, "Canvas must receive native LVGL ImageData");
    const pixels = harness.lastFrame;
    const background = pixels.slice(0, 3);
    let nonBg = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== background[0] ||
            pixels[i + 1] !== background[1] ||
            pixels[i + 2] !== background[2]) nonBg++;
    }
    assert(nonBg > 1500, "Actual Canvas frame must contain the styled Button");
    const center = (80 * 260 + 130) * 4;
    console.log("Initial selection OK. Pixels:", nonBg,
        "corner:", Array.from(pixels.slice(0, 4)),
        "center:", Array.from(pixels.slice(center, center + 4)));

    const previousObject = button._lvglObj;
    runInAction(() => harness.selectedStyle = undefined);
    assert.equal(harness.previewError, undefined, "Removing style should succeed");
    runInAction(() => harness.selectedStyle = style);
    assert.equal(harness.previewError, undefined, "Re-selecting style should rebuild");
    assert.equal(harness.previewObjectReady, true);
    assert.equal(harness.previewFrameReady, false, "New style must invalidate prior frame");
    for (let frame = 0; frame < 12 && !harness.previewFrameReady; frame++) {
        await new Promise(resolve => setTimeout(resolve, 30));
        harness.tick();
    }
    assert(harness.lastFrame, "Reselected style must produce a real Canvas frame");
    console.log("RESELECT", JSON.stringify({
        frameReady: harness.previewFrameReady,
        objectReady: harness.previewObjectReady,
        stage: harness.previewStage,
        error: harness.previewError
    }));
    assert.equal(harness.previewFrameReady, true, "Frame loop must recover after style change");
    assert(button._lvglObj > 0);
    assert(harness.page._lvglObj > 0);
    harness.autorRunDispose();
    console.log("Actual MobX autorun + WASM style selection/reselection passed.");
}
run().catch(e => {console.error(e.stack || e);process.exitCode=1;});
setTimeout(() => process.exit(2), 15000).unref();
