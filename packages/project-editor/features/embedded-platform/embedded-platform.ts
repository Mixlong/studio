import fs from "fs";

import { makeObservable, observable } from "mobx";

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
    getChildOfObject,
    getProjectStore,
    Message,
    propertyNotSetMessage
} from "project-editor/store";
import type { ProjectEditorFeature } from "project-editor/store/features";

////////////////////////////////////////////////////////////////////////////////

export type EmbeddedStorageMode = "rom" | "xip" | "non-xip";
export type EmbeddedDownloadTool = "jlink" | "stlink" | "dplink";
export type EmbeddedWebSocketEnvironment = "local" | "production";

export const DEFAULT_EMBEDDED_BUILD_OUTPUT_DIRECTORY = "build";

export const DEFAULT_LOCAL_WEBSOCKET_ENDPOINT =
    "ws://192.168.124.144:8765";

const LEGACY_EMBEDDED_BUILD_OUTPUT_DIRECTORY = "build/firmware";
const LEGACY_LOCAL_WEBSOCKET_ENDPOINTS = new Set([
    "ws://127.0.0.1:8765",
    "ws://192.168.2.18:8765",
    "ws://192.168.2.251:8765"
]);

function isExistingPath(object: IEezObject, propertyName: string, value: string) {
    if (!value) {
        return true;
    }

    const absolutePath = getProjectStore(object).getAbsoluteFilePath(value);
    return fs.existsSync(absolutePath);
}

function checkPath(
    object: IEezObject,
    propertyName: string,
    value: string,
    messages: IMessage[],
    label: string
) {
    if (value && !isExistingPath(object, propertyName, value)) {
        messages.push(
            new Message(
                MessageType.WARNING,
                `${label} does not exist: ${value}`,
                getChildOfObject(object, propertyName)
            )
        );
    }
}

