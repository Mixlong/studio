"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { prepareAudioBuild } = require(
    "../../build/project-editor/features/audio/build.js"
);

const projectRoot = path.resolve(__dirname, "../..");
const sampleFile = "test-assets/audio/sample-3s.mp3";

function createAudio(resources, overrides = {}) {
    return {
        flashLayout: {
            storage: "qspi-flash",
            baseAddress: "0x90000000",
            partitionSize: 1024 * 1024,
            alignment: 4096
        },
        resources,
        pythonExecutable: "python3",
        ffmpegExecutable: "ffmpeg",
        converterScript: "",
        converterArguments: "",
        targetSampleRate: 16000,
        targetChannels: 1,
        ...overrides
    };
}

function resource(name, placement = "automatic", flashOffset = 0) {
    return {
        name,
        filePath: sampleFile,
        format: "mp3",
        sampleFormat: "s16",
        placement,
        flashOffset
    };
}

function createWavFixture() {
    const data = Buffer.alloc(16);
    for (let index = 0; index < data.length / 2; index++) {
        data.writeInt16LE(index % 2 === 0 ? 1200 : -1200, index * 2);
    }

    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(16000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(data.length, 40);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eez-audio-regression-"));
    const filePath = path.join(directory, "fixture.wav");
    fs.writeFileSync(filePath, Buffer.concat([header, data]));
    return { directory, filePath };
}

async function main() {
    const resolveFilePath = filePath => path.resolve(projectRoot, filePath);
    const wavFixture = createWavFixture();

    try {
        const wav = await prepareAudioBuild(
            createAudio([
                {
                    name: "fixture_wav",
                    filePath: wavFixture.filePath,
                    format: "wav",
                    sampleFormat: "source",
                    placement: "automatic",
                    flashOffset: 0
                }
            ]),
            resolveFilePath
        );
        assert.deepStrictEqual(wav.issues, []);
        assert(wav.result, "Expected WAV build to produce a result.");
        assert.strictEqual(wav.result.manifest.resources[0].audioIndex, 1);
        assert.strictEqual(wav.result.manifest.resources[0].id, 1);
        assert.strictEqual(wav.result.manifest.resources[0].dataSize, 16);
        assert.strictEqual(wav.result.manifest.resources[0].sampleRate, 8000);

        const explicitlyIndexedWav = await prepareAudioBuild(
            createAudio([
                {
                    name: "indexed_fixture_wav",
                    audioIndex: 42,
                    filePath: wavFixture.filePath,
                    format: "wav",
                    sampleFormat: "source",
                    placement: "automatic",
                    flashOffset: 0
                }
            ]),
            resolveFilePath
        );
        assert.deepStrictEqual(explicitlyIndexedWav.issues, []);
        assert(explicitlyIndexedWav.result, "Expected explicitly indexed WAV to build.");
        assert.strictEqual(
            explicitlyIndexedWav.result.manifest.resources[0].audioIndex,
            42
        );
        assert.strictEqual(
            explicitlyIndexedWav.result.manifest.resources[0].id,
            1,
            "Legacy resource id should remain the resource order."
        );

        const success = await prepareAudioBuild(
            createAudio([resource("sample_3s")]),
            resolveFilePath
        );
        assert.deepStrictEqual(success.issues, []);
        assert(success.result, "Expected MP3 build to produce a result.");
        assert.strictEqual(success.result.manifest.resources[0].audioIndex, 1);
        assert.strictEqual(success.result.manifest.resources[0].sampleRate, 16000);
        assert.strictEqual(success.result.manifest.resources[0].channels, 1);
        assert.strictEqual(success.result.manifest.resources[0].bitsPerSample, 16);
        assert.strictEqual(success.result.manifest.imageSize % 4096, 0);
        assert(success.result.binary.length > 0);

        const missingConverter = await prepareAudioBuild(
            createAudio([resource("missing_converter")], {
                converterScript: "tools/embedded/missing-converter.py"
            }),
            resolveFilePath
        );
        assert(
            missingConverter.issues.some(issue =>
                issue.message.includes("MP3 converter script was not found")
            ),
            "Expected a missing converter script error."
        );

        const overlap = await prepareAudioBuild(
            createAudio([
                resource("first", "manual", 0),
                resource("second", "manual", 0)
            ]),
            resolveFilePath
        );
        assert(
            overlap.issues.some(issue => issue.message.includes("overlaps")),
            "Expected an overlapping Flash resource error."
        );

        const duplicateIndex = await prepareAudioBuild(
            createAudio([
                { ...resource("first"), audioIndex: 7 },
                { ...resource("second"), audioIndex: 7 }
            ]),
            resolveFilePath
        );
        assert(
            duplicateIndex.issues.some(issue => issue.message.includes("Audio index 7")),
            "Expected a duplicate audio index error."
        );

        const invalidIndex = await prepareAudioBuild(
            createAudio([{ ...resource("invalid"), audioIndex: 0 }]),
            resolveFilePath
        );
        assert(
            invalidIndex.issues.some(issue => issue.message.includes("Index 0 is reserved")),
            "Expected index 0 to be rejected for an audio resource."
        );

        console.log(
            `Audio regression passed: WAV ${wav.result.manifest.resources[0].dataSize} bytes; MP3 ${success.result.manifest.resources[0].dataSize} PCM bytes, ${success.result.manifest.imageSize} image bytes.`
        );
    } finally {
        fs.rmSync(wavFixture.directory, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
