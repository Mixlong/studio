"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");

// Exercise the production cache implementation without loading Electron UI.
const sourcePath = path.join(
    __dirname,
    "../../packages/project-editor/store/fonts-cache.ts"
);
let source = fs.readFileSync(sourcePath, "utf8");
source = source
    .replace('import fs from "fs";', 'const fs = require("fs");')
    .replace(
        'import * as notification from "eez-studio-ui/notification";',
        'const notification = require("eez-studio-ui/notification");'
    )
    .replace(
        'import { isScrapbookItemFilePath } from "project-editor/store/scrapbook";',
        'const { isScrapbookItemFilePath } = require("project-editor/store/scrapbook");'
    )
    .replace("export class FontsCacheStore", "class FontsCacheStore");

const compiled =
    stripTypeScriptTypes(source, { mode: "transform" }) +
    "\nmodule.exports = { FontsCacheStore };";
const runtimeModule = { exports: {} };
vm.runInNewContext(compiled, {
    module: runtimeModule,
    exports: runtimeModule.exports,
    console,
    require: id => {
        if (id === "fs") return fs;
        if (id === "project-editor/store/scrapbook") {
            return { isScrapbookItemFilePath: () => false };
        }
        if (id === "eez-studio-ui/notification") {
            return { error: message => { throw new Error(message); } };
        }
        throw new Error("Unexpected module: " + id);
    }
});

const { FontsCacheStore } = runtimeModule.exports;

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-font-cache-"));
    const filePath = path.join(dir, "fixture.eez-project");
    const projectStore = {
        filePath,
        project: {
            settings: { general: { cacheFonts: true } },
            fonts: []
        }
    };
    const cache = new FontsCacheStore(projectStore);
    const cachePath = filePath + "-fonts-cache";

    try {
        await cache.save();
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(cachePath, "utf8")), []);

        fs.writeFileSync(cachePath, '{"invalid":"shape"}');
        await cache.load();
        assert.strictEqual(cache.fontsCache.length, 0);

        const params = { absoluteFilePath: "fixture.ttf", size: 14 };
        const valid = {
            extractFontParams: params,
            binFile: "binary",
            sourceFile: "source"
        };
        fs.writeFileSync(cachePath, JSON.stringify([{}, null, valid]));
        await cache.load();
        assert.strictEqual(cache.fontsCache.length, 1);
        assert.strictEqual(
            cache.getCachedFontDefinition(params).lvglBinFile,
            "binary"
        );

        projectStore.project.fonts = [{
            _lvglFontDefinitionExtractFontParams: params,
            _lvglFontDefinition: { binFile: "updated", sourceFile: "updated-source" }
        }];
        await cache.save();
        assert.strictEqual(
            cache.getCachedFontDefinition(params).lvglBinFile,
            "updated"
        );

        console.log("Font cache regression verification passed.");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