function isPowerOfTwo(value: number) {
    return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function isValidAddress(value: string) {
    return /^(0x[0-9a-f]+|\d+)$/i.test(value.trim());
}

function isValidWebSocketEndpoint(value: string) {
    return /^wss?:\/\/\S+$/i.test(value.trim());
}

////////////////////////////////////////////////////////////////////////////////

export class EmbeddedBsp extends EezObject {
    name: string;
    rootPath: string;
    cmakeListsPath: string;
    toolchainFile: string;
    displayWidth: number;
    displayHeight: number;
    cpuCore: string;
    ramSize: number;
    flashSize: number;
    serialPortCount: number;

    static classInfo: ClassInfo = {
        label: () => "BSP",
        properties: [
            { name: "name", type: PropertyType.String },
            { name: "rootPath", displayName: "BSP root", type: PropertyType.RelativeFolder },
            { name: "cmakeListsPath", displayName: "CMakeLists", type: PropertyType.RelativeFile },
            { name: "toolchainFile", displayName: "Toolchain file", type: PropertyType.RelativeFile },
            { name: "displayWidth", displayName: "Display width (px)", type: PropertyType.Number },
            { name: "displayHeight", displayName: "Display height (px)", type: PropertyType.Number },
            { name: "cpuCore", displayName: "CPU core", type: PropertyType.String },
            { name: "ramSize", displayName: "RAM (KB)", type: PropertyType.Number },
            { name: "flashSize", displayName: "Flash (KB)", type: PropertyType.Number },
            { name: "serialPortCount", displayName: "Serial ports", type: PropertyType.Number }
        ],
        defaultValue: {
            name: "Generic BSP",
            rootPath: "",
            cmakeListsPath: "",
            toolchainFile: "",
            displayWidth: 0,
            displayHeight: 0,
            cpuCore: "",
            ramSize: 0,
            flashSize: 0,
            serialPortCount: 0
        },
        check: (object: EmbeddedBsp, messages: IMessage[]) => {
            if (!object.name) {
                messages.push(propertyNotSetMessage(object, "name"));
            }
            checkPath(object, "rootPath", object.rootPath, messages, "BSP root");
            checkPath(
                object,
                "cmakeListsPath",
                object.cmakeListsPath,
                messages,
                "CMakeLists"
            );
        }
    };

    override makeEditable() {
        super.makeEditable();
        makeObservable(this, {
            name: observable,
            rootPath: observable,
            cmakeListsPath: observable,
            toolchainFile: observable,
            displayWidth: observable,
            displayHeight: observable,
            cpuCore: observable,
            ramSize: observable,
            flashSize: observable,
            serialPortCount: observable
        });
    }
}

registerClass("EmbeddedBsp", EmbeddedBsp);

////////////////////////////////////////////////////////////////////////////////

export class EmbeddedStorageSettings extends EezObject {
    enabled: boolean;
    image: EmbeddedStorageMode;
    font: EmbeddedStorageMode;
    audio: EmbeddedStorageMode;
    imageBaseAddress: string;
    imagePartitionSize: number;
    imageAlignment: number;
    xipSectionAttribute: string;

    static classInfo: ClassInfo = {
        label: () => "Resource storage",
        properties: [
            {
                name: "enabled",
                displayName: "Use unified storage modes",
                type: PropertyType.Boolean
            },
            {
                name: "image",
                displayName: "Images",
                type: PropertyType.Enum,
                disabled: (object: EmbeddedStorageSettings) => !object.enabled,
                enumItems: [
                    { id: "rom", label: "ROM (C array)" },
                    { id: "xip", label: "External Flash XIP" },
                    { id: "non-xip", label: "External Flash non-XIP" }
                ],
                enumDisallowUndefined: true
            },
            {
                name: "font",
                displayName: "Fonts",
                type: PropertyType.Enum,
                disabled: (object: EmbeddedStorageSettings) => !object.enabled,
                enumItems: [
                    { id: "rom", label: "ROM (C array)" },
                    { id: "xip", label: "External Flash XIP" },
                    { id: "non-xip", label: "External Flash non-XIP" }
                ],
                enumDisallowUndefined: true
            },
            {
                name: "audio",
                displayName: "Audio",
                type: PropertyType.Enum,
                disabled: (object: EmbeddedStorageSettings) => !object.enabled,
                enumItems: [
                    { id: "rom", label: "ROM" },
                    { id: "xip", label: "External Flash XIP" },
                    { id: "non-xip", label: "External Flash non-XIP" }
                ],
                enumDisallowUndefined: true
            },
            {
                name: "imageBaseAddress",
                displayName: "Image base address",
                type: PropertyType.String,
                disabled: (object: EmbeddedStorageSettings) =>
                    !object.enabled || object.image === "rom"
            },
            {
                name: "imagePartitionSize",
                displayName: "Image partition size (bytes)",
                type: PropertyType.Number,
                disabled: (object: EmbeddedStorageSettings) =>
                    !object.enabled || object.image === "rom"
            },
            {
                name: "imageAlignment",
                displayName: "Image alignment (bytes)",
                type: PropertyType.Number,
                disabled: (object: EmbeddedStorageSettings) =>
                    !object.enabled || object.image === "rom"
            },
            {
                name: "xipSectionAttribute",
                displayName: "Image XIP section attribute",
                type: PropertyType.String,
                disabled: (object: EmbeddedStorageSettings) =>
                    !object.enabled || object.image !== "xip"
            }
        ],
        defaultValue: {
            enabled: false,
            image: "rom",
            font: "rom",
            audio: "non-xip",
            imageBaseAddress: "",
            imagePartitionSize: 0,
            imageAlignment: 4096,
            xipSectionAttribute:
                "__attribute__((section(\".qspi_xip\")))"
        },
        beforeLoadHook: (_object: EmbeddedStorageSettings, jsObject: Partial<EmbeddedStorageSettings>) => {
            if (jsObject.enabled === undefined) {
                jsObject.enabled = false;
            }
            if (jsObject.image === undefined) {
                jsObject.image = "rom";
            }
            if (jsObject.font === undefined) {
                jsObject.font = "rom";
            }
            if (jsObject.audio === undefined) {
                jsObject.audio = "non-xip";
            }
            if (jsObject.imageBaseAddress === undefined) {
                jsObject.imageBaseAddress = "";
            }
            if (jsObject.imagePartitionSize === undefined) {
                jsObject.imagePartitionSize = 0;
            }
            if (jsObject.imageAlignment === undefined) {
                jsObject.imageAlignment = 4096;
            }
            if (jsObject.xipSectionAttribute === undefined) {
                jsObject.xipSectionAttribute =
                    "__attribute__((section(\".qspi_xip\")))";
            }
        },
        check: (object: EmbeddedStorageSettings, messages: IMessage[]) => {
            if (!object.enabled) {
                return;
            }

            if (object.image !== "rom" && object.image !== "xip" && object.image !== "non-xip") {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "Image storage mode is invalid.",
                        getChildOfObject(object, "image")
                    )
                );
            }
            if (object.font !== "rom" && object.font !== "xip" && object.font !== "non-xip") {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "Font storage mode is invalid.",
                        getChildOfObject(object, "font")
                    )
                );
            }
            if (object.audio !== "rom" && object.audio !== "xip" && object.audio !== "non-xip") {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "Audio storage mode is invalid.",
                        getChildOfObject(object, "audio")
                    )
                );
            }

            if (object.image !== "rom") {
                if (object.imageBaseAddress && !isValidAddress(object.imageBaseAddress)) {
                    messages.push(
                        new Message(
                            MessageType.ERROR,
                            "Image base address must be decimal or hexadecimal.",
                            getChildOfObject(object, "imageBaseAddress")
                        )
                    );
                }
                if (
                    !Number.isSafeInteger(object.imagePartitionSize) ||
                    object.imagePartitionSize <= 0
                ) {
                    messages.push(
                        new Message(
                            MessageType.ERROR,
                            "Image partition size must be a positive whole number.",
                            getChildOfObject(object, "imagePartitionSize")
                        )
                    );
                }
                if (!isPowerOfTwo(object.imageAlignment)) {
                    messages.push(
                        new Message(
                            MessageType.ERROR,
                            "Image alignment must be a positive power of two.",
                            getChildOfObject(object, "imageAlignment")
                        )
                    );
                }
            }
        }
    };

    override makeEditable() {
        super.makeEditable();
        makeObservable(this, {
            enabled: observable,
            image: observable,
            font: observable,
            audio: observable,
            imageBaseAddress: observable,
            imagePartitionSize: observable,
            imageAlignment: observable,
            xipSectionAttribute: observable
        });
    }
}

