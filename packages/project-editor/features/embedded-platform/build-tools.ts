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
import { EmbeddedWebSocketClient } from "project-editor/features/embedded-platform/embedded-websocket";
import type { EmbeddedOutgoingMessage } from "project-editor/features/embedded-platform/embedded-protocol";

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
}

const activeProcesses = new Map<ProjectStore, ChildProcess>();
const websocketClients = new WeakMap<ProjectStore, EmbeddedWebSocketClient>();
const websocketOperationOptions = new WeakMap<ProjectStore, EmbeddedOperationOptions>();

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

function toWebSocketPath(projectRoot: string, filePath: string) {
    const relativePath = toProjectRelativePath(projectRoot, filePath) || ".";
    if (relativePath === ".") {
        return "./";
    }
    return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
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
                            : JSON.stringify(message.data);
                    output(projectStore, MessageType.INFO, data);
                    const progress = parseProgress(data);
                    if (progress !== undefined) {
                        websocketOperationOptions
                            .get(projectStore)
                            ?.onProgress?.(progress);
                    }
                    return;
                }

                output(
                    projectStore,
                    MessageType.INFO,
                    `WebSocket ${message.command}: ${JSON.stringify(message)}`
                );
            },
            onStateChange: state => {
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
                    output(
                        projectStore,
                        MessageType.WARNING,
                        "Embedded middleware WebSocket disconnected."
                    );
                }
            },
            onError: error => {
                output(
                    projectStore,
                    MessageType.ERROR,
                    `Embedded middleware WebSocket error: ${error.message}`
                );
            }
        });
        websocketClients.set(projectStore, client);
    } else {
        client.setEndpoint(endpoint);
        client.setTimeout(timeoutMs);
    }

    return client;
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

    try {
        await client.send(message);
        // §5.7 defines command submission and log messages, but not a
        // completion response. Keep the progress below 100 until middleware
        // reports execution progress through a log message.
        options.onProgress?.(10);
        const resultMessage = `WebSocket ${message.command} command sent.`;
        output(projectStore, MessageType.INFO, resultMessage);
        return {
            success: true,
            message: resultMessage,
            ...metadata
        };
    } catch (error) {
        const resultMessage = `WebSocket ${message.command} command failed: ${error}`;
        output(projectStore, MessageType.ERROR, resultMessage);
        return {
            success: false,
            message: resultMessage,
            ...metadata
        };
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
    return value.replace(/\{(firmware|offset|target|interface|speed|output)\}/g, (_match, key) => {
        return variables[key] ?? "";
    });
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

    if (isWebSocketEnabled(platform)) {
        return sendEmbeddedWebSocketCommand(
            projectStore,
            {
                command: "build",
                src: toWebSocketPath(cwd, cwd),
                dst: toWebSocketPath(cwd, outputDirectory)
            },
            options,
            { outputDirectory }
        );
    }

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
    type: string,
    model: string,
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
    const outputDirectory = getOutputDirectory(projectStore, platform);
    const resolvedFirmware = firmwarePath || findFirmwareFile(outputDirectory);

    if (!resolvedFirmware || !fs.existsSync(resolvedFirmware)) {
        const message = "No firmware image was found. Build the firmware or choose a .bin/.hex file.";
        output(projectStore, MessageType.ERROR, message);
        return { success: false, message, outputDirectory };
    }

    const offset = settings.addressOffset || "0x0";
    const projectRoot = projectDirectory(projectStore);

    if (isWebSocketEnabled(platform)) {
        return sendEmbeddedWebSocketCommand(
            projectStore,
            {
                command: "download",
                interface: settings.interfaceName || "",
                target: settings.targetId || "",
                speed: settings.speed || "5000",
                firmware: toWebSocketPath(projectRoot, resolvedFirmware),
                addr: offset
            },
            options,
            { outputDirectory, firmwarePath: resolvedFirmware }
        );
    }

    const command = settings.executablePath || defaultDownloadExecutable(settings.tool);
    const variables = {
        firmware: resolvedFirmware,
        offset,
        target: settings.targetId,
        interface: settings.interfaceName,
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
