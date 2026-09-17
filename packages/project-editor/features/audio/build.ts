import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

import type { IEezObject } from "project-editor/core/object";
import type { ProjectStore } from "project-editor/store";
import type {
    Audio,
    AudioResource,
    AudioSampleFormat,
    AudioStorageType
} from "project-editor/features/audio/audio";

////////////////////////////////////////////////////////////////////////////////

const PCM_FORMAT = 1;
const EXTENSIBLE_FORMAT = 0xfffe;
const SUPPORTED_PCM_BITS = new Set([8, 16, 24, 32]);
const MAX_FLASH_ADDRESS = 0xffffffff;

// Keep the build module runnable from the standalone Node regression script;
// this module intentionally has no runtime dependency on the editor/UI model.
const AUDIO_INDEX_MIN = 1;
const AUDIO_INDEX_MAX = 100;

export interface WavPcmData {
    channels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
    data: Buffer;
}

export interface AudioBuildIssue {
    message: string;
    object?: IEezObject;
}

export interface AudioManifestResource {
    /** Stable Flow/BSP selector. Index 0 is reserved for stop/no audio. */
    audioIndex: number;
    /** Legacy resource id retained for existing generated consumers. */
    id: number;
    name: string;
    sourceFile: string;
    format: "pcm";
    sampleFormat: AudioSampleFormat;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
    blockAlign: number;
    dataSize: number;
    flashOffset: number;
    flashAddress: string;
}

export interface AudioBuildManifest {
    schema: "eez-studio.audio";
    version: 1;
    storage: AudioStorageType;
    accessMode: "rom" | "xip" | "non-xip";
    baseAddress: string;
    partitionSize: number;
    alignment: number;
    usedSize: number;
    imageSize: number;
    freeSize: number;
    resources: AudioManifestResource[];
}

export interface AudioBuildResult {
    binary: Buffer;
    manifest: AudioBuildManifest;
}

export interface AudioBuildPreparation {
    result?: AudioBuildResult;
    issues: AudioBuildIssue[];
}

interface ParsedResource {
    resource: AudioResource;
    audioIndex: number;
    id: number;
    sourceFile: string;
    wav: WavPcmData;
    sampleFormat: AudioSampleFormat;
}

interface OccupiedRange {
    start: number;
    end: number;
    resource: AudioResource;
}

////////////////////////////////////////////////////////////////////////////////

function audioError(message: string, object?: IEezObject): AudioBuildIssue {
    return { message, object };
}

function readAscii(buffer: Buffer, offset: number, length: number) {
    return buffer.toString("ascii", offset, offset + length);
}

function isSafeRange(start: number, size: number, bufferLength: number) {
    return (
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(size) &&
        size >= 0 &&
        start >= 0 &&
        start <= bufferLength &&
        size <= bufferLength - start
    );
}

