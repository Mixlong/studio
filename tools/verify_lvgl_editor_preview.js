"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");

const root = path.resolve(__dirname, "..");
let source = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/EditorPreview.ts"),
    "utf8"
);
source = source
    .replace(
        'import { ProjectEditor } from "project-editor/project-editor-interface";',
        ""
    )
    .replace(/export function /g, "function ");

class Widget {
    constructor(options = {}) {
        Object.assign(this, {
            top: 0,
            height: 0,
            children: []
        }, options);
    }
}
const environment = {
    module: { exports: {} },
    ProjectEditor: { LVGLWidgetClass: Widget }
};
vm.runInNewContext(
    stripTypeScriptTypes(source, { mode: "transform" }) +
        "\nmodule.exports = { getLVGLEditorPreviewHeight, getLVGLEditorWidgetHeight, resizeLVGLEditorObject };",
    environment
);

const {
    getLVGLEditorPreviewHeight,
    getLVGLEditorWidgetHeight,
    resizeLVGLEditorObject
} = environment.module.exports;

const rows = Array.from({ length: 8 }, (_, i) =>
    new Widget({ top: i * 79, height: 79 })
);
const scrollContainer = new Widget({
    top: 276, height: 364, children: rows
});
const screen = new Widget({
    height: 640, children: [
        new Widget({ top: 70, height: 72 }),
        scrollContainer
    ]
});
const page = {
    width: 960, height: 640, left: 0, top: 0,
    lvglScreenWidget: screen
};
const modelSnapshot = JSON.stringify(page);

assert.strictEqual(getLVGLEditorWidgetHeight(scrollContainer), 632);
assert.strictEqual(getLVGLEditorPreviewHeight(page), 948);
assert.strictEqual(JSON.stringify(page), modelSnapshot,
    "Expanded editing must not mutate screen size or widget coordinates");
assert.strictEqual(
    getLVGLEditorPreviewHeight({ ...page, lvglScreenWidget: undefined, components: [] }),
    640
);

const calls = [];
resizeLVGLEditorObject({
    _lv_obj_set_height: (obj, height) => calls.push(["height", obj, height]),
    _lv_obj_update_layout: obj => calls.push(["layout", obj])
}, 42, 948);
assert.strictEqual(JSON.stringify(calls), JSON.stringify([
    ["height", 42, 948],
    ["layout", 42]
]));

for (const lvglVersion of [
    "8.4.0", "9.2.2", "9.3.0", "9.4.0", "9.5.0"
]) {
    const generated = fs.readFileSync(
        path.join(
            root,
            "packages/project-editor/flow/runtime/wasm/lvgl_runtime_v" +
            lvglVersion + ".js"
        ),
        "utf8"
    );
    assert(generated.includes("_lv_obj_set_height"),
        "Missing WASM height API in " + lvglVersion);
    assert(generated.includes("_lv_obj_update_layout"),
        "Missing WASM layout API in " + lvglVersion);
}

console.log(
    "Real LVGL preview geometry passed: 960x640 device, " +
    "948px expanded render, 8 menu rows, all five WASM versions supported."
);
