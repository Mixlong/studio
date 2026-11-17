"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const source = fs.readFileSync(
    path.join(__dirname, "../packages/project-editor/lvgl/page-runtime.ts"),
    "utf8"
).replace(/\r\n/g, "\n");
const start = source.indexOf("    getFontPtr(font: Font) {");
const end = source.indexOf("    allocateUTF8(", start);
assert(start >= 0 && end > start, "Find production font-loading method");

const writes = [];
const frees = [];
const disposals = [];
let mtime = 1;
let nextFontPtr = 100;
let failCreation = false;
const virtualFs = {
    statSync(file) {
        assert.equal(file, "D:/fonts/cjk.ttf");
        return { mtimeMs: mtime, size: 4 };
    },
    readFileSync(file) {
        assert.equal(file, "D:/fonts/cjk.ttf");
        return Buffer.from([1, 2, 3, 4]);
    }
};
const wasm = {
    FS: { writeFile(file, contents) { writes.push({ file, contents }); } },
    stringToNewUTF8(file) {
        assert.match(file, /^\/runtime_font_[a-zA-Z0-9_-]+_22\.ttf$/);
        return 900;
    },
    _free(ptr) { frees.push(ptr); },
    _lvglCreateFreeTypeFont(ptr, size, mode, style) {
        assert.equal(ptr, 900);
        assert.equal(size, 22);
        assert.equal(mode, 0);
        assert.equal(style, 0);
        return failCreation ? 0 : ++nextFontPtr;
    },
    _lvglFreeFont(ptr) { disposals.push(ptr); }
};
const sandbox = {
    module: { exports: {} },
    fs: virtualFs,
    Buffer,
    Uint8Array,
    console: { error() {} }
};
vm.runInNewContext(
    stripTypeScriptTypes(
        "class FontHarness {\n" + source.slice(start, end) +
        "\n}\nmodule.exports = FontHarness;",
        { mode: "transform" }
    ),
    sandbox
);
const harness = new sandbox.module.exports();
harness.wasm = wasm;
harness.project = {
    _store: { getAbsoluteFilePath() { return "D:/fonts/cjk.ttf"; } }
};
harness.fontsCache = new Map();
harness.fontAddressToFont = new Map();

const font = {
    lvglUseFreeType: true,
    objID: "abc:def",
    name: "../unsafe/font",
    source: { filePath: "fonts/cjk.ttf", size: 22 },
    lvglFreeTypeRenderMode: "BITMAP",
    lvglFreeTypeStyle: "NORMAL"
};

const first = harness.getFontPtr(font);
assert.equal(first, 101);
assert.equal(harness.getFontPtr(font), first, "Unchanged face should use cache");
assert.equal(writes.length, 1);
assert.equal(writes[0].file, "/runtime_font_abc_def_22.ttf");
assert.deepEqual(frees, [900], "Virtual path allocation must be freed");
assert.equal(harness.fontAddressToFont.get(first), font);

mtime = 2;
const next = harness.getFontPtr(font);
assert.equal(next, 102);
assert.deepEqual(disposals, [first], "Old face must be released on file update");
assert.equal(harness.fontAddressToFont.has(first), false);
assert.deepEqual(frees, [900, 900]);

mtime = 3;
failCreation = true;
assert.equal(harness.getFontPtr(font), 0);
assert.equal(harness.fontsCache.has(font), false, "Failed handle must not be cached");
assert.equal(harness.fontAddressToFont.has(next), false);
failCreation = false;
assert.equal(harness.getFontPtr(font), 103, "Failed font must be retryable");
assert.equal(frees.length, 4, "Every UTF-8 allocation must be freed");

console.log("FreeType font regression passed: cache reuse, source changes, safe path, pointer cleanup, failed-handle retry.");