/** Parse a RIFF/WAVE file and return its raw little-endian PCM data. */
export function parseWavPcmBuffer(
    buffer: Buffer,
    sourceName = "WAV file"
): WavPcmData {
    if (buffer.length < 12) {
        throw new Error(`${sourceName} is too small to contain a WAV header.`);
    }

    if (readAscii(buffer, 0, 4) !== "RIFF" || readAscii(buffer, 8, 4) !== "WAVE") {
        throw new Error(`${sourceName} is not a RIFF/WAVE file.`);
    }

    const riffSize = buffer.readUInt32LE(4);
    if (riffSize < 4 || riffSize + 8 > buffer.length) {
        throw new Error(`${sourceName} contains an incomplete RIFF chunk.`);
    }

    let format: WavPcmData | undefined;
    let data: Buffer | undefined;
    let offset = 12;

    while (offset + 8 <= buffer.length) {
        const chunkName = readAscii(buffer, offset, 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const chunkDataOffset = offset + 8;

        if (!isSafeRange(chunkDataOffset, chunkSize, buffer.length)) {
            throw new Error(`${sourceName} contains an incomplete ${chunkName} chunk.`);
        }

        if (chunkName === "fmt " && !format) {
            if (chunkSize < 16) {
                throw new Error(`${sourceName} has an invalid fmt chunk.`);
            }

            const formatBuffer = buffer.subarray(
                chunkDataOffset,
                chunkDataOffset + chunkSize
            );
            const formatTag = formatBuffer.readUInt16LE(0);
            let audioFormat = formatTag;

            // WAVE_FORMAT_EXTENSIBLE stores the PCM tag in its sub-format GUID.
            if (formatTag === EXTENSIBLE_FORMAT) {
                if (chunkSize < 40 || formatBuffer.readUInt16LE(24) !== PCM_FORMAT) {
                    throw new Error(
                        `${sourceName} uses an unsupported extensible audio format.`
                    );
                }
                audioFormat = PCM_FORMAT;
            }

            if (audioFormat !== PCM_FORMAT) {
                throw new Error(`${sourceName} is not PCM audio.`);
            }

            const channels = formatBuffer.readUInt16LE(2);
            const sampleRate = formatBuffer.readUInt32LE(4);
            const byteRate = formatBuffer.readUInt32LE(8);
            const blockAlign = formatBuffer.readUInt16LE(12);
            const bitsPerSample = formatBuffer.readUInt16LE(14);

            if (
                channels < 1 ||
                sampleRate < 1 ||
                !SUPPORTED_PCM_BITS.has(bitsPerSample) ||
                blockAlign < 1 ||
                byteRate < 1
            ) {
                throw new Error(`${sourceName} has invalid PCM format values.`);
            }

            const expectedBlockAlign = channels * (bitsPerSample / 8);
            const expectedByteRate = sampleRate * expectedBlockAlign;
            if (
                blockAlign !== expectedBlockAlign ||
                byteRate !== expectedByteRate
            ) {
                throw new Error(`${sourceName} has inconsistent PCM format values.`);
            }

            format = {
                channels,
                sampleRate,
                byteRate,
                blockAlign,
                bitsPerSample,
                data: Buffer.alloc(0)
            };
        } else if (chunkName === "data" && !data) {
            data = Buffer.from(
                buffer.subarray(chunkDataOffset, chunkDataOffset + chunkSize)
            );
        }

        offset = chunkDataOffset + chunkSize + (chunkSize % 2);
    }

    if (!format) {
        throw new Error(`${sourceName} is missing its fmt chunk.`);
    }

    if (!data) {
        throw new Error(`${sourceName} is missing its data chunk.`);
    }

    if (data.length === 0 || data.length % format.blockAlign !== 0) {
        throw new Error(`${sourceName} contains incomplete PCM sample data.`);
    }

    format.data = data;
    return format;
}

export async function parseWavPcmFile(filePath: string) {
    const buffer = await fs.promises.readFile(filePath);
    return parseWavPcmBuffer(buffer, filePath);
}

export function isPowerOfTwo(value: number) {
    return (
        Number.isSafeInteger(value) &&
        value > 0 &&
        Math.log2(value) % 1 === 0
    );
}

export function alignAudioOffset(value: number, alignment: number) {
    if (!isPowerOfTwo(alignment)) {
        throw new Error("Audio alignment must be a positive power of two.");
    }

    const aligned = Math.ceil(value / alignment) * alignment;
    if (!Number.isSafeInteger(aligned)) {
        throw new Error("Audio layout exceeds the supported address range.");
    }
    return aligned;
}

function parseFlashAddress(value: string) {
    const trimmed = value.trim();
    if (!/^(0x[0-9a-f]+|\d+)$/i.test(trimmed)) {
        throw new Error("Flash base address must be a decimal or hexadecimal value.");
    }

    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_FLASH_ADDRESS) {
        throw new Error("Flash base address must fit in an unsigned 32-bit value.");
    }
    return parsed;
}

function formatFlashAddress(value: number) {
    return `0x${value.toString(16).toUpperCase()}`;
}

function normalizePath(filePath: string) {
    return filePath.replace(/\\/g, "/");
}

function getPcmFormatInfo(format: Exclude<AudioSampleFormat, "source">) {
    switch (format) {
        case "s8":
            return { bitsPerSample: 8, signed: true };
        case "u8":
            return { bitsPerSample: 8, signed: false };
        case "s16":
            return { bitsPerSample: 16, signed: true };
        case "u16":
            return { bitsPerSample: 16, signed: false };
    }
}

function clampSample(sample: number) {
    return Math.max(-1, Math.min(1, sample));
}

