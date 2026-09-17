import path from "path";
import fs from "fs";
import { makeObservable, observable } from "mobx";

import { validators } from "eez-studio-shared/validation";
import { fileExistsSync } from "eez-studio-shared/util-electron";

import {
    ClassInfo,
    EezObject,
    IEezObject,
    IMessage,
    MessageType,
    PropertyType,
    registerClass
} from "project-editor/core/object";
import {
    createObject,
    getChildOfObject,
    getProjectStore,
    Message,
    propertyNotSetMessage
} from "project-editor/store";
import { ProjectEditor } from "project-editor/project-editor-interface";
import { info, showGenericDialog } from "project-editor/core/util";
import { AbsoluteFileInput } from "project-editor/ui-components/FileInput";
import type { ProjectEditorFeature } from "project-editor/store/features";
import {
    AUDIO_INDEX_MAX,
    AUDIO_INDEX_MIN,
    AUDIO_INDEX_NONE
} from "project-editor/features/audio/audio-index";

////////////////////////////////////////////////////////////////////////////////

export type AudioStorageType = "internal-flash" | "qspi-flash" | "spi-flash";
export type AudioPlacement = "automatic" | "manual";
export type AudioSourceFormat = "wav" | "mp3";
export type AudioSampleFormat = "source" | "s8" | "u8" | "s16" | "u16";

const AUDIO_FILE_FILTERS = [
    { name: "Audio files", extensions: ["wav", "mp3"] },
    { name: "WAV audio files", extensions: ["wav"] },
    { name: "MP3 audio files", extensions: ["mp3"] },
    { name: "All Files", extensions: ["*"] }
];

function isPowerOfTwo(value: number) {
    return value > 0 && (value & (value - 1)) === 0;
}

function isValidFlashAddress(value: string) {
    return /^(0x[0-9a-f]+|\d+)$/i.test(value.trim());
}

////////////////////////////////////////////////////////////////////////////////

export class FlashLayout extends EezObject {
    storage: AudioStorageType;
    baseAddress: string;
    partitionSize: number;
    alignment: number;

    static classInfo: ClassInfo = {
        properties: [
            {
                name: "storage",
                displayName: "Storage",
                type: PropertyType.Enum,
                enumItems: [
                    { id: "internal-flash", label: "Internal Flash" },
                    { id: "qspi-flash", label: "QSPI Flash" },
                    { id: "spi-flash", label: "SPI Flash" }
                ],
                defaultValue: "internal-flash"
            },
            {
                name: "baseAddress",
                displayName: "Base Address",
                type: PropertyType.String,
                defaultValue: ""
            },
            {
                name: "partitionSize",
                displayName: "Partition Size (bytes)",
                type: PropertyType.Number,
                defaultValue: 0
            },
            {
                name: "alignment",
                displayName: "Alignment (bytes)",
                type: PropertyType.Number,
                defaultValue: 4096
            }
        ],
        defaultValue: {
            storage: "internal-flash",
            baseAddress: "",
            partitionSize: 0,
            alignment: 4096
        },
        check: (flashLayout: FlashLayout, messages: IMessage[]) => {
            const project = ProjectEditor.getProject(flashLayout);
            if (!project.audio?.resources?.length) {
                return;
            }

            if (!flashLayout.baseAddress) {
                messages.push(
                    propertyNotSetMessage(flashLayout, "baseAddress")
                );
            } else if (!isValidFlashAddress(flashLayout.baseAddress)) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "Flash base address must be a decimal or hexadecimal value.",
                        getChildOfObject(flashLayout, "baseAddress")
                    )
                );
            }

            if (
                !Number.isInteger(flashLayout.partitionSize) ||
                flashLayout.partitionSize <= 0
            ) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "Flash partition size must be a positive whole number.",
                        getChildOfObject(flashLayout, "partitionSize")
                    )
                );
            }

            if (
                !Number.isInteger(flashLayout.alignment) ||
                !isPowerOfTwo(flashLayout.alignment)
            ) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "Flash alignment must be a positive power of two.",
                        getChildOfObject(flashLayout, "alignment")
                    )
                );
            }
        }
    };

    override makeEditable() {
        super.makeEditable();

        makeObservable(this, {
            storage: observable,
            baseAddress: observable,
            partitionSize: observable,
            alignment: observable
        });
    }
}

registerClass("FlashLayout", FlashLayout);

////////////////////////////////////////////////////////////////////////////////

export class AudioResource extends EezObject {
    name: string;
    audioIndex: number;
    description?: string;
    filePath: string;
    format: AudioSourceFormat;
    sampleFormat: AudioSampleFormat;
    placement: AudioPlacement;
    flashOffset: number;

