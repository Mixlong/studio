"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makeObservable, observable, computed, autorun, action } = require("mobx");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/page-runtime.ts"),
    "utf8"
);
const bitmap = fs.readFileSync(
    path.join(root, "packages/project-editor/features/bitmap/bitmap.tsx"),
    "utf8"
);

const editorStart = runtime.indexOf("export class LVGLPageEditorRuntime");
const editorEnd = runtime.indexOf("export class LVGLNonActivePageViewerRuntime");
assert(editorStart >= 0 && editorEnd > editorStart);
const editor = runtime.slice(editorStart, editorEnd);

assert(
    editor.includes("await this.preloadImages();"),
    "Editor runtime must still preload bitmap assets before WASM init"
);
assert(
    editor.includes('getAllObjectsOfType(\n                            "bitmaps"\n                        )') &&
    editor.includes("(bitmapObject.object as Bitmap).imageElement"),
    "Editor autorun must observe async bitmap imageElement state"
);
assert(
    bitmap.includes("_imageElement: observable") &&
    bitmap.includes("imageElement: computed({ keepAlive: true })"),
    "Bitmap load state must be observable for the editor autorun to refresh"
);

// Behavior proof: this models the same undefined -> loaded transition.
class AsyncBitmap {
    _imageElement = undefined;
    constructor() {
        makeObservable(this, {
            _imageElement: observable.ref,
            imageElement: computed,
            finish: action
        });
    }
    get imageElement() {
        return this._imageElement;
    }
    finish(value) {
        this._imageElement = value;
    }
}
const assets = [new AsyncBitmap(), new AsyncBitmap()];
let renders = 0;
const stop = autorun(() => {
    assets.forEach(asset => asset.imageElement);
    renders++;
});
assert.equal(renders, 1);
assets[0].finish({ width: 555, height: 152 });
assert.equal(renders, 2, "Loaded image must invalidate editor rendering");
assets[1].finish(null);
assert.equal(renders, 3, "Failed image completion must also settle rendering");
stop();

console.log(
    "LVGL bitmap refresh regression passed: late bitmap load invalidates the editor preview."
);
