"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { listFilesWithPrefix, listNamedFiles, uniqueFiles } = require(
    "../../build/project-editor/features/embedded-platform/resource-files.js"
);

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "eez-resource-files-"));
    try {
        const images = path.join(root, "images");
        fs.mkdirSync(images);
        fs.writeFileSync(path.join(images, "ui_image_logo.c"), "");
        fs.writeFileSync(path.join(images, "ui_image_logo.bin"), "");
        fs.writeFileSync(path.join(images, "ignored.txt"), "");

        const imageFiles = listFilesWithPrefix(
            images,
            ["ui_image_"],
            [".c", ".bin"]
        );
        assert.strictEqual(imageFiles.length, 2);
        assert.strictEqual(listNamedFiles(root, ["missing.json"]).length, 0);
        assert.strictEqual(
            uniqueFiles([imageFiles[0], imageFiles[0], imageFiles[1]]).length,
            2
        );

        console.log(
            "Resource file discovery regression passed: prefixes, extensions and deduplication."
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
}
