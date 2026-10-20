import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";

import { MessageType } from "project-editor/core/object";
import { Section, type ProjectStore } from "project-editor/store";
import { ProjectEditor } from "project-editor/project-editor-interface";
import {
    listFiles,
    listFilesWithPrefix,
    listNamedFiles,
    uniqueFiles
} from "project-editor/features/embedded-platform/resource-files";
import type {
    EmbeddedDownloadSettings,
    EmbeddedPlatform,
    ProtocolResource
} from "project-editor/features/embedded-platform/embedded-platform";
import {
    DEFAULT_EMBEDDED_BUILD_OUTPUT_DIRECTORY,
    getEmbeddedWebSocketEndpoint
} from "project-editor/features/embedded-platform/embedded-platform";
import {
    EmbeddedWebSocketClient,
    type EmbeddedWebSocketState
} from "project-editor/features/embedded-platform/embedded-websocket";
import type {
    EmbeddedOutgoingMessage,
    EmbeddedTransformModel,
    EmbeddedTransformType
} from "project-editor/features/embedded-platform/embedded-protocol";

////////////////////////////////////////////////////////////////////////////////

export interface EmbeddedOperationResult {
    success: boolean;
    message: string;
    outputDirectory?: string;
    firmwarePath?: string;
}

export interface EmbeddedResourceSummary {
    imageFiles: string[];
    fontFiles: string[];
    audioFiles: string[];
    protocolFiles: string[];
    manifestPath: string;
    cmakePath: string;
    makefilePath: string;
}

export interface EmbeddedOperationOptions {
    onProgress?: (value: number) => void;
    onLog?: (message: string) => void;
    onStateChange?: (state: EmbeddedWebSocketState) => void;
}

const activeProcesses = new Map<ProjectStore, ChildProcess>();
const websocketClients = new WeakMap<ProjectStore, EmbeddedWebSocketClient>();
const websocketOperationOptions = new WeakMap<ProjectStore, EmbeddedOperationOptions>();
const websocketOperationCancellers = new WeakMap<ProjectStore, () => void>();
type RemoteBuildCommand = "cmake" | "build" | "download";
type RemoteLogWaiter = (message: string) => void;
const websocketLogWaiters = new WeakMap<ProjectStore, Set<RemoteLogWaiter>>();
const REMOTE_COMMAND_COMPLETION_TIMEOUT_MS = 15 * 60 * 1000;

function remoteCommandLogResult(
    command: RemoteBuildCommand,
    message: string
): boolean | undefined {
    for (const line of message.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) {
            continue;
        }

        if (
            /(?:^|[\s:：])(?:cmake|build|compile|firmware|download|flash|program|burn)?\s*(?:failed|failure|fatal(?:\s+error)?|exception|error)(?=\s|[:：]|$)|(?:失败|错误|异常|无法(?:生成|编译|构建|下载|烧录|刷写))(?=\s|[:：]|$)/i.test(
                normalized
            )
        ) {
            return false;
        }

        if (command === "cmake") {
            if (
                /\bcmake\s+(?:completed?|success(?:ful|fully)?|succeed(?:ed)?|done)\b/i.test(
                    normalized
                ) ||
                /(?:成功|生成|完成).*CMakeLists(?:\.txt)?\b|\bCMakeLists(?:\.txt)?\b.*(?:成功|生成|完成)/i.test(
                    normalized
                )
            ) {
                return true;
            }
        } else if (command === "build") {
            if (
                /\b(?:build|compile|firmware)\s+(?:completed?|success(?:ful|fully)?|succeed(?:ed)?|done)\b/i.test(
                    normalized
                ) ||
                /(?:构建|编译|固件).*(?:成功|完成)|(?:成功|完成).*(?:构建|编译|固件)/i.test(
                    normalized
                )
            ) {
                return true;
            }
        } else if (
            /\b(?:download|flash|program|burn)\s+(?:completed?|success(?:ful|fully)?|succeed(?:ed)?|done)\b/i.test(
                normalized
            ) ||
            /(?:下载|烧录|刷写).*(?:成功|完成)|(?:成功|完成).*(?:下载|烧录|刷写)/i.test(
                normalized
            )
        ) {
            return true;
        }
    }

    return undefined;
}

function notifyRemoteLogWaiters(projectStore: ProjectStore, message: string) {
    const waiters = websocketLogWaiters.get(projectStore);
    if (!waiters) {
        return;
    }
    for (const waiter of [...waiters]) {
        waiter(message);
    }
}

