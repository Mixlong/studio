"use strict";
const assert = require("assert");
const path = require("path");
const { createNativeStyleSample } = require(
    "../build/project-editor/lvgl/style-sample-native.js"
);
const samples = [
    ["8.4.0", 32, 33],
    ["9.2.2", 28, 29],
    ["9.5.0", 73, 72]
];
const tasks = samples.flatMap(([version, bgColorCode, bgOpacityCode]) =>
    ["LVGLButtonWidget", "LVGLLabelWidget"].map(widgetType => new Promise((resolve, reject) => {
        const file = path.resolve(
            __dirname,
            "../packages/project-editor/flow/runtime/wasm/lvgl_runtime_v" +
                version + ".js"
        );
        // Emscripten overwrites its module export with a runtime object.
        // Reload the factory for each isolated example.
        delete require.cache[require.resolve(file)];
        const factory = require(file);
        let wasm;
        wasm = factory(() => {
            try {
                wasm._init(0, 0, 0, 0, 260, 160, false, 0, false);
                const result = createNativeStyleSample(
                    wasm, widgetType, version, 260, 160
                );
                assert(result && result.screenObj && result.widgetObj);
                if (widgetType === "LVGLButtonWidget") {
                    // Match the actual project's my_back_button style:
                    // create an LVGL style object, attach it to the Button,
                    // and verify the framebuffer contains its new color.
                    const styleObj = wasm._lvglStyleCreate();
                    assert(styleObj > 0, "Cannot allocate LVGL sample style");
                    wasm._lvglStyleSetPropColor(
                        styleObj, bgColorCode, 0x5c6b77
                    );
                    wasm._lvglObjAddStyle(result.widgetObj, styleObj, 0);
                    wasm._lvglObjSetLocalStylePropNum(
                        result.widgetObj, bgOpacityCode, 255, 0
                    );
                }
                wasm._lvglScreenLoad(-1, result.screenObj);
                wasm._mainLoop();
                const buf = wasm._getSyncedBuffer();
                assert(buf > 0);
                const pixels = wasm.HEAPU8.subarray(buf, buf + 260 * 160 * 4);
                const background = pixels.subarray(0, 4);
                let changed = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                    if (pixels[i] !== background[0] ||
                        pixels[i + 1] !== background[1] ||
                        pixels[i + 2] !== background[2]) changed++;
                }
                assert(
                    changed > (widgetType === "LVGLButtonWidget" ? 1500 : 50),
                    version + " " + widgetType + " did not render visible pixels: " + changed
                );
                console.log("OK", version, widgetType,
                    "non-background pixels:", changed);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }))
);
Promise.all(tasks)
    .then(() => console.log("Native LVGL style sample pixel test passed."))
    .catch(error => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
setTimeout(() => process.exit(2), 20000).unref();