registerClass("EmbeddedStorageSettings", EmbeddedStorageSettings);

////////////////////////////////////////////////////////////////////////////////

export class ProtocolResource extends EezObject {
    name: string;
    category: string;
    filePath: string;
    source: "local" | "cloud";
    enabled: boolean;

    static classInfo: ClassInfo = {
        label: (object: ProtocolResource) => object.name || object.filePath,
        properties: [
            { name: "name", type: PropertyType.String, unique: true },
            { name: "category", type: PropertyType.String },
            { name: "filePath", displayName: "Protocol file", type: PropertyType.String },
            {
                name: "source",
                type: PropertyType.Enum,
                enumItems: [
                    { id: "local", label: "Local" },
                    { id: "cloud", label: "Ditai Cloud" }
                ],
                enumDisallowUndefined: true
            },
            { name: "enabled", displayName: "Use in project", type: PropertyType.Boolean }
        ],
        defaultValue: {
            name: "",
            category: "Uncategorized",
            filePath: "",
            source: "local",
            enabled: true
        },
        beforeLoadHook: (_object: ProtocolResource, jsObject: Partial<ProtocolResource>) => {
            if (jsObject.category === undefined || !String(jsObject.category).trim()) {
                jsObject.category = "Uncategorized";
            }
            if (jsObject.source === undefined) {
                jsObject.source = "local";
            }
            if (jsObject.enabled === undefined) {
                jsObject.enabled = true;
            }
        },
        check: (object: ProtocolResource, messages: IMessage[]) => {
            if (!object.name) {
                messages.push(propertyNotSetMessage(object, "name"));
            }
            if (!object.filePath) {
                messages.push(propertyNotSetMessage(object, "filePath"));
            } else if (!object.filePath.startsWith("mock://")) {
                const absoluteFilePath = getProjectStore(object).getAbsoluteFilePath(
                    object.filePath
                );
                if (!fs.existsSync(absoluteFilePath)) {
                    messages.push(
                        new Message(
                            MessageType.WARNING,
                            `Protocol file does not exist: ${object.filePath}`,
                            getChildOfObject(object, "filePath")
                        )
                    );
                }
            }
        }
    };

    override makeEditable() {
        super.makeEditable();
        makeObservable(this, {
            name: observable,
            category: observable,
            filePath: observable,
            source: observable,
            enabled: observable
        });
    }
}

registerClass("ProtocolResource", ProtocolResource);

////////////////////////////////////////////////////////////////////////////////

export class EmbeddedBuildSettings extends EezObject {
    pythonExecutable: string;
    scriptPath: string;
    outputDirectory: string;
    cmakeGenerator: string;
    extraArguments: string;
    autoUpdateCMake: boolean;