function waitForRemoteCommandCompletion(
    projectStore: ProjectStore,
    command: RemoteBuildCommand
) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolvePromise: (result: { success: boolean; message: string }) => void;
    const waiters = websocketLogWaiters.get(projectStore) || new Set<RemoteLogWaiter>();
    websocketLogWaiters.set(projectStore, waiters);

    const promise = new Promise<{ success: boolean; message: string }>(resolve => {
        resolvePromise = resolve;
    });

    const cleanup = () => {
        waiters.delete(waiter);
        if (waiters.size === 0) {
            websocketLogWaiters.delete(projectStore);
        }
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    };

    const finish = (result: { success: boolean; message: string }) => {
        cleanup();
        resolvePromise(result);
    };

    const waiter: RemoteLogWaiter = message => {
        const success = remoteCommandLogResult(command, message);
        if (success === undefined) {
            return;
        }
        finish({
            success,
            message: message.trim() || `Remote ${command} command completed.`
        });
    };

    waiters.add(waiter);
    timer = setTimeout(() => {
        finish({
            success: false,
            message: `Timed out waiting for remote ${command} completion.`
        });
    }, REMOTE_COMMAND_COMPLETION_TIMEOUT_MS);

    return {
        promise,
        cancel: () =>
            finish({
                success: false,
                message: `Remote ${command} command was cancelled before completion.`
            })
    };
}

function assertSavedProject(projectStore: ProjectStore) {
    if (!projectStore.filePath) {
        throw new Error("Save the project before generating embedded resources.");
    }
}

function projectDirectory(projectStore: ProjectStore) {
    assertSavedProject(projectStore);
    return path.dirname(projectStore.filePath!);
}

function normalizeCMakePath(value: string) {
    return value.replace(/\\/g, "/").replace(/"/g, "\\\"");
}

function toProjectRelativePath(projectRoot: string, filePath: string) {
    return normalizeCMakePath(path.relative(projectRoot, filePath));
}

function resolveConfiguredPath(projectStore: ProjectStore, filePath: string) {
    if (!filePath) {
        return "";
    }
    return path.isAbsolute(filePath)
        ? filePath
        : projectStore.getAbsoluteFilePath(filePath);
}

function getOutputDirectory(projectStore: ProjectStore, platform: EmbeddedPlatform) {
    return resolveConfiguredPath(
        projectStore,
        platform.build.outputDirectory || DEFAULT_EMBEDDED_BUILD_OUTPUT_DIRECTORY
    );
}

function output(projectStore: ProjectStore, type: MessageType, message: string) {
    projectStore.outputSectionsStore.write(Section.OUTPUT, type, message);
}

function parseProgress(text: string) {
    const result = /(\d{1,3})\s*%/.exec(text);
    if (!result) {
        return undefined;
    }
    return Math.min(100, Number(result[1]));
}

function isWebSocketEnabled(platform: EmbeddedPlatform) {
    return platform.websocket?.enabled === true;
}

function normalizeRemotePath(value: string) {
    return value.trim().replace(/\\/g, "/");
}

function getMissingRemoteBuildField(platform: EmbeddedPlatform) {
    const build = platform.remote.build;
    if (!build.projectDirectory.trim()) {
        return "Project directory (remote)";
    }
    if (!build.configFile.trim()) {
        return "CMake config file (remote)";
    }
    if (!build.outputDirectory.trim()) {
        return "Build directory (remote)";
    }
    return undefined;
}

function getMissingRemoteDownloadField(platform: EmbeddedPlatform) {
    const download = platform.remote.download;
    if (!download.target.trim()) {
        return "Target identifier";
    }
    if (!download.firmwarePath.trim()) {
        return "Firmware path (remote)";
    }
    return undefined;
}

function getEmbeddedWebSocketClient(projectStore: ProjectStore) {
    const platform = projectStore.project.embeddedPlatform;
    const websocketSettings = platform.websocket;
    const endpoint = websocketSettings
        ? getEmbeddedWebSocketEndpoint(websocketSettings)
        : "";
    const timeoutMs = websocketSettings?.connectTimeoutMs || 5000;
    let client = websocketClients.get(projectStore);

    if (!client) {
        client = new EmbeddedWebSocketClient(endpoint, timeoutMs, {
            onMessage: message => {
                if (message.command === "log") {
                    const data =
                        typeof message.data === "string"
                            ? message.data
                            : JSON.stringify(message.data ?? null, null, 2);
                    output(projectStore, MessageType.INFO, data);
                    websocketOperationOptions.get(projectStore)?.onLog?.(data);
                    notifyRemoteLogWaiters(projectStore, data);
                    const progress = parseProgress(data);
                    if (progress !== undefined) {
                        websocketOperationOptions
                            .get(projectStore)
                            ?.onProgress?.(progress);
                    }
                    return;
                }

                // Non-log protocol responses must also be visible in the
                // remote log panel, not only in the global output console.
                const data = `WebSocket ${message.command}: ${JSON.stringify(
                    message,
                    null,
                    2
                )}`;
                output(projectStore, MessageType.INFO, data);
                websocketOperationOptions.get(projectStore)?.onLog?.(data);
            },
            onStateChange: state => {
                websocketOperationOptions.get(projectStore)?.onStateChange?.(state);
                const activeEndpoint = platform.websocket
                    ? getEmbeddedWebSocketEndpoint(platform.websocket)
                    : endpoint;
                if (state === "open") {
                    output(
                        projectStore,
                        MessageType.INFO,
                        `Connected to embedded middleware WebSocket (${platform.websocket?.environment || "local"}): ${activeEndpoint}`
                    );
                } else if (state === "disconnected") {
                    const message =
                        "WebSocket error: connection closed before the remote command completed.";
                    output(projectStore, MessageType.WARNING, message);
                    websocketOperationOptions.get(projectStore)?.onLog?.(message);
                    // Do not leave a build waiting for the 15-minute timeout
                    // when its transport is already closed.
                    notifyRemoteLogWaiters(projectStore, message);
                }
            },
            onError: error => {
                const message = `WebSocket error: ${error.message}`;
                output(projectStore, MessageType.ERROR, message);
                websocketOperationOptions.get(projectStore)?.onLog?.(message);
                notifyRemoteLogWaiters(projectStore, message);
            }
        });
        websocketClients.set(projectStore, client);
    } else {
        client.setEndpoint(endpoint);
        client.setTimeout(timeoutMs);
    }

    return client;
}

