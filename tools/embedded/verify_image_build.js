"use strict";

const assert = require("assert");
const path = require("path");

const projectRoot = path.resolve(__dirname, "../..");
process.env.NODE_PATH = path.join(projectRoot, "build");
require("module").Module._initPaths();

const {
    prepareEmbeddedImageBuild
} = require("project-editor/features/embedded-platform/image-build");

function image(name, bytes, width = 2, height = 2, bpp = 32) {
    return {
        name,
        sourceFile: `assets/${name}.png`,
        data: {
            width,
            height,
            bpp,
            pixels: Uint8Array.from(bytes)
        }
    };
}

function settings(storage) {
    return {
        storage,
        baseAddress: "0x90000000",
        partitionSize: 16384,
        alignment: 4096,
        xipSectionAttribute: "__attribute__((section(\".qspi_xip\")))"
    };
}

async function main() {
    const images = [image("logo", [1, 2, 3, 4]), image("icon", [5, 6, 7, 8])];

    for (const storage of ["rom", "xip", "non-xip"]) {
        const preparation = prepareEmbeddedImageBuild(images, settings(storage));
        assert.deepStrictEqual(preparation.issues, []);
        assert(preparation.result, `Expected ${storage} image output.`);
        assert.strictEqual(preparation.result.manifest.accessMode, storage);
        assert.strictEqual(preparation.result.manifest.resources.length, 2);
        assert.strictEqual(preparation.result.manifest.resources[0].flashOffset, 0);
        assert.strictEqual(preparation.result.manifest.resources[1].flashOffset, 4096);
        assert.strictEqual(preparation.result.manifest.imageSize, 8192);
        assert.strictEqual(preparation.result.binary[0], 1);
        assert.strictEqual(preparation.result.binary[4096], 5);
    }

    const duplicate = prepareEmbeddedImageBuild(
        [image("logo", [1]), image("logo", [2])],
        settings("rom")
    );
    assert(
        duplicate.issues.some(issue => issue.message.includes("duplicated")),
        "Expected duplicate image name validation."
    );

    const smallPartition = settings("non-xip");
    smallPartition.partitionSize = 4096;
    const tooSmall = prepareEmbeddedImageBuild(
        [image("large", new Array(5000).fill(1))],
        smallPartition
    );
    assert(
        tooSmall.issues.some(issue => issue.message.includes("does not fit")),
        "Expected image partition validation."
    );

    console.log("Image regression passed: ROM, XIP, non-XIP, duplicate and capacity checks.");
}

Promise.resolve(main()).catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
