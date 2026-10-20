"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");

const root = path.resolve(__dirname, "..");
const model = fs.readFileSync(
    path.join(root, "packages/project-editor/features/audio/audio.tsx"),
    "utf8"
);
const settings = fs.readFileSync(
    path.join(root, "packages/project-editor/features/audio/AudioNavigation.tsx"),
    "utf8"
);
const fileInput = fs.readFileSync(
    path.join(root, "packages/project-editor/ui-components/FileInput.tsx"),
    "utf8"
);
const start = model.indexOf("export const AUDIO_FILE_FILTERS = [");
const end = model.indexOf("\nfunction isPowerOfTwo(", start);
assert(start >= 0 && end > start, "Audio file filters and validation helper must exist");

const script = stripTypeScriptTypes(
    model.slice(start, end)
        .replace("export const AUDIO_FILE_FILTERS", "const AUDIO_FILE_FILTERS")
        .replace("export function getAudioSourceFormat", "function getAudioSourceFormat"),
    { mode: "transform" }
);
const context = { module: { exports: {} }, path };
vm.runInNewContext(
    script + "\nmodule.exports = { AUDIO_FILE_FILTERS, getAudioSourceFormat };",
    context
);
const { AUDIO_FILE_FILTERS, getAudioSourceFormat } = context.module.exports;

assert.deepStrictEqual(
    Array.from(AUDIO_FILE_FILTERS[0].extensions),
    ["wav", "mp3"],
    "Only WAV and MP3 should be offered in the combined file dialog filter"
);
assert(
    AUDIO_FILE_FILTERS.every(filter =>
        filter.extensions.every(extension => extension !== "*")),
    "Audio selection must not offer an All Files fallback"
);
for (const name of ["sound.wav", "sound.WAV", "song.mp3", "song.Mp3"]) {
    assert(["wav", "mp3"].includes(getAudioSourceFormat(name)));
}
for (const name of ["song.flac", "sound.aac", "song.mp4", "song.wav.exe", "x"]) {
    assert.strictEqual(getAudioSourceFormat(name), undefined, name);
}
assert(
    model.includes("const sourceFormat = getAudioSourceFormat(selectedFilePath)") &&
    model.includes("if (!sourceFormat)") &&
    model.indexOf("if (!sourceFormat)") < model.indexOf("await fs.promises.mkdir(audioFolder"),
    "Unsupported file extensions must be rejected before import copies the file"
);
assert(
    model.includes("fileFilters: AUDIO_FILE_FILTERS") &&
    model.includes("options: { filters: AUDIO_FILE_FILTERS }") &&
    fileInput.includes("filters: this.props.fieldProperties.options.filters"),
    "Both resource replacement and New Audio Resource pickers must honor filters"
);
assert(
    /name: "converterScript",[\s\S]*?fileFilters: \[\s*\{ name: "Python scripts", extensions: \["py"\] \}\s*\]/.test(
        model
    ),
    "Custom converter script picker must restrict selection to Python .py files"
);
assert(
    model.includes("MP3 converter script must be a Python (.py) file."),
    "Invalid custom converter script paths must also be rejected by validation"
);

assert(settings.includes("React.useState(false)"), "Advanced Settings must start closed");
assert(settings.includes("aria-expanded={advancedOpen}"));
assert(settings.includes("{advancedOpen && ("));
assert(settings.includes("Storage Target"));
assert(settings.includes("MP3 Output"));
assert(settings.includes("Converter Tools"));
assert(settings.includes("Flash Partition"));
assert(settings.includes("body={<AudioSettings />}"));

console.log("Audio UI verified: concise default settings, optional advanced tools, WAV/MP3-only dialogs, import validation.");