    static classInfo: ClassInfo = {
        label: () => "Cross compiler",
        properties: [
            { name: "pythonExecutable", displayName: "Python", type: PropertyType.String },
            { name: "scriptPath", displayName: "Resource/build script", type: PropertyType.RelativeFile },
            { name: "outputDirectory", displayName: "Output directory", type: PropertyType.RelativeFolder },
            { name: "cmakeGenerator", displayName: "CMake generator", type: PropertyType.String },
            { name: "extraArguments", displayName: "Extra arguments", type: PropertyType.MultilineText },
            { name: "autoUpdateCMake", displayName: "Update CMake resource list", type: PropertyType.Boolean }
        ],
        defaultValue: {
            pythonExecutable: "python3",
            scriptPath: "",
            outputDirectory: DEFAULT_EMBEDDED_BUILD_OUTPUT_DIRECTORY,
            cmakeGenerator: "",
            extraArguments: "",
            autoUpdateCMake: true
        },
        beforeLoadHook: (
            _object: EmbeddedBuildSettings,
            jsObject: Partial<EmbeddedBuildSettings>
        ) => {
            if (jsObject.outputDirectory === undefined) {
                jsObject.outputDirectory = DEFAULT_EMBEDDED_BUILD_OUTPUT_DIRECTORY;
            } else if (
                jsObject.outputDirectory ===
                LEGACY_EMBEDDED_BUILD_OUTPUT_DIRECTORY
            ) {
                // Migrate projects that persisted the previous default output folder.
                jsObject.outputDirectory = DEFAULT_EMBEDDED_BUILD_OUTPUT_DIRECTORY;
            }
        },
        check: (object: EmbeddedBuildSettings, messages: IMessage[]) => {
            checkPath(object, "scriptPath", object.scriptPath, messages, "Build script");
        }
    };

    override makeEditable() {
        super.makeEditable();
        makeObservable(this, {
            pythonExecutable: observable,
            scriptPath: observable,
            outputDirectory: observable,
            cmakeGenerator: observable,
            extraArguments: observable,
            autoUpdateCMake: observable
        });
    }
}

registerClass("EmbeddedBuildSettings", EmbeddedBuildSettings);

////////////////////////////////////////////////////////////////////////////////

export class EmbeddedWebSocketSettings extends EezObject {
    enabled: boolean;
    environment: EmbeddedWebSocketEnvironment;
    localEndpoint: string;
    productionEndpoint: string;
    connectTimeoutMs: number;

