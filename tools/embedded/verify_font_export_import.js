"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");

const root = path.resolve(__dirname, "../..");

function loadHelper(relativePath, exportName, replacements) {
    let source = fs.readFileSync(path.join(root, relativePath), "utf8");
    for (const [from, to] of replacements) {
        assert(source.includes(from), "Missing helper source: " + from);
        source = source.replace(from, to);
    }
    const compiled = stripTypeScriptTypes(source, { mode: "transform" });
    const runtimeModule = { exports: {} };
    vm.runInNewContext(
        compiled + "\nmodule.exports = { " + exportName + " };",
        { module: runtimeModule, exports: runtimeModule.exports, require, console }
    );
    return runtimeModule.exports[exportName];
}

const exportFontWithRecovery = loadHelper(
    "packages/project-editor/features/font/font-export-recovery.ts",
    "exportFontWithRecovery",
    [["export async function", "async function"]]
);
const embedFontSource = loadHelper(
    "packages/project-editor/features/font/font-source-portability.ts",
    "embedFontSource",
    [
        ['import fs from "fs";', 'const fs = require("fs");'],
        ["export function", "function"]
    ]
);

async function testDecisions() {
    let attempts = 0;
    let prompted = 0;
    const retried = await exportFontWithRecovery(
        async () => {
            if (++attempts === 1) throw new Error("font converter unavailable");
        },
        async error => {
            assert(error.message.includes("font converter"));
            prompted++;
            return "retry";
        }
    );
    assert.strictEqual(retried, true);
    assert.strictEqual(attempts, 2);
    assert.strictEqual(prompted, 1);

    const skipped = await exportFontWithRecovery(
        async () => { throw new Error("file missing"); },
        async () => "skip"
    );
    assert.strictEqual(skipped, false);

    await assert.rejects(
        () => exportFontWithRecovery(
            async () => { throw new Error("file missing"); },
            async () => "cancel"
        ),
        /Font export cancelled.*file missing/
    );
}

async function testPortableFontSources() {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "digi-studio-font-roundtrip-")
    );
    try {
        const original = path.join(
            root, "packages/eez-studio-ui/_stylesheets/Roboto-Regular.ttf"
        );
        const primaryPath = path.join(directory, "primary.ttf");
        const additionalPath = path.join(directory, "additional.ttf");
        fs.copyFileSync(original, primaryPath);
        fs.copyFileSync(original, additionalPath);

        const projectJson = {
            fonts: [{
                name: "Test Font",
                source: { filePath: "primary.ttf", size: 18 },
                lvglAdditionalSources: [{
                    filePath: "additional.ttf",
                    lvglRanges: "66",
                    lvglSymbols: ""
                }]
            }]
        };
        const font = projectJson.fonts[0];
        const resolvePath = value => path.join(directory, value);
        embedFontSource(font, font.source.filePath, font.name, resolvePath);
        for (const item of font.lvglAdditionalSources) {
            embedFontSource(item, item.filePath, font.name, resolvePath);
        }
        assert(font.embeddedFontFile);
        assert(font.lvglAdditionalSources[0].embeddedFontFile);

        // Simulate exporting the project, moving it to another computer and
        // importing it where neither original font path exists anymore.
        const serialized = JSON.stringify(projectJson);
        fs.rmSync(primaryPath);
        fs.rmSync(additionalPath);
        const loaded = JSON.parse(serialized).fonts[0];

        // Re-saving an imported project must use embedded bytes, even when
        // the source files are no longer available on this computer.
        embedFontSource(
            loaded, loaded.source.filePath, loaded.name, resolvePath
        );
        embedFontSource(
            loaded.lvglAdditionalSources[0],
            loaded.lvglAdditionalSources[0].filePath,
            loaded.name,
            resolvePath
        );
        assert.throws(
            () => embedFontSource(
                {}, "missing.ttf", "Missing", resolvePath
            ),
            /Cannot embed font.*missing.ttf/
        );

        const collectFontData = require("lv_font_conv/lib/collect_font_data");
        const binaryWriter = require("lv_font_conv/lib/writers/bin");
        const sourceWriter = require("lv_font_conv/lib/writers/lvgl");
        const args = {
            font: [
                {
                    source_path: loaded.source.filePath,
                    source_bin: Buffer.from(loaded.embeddedFontFile, "base64"),
                    ranges: [{ range: [65, 65, 65], symbols: "" }]
                },
                {
                    source_path: loaded.lvglAdditionalSources[0].filePath,
                    source_bin: Buffer.from(
                        loaded.lvglAdditionalSources[0].embeddedFontFile,
                        "base64"
                    ),
                    ranges: [{ range: [66, 66, 66], symbols: "" }]
                }
            ],
            size: 18,
            bpp: 4,
            no_compress: true,
            lcd: false,
            lcd_v: false,
            use_color_info: false,
            output: "ui_font_roundtrip",
            no_kerning: false,
            no_prefilter: false,
            fast_kerning: false
        };
        const glyphs = await collectFontData(args);
        assert(glyphs.glyphs.length >= 2);
        assert(binaryWriter(args, glyphs)[args.output].length > 0);
        assert(sourceWriter(args, glyphs)[args.output].length > 0);
        console.log(
            "Font export/import regression passed: " +
            glyphs.glyphs.length +
            " glyphs regenerated without original files."
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

async function main() {
    await testDecisions();
    await testPortableFontSources();
    console.log("Font export retry/skip/cancel verified.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