function readPcmSample(buffer: Buffer, offset: number, bitsPerSample: number) {
    switch (bitsPerSample) {
        case 8:
            return (buffer.readUInt8(offset) - 128) / 128;
        case 16:
            return buffer.readInt16LE(offset) / 32768;
        case 24:
            return buffer.readIntLE(offset, 3) / 8388608;
        case 32:
            return buffer.readInt32LE(offset) / 2147483648;
        default:
            return 0;
    }
}

function convertWavPcmFormat(
    wav: WavPcmData,
    sampleFormat: AudioSampleFormat
) {
    if (sampleFormat === "source") {
        return wav;
    }

    const format = getPcmFormatInfo(sampleFormat);
    const bytesPerSample = format.bitsPerSample / 8;
    const frames = Math.floor(wav.data.length / wav.blockAlign);
    const blockAlign = wav.channels * bytesPerSample;
    const data = Buffer.alloc(frames * blockAlign);
    const sourceBytesPerSample = wav.bitsPerSample / 8;

    for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < wav.channels; channel++) {
            const sourceOffset = frame * wav.blockAlign + channel * sourceBytesPerSample;
            const destinationOffset = frame * blockAlign + channel * bytesPerSample;
            const sample = clampSample(
                readPcmSample(wav.data, sourceOffset, wav.bitsPerSample)
            );

            if (sampleFormat === "s8") {
                data.writeInt8(
                    Math.max(-128, Math.min(127, Math.round(sample * 127.5))),
                    destinationOffset
                );
            } else if (sampleFormat === "u8") {
                data.writeUInt8(
                    Math.round(Math.max(0, Math.min(255, (sample + 1) * 127.5))),
                    destinationOffset
                );
            } else if (sampleFormat === "s16") {
                data.writeInt16LE(
                    Math.max(
                        -32768,
                        Math.min(32767, Math.round(sample * 32767.5))
                    ),
                    destinationOffset
                );
            } else {
                data.writeUInt16LE(
                    Math.round(
                        Math.max(0, Math.min(65535, (sample + 1) * 32767.5))
                    ),
                    destinationOffset
                );
            }
        }
    }

    return {
        channels: wav.channels,
        sampleRate: wav.sampleRate,
        byteRate: wav.sampleRate * blockAlign,
        blockAlign,
        bitsPerSample: format.bitsPerSample,
        data
    };
}

function tokenizeArguments(value: string) {
    const args: string[] = [];
    const expression = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
    let match: RegExpExecArray | null;

    while ((match = expression.exec(value))) {
        args.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["'])/g, "$1"));
    }

    return args;
}

function getBundledConverterScriptPath() {
    const candidates = [
        // The gulp release task copies the converter into the build root.
        path.resolve(__dirname, "../../../convert_audio.py"),
        // Keep the source-tree path available for development builds.
        path.resolve(__dirname, "../../../tools/embedded/convert_audio.py"),
        path.resolve(__dirname, "../../../../tools/embedded/convert_audio.py"),
        // Electron packages may place the compiled app below resources/app.
        process.resourcesPath
            ? path.join(
                  process.resourcesPath,
                  "app",
                  "build",
                  "tools",
                  "embedded",
                  "convert_audio.py"
              )
            : ""
    ];

    return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

function runAudioConverter(command: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
        const process = spawn(command, args, { shell: false, windowsHide: true });
        let stderr = "";
        let settled = false;

        const fail = (error: unknown) => {
            if (settled) {
                return;
            }
            settled = true;
            const message = error instanceof Error ? error.message : String(error);
            reject(new Error(`Unable to run the MP3 converter '${command}': ${message}`));
        };

        process.stderr?.on("data", chunk => {
            stderr += chunk.toString();
        });
        process.once("error", fail);
        process.once("close", code => {
            if (settled) {
                return;
            }
            if (code === 0) {
                settled = true;
                resolve();
            } else {
                settled = true;
                reject(
                    new Error(
                        stderr.trim() || `Audio converter exited with code ${code}.`
                    )
                );
            }
        });
    });
}