    static classInfo: ClassInfo = {
        properties: [
            {
                name: "name",
                type: PropertyType.String,
                unique: true
            },
            {
                name: "audioIndex",
                displayName: "Audio Index (0 = stop)",
                type: PropertyType.Number,
                defaultValue: AUDIO_INDEX_NONE
            },
            {
                name: "description",
                type: PropertyType.MultilineText
            },
            {
                name: "filePath",
                displayName: "Audio File",
                type: PropertyType.RelativeFile,
                fileFilters: AUDIO_FILE_FILTERS
            },
            {
                name: "format",
                type: PropertyType.Enum,
                enumItems: [
                    { id: "wav", label: "WAV" },
                    { id: "mp3", label: "MP3" }
                ],
                defaultValue: "wav",
                readOnlyInPropertyGrid: true
            },
            {
                name: "sampleFormat",
                displayName: "Output PCM Format",
                type: PropertyType.Enum,
                enumItems: [
                    { id: "source", label: "Source PCM" },
                    { id: "s8", label: "8-bit signed PCM" },
                    { id: "u8", label: "8-bit unsigned PCM" },
                    { id: "s16", label: "16-bit signed PCM" },
                    { id: "u16", label: "16-bit unsigned PCM" }
                ],
                defaultValue: "source"
            },
            {
                name: "placement",
                displayName: "Flash Placement",
                type: PropertyType.Enum,
                enumItems: [
                    { id: "automatic", label: "Automatic" },
                    { id: "manual", label: "Manual" }
                ],
                defaultValue: "automatic"
            },
            {
                name: "flashOffset",
                displayName: "Flash Offset (bytes)",
                type: PropertyType.Number,
                defaultValue: 0,
                hideInPropertyGrid: (audioResource: AudioResource) =>
                    audioResource.placement !== "manual"
            }
        ],
        listLabel: (audioResource: AudioResource) => audioResource.name,
        icon: "material:volume_up",
        beforeLoadHook: (
            _object: AudioResource,
            jsObject: Partial<AudioResource>
        ) => {
            if (jsObject.format === undefined) {
                jsObject.format =
                    typeof jsObject.filePath === "string" &&
                    path.extname(jsObject.filePath).toLowerCase() === ".mp3"
                        ? "mp3"
                        : "wav";
            }
            if (jsObject.sampleFormat === undefined) {
                jsObject.sampleFormat = jsObject.format === "mp3" ? "s16" : "source";
            }
        },
        check: (audioResource: AudioResource, messages: IMessage[]) => {
            if (
                !Number.isInteger(audioResource.audioIndex) ||
                audioResource.audioIndex < AUDIO_INDEX_MIN ||
                audioResource.audioIndex > AUDIO_INDEX_MAX
            ) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        `Audio index must be a whole number from ${AUDIO_INDEX_MIN} to ${AUDIO_INDEX_MAX}. Index ${AUDIO_INDEX_NONE} is reserved for stop/no audio.`,
                        getChildOfObject(audioResource, "audioIndex")
                    )
                );
            }

            if (!audioResource.filePath) {
                messages.push(propertyNotSetMessage(audioResource, "filePath"));
            } else {
                const absoluteFilePath = ProjectEditor.getProjectStore(
                    audioResource
                ).getAbsoluteFilePath(audioResource.filePath);

                if (!fileExistsSync(absoluteFilePath)) {
                    messages.push(
                        new Message(
                            MessageType.ERROR,
                            `Audio file '${absoluteFilePath}' not found.`,
                            getChildOfObject(audioResource, "filePath")
                        )
                    );
                } else if (
                    ![".wav", ".mp3"].includes(
                        path.extname(absoluteFilePath).toLowerCase()
                    )
                ) {
                    messages.push(
                        new Message(
                            MessageType.ERROR,
                            "Only WAV and MP3 audio files are supported.",
                            getChildOfObject(audioResource, "filePath")
                        )
                    );
                } else if (
                    path.extname(absoluteFilePath).toLowerCase() !==
                    `.${audioResource.format}`
                ) {
                    messages.push(
                        new Message(
                            MessageType.ERROR,
                            "Audio format does not match the selected file.",
                            getChildOfObject(audioResource, "filePath")
                        )
                    );
                }
            }

            if (
                audioResource.format === "mp3" &&
                audioResource.sampleFormat === "source"
            ) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "MP3 resources require an 8-bit or 16-bit PCM output format.",
                        getChildOfObject(audioResource, "sampleFormat")
                    )
                );
            }

            if (audioResource.placement === "manual") {
                if (
                    !Number.isInteger(audioResource.flashOffset) ||
                    audioResource.flashOffset < 0
                ) {
                    messages.push(
                        new Message(
                            MessageType.ERROR,
                            "Manual flash offset must be a non-negative whole number.",
                            getChildOfObject(audioResource, "flashOffset")
                        )
                    );
                } else {
                    const alignment =
                        ProjectEditor.getProject(audioResource).audio
                            ?.flashLayout.alignment;
                    if (
                        alignment &&
                        audioResource.flashOffset % alignment !== 0
                    ) {
                        messages.push(
                            new Message(
                                MessageType.ERROR,
                                "Manual flash offset must match the configured alignment.",
                                getChildOfObject(audioResource, "flashOffset")
                            )
                        );
                    }
                }
            }
        },
        newItem: async (parent: IEezObject) => {
            const projectStore = getProjectStore(parent);
            if (!projectStore.filePath) {
                await info(
                    "Save the project before adding audio resources.",
                    "Audio files are copied into the project's audio folder so the project remains portable."
                );
                return undefined;
            }

            const result = await showGenericDialog(projectStore, {
                dialogDefinition: {
                    title: "New Audio Resource",
                    fields: [
                        {
                            name: "name",
                            type: "string",
                            validators: [
                                validators.required,
                                validators.invalidCharacters("."),
                                validators.unique({}, parent)
                            ]
                        },
                        {
                            name: "filePath",
                            displayName: "Audio File",
                            type: AbsoluteFileInput,
                            validators: [validators.required],
                            options: { filters: AUDIO_FILE_FILTERS }
                        }
                    ]
                },
                values: {},
                modal: true,
                backdrop: "static"
            });

            const selectedFilePath = result.values.filePath as string;
            const sourceFormat = path.extname(selectedFilePath).toLowerCase();
            const audioFolder = projectStore.getAbsoluteFilePath("audio");
            await fs.promises.mkdir(audioFolder, { recursive: true });

            const usedAudioIndexes = new Set(
                (projectStore.project.audio?.resources || [])
                    .map(resource => resource.audioIndex)
                    .filter(index => Number.isInteger(index))
            );
            let audioIndex = AUDIO_INDEX_MIN;
            while (
                usedAudioIndexes.has(audioIndex) &&
                audioIndex <= AUDIO_INDEX_MAX
            ) {
                audioIndex++;
            }

            const originalName = path.basename(selectedFilePath);
            const extension = path.extname(originalName);
            const baseName = path.basename(originalName, extension);
            let targetName = originalName;
            let suffix = 2;
            while (fs.existsSync(path.join(audioFolder, targetName))) {
                targetName = `${baseName}-${suffix++}${extension}`;
            }

            const targetPath = path.join(audioFolder, targetName);
            if (path.resolve(selectedFilePath) !== path.resolve(targetPath)) {
                await fs.promises.copyFile(selectedFilePath, targetPath);
            }
            const filePath = projectStore.getFilePathRelativeToProjectPath(targetPath);

            return createObject<AudioResource>(
                projectStore,
                {
                    name: result.values.name,
                    audioIndex,
                    filePath,
                    format: sourceFormat === ".mp3" ? "mp3" : "wav",
                    sampleFormat: sourceFormat === ".mp3" ? "s16" : "source",
                    placement: "automatic",
                    flashOffset: 0
                },
                AudioResource
            );
        }
    };

    override makeEditable() {
        super.makeEditable();

        makeObservable(this, {
            name: observable,
            audioIndex: observable,
            description: observable,
            filePath: observable,
            format: observable,
            sampleFormat: observable,
            placement: observable,
            flashOffset: observable
        });
    }
}