    static classInfo: ClassInfo = {
        label: () => "Middleware WebSocket",
        properties: [
            {
                name: "enabled",
                displayName: "Use WebSocket middleware",
                type: PropertyType.Boolean
            },
            {
                name: "environment",
                displayName: "Environment",
                type: PropertyType.Enum,
                disabled: (object: EmbeddedWebSocketSettings) => !object.enabled,
                enumItems: [
                    { id: "local", label: "Local / Debug" },
                    { id: "production", label: "Production" }
                ],
                enumDisallowUndefined: true
            },
            {
                name: "localEndpoint",
                displayName: "Local WebSocket endpoint",
                type: PropertyType.String,
                disabled: (object: EmbeddedWebSocketSettings) =>
                    !object.enabled || object.environment !== "local"
            },
            {
                name: "productionEndpoint",
                displayName: "Production WebSocket endpoint",
                type: PropertyType.String,
                disabled: (object: EmbeddedWebSocketSettings) =>
                    !object.enabled || object.environment !== "production"
            },
            {
                name: "connectTimeoutMs",
                displayName: "Connect timeout (ms)",
                type: PropertyType.Number,
                disabled: (object: EmbeddedWebSocketSettings) => !object.enabled
            }
        ],
        defaultValue: {
            enabled: false,
            environment: "local",
            localEndpoint: DEFAULT_LOCAL_WEBSOCKET_ENDPOINT,
            productionEndpoint: "",
            connectTimeoutMs: 5000
        },
        beforeLoadHook: (
            _object: EmbeddedWebSocketSettings,
            jsObject: Partial<EmbeddedWebSocketSettings> & { endpoint?: string }
        ) => {
            if (jsObject.enabled === undefined) {
                jsObject.enabled = false;
            }
            if (jsObject.environment === undefined) {
                jsObject.environment = "local";
            }
            if (jsObject.localEndpoint === undefined) {
                jsObject.localEndpoint =
                    jsObject.endpoint || DEFAULT_LOCAL_WEBSOCKET_ENDPOINT;
            } else if (
                LEGACY_LOCAL_WEBSOCKET_ENDPOINTS.has(jsObject.localEndpoint)
            ) {
                // Migrate projects that persisted the previous debug-machine default.
                jsObject.localEndpoint = DEFAULT_LOCAL_WEBSOCKET_ENDPOINT;
            }
            if (jsObject.productionEndpoint === undefined) {
                jsObject.productionEndpoint = "";
            }
            if (jsObject.connectTimeoutMs === undefined) {
                jsObject.connectTimeoutMs = 5000;
            }
        },
        check: (object: EmbeddedWebSocketSettings, messages: IMessage[]) => {
            if (!object.enabled) {
                return;
            }
            const endpoint =
                object.environment === "production"
                    ? object.productionEndpoint
                    : object.localEndpoint;
            const endpointProperty =
                object.environment === "production"
                    ? "productionEndpoint"
                    : "localEndpoint";
            if (!isValidWebSocketEndpoint(endpoint)) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        `${object.environment === "production" ? "Production" : "Local"} WebSocket endpoint must start with ws:// or wss:// and include a valid host.`,
                        getChildOfObject(object, endpointProperty)
                    )
                );
            }
            if (
                !Number.isSafeInteger(object.connectTimeoutMs) ||
                object.connectTimeoutMs < 100
            ) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "WebSocket connect timeout must be at least 100 ms.",
                        getChildOfObject(object, "connectTimeoutMs")
                    )
                );
            }
        }
    };

    override makeEditable() {
        super.makeEditable();
        makeObservable(this, {
            enabled: observable,
            environment: observable,
            localEndpoint: observable,
            productionEndpoint: observable,
            connectTimeoutMs: observable
        });
    }
}

registerClass("EmbeddedWebSocketSettings", EmbeddedWebSocketSettings);

export function getEmbeddedWebSocketEndpoint(settings: EmbeddedWebSocketSettings) {
    return settings.environment === "production"
        ? settings.productionEndpoint.trim()
        : settings.localEndpoint.trim();
}

////////////////////////////////////////////////////////////////////////////////

export class EmbeddedDownloadSettings extends EezObject {
    tool: EmbeddedDownloadTool;
    executablePath: string;
    interfaceName: string;
    addressOffset: string;
    targetId: string;
    speed: string;
    commandArguments: string;

    static classInfo: ClassInfo = {
        label: () => "Firmware downloader",
        properties: [
            {
                name: "tool",
                type: PropertyType.Enum,
                enumItems: [
                    { id: "jlink", label: "JLink" },
                    { id: "stlink", label: "STLink" },
                    { id: "dplink", label: "DPlink" }
                ],
                enumDisallowUndefined: true
            },
            { name: "executablePath", displayName: "Executable", type: PropertyType.String },
            { name: "interfaceName", displayName: "Interface", type: PropertyType.String },
            { name: "addressOffset", displayName: "Address offset", type: PropertyType.String },
            { name: "targetId", displayName: "Target identifier", type: PropertyType.String },
            { name: "speed", displayName: "Speed (kHz)", type: PropertyType.String },
            { name: "commandArguments", displayName: "Command arguments", type: PropertyType.MultilineText }
        ],
        defaultValue: {
            tool: "jlink",
            executablePath: "",
            interfaceName: "",
            addressOffset: "0x0",
            targetId: "",
            speed: "5000",
            commandArguments: ""
        },
        beforeLoadHook: (
            _object: EmbeddedDownloadSettings,
            jsObject: Partial<EmbeddedDownloadSettings>
        ) => {
            if (jsObject.speed === undefined) {
                jsObject.speed = "5000";
            }
        },
        check: (object: EmbeddedDownloadSettings, messages: IMessage[]) => {
            if (
                object.addressOffset &&
                !/^(0x[0-9a-f]+|\d+)$/i.test(object.addressOffset.trim())
            ) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "Firmware address offset must be decimal or hexadecimal.",
                        getChildOfObject(object, "addressOffset")
                    )
                );
            }
            if (
                object.speed &&
                (!/^\d+$/.test(object.speed.trim()) || Number(object.speed) <= 0)
            ) {
                messages.push(
                    new Message(
                        MessageType.ERROR,
                        "Download speed must be a positive integer in kHz.",
                        getChildOfObject(object, "speed")
                    )
                );
            }
        }
    };

    override makeEditable() {
        super.makeEditable();
        makeObservable(this, {
            tool: observable,
            executablePath: observable,
            interfaceName: observable,
            addressOffset: observable,
            targetId: observable,
            speed: observable,
            commandArguments: observable
        });
    }
}

