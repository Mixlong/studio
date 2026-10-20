"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "../..");
const dependencyNames = ["make-error", "bit-buffer", "mkdirp"];
const converterModuleNames = [
    "lv_font_conv/lib/app_error",
    "lv_font_conv/lib/collect_font_data",
    "lv_font_conv/lib/writers/bin",
    "lv_font_conv/lib/writers/lvgl"
];

async function verify() {
    const collectorPath = require.resolve("lv_font_conv/lib/collect_font_data");
    const converterRoot = path.dirname(collectorPath);
    for (const name of dependencyNames) {
        try {
            require.resolve(name, { paths: [converterRoot] });
        } catch (error) {
            throw new Error(
                'Missing runtime dependency "' + name + '" required by lv_font_conv. ' +
                "Restore the project's locked dependencies with npm ci. " +
                "Original error: " + error.message
            );
        }
    }

    // These modules are imported in lvgl-worker.js.
    for (const name of converterModuleNames) {
        require(name);
    }

    const collectFontData = require(converterModuleNames[1]);
    const writeBin = require(converterModuleNames[2]);
    const writeLvgl = require(converterModuleNames[3]);

    // Exercise the full FreeType conversion path using a bundled font.
    const fontPath = path.join(
        projectRoot,
        "packages/eez-studio-ui/_stylesheets/Roboto-Regular.ttf"
    );
    const args = {
        font: [{
            source_path: fontPath,
            source_bin: fs.readFileSync(fontPath),
            ranges: [{ range: [65, 67, 65], symbols: "" }]
        }],
        size: 18,
        bpp: 4,
        no_compress: true,
        lcd: false,
        lcd_v: false,
        use_color_info: false,
        output: "ui_font_smoke_test",
        no_kerning: false,
        no_prefilter: false,
        fast_kerning: false
    };

    const fontData = await collectFontData(args);
    assert(fontData.glyphs.length > 0, "No font glyphs were extracted");
    const binary = writeBin(args, fontData)[args.output];
    const source = writeLvgl(args, fontData)[args.output];
    assert(binary?.length > 0, "No LVGL binary font data produced");
    assert(source?.length > 0, "No LVGL source font data produced");

    console.log(
        "LVGL font converter verified: " + fontData.glyphs.length +
        " glyphs, " + binary.length + " binary bytes and " +
        source.length + " source bytes."
    );
}

verify().catch(error => {
    console.error(
        "LVGL font converter verification failed: " +
        (error.stack || error)
    );
    process.exitCode = 1;
});