registerClass("AudioResource", AudioResource);

////////////////////////////////////////////////////////////////////////////////

export class Audio extends EezObject {
    flashLayout: FlashLayout;
    resources: AudioResource[];
    pythonExecutable: string;
    ffmpegExecutable: string;
    converterScript: string;
    converterArguments: string;
    targetSampleRate: number;
    targetChannels: number;

    static classInfo: ClassInfo = {
        properties: [
            {
                name: "flashLayout",
                displayName: "Flash Layout",
                type: PropertyType.Object,
                typeClass: FlashLayout,
                hideInPropertyGrid: true
            },
            {
                name: "resources",
                type: PropertyType.Array,
                typeClass: AudioResource,
                hideInPropertyGrid: true
            },
            {
                name: "pythonExecutable",
                displayName: "Python",
                type: PropertyType.String
            },
            {
                name: "ffmpegExecutable",
                displayName: "FFmpeg",
                type: PropertyType.String
            },
            {
                name: "converterScript",
                displayName: "MP3 converter script",
                type: PropertyType.RelativeFile
            },
            {
                name: "converterArguments",
                displayName: "MP3 converter arguments",
                type: PropertyType.MultilineText
            },
            {
                name: "targetSampleRate",
                displayName: "MP3 sample rate (Hz)",
                type: PropertyType.Number
            },
            {
                name: "targetChannels",
                displayName: "MP3 channels",
                type: PropertyType.Number
            }
        ],
        defaultValue: {
            flashLayout: FlashLayout.classInfo.defaultValue,
            resources: [],
            pythonExecutable: "python3",
            ffmpegExecutable: "ffmpeg",
            converterScript: "",
            converterArguments: "",
            targetSampleRate: 16000,
            targetChannels: 1
        },
        beforeLoadHook: (_object: Audio, jsObject: Partial<Audio>) => {
            if (Array.isArray(jsObject.resources)) {
                const usedAudioIndexes = new Set<number>();
                for (const resource of jsObject.resources) {
                    if (
                        Number.isInteger(resource.audioIndex) &&
                        resource.audioIndex >= AUDIO_INDEX_MIN &&
                        resource.audioIndex <= AUDIO_INDEX_MAX
                    ) {
                        usedAudioIndexes.add(resource.audioIndex);
                    }
                }

                let nextAudioIndex = AUDIO_INDEX_MIN;
                for (const resource of jsObject.resources) {
                    if (resource.audioIndex !== undefined) {
                        continue;
                    }
                    while (
                        usedAudioIndexes.has(nextAudioIndex) &&
                        nextAudioIndex <= AUDIO_INDEX_MAX
                    ) {
                        nextAudioIndex++;
                    }
                    if (nextAudioIndex <= AUDIO_INDEX_MAX) {
                        resource.audioIndex = nextAudioIndex;
                        usedAudioIndexes.add(nextAudioIndex);
                        nextAudioIndex++;
                    }
                }
            }
            if (jsObject.pythonExecutable === undefined) {
                jsObject.pythonExecutable = "python3";
            }
            if (jsObject.ffmpegExecutable === undefined) {
                jsObject.ffmpegExecutable = "ffmpeg";
            }
            if (jsObject.converterScript === undefined) {
                jsObject.converterScript = "";
            }
            if (jsObject.converterArguments === undefined) {
                jsObject.converterArguments = "";
            }
            if (jsObject.targetSampleRate === undefined) {
                jsObject.targetSampleRate = 16000;
            }
            if (jsObject.targetChannels === undefined) {
                jsObject.targetChannels = 1;
            }
        },
        check: (object: Audio, messages: IMessage[]) => {
            if (object.resources.length > AUDIO_INDEX_MAX) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        `Audio projects support at most ${AUDIO_INDEX_MAX} indexed resources.`,
                        object
                    )
                );
            }

            const indexes = new Map<number, AudioResource>();
            for (const resource of object.resources) {
                if (
                    !Number.isInteger(resource.audioIndex) ||
                    resource.audioIndex < AUDIO_INDEX_MIN ||
                    resource.audioIndex > AUDIO_INDEX_MAX
                ) {
                    continue;
                }
                const previous = indexes.get(resource.audioIndex);
                if (previous) {
                    messages.push(
                        new Message(
                            MessageType.ERROR,
                            `Audio index ${resource.audioIndex} is used by both '${previous.name}' and '${resource.name}'.`,
                            getChildOfObject(resource, "audioIndex")
                        )
                    );
                } else {
                    indexes.set(resource.audioIndex, resource);
                }
            }

            if (!Number.isInteger(object.targetSampleRate) || object.targetSampleRate <= 0) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "MP3 target sample rate must be a positive whole number.",
                        getChildOfObject(object, "targetSampleRate")
                    )
                );
            }
            if (!Number.isInteger(object.targetChannels) || object.targetChannels <= 0) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "MP3 target channels must be a positive whole number.",
                        getChildOfObject(object, "targetChannels")
                    )
                );
            }
        },
        icon: "material:volume_up"
    };

    override makeEditable() {
        super.makeEditable();

        makeObservable(this, {
            flashLayout: observable,
            resources: observable,
            pythonExecutable: observable,
            ffmpegExecutable: observable,
            converterScript: observable,
            converterArguments: observable,
            targetSampleRate: observable,
            targetChannels: observable
        });
    }
}

registerClass("Audio", Audio);

////////////////////////////////////////////////////////////////////////////////

const feature: ProjectEditorFeature = {
    name: "eezstudio-project-feature-audio",
    version: "0.1.0",
    description: "Flash-backed WAV audio resources for embedded projects",
    author: "EEZ",
    authorLogo: "../eez-studio-ui/_images/eez_logo.png",
    displayName: "Audio",
    mandatory: false,
    key: "audio",
    type: PropertyType.Object,
    typeClass: Audio,
    icon: "material:volume_up",
    create: () => ({
        flashLayout: FlashLayout.classInfo.defaultValue,
        resources: [],
        pythonExecutable: "python3",
        ffmpegExecutable: "ffmpeg",
        converterScript: "",
        converterArguments: "",
        targetSampleRate: 16000,
        targetChannels: 1
    })
};

export default feature;