registerClass("EmbeddedDownloadSettings", EmbeddedDownloadSettings);

////////////////////////////////////////////////////////////////////////////////

export class HiddenComponent extends EezObject {
    name: string;
    type: "widget" | "action";

    static classInfo: ClassInfo = {
        label: (object: HiddenComponent) => object.name,
        properties: [
            { name: "name", type: PropertyType.String, unique: true },
            {
                name: "type",
                type: PropertyType.Enum,
                enumItems: [
                    { id: "widget", label: "Widget" },
                    { id: "action", label: "Action" }
                ]
            }
        ],
        defaultValue: { name: "", type: "widget" }
    };

    override makeEditable() {
        super.makeEditable();
        makeObservable(this, { name: observable, type: observable });
    }
}

registerClass("HiddenComponent", HiddenComponent);

////////////////////////////////////////////////////////////////////////////////

export class EmbeddedPlatform extends EezObject {
    bsp: EmbeddedBsp;
    storage: EmbeddedStorageSettings;
    protocols: ProtocolResource[];
    build: EmbeddedBuildSettings;
    websocket: EmbeddedWebSocketSettings;
    download: EmbeddedDownloadSettings;
    hiddenComponents: HiddenComponent[];
    cloudEndpoint: string;

    static classInfo: ClassInfo = {
        label: () => "Embedded platform",
        properties: [
            { name: "bsp", type: PropertyType.Object, typeClass: EmbeddedBsp },
            { name: "storage", type: PropertyType.Object, typeClass: EmbeddedStorageSettings },
            { name: "protocols", type: PropertyType.Array, typeClass: ProtocolResource, defaultValue: [] },
            { name: "build", type: PropertyType.Object, typeClass: EmbeddedBuildSettings },
            { name: "websocket", type: PropertyType.Object, typeClass: EmbeddedWebSocketSettings },
            { name: "download", type: PropertyType.Object, typeClass: EmbeddedDownloadSettings },
            { name: "hiddenComponents", type: PropertyType.Array, typeClass: HiddenComponent, defaultValue: [] },
            { name: "cloudEndpoint", displayName: "Protocol cloud endpoint", type: PropertyType.String }
        ],
        defaultValue: {
            bsp: EmbeddedBsp.classInfo.defaultValue,
            storage: EmbeddedStorageSettings.classInfo.defaultValue,
            protocols: [],
            build: EmbeddedBuildSettings.classInfo.defaultValue,
            websocket: EmbeddedWebSocketSettings.classInfo.defaultValue,
            download: EmbeddedDownloadSettings.classInfo.defaultValue,
            hiddenComponents: [],
            cloudEndpoint: ""
        },
        beforeLoadHook: (
            _object: EmbeddedPlatform,
            jsObject: Partial<EmbeddedPlatform>
        ) => {
            if (jsObject.websocket === undefined) {
                jsObject.websocket = EmbeddedWebSocketSettings.classInfo.defaultValue;
            }
        }
    };

    override makeEditable() {
        super.makeEditable();
        makeObservable(this, {
            bsp: observable,
            storage: observable,
            protocols: observable,
            build: observable,
            websocket: observable,
            download: observable,
            hiddenComponents: observable,
            cloudEndpoint: observable
        });
    }
}

registerClass("EmbeddedPlatform", EmbeddedPlatform);

////////////////////////////////////////////////////////////////////////////////

const feature: ProjectEditorFeature = {
    name: "eezstudio-project-feature-embedded-platform",
    version: "0.1.0",
    description:
        "BSP, protocol, resource storage, cross compilation and firmware download settings",
    author: "EEZ",
    authorLogo: "../eez-studio-ui/_images/eez_logo.png",
    displayName: "Embedded Platform",
    mandatory: true,
    key: "embeddedPlatform",
    type: PropertyType.Object,
    typeClass: EmbeddedPlatform,
    icon: "material:developer_board",
    create: () => EmbeddedPlatform.classInfo.defaultValue
};

export default feature;