async function convertMp3ToPcm(
    audio: Audio,
    resource: AudioResource,
    sourceFilePath: string,
    resolveFilePath: (filePath: string) => string
) {
    const converterScriptPath = audio.converterScript
        ? resolveFilePath(audio.converterScript)
        : getBundledConverterScriptPath();
    if (!converterScriptPath || !fs.existsSync(converterScriptPath)) {
        throw new Error(
            audio.converterScript
                ? `MP3 converter script was not found: ${audio.converterScript}`
                : "The bundled MP3 converter is unavailable. Set a converter script in Audio Settings."
        );
    }

    const sampleFormat =
        resource.sampleFormat === "source" ? "s16" : resource.sampleFormat;
    const format = getPcmFormatInfo(sampleFormat);
    const targetSampleRate = audio.targetSampleRate || 16000;
    const targetChannels = audio.targetChannels || 1;
    if (!Number.isInteger(targetSampleRate) || targetSampleRate <= 0) {
        throw new Error("MP3 target sample rate must be a positive whole number.");
    }
    if (!Number.isInteger(targetChannels) || targetChannels <= 0) {
        throw new Error("MP3 target channels must be a positive whole number.");
    }

    const temporaryDirectory = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "eez-studio-audio-")
    );
    const outputFilePath = path.join(temporaryDirectory, "audio.raw");
    const values = {
        input: sourceFilePath,
        output: outputFilePath,
        format: sampleFormat,
        sampleRate: String(targetSampleRate),
        channels: String(targetChannels),
        ffmpeg: audio.ffmpegExecutable || "ffmpeg"
    };
    const argumentTemplate =
        audio.converterArguments ||
        "--input \"{input}\" --output \"{output}\" --format {format} --sample-rate {sampleRate} --channels {channels} --ffmpeg \"{ffmpeg}\"";
    const args = [
        converterScriptPath,
        ...tokenizeArguments(
            argumentTemplate.replace(
                /\{(input|output|format|sampleRate|channels|ffmpeg)\}/g,
                (_match, name) => values[name as keyof typeof values]
            )
        )
    ];

    try {
        await runAudioConverter(audio.pythonExecutable || "python3", args);
        const data = await fs.promises.readFile(outputFilePath);
        const blockAlign = targetChannels * (format.bitsPerSample / 8);
        if (!data.length || data.length % blockAlign !== 0) {
            throw new Error("Audio converter produced incomplete PCM sample data.");
        }
        return {
            channels: targetChannels,
            sampleRate: targetSampleRate,
            byteRate: targetSampleRate * blockAlign,
            blockAlign,
            bitsPerSample: format.bitsPerSample,
            data
        };
    } finally {
        await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

function insertRange(ranges: OccupiedRange[], range: OccupiedRange) {
    ranges.push(range);
    ranges.sort((left, right) => left.start - right.start);
}

function findFirstAvailableOffset(
    ranges: OccupiedRange[],
    size: number,
    alignment: number,
    partitionSize: number
) {
    let candidate = 0;

    for (const range of ranges) {
        candidate = alignAudioOffset(candidate, alignment);

        if (candidate + size <= range.start) {
            return candidate;
        }

        if (candidate < range.end) {
            candidate = range.end;
        }
    }

    candidate = alignAudioOffset(candidate, alignment);
    return candidate + size <= partitionSize ? candidate : undefined;
}

function hasOverlap(ranges: OccupiedRange[], start: number, end: number) {
    return ranges.find(range => start < range.end && end > range.start);
}

////////////////////////////////////////////////////////////////////////////////

/** Build the binary image and manifest without writing files. */
export async function prepareAudioBuild(
    audio: Audio,
    resolveFilePath: (filePath: string) => string
): Promise<AudioBuildPreparation> {
    const issues: AudioBuildIssue[] = [];
    const resources = audio.resources || [];

    if (resources.length === 0) {
        return { issues };
    }

    const layout = audio.flashLayout;
    if (!layout) {
        return {
            issues: [audioError("Audio Flash Layout is not configured.")]
        };
    }

    let baseAddress = 0;
    try {
        baseAddress = parseFlashAddress(layout.baseAddress || "");
    } catch (error) {
        issues.push(
            audioError(
                error instanceof Error
                    ? error.message
                    : "Flash base address is invalid.",
                layout
            )
        );
    }

    const partitionSize = layout.partitionSize;
    if (!Number.isSafeInteger(partitionSize) || partitionSize <= 0) {
        issues.push(
            audioError(
                "Flash partition size must be a positive whole number.",
                layout
            )
        );
    }

    const alignment = layout.alignment;
    if (!isPowerOfTwo(alignment)) {
        issues.push(
            audioError(
                "Flash alignment must be a positive power of two.",
                layout
            )
        );
    }

    if (
        Number.isSafeInteger(baseAddress) &&
        Number.isSafeInteger(partitionSize) &&
        partitionSize > 0 &&
        baseAddress + partitionSize > MAX_FLASH_ADDRESS + 1
    ) {
        issues.push(
            audioError(
                "Flash base address and partition size exceed the 32-bit address space.",
                layout
            )
        );
    }

    if (
        layout.storage !== "internal-flash" &&
        layout.storage !== "qspi-flash" &&
        layout.storage !== "spi-flash"
    ) {
        issues.push(audioError("Audio storage target is invalid.", layout));
    }

    const parsedResources: ParsedResource[] = [];
    const names = new Set<string>();
    const audioIndexes = new Map<number, AudioResource>();

    for (let resourcePosition = 0; resourcePosition < resources.length; resourcePosition++) {
        const resource = resources[resourcePosition];
        // Direct build API callers may still provide pre-index projects. Keep
        // those projects deterministic while the Studio loader migrates them.
        const audioIndex = resource.audioIndex ?? resourcePosition + AUDIO_INDEX_MIN;
        if (!resource.name) {
            issues.push(audioError("Audio resource name is required.", resource));
        } else if (names.has(resource.name)) {
            issues.push(
                audioError(
                    `Audio resource name '${resource.name}' is duplicated.`,
                    resource
                )
            );
        } else {
            names.add(resource.name);
        }

        if (
            !Number.isInteger(audioIndex) ||
            audioIndex < AUDIO_INDEX_MIN ||
            audioIndex > AUDIO_INDEX_MAX
        ) {
            issues.push(
                audioError(
                    `Audio index for '${resource.name}' must be a whole number from ${AUDIO_INDEX_MIN} to ${AUDIO_INDEX_MAX}. Index 0 is reserved for stop/no audio.`,
                    resource
                )
            );
        } else {
            const previous = audioIndexes.get(audioIndex);
            if (previous) {
                issues.push(
                    audioError(
                        `Audio index ${audioIndex} is used by both '${previous.name}' and '${resource.name}'.`,
                        resource
                    )
                );
            } else {
                audioIndexes.set(audioIndex, resource);
            }
        }

        if (!resource.filePath) {
            issues.push(
                audioError(
                    `Audio resource '${resource.name}' has no source file.`,
                    resource
                )
            );
            continue;
        }

        const absoluteFilePath = resolveFilePath(resource.filePath);
        try {
            if (!fs.existsSync(absoluteFilePath)) {
                throw new Error(`Audio source file was not found: ${resource.filePath}`);
            }
            const sampleFormat = resource.sampleFormat || "source";
            const wav =
                resource.format === "mp3"
                    ? await convertMp3ToPcm(
                          audio,
                          resource,
                          absoluteFilePath,
                          resolveFilePath
                      )
                    : convertWavPcmFormat(
                          await parseWavPcmFile(absoluteFilePath),
                          sampleFormat
                      );
            parsedResources.push({
                resource,
                audioIndex,
                id: resourcePosition + 1,
                sourceFile: normalizePath(resource.filePath),
                wav,
                sampleFormat
            });
        } catch (error) {
            issues.push(
                audioError(
                    `Audio resource '${resource.name}' could not be packaged: ${
                        error instanceof Error ? error.message : error
                    }`,
                    resource
                )
            );
        }
    }

    if (issues.length > 0) {
        return { issues };
    }

    const occupiedRanges: OccupiedRange[] = [];
    const offsets = new Map<AudioResource, number>();

    // Reserve fixed resources first so automatic resources can fill the gaps.
    for (const parsedResource of parsedResources) {
        const { resource, wav } = parsedResource;
        if (resource.placement !== "manual") {
            continue;
        }

        const offset = resource.flashOffset;
        if (!Number.isSafeInteger(offset) || offset < 0) {
            issues.push(
                audioError(
                    `Manual Flash offset for '${resource.name}' must be a non-negative whole number.`,
                    resource
                )
            );
            continue;
        }

        if (offset % alignment !== 0) {
            issues.push(
                audioError(
                    `Manual Flash offset for '${resource.name}' must match the configured alignment.`,
                    resource
                )
            );
        }

        const end = offset + wav.data.length;
        if (!Number.isSafeInteger(end) || end > partitionSize) {
            issues.push(
                audioError(
                    `Audio resource '${resource.name}' exceeds the configured Flash partition.`,
                    resource
                )
            );
            continue;
        }

        const overlap = hasOverlap(occupiedRanges, offset, end);
        if (overlap) {
            issues.push(
                audioError(
                    `Audio resource '${resource.name}' overlaps '${overlap.resource.name}' in Flash.`,
                    resource
                )
            );
            continue;
        }

        offsets.set(resource, offset);
        insertRange(occupiedRanges, { start: offset, end, resource });
    }

    if (issues.length > 0) {
        return { issues };
    }

    for (const parsedResource of parsedResources) {
        const { resource, wav } = parsedResource;
        if (resource.placement === "manual") {
            continue;
        }

        const offset = findFirstAvailableOffset(
            occupiedRanges,
            wav.data.length,
            alignment,
            partitionSize
        );

        if (offset === undefined) {
            issues.push(
                audioError(
                    `Audio resource '${resource.name}' does not fit in the configured Flash partition.`,
                    resource
                )
            );
            continue;
        }

        const end = offset + wav.data.length;
        offsets.set(resource, offset);
        insertRange(occupiedRanges, { start: offset, end, resource });
    }

    if (issues.length > 0) {
        return { issues };
    }

    let usedSize = 0;
    for (const range of occupiedRanges) {
        usedSize = Math.max(usedSize, range.end);
    }

    let imageSize: number;
    try {
        imageSize = alignAudioOffset(usedSize, alignment);
    } catch (error) {
        return {
            issues: [
                audioError(
                    error instanceof Error
                        ? error.message
                        : "Audio image size is invalid.",
                    layout
                )
            ]
        };
    }

    if (imageSize > partitionSize) {
        return {
            issues: [
                audioError(
                    "The aligned audio image exceeds the configured Flash partition.",
                    layout
                )
            ]
        };
    }

    // A single Node Buffer cannot represent an arbitrarily large sparse Flash image.
    if (imageSize > 0x7fffffff) {
        return {
            issues: [
                audioError(
                    "The audio image is too large to generate as a single binary file.",
                    layout
                )
            ]
        };
    }

    if (baseAddress + usedSize > MAX_FLASH_ADDRESS + 1) {
        return {
            issues: [
                audioError(
                    "Audio Flash addresses exceed the 32-bit address space.",
                    layout
                )
            ]
        };
    }

    const binary = Buffer.alloc(imageSize, 0xff);
    const manifestResources: AudioManifestResource[] = [];

    for (const parsedResource of parsedResources) {
        const offset = offsets.get(parsedResource.resource);

        if (offset === undefined) {
            return {
                issues: [
                    audioError(
                        `Audio resource '${parsedResource.resource.name}' has no Flash placement.`,
                        parsedResource.resource
                    )
                ]
            };
        }

        parsedResource.wav.data.copy(binary, offset);
        manifestResources.push({
            audioIndex: parsedResource.audioIndex,
            id: parsedResource.id,
            name: parsedResource.resource.name,
            sourceFile: parsedResource.sourceFile,
            format: "pcm",
            sampleFormat: parsedResource.sampleFormat,
            channels: parsedResource.wav.channels,
            sampleRate: parsedResource.wav.sampleRate,
            bitsPerSample: parsedResource.wav.bitsPerSample,
            blockAlign: parsedResource.wav.blockAlign,
            dataSize: parsedResource.wav.data.length,
            flashOffset: offset,
            flashAddress: formatFlashAddress(baseAddress + offset)
        });
    }

    const manifest: AudioBuildManifest = {
        schema: "eez-studio.audio",
        version: 1,
        storage: layout.storage,
        accessMode: "rom",
        baseAddress: formatFlashAddress(baseAddress),
        partitionSize,
        alignment,
        usedSize,
        imageSize,
        freeSize: partitionSize - imageSize,
        resources: manifestResources
    };

    return { issues, result: { binary, manifest } };
}

export async function prepareAudioBuildForProject(
    projectStore: ProjectStore
): Promise<AudioBuildPreparation> {
    const audio = projectStore.project.audio;
    if (!audio) {
        return { issues: [] };
    }

    const preparation = await prepareAudioBuild(audio, filePath =>
        projectStore.getAbsoluteFilePath(filePath)
    );
    const storage = projectStore.project.embeddedPlatform?.storage;
    if (preparation.result) {
        preparation.result.manifest.accessMode = storage?.enabled
            ? storage.audio
            : "rom";
    }
    return preparation;
}