export async function connectEmbeddedWebSocket(
    projectStore: ProjectStore
): Promise<EmbeddedOperationResult> {
    const platform = projectStore.project.embeddedPlatform;
    if (!isWebSocketEnabled(platform)) {
        const message = "Enable WebSocket middleware before connecting.";
        output(projectStore, MessageType.WARNING, message);
        return { success: false, message };
    }

    try {
        await getEmbeddedWebSocketClient(projectStore).connect();
        return {
            success: true,
            message: "Embedded middleware WebSocket connected."
        };
    } catch (error) {
        return {
            success: false,
            message: `Embedded middleware WebSocket connection failed: ${error}`
        };
    }
}

async function sendEmbeddedWebSocketCommand(
    projectStore: ProjectStore,
    message: EmbeddedOutgoingMessage,
    options: EmbeddedOperationOptions,
    metadata: Pick<EmbeddedOperationResult, "outputDirectory" | "firmwarePath"> = {}
): Promise<EmbeddedOperationResult> {
    const client = getEmbeddedWebSocketClient(projectStore);
    websocketOperationOptions.set(projectStore, options);
    options.onProgress?.(0);
    const command =
        message.command === "cmake" ||
        message.command === "build" ||
        message.command === "download"
            ? message.command
            : undefined;
    const completion = command
        ? waitForRemoteCommandCompletion(projectStore, command)
        : undefined;
    const cancelRemoteCommand = completion ? () => completion.cancel() : undefined;
    if (cancelRemoteCommand) {
        websocketOperationCancellers.set(projectStore, cancelRemoteCommand);
    }

    try {
        await client.send(message);
        options.onProgress?.(10);
        const completionResult = completion
            ? await completion.promise
            : { success: true, message: "" };
        if (!completionResult.success) {
            output(projectStore, MessageType.ERROR, completionResult.message);
            return {
                success: false,
                message: completionResult.message,
                ...metadata
            };
        }

        if (command === "cmake") {
            options.onProgress?.(50);
        } else if (command === "build" || command === "download") {
            options.onProgress?.(100);
        }

        const resultMessage = command
            ? `WebSocket ${command} command completed.`
            : `WebSocket ${message.command} command sent.`;
        output(projectStore, MessageType.INFO, resultMessage);
        return {
            success: true,
            message: resultMessage,
            ...metadata
        };
    } catch (error) {
        completion?.cancel();
        const resultMessage = `WebSocket ${message.command} command failed: ${error}`;
        output(projectStore, MessageType.ERROR, resultMessage);
        return {
            success: false,
            message: resultMessage,
            ...metadata
        };
    } finally {
        if (cancelRemoteCommand && websocketOperationCancellers.get(projectStore) === cancelRemoteCommand) {
            websocketOperationCancellers.delete(projectStore);
        }
        if (websocketOperationOptions.get(projectStore) === options) {
            websocketOperationOptions.delete(projectStore);
        }
    }
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

function substituteArguments(value: string, variables: Record<string, string>) {
    return value.replace(
        /\{(firmware|offset|target|interface|pack|script|frequency|speed|output)\}/g,
        (_match, key) => variables[key] ?? ""
    );
}

async function runCommand(
    projectStore: ProjectStore,
    command: string,
    args: string[],
    cwd: string,
    options: EmbeddedOperationOptions
) {
    output(
        projectStore,
        MessageType.INFO,
        `$ ${[command, ...args].map(value => (value.includes(" ") ? `"${value}"` : value)).join(" ")}`
    );

    return new Promise<number>((resolve, reject) => {
        let process: ChildProcess;
        try {
            process = spawn(command, args, {
                cwd,
                shell: false,
                windowsHide: true
            });
        } catch (error) {
            reject(error);
            return;
        }

        activeProcesses.set(projectStore, process);

        const writeChunk = (type: MessageType, chunk: Buffer) => {
            const text = chunk.toString().trim();
            if (!text) {
                return;
            }
            output(projectStore, type, text);
            const progress = parseProgress(text);
            if (progress !== undefined) {
                options.onProgress?.(progress);
            }
        };

        process.stdout?.on("data", chunk => writeChunk(MessageType.INFO, chunk));
        process.stderr?.on("data", chunk => writeChunk(MessageType.WARNING, chunk));
        process.once("error", error => {
            activeProcesses.delete(projectStore);
            reject(error);
        });
        process.once("close", code => {
            activeProcesses.delete(projectStore);
            resolve(code ?? 1);
        });
    });
}

function updateCMakeInclude(cmakeListsPath: string, generatedCMakePath: string) {
    if (!cmakeListsPath || !fs.existsSync(cmakeListsPath)) {
        return;
    }

    const relativePath = normalizeCMakePath(
        path.relative(path.dirname(cmakeListsPath), generatedCMakePath)
    );
    const includeLine = `include("${relativePath}")`;
    const markerStart = "# >>> eez-studio embedded resources >>>";
    const markerEnd = "# <<< eez-studio embedded resources <<<";
    const block = `${markerStart}\n${includeLine}\n${markerEnd}`;
    const current = fs.readFileSync(cmakeListsPath, "utf8");
    const markerExpression = new RegExp(
        `${markerStart}[\\s\\S]*?${markerEnd}`,
        "g"
    );
    const next = markerExpression.test(current)
        ? current.replace(markerExpression, block)
        : `${current.trimEnd()}\n\n${block}\n`;

    if (next !== current) {
        fs.writeFileSync(cmakeListsPath, next, "utf8");
    }
}

function updateMakefileInclude(makefilePath: string, generatedMakefilePath: string) {
    if (!makefilePath || !fs.existsSync(makefilePath)) {
        return;
    }

    const relativePath = normalizeCMakePath(
        path.relative(path.dirname(makefilePath), generatedMakefilePath)
    ).replace(/ /g, "\\ ");
    const markerStart = "# >>> eez-studio embedded resources >>>";
    const markerEnd = "# <<< eez-studio embedded resources <<<";
    const block = `${markerStart}\nEEZ_STUDIO_RESOURCES_MK := ${relativePath}\n-include $(EEZ_STUDIO_RESOURCES_MK)\n${markerEnd}`;
    const current = fs.readFileSync(makefilePath, "utf8");
    const markerExpression = new RegExp(
        `${markerStart}[\\s\\S]*?${markerEnd}`,
        "g"
    );
    const next = markerExpression.test(current)
        ? current.replace(markerExpression, block)
        : `${current.trimEnd()}\n\n${block}\n`;

    if (next !== current) {
        fs.writeFileSync(makefilePath, next, "utf8");
    }
}

function protocolDestinationName(protocol: ProtocolResource) {
    return path.basename(protocol.filePath).replace(/[\\/:*?"<>|]/g, "_");
}

export async function synchronizeEmbeddedResources(
    projectStore: ProjectStore
): Promise<EmbeddedResourceSummary> {
    const projectRoot = projectDirectory(projectStore);
    const platform = projectStore.project.embeddedPlatform;
    const outputDirectory = getOutputDirectory(projectStore, platform);
    const audioDirectory = path.join(projectRoot, "audio");
    const protocolDirectory = path.join(projectRoot, "protocol");
    const assetOutputDirectory = projectStore.getAbsoluteFilePath(
        projectStore.project.settings.build.destinationFolder || "."
    );
    const separateAssetDirectories =
        !!projectStore.project.settings.build.separateFolderForImagesAndFonts;
    const imageAssetDirectory = separateAssetDirectories
        ? path.join(assetOutputDirectory, "images")
        : assetOutputDirectory;
    const fontAssetDirectory = separateAssetDirectories
        ? path.join(assetOutputDirectory, "fonts")
        : assetOutputDirectory;

    await fs.promises.mkdir(audioDirectory, { recursive: true });
    await fs.promises.mkdir(protocolDirectory, { recursive: true });
    await fs.promises.mkdir(outputDirectory, { recursive: true });

    const copiedProtocols: string[] = [];
    const targetNames = new Set<string>();
    for (const protocol of platform.protocols.filter(item => item.enabled)) {
        const source = resolveConfiguredPath(projectStore, protocol.filePath);
        if (!source || !fs.existsSync(source)) {
            output(
                projectStore,
                MessageType.WARNING,
                `Protocol '${protocol.name}' was skipped because its file is unavailable.`
            );
            continue;
        }

        let destinationName = protocolDestinationName(protocol);
        const originalName = destinationName;
        let index = 2;
        while (targetNames.has(destinationName)) {
            const extension = path.extname(originalName);
            destinationName = `${path.basename(originalName, extension)}-${index++}${extension}`;
        }
        targetNames.add(destinationName);

        const destination = path.join(protocolDirectory, destinationName);
        if (path.resolve(source) !== path.resolve(destination)) {
            await fs.promises.copyFile(source, destination);
        }
        copiedProtocols.push(destination);
    }

    const audioFiles = listFiles(audioDirectory, [".wav", ".mp3", ".raw", ".pcm"]);
    const protocolFiles = listFiles(protocolDirectory, [
        ".json",
        ".yaml",
        ".yml",
        ".xml",
        ".c",
        ".h",
        ".proto",
        ".txt"
    ]);
    const generatedAssetExtensions = [".bin", ".c", ".h", ".json"];
    const imageFiles = uniqueFiles([
        ...listFilesWithPrefix(
            imageAssetDirectory,
            ["ui_image_"],
            generatedAssetExtensions
        ),
        ...listNamedFiles(assetOutputDirectory, [
            "image.bin",
            "image-data.c",
            "image-data.h",
            "image-manifest.json"
        ])
    ]);
    const fontFiles = uniqueFiles([
        ...listFilesWithPrefix(
            fontAssetDirectory,
            ["ui_font_"],
            generatedAssetExtensions
        ),
        ...listNamedFiles(assetOutputDirectory, [
            "font-manifest.json",
            "fonts-manifest.json"
        ])
    ]);
    const generatedDirectory = path.join(outputDirectory, "generated");
    await fs.promises.mkdir(generatedDirectory, { recursive: true });

    const cmakeListsPath = resolveConfiguredPath(
        projectStore,
        platform.bsp.cmakeListsPath ||
            (platform.bsp.rootPath
                ? path.join(platform.bsp.rootPath, "CMakeLists.txt")
                : "")
    );
    const bspMakefilePath = platform.bsp.rootPath
        ? path.join(resolveConfiguredPath(projectStore, platform.bsp.rootPath), "Makefile")
        : "";
    const cmakeBasePath = cmakeListsPath
        ? path.dirname(cmakeListsPath)
        : projectRoot;
    const makeBasePath = bspMakefilePath
        ? path.dirname(bspMakefilePath)
        : projectRoot;

    const manifestPath = path.join(generatedDirectory, "embedded-resources.json");
    const cmakePath = path.join(generatedDirectory, "embedded-resources.cmake");
    const makefilePath = path.join(generatedDirectory, "embedded-resources.mk");
    const manifest = {
        schema: "eez-studio.embedded-resources",
        version: 1,
        storage: {
            enabled: platform.storage.enabled,
            image: platform.storage.image,
            font: platform.storage.font,
            audio: platform.storage.audio,
            xipSectionAttribute: platform.storage.xipSectionAttribute
        },
        image: imageFiles.map(filePath =>
            toProjectRelativePath(projectRoot, filePath)
        ),
        font: fontFiles.map(filePath =>
            toProjectRelativePath(projectRoot, filePath)
        ),
        audio: audioFiles.map(filePath => toProjectRelativePath(projectRoot, filePath)),
        protocol: protocolFiles.map(filePath => toProjectRelativePath(projectRoot, filePath)),
        copiedProtocols: copiedProtocols.map(filePath =>
            toProjectRelativePath(projectRoot, filePath)
        )
    };
    await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2) + "\n",
        "utf8"
    );

    const cmakeList = (name: string, files: string[]) => {
        const entries = files
            .map(filePath =>
                `    "${normalizeCMakePath(path.relative(cmakeBasePath, filePath))}"`
            )
            .join("\n");
        return `set(${name}\n${entries}\n)\n`;
    };
    const cmake = [
        "# Generated by EEZ Studio. Do not edit manually.",
        `set(EEZ_EMBEDDED_IMAGE_STORAGE \"${platform.storage.image}\")`,
        `set(EEZ_EMBEDDED_FONT_STORAGE \"${platform.storage.font}\")`,
        `set(EEZ_EMBEDDED_AUDIO_STORAGE \"${platform.storage.audio}\")`,
        cmakeList("EEZ_EMBEDDED_IMAGE_FILES", imageFiles),
        cmakeList("EEZ_EMBEDDED_FONT_FILES", fontFiles),
        cmakeList(
            "EEZ_EMBEDDED_AUDIO_FILES",
            audioFiles
        ),
        cmakeList(
            "EEZ_EMBEDDED_PROTOCOL_FILES",
            protocolFiles
        )
    ].join("\n");
    await fs.promises.writeFile(cmakePath, cmake, "utf8");

    const makePath = (filePath: string) =>
        normalizeCMakePath(path.relative(makeBasePath, filePath)).replace(/ /g, "\\ ");
    const makeList = (name: string, files: string[]) => {
        if (files.length === 0) {
            return `${name} :=`;
        }

        const continuation = String.fromCharCode(92);
        const entries = files
            .map(
                (filePath, index) =>
                    `    ${makePath(filePath)}${
                        index < files.length - 1 ? ` ${continuation}` : ""
                    }`
            )
            .join("\n");
        return `${name} := ${continuation}\n${entries}`;
    };
    const makefile = [
        "# Generated by EEZ Studio. Do not edit manually.",
        `EEZ_EMBEDDED_IMAGE_STORAGE := ${platform.storage.image}`,
        `EEZ_EMBEDDED_FONT_STORAGE := ${platform.storage.font}`,
        `EEZ_EMBEDDED_AUDIO_STORAGE := ${platform.storage.audio}`,
        makeList("EEZ_EMBEDDED_IMAGE_FILES", imageFiles),
        makeList("EEZ_EMBEDDED_FONT_FILES", fontFiles),
        makeList("EEZ_EMBEDDED_AUDIO_FILES", audioFiles),
        makeList("EEZ_EMBEDDED_PROTOCOL_FILES", protocolFiles)
    ].join("\n") + "\n";
    await fs.promises.writeFile(makefilePath, makefile, "utf8");

    if (platform.build.autoUpdateCMake) {
        updateCMakeInclude(cmakeListsPath, cmakePath);

        updateMakefileInclude(bspMakefilePath, makefilePath);
    }

    output(
        projectStore,
        MessageType.INFO,
        `Embedded resources synchronized: ${imageFiles.length} image file(s), ${fontFiles.length} font file(s), ${audioFiles.length} audio file(s), ${protocolFiles.length} protocol file(s).`
    );

    return {
        imageFiles,
        fontFiles,
        audioFiles,
        protocolFiles,
        manifestPath,
        cmakePath,
        makefilePath
    };
}

export function stopEmbeddedOperation(projectStore: ProjectStore) {
    const cancelRemoteCommand = websocketOperationCancellers.get(projectStore);
    if (cancelRemoteCommand) {
        cancelRemoteCommand();
        websocketOperationCancellers.delete(projectStore);
        output(projectStore, MessageType.WARNING, "Remote embedded operation stopped by user.");
        return true;
    }

    const process = activeProcesses.get(projectStore);
    if (!process) {
        return false;
    }

    process.kill();
    activeProcesses.delete(projectStore);
    output(projectStore, MessageType.WARNING, "Embedded operation stopped by user.");
    return true;
}

function getBspSourceDirectory(projectStore: ProjectStore, platform: EmbeddedPlatform) {
    if (platform.bsp.rootPath) {
        return resolveConfiguredPath(projectStore, platform.bsp.rootPath);
    }
    if (platform.bsp.cmakeListsPath) {
        return path.dirname(
            resolveConfiguredPath(projectStore, platform.bsp.cmakeListsPath)
        );
    }
    return "";
}

export async function runEmbeddedBuild(
    projectStore: ProjectStore,
    options: EmbeddedOperationOptions = {}
): Promise<EmbeddedOperationResult> {
    const platform = projectStore.project.embeddedPlatform;
    options.onProgress?.(0);

    if (isWebSocketEnabled(platform)) {
        const missingField = getMissingRemoteBuildField(platform);
        if (missingField) {
            const message = `Set ${missingField} before starting the remote firmware build.`;
            output(projectStore, MessageType.ERROR, message);
            return { success: false, message };
        }

        const remoteBuild = platform.remote.build;
        const cmakeResult = await sendEmbeddedWebSocketCommand(
            projectStore,
            {
                command: "cmake",
                output_dir: normalizeRemotePath(remoteBuild.projectDirectory),
                config_file: normalizeRemotePath(remoteBuild.configFile)
            },
            options,
            { outputDirectory: normalizeRemotePath(remoteBuild.outputDirectory) }
        );
        if (!cmakeResult.success) {
            return cmakeResult;
        }

        return sendEmbeddedWebSocketCommand(
            projectStore,
            {
                command: "build",
                src: normalizeRemotePath(remoteBuild.projectDirectory),
                dst: normalizeRemotePath(remoteBuild.outputDirectory)
            },
            options,
            { outputDirectory: normalizeRemotePath(remoteBuild.outputDirectory) }
        );
    }

    try {
        await ProjectEditor.build.buildProject(projectStore, "buildFiles");
        if (projectStore.outputSectionsStore.getSection(Section.OUTPUT).numErrors) {
            const message = "EEZ resource generation failed before firmware build.";
            return { success: false, message };
        }
        await synchronizeEmbeddedResources(projectStore);
        options.onProgress?.(10);
    } catch (error) {
        const message = `Resource synchronization failed: ${error}`;
        output(projectStore, MessageType.ERROR, message);
        return { success: false, message };
    }

    const outputDirectory = getOutputDirectory(projectStore, platform);
    const sourceDirectory = getBspSourceDirectory(projectStore, platform);
    const cwd = projectDirectory(projectStore);

    try {
        if (platform.build.scriptPath) {
            const script = resolveConfiguredPath(projectStore, platform.build.scriptPath);
            const args = [
                script,
                "--project",
                cwd,
                "--output",
                outputDirectory,
                ...tokenizeArguments(platform.build.extraArguments)
            ];
            const code = await runCommand(
                projectStore,
                platform.build.pythonExecutable || "python3",
                args,
                cwd,
                options
            );
            if (code !== 0) {
                const message = `Firmware build script exited with code ${code}.`;
                output(projectStore, MessageType.ERROR, message);
                return { success: false, message, outputDirectory };
            }
        } else {
            if (!sourceDirectory || !fs.existsSync(sourceDirectory)) {
                const message =
                    "Set a BSP root or CMakeLists path before starting the firmware build.";
                output(projectStore, MessageType.ERROR, message);
                return { success: false, message, outputDirectory };
            }

            const configureArgs = ["-S", sourceDirectory, "-B", outputDirectory];
            if (platform.build.cmakeGenerator) {
                configureArgs.push("-G", platform.build.cmakeGenerator);
            }
            if (platform.bsp.toolchainFile) {
                configureArgs.push(
                    `-DCMAKE_TOOLCHAIN_FILE=${resolveConfiguredPath(projectStore, platform.bsp.toolchainFile)}`
                );
            }
            configureArgs.push(...tokenizeArguments(platform.build.extraArguments));

            const configureCode = await runCommand(
                projectStore,
                "cmake",
                configureArgs,
                cwd,
                options
            );
            if (configureCode !== 0) {
                const message = `CMake configuration exited with code ${configureCode}.`;
                output(projectStore, MessageType.ERROR, message);
                return { success: false, message, outputDirectory };
            }

            options.onProgress?.(50);
            const buildCode = await runCommand(
                projectStore,
                "cmake",
                ["--build", outputDirectory],
                cwd,
                options
            );
            if (buildCode !== 0) {
                const message = `CMake build exited with code ${buildCode}.`;
                output(projectStore, MessageType.ERROR, message);
                return { success: false, message, outputDirectory };
            }
        }
    } catch (error) {
        const message = `Firmware build could not be started: ${error}`;
        output(projectStore, MessageType.ERROR, message);
        return { success: false, message, outputDirectory };
    }

    options.onProgress?.(100);
    const message = "Firmware build completed.";
    output(projectStore, MessageType.INFO, message);
    return { success: true, message, outputDirectory };
}

function findFirmwareFile(outputDirectory: string) {
    const candidates = [
        "firmware.bin",
        "firmware.hex",
        "firmware.elf",
        "app.bin",
        "app.hex"
    ].map(name => path.join(outputDirectory, name));
    return candidates.find(candidate => fs.existsSync(candidate));
}

function defaultDownloadExecutable(tool: EmbeddedDownloadSettings["tool"]) {
    if (tool === "jlink") {
        return process.platform === "win32" ? "JLink.exe" : "JLinkExe";
    }
    if (tool === "stlink") {
        return "STM32_Programmer_CLI";
    }
    return "dplink";
}

function getDefaultDownloadArguments(
    settings: EmbeddedDownloadSettings,
    firmwarePath: string,
    offset: string
) {
    if (settings.tool === "jlink") {
        return [
            "-device",
            settings.targetId || "Cortex-M",
            "-if",
            settings.interfaceName || "SWD",
            "-autoconnect",
            "1",
            "-CommanderScript",
            path.join(path.dirname(firmwarePath), "eez-studio-download.jlink")
        ];
    }
    if (settings.tool === "stlink") {
        return [
            "-c",
            `port=${settings.interfaceName || "swd"}`,
            "-w",
            firmwarePath,
            offset,
            "-rst"
        ];
    }
    return ["--download", firmwarePath, "--address", offset];
}

function createJLinkScript(firmwarePath: string, offset: string) {
    const scriptPath = path.join(
        path.dirname(firmwarePath),
        "eez-studio-download.jlink"
    );
    fs.writeFileSync(scriptPath, `loadfile ${firmwarePath}, ${offset}\nr\nq\n`, "utf8");
    return scriptPath;
}

export async function detectEmbeddedTarget(
    projectStore: ProjectStore
): Promise<EmbeddedOperationResult> {
    const platform = projectStore.project.embeddedPlatform;
    if (isWebSocketEnabled(platform)) {
        return sendEmbeddedWebSocketCommand(
            projectStore,
            { command: "test", msg: "Studio WebSocket connection test" },
            {}
        );
    }

    const settings = projectStore.project.embeddedPlatform.download;
    const command = settings.executablePath || defaultDownloadExecutable(settings.tool);

    try {
        const code = await runCommand(
            projectStore,
            command,
            settings.tool === "jlink" ? ["-?" ] : ["--version"],
            projectDirectory(projectStore),
            {}
        );
        const message =
            code === 0
                ? `${settings.tool.toUpperCase()} tool is available.`
                : `${settings.tool.toUpperCase()} tool exited with code ${code}.`;
        output(projectStore, code === 0 ? MessageType.INFO : MessageType.ERROR, message);
        return { success: code === 0, message };
    } catch (error) {
        const message = `Unable to detect ${settings.tool.toUpperCase()}: ${error}`;
        output(projectStore, MessageType.ERROR, message);
        return { success: false, message };
    }
}

export async function runEmbeddedTransform(
    projectStore: ProjectStore,
    type: EmbeddedTransformType,
    model: EmbeddedTransformModel,
    options: EmbeddedOperationOptions = {}
): Promise<EmbeddedOperationResult> {
    const platform = projectStore.project.embeddedPlatform;
    if (!isWebSocketEnabled(platform)) {
        const message =
            "Enable WebSocket middleware before sending a resource transform command.";
        output(projectStore, MessageType.WARNING, message);
        return { success: false, message };
    }

    return sendEmbeddedWebSocketCommand(
        projectStore,
        { command: "transform", type, model },
        options
    );
}

export async function runEmbeddedDownload(
    projectStore: ProjectStore,
    firmwarePath: string | undefined,
    options: EmbeddedOperationOptions = {}
): Promise<EmbeddedOperationResult> {
    const platform = projectStore.project.embeddedPlatform;
    const settings = platform.download;

    if (isWebSocketEnabled(platform)) {
        const missingField = getMissingRemoteDownloadField(platform);
        if (missingField) {
            const message = `Set ${missingField} before starting the remote firmware download.`;
            output(projectStore, MessageType.ERROR, message);
            return { success: false, message };
        }

        const remoteDownload = platform.remote.download;
        const remoteFirmwarePath = normalizeRemotePath(remoteDownload.firmwarePath);
        return sendEmbeddedWebSocketCommand(
            projectStore,
            {
                command: "download",
                target: remoteDownload.target.trim(),
                pack: remoteDownload.pack.trim() || "null",
                script: remoteDownload.script.trim() || "null",
                frequency: remoteDownload.frequency.trim() || "500000",
                firmware: remoteFirmwarePath,
                addr: remoteDownload.addressOffset.trim() || "0x0"
            },
            options,
            { outputDirectory: normalizeRemotePath(platform.remote.build.outputDirectory), firmwarePath: remoteFirmwarePath }
        );
    }

    const outputDirectory = getOutputDirectory(projectStore, platform);
    const resolvedFirmware = firmwarePath || findFirmwareFile(outputDirectory);

    if (!resolvedFirmware || !fs.existsSync(resolvedFirmware)) {
        const message = "No firmware image was found. Build the firmware or choose a .bin/.hex file.";
        output(projectStore, MessageType.ERROR, message);
        return { success: false, message, outputDirectory };
    }

    const offset = settings.addressOffset || "0x0";
    const command = settings.executablePath || defaultDownloadExecutable(settings.tool);
    const variables = {
        firmware: resolvedFirmware,
        offset,
        target: settings.targetId,
        interface: settings.interfaceName,
        pack: settings.pack || "null",
        script: settings.script || "null",
        frequency: settings.frequency || "500000",
        speed: settings.speed || "5000",
        output: outputDirectory
    };

    if (settings.tool === "jlink" && !settings.commandArguments) {
        createJLinkScript(resolvedFirmware, offset);
    }

    const args = settings.commandArguments
        ? tokenizeArguments(substituteArguments(settings.commandArguments, variables))
        : getDefaultDownloadArguments(settings, resolvedFirmware, offset);

    options.onProgress?.(0);
    try {
        const code = await runCommand(
            projectStore,
            command,
            args,
            projectDirectory(projectStore),
            options
        );
        const message =
            code === 0
                ? "Firmware download completed."
                : `Firmware download exited with code ${code}.`;
        output(projectStore, code === 0 ? MessageType.INFO : MessageType.ERROR, message);
        options.onProgress?.(code === 0 ? 100 : 0);
        return {
            success: code === 0,
            message,
            outputDirectory,
            firmwarePath: resolvedFirmware
        };
    } catch (error) {
        const message = `Firmware download could not be started: ${error}`;
        output(projectStore, MessageType.ERROR, message);
        return {
            success: false,
            message,
            outputDirectory,
            firmwarePath: resolvedFirmware
        };
    }
}
