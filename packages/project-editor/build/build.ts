import path from "path";
import fs from "fs";
import { createTransformer } from "mobx-utils";

import {
    writeTextFile as originalWriteTextFile,
    writeBinaryData as originalWriteBinaryData,
    makeFolder
} from "eez-studio-shared/util-electron";

import type { BuildResult } from "project-editor/store/features";
import {
    IEezObject,
    IMessage,
    getPropertyInfo,
    MessageType,
    ProjectType
} from "project-editor/core/object";
import {
    ProjectStore,
    isEezObjectArray,
    getArrayAndObjectProperties,
    getClassInfo,
    Section,
    getJSON,
    Message,
    getLabel
} from "project-editor/store";

import type { BuildConfiguration } from "project-editor/project/project";
import {
    extensionDefinitionAnythingToBuild,
    extensionDefinitionBuild
} from "project-editor/features/extension-definitions/build";

import { buildAssets } from "project-editor/build/assets";
import {
    prepareAudioBuildForProject,
    type AudioBuildResult
} from "project-editor/features/audio/build";
import {
    prepareEmbeddedImageBuildForProject,
    type EmbeddedImageBuildResult
} from "project-editor/features/embedded-platform/image-build";
import { buildScpi } from "project-editor/build/scpi";
import { generateSourceCodeForEezFramework } from "project-editor/lvgl/build";
import { cleanupSourceFile } from "project-editor/build/cleanup-c-source-files";
import { generateSourceCodeForEezGuiLite } from "project-editor/eez-gui-lite/build";

////////////////////////////////////////////////////////////////////////////////

// Build manifest tracking
interface BuildManifest {
    files: string[]; // Relative paths from destinationFolder
}

let currentBuildFiles: Set<string> = new Set();
let trackingDestinationFolder: string | null = null;

function trackBuildFile(absolutePath: string, destinationFolderPath: string) {
    // Convert absolute path to relative path from destination folder
    let relativePath = path.relative(destinationFolderPath, absolutePath);
    // Normalize path separators to forward slashes for consistency
    relativePath = relativePath.replace(/\\/g, "/");
    currentBuildFiles.add(relativePath);
}

// Enable tracking mode - this will intercept all file writes
function enableBuildTracking(destinationFolderPath: string) {
    trackingDestinationFolder = destinationFolderPath;
    currentBuildFiles.clear();
}

function disableBuildTracking() {
    trackingDestinationFolder = null;
}

// Flag to indicate if EEZ_FOR_LVGL blocks should be removed (for eez-flow-lite or no-flow projects)

interface SourceCleanupOptions {
    hasFlowSupport: boolean;
    generateSourceCodeForEezFramework: boolean;

}

let sourceCleanupOptions: SourceCleanupOptions = {
    hasFlowSupport: true,
    generateSourceCodeForEezFramework: true
};

export function setSourceCleanupOptions(options: SourceCleanupOptions) {
    sourceCleanupOptions = options;
}

const GENERATED_C_CPP_EXTENSIONS = new Set([
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cc",
    ".cxx",
    ".hh",
    ".hxx"
]);

function normalizeLineEndingsToLf(content: string) {
    return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Tracked write functions - these track files when tracking is enabled
export async function writeTextFile(
    filePath: string,
    content: string
): Promise<void> {
    // Clean up .c and .h files to remove consecutive empty lines
    const basename = path.basename(filePath).toLowerCase();
    if (
        basename.endsWith('.c') ||
        (basename.endsWith('.h') && basename != 'eez-flow.h')
    ) {
        content = cleanupSourceFile(
            content, 
            
            // hasFlowSupport then EEZ_FOR_LVGL is defined
            sourceCleanupOptions.hasFlowSupport ? ["EEZ_FOR_LVGL"] : [],
            
            // noFlow then EEZ_FOR_LVGL is NOT defined
            sourceCleanupOptions.hasFlowSupport ? [] : ["EEZ_FOR_LVGL"], 

            // Always exclude eez/ folder when generating source code for eez framework
            sourceCleanupOptions.hasFlowSupport && sourceCleanupOptions.generateSourceCodeForEezFramework ? ["eez/"] : []
        );
    }

    const extname = path.extname(filePath).toLowerCase();
    if (GENERATED_C_CPP_EXTENSIONS.has(extname)) {
        content = normalizeLineEndingsToLf(content);
    }
    
    await originalWriteTextFile(filePath, content);
    if (trackingDestinationFolder) {
        trackBuildFile(filePath, trackingDestinationFolder);
    }
}

export async function writeBinaryData(
    filePath: string,
    data: Buffer
): Promise<void> {
    await originalWriteBinaryData(filePath, data);
    if (trackingDestinationFolder) {
        trackBuildFile(filePath, trackingDestinationFolder);
    }
}

// Convenience aliases for internal use
const trackedWriteTextFile = writeTextFile;
const trackedWriteBinaryData = writeBinaryData;

async function loadPreviousManifest(
    destinationFolderPath: string
): Promise<BuildManifest | null> {
    const manifestPath = path.join(destinationFolderPath, ".eez-project-build");

    try {
        const content = await fs.promises.readFile(manifestPath, "utf-8");
        return JSON.parse(content) as BuildManifest;
    } catch (err) {
        return null;
    }
}

async function saveManifest(
    destinationFolderPath: string,
    files: string[]
): Promise<void> {
    const manifestPath = path.join(destinationFolderPath, ".eez-project-build");

    const manifest: BuildManifest = {
        files: files.sort() // Sort for consistency
    };

    await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        "utf-8"
    );
}

async function deleteOrphanedFiles(
    destinationFolderPath: string,
    previousFiles: string[],
    currentFiles: string[],
    outputSectionsStore: any
): Promise<void> {
    const currentSet = new Set(currentFiles);
    const orphanedFiles = previousFiles.filter(file => !currentSet.has(file));

    for (const relativePath of orphanedFiles) {
        const absolutePath = path.join(destinationFolderPath, relativePath);
        try {
            await fs.promises.unlink(absolutePath);
            outputSectionsStore.write(
                Section.OUTPUT,
                MessageType.INFO,
                `Deleted orphaned file: ${relativePath}`
            );
        } catch (err) {
            // Ignore errors (file might already be deleted)
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

function showCheckResult(projectStore: ProjectStore) {
    const OutputSections = projectStore.outputSectionsStore;

    let outputSection = OutputSections.getSection(Section.OUTPUT);

    let checkResultMassage: string;

    if (outputSection.numErrors == 0) {
        checkResultMassage = "No error";
    } else if (outputSection.numErrors == 1) {
        checkResultMassage = "1 error";
    } else {
        checkResultMassage = `${outputSection.numErrors} errors`;
    }

    checkResultMassage += " and";

    if (outputSection.numWarnings == 0) {
        checkResultMassage += " no warning";
    } else if (outputSection.numWarnings == 1) {
        checkResultMassage += " 1 warning";
    } else {
        checkResultMassage += ` ${outputSection.numWarnings} warnings`;
    }

    checkResultMassage += " detected";

    OutputSections.write(Section.OUTPUT, MessageType.INFO, checkResultMassage);
}

class BuildException {
    constructor(
        public message: string,
        public object?: IEezObject | undefined
    ) {}
}

async function getBuildResults(
    projectStore: ProjectStore,
    sectionNames: string[] | undefined,
    buildConfiguration: BuildConfiguration | undefined,
    option: "check" | "buildAssets" | "buildFiles"
) {
    const project = projectStore.project;

    let buildResults: BuildResult[] = [];

    buildResults.push(
        await buildAssets(project, sectionNames, buildConfiguration, option)
    );

    if (project.scpi) {
        buildResults.push(
            await buildScpi(project, sectionNames, buildConfiguration)
        );
    }

    return buildResults;
}

const sectionNamesRegexp = /\/\/\$\{eez-studio (\w*)\s*(\w*)\}/g;

function getSectionNames(projectStore: ProjectStore): string[] {
    if (
        projectStore.masterProject &&
        projectStore.project.settings.general.projectType !=
            ProjectType.FIRMWARE
    ) {
        return ["GUI_ASSETS_DATA", "GUI_ASSETS_DATA_MAP"];
    }

    const project = projectStore.project;

    const sectionNames: string[] = [];

    project.settings.build.files.forEach(buildFile => {
        let result;
        while (
            (result = sectionNamesRegexp.exec(buildFile.template)) !== null
        ) {
            sectionNames.push(result[1]);
        }
    });

    return sectionNames;
}

async function generateFile(
    projectStore: ProjectStore,
    configurationBuildResults: {
        [configurationName: string]: BuildResult[];
    },
    defaultConfigurationName: string,
    template: string | undefined,
    filePath: string
): Promise<any> {
    let parts: any;

    if (template != undefined) {
        let buildFileContent = template.replace(
            sectionNamesRegexp,
            (_1, part, configurationName) => {
                const buildResults =
                    configurationBuildResults[
                        configurationName || defaultConfigurationName
                    ];

                parts = {};
                for (const buildResult of buildResults) {
                    parts = Object.assign(parts, buildResult);
                }

                return parts[part];
            }
        );

        await trackedWriteTextFile(filePath, buildFileContent);
    } else {
        const buildResults =
            configurationBuildResults[defaultConfigurationName];

        parts = {};
        for (const buildResult of buildResults) {
            parts = Object.assign(parts, buildResult);
        }

        await trackedWriteBinaryData(filePath, parts["GUI_ASSETS_DATA"]);
        if (parts["GUI_ASSETS_DATA_MAP"]) {
            await trackedWriteBinaryData(
                filePath + ".map",
                parts["GUI_ASSETS_DATA_MAP"]
            );

            projectStore.outputSectionsStore.write(
                Section.OUTPUT,
                MessageType.INFO,
                `File "${filePath}.map" built`
            );
        }
    }

    projectStore.outputSectionsStore.write(
        Section.OUTPUT,
        MessageType.INFO,
        `File "${filePath}" built`
    );

    return parts;
}

async function generateFiles(
    projectStore: ProjectStore,
    destinationFolderPath: string,
    configurationBuildResults: {
        [configurationName: string]: BuildResult[];
    }
) {
    let parts: any = undefined;

    const project = projectStore.project;

    if (
        projectStore.masterProject &&
        project.settings.general.projectType != ProjectType.FIRMWARE
    ) {
        parts = await generateFile(
            projectStore,
            configurationBuildResults,
            projectStore.selectedBuildConfiguration
                ? projectStore.selectedBuildConfiguration.name
                : "default",
            undefined,
            destinationFolderPath +
                "/" +
                path.basename(projectStore.filePath || "", ".eez-project") +
                (project.projectTypeTraits.isApplet ? ".app" : ".res")
        );

        if (project.projectTypeTraits.isResource && project.micropython) {
            await trackedWriteTextFile(
                destinationFolderPath +
                    "/" +
                    path.basename(projectStore.filePath || "", ".eez-project") +
                    ".py",
                project.micropython.code
            );
        }
    } else {
        const build = project.settings.build;

        for (const buildFile of build.files) {
            if (buildFile.fileName.indexOf("<configuration>") !== -1) {
                for (const configuration of build.configurations) {
                    try {
                        parts = await generateFile(
                            projectStore,
                            configurationBuildResults,
                            configuration.name,
                            buildFile.template,
                            destinationFolderPath +
                                "/" +
                                buildFile.fileName.replace(
                                    "<configuration>",
                                    configuration.name
                                )
                        );
                    } catch (err) {
                        await new Promise(resolve => setTimeout(resolve, 10));

                        parts = await generateFile(
                            projectStore,
                            configurationBuildResults,
                            configuration.name,
                            buildFile.template,
                            destinationFolderPath +
                                "/" +
                                buildFile.fileName.replace(
                                    "<configuration>",
                                    configuration.name
                                )
                        );
                    }
                }
            } else {
                parts = await generateFile(
                    projectStore,
                    configurationBuildResults,
                    projectStore.selectedBuildConfiguration
                        ? projectStore.selectedBuildConfiguration.name
                        : "default",
                    buildFile.template,
                    destinationFolderPath + "/" + buildFile.fileName
                );
            }
        }
    }

    return parts;
}

function anythingToBuild(projectStore: ProjectStore) {
    const project = projectStore.project;
    return (
        project.settings.build.files.length > 0 ||
        (project.audio?.resources.length ?? 0) > 0 ||
        project.bitmaps.length > 0 ||
        projectStore.masterProject ||
        project.projectTypeTraits.isDashboard ||
        project.projectTypeTraits.isLVGL
    );
}

function getAudioIndexConstantName(
    resourceName: string,
    audioIndex: number,
    usedNames: Set<string>
) {
    const normalized = resourceName
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    const baseName = normalized
        ? `EEZ_AUDIO_INDEX_${normalized}`
        : `EEZ_AUDIO_INDEX_RESOURCE_${audioIndex}`;
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
        name = `${baseName}_${suffix++}`;
    }
    usedNames.add(name);
    return name;
}

async function writeAudioBuildFiles(
    destinationFolderPath: string,
    audioBuildResult: AudioBuildResult,
    outputSectionsStore: ProjectStore["outputSectionsStore"]
) {
    const binaryFileName = "audio.bin";
    const manifestFileName = "audio-manifest.json";

    const headerFileName = "audio-data.h";
    const sourceFileName = "audio-data.c";
    const bytesPerLine = 12;
    const dataLines: string[] = [];
    if (audioBuildResult.manifest.accessMode === "rom") {
        for (let offset = 0; offset < audioBuildResult.binary.length; offset += bytesPerLine) {
            const values = Array.from(
                audioBuildResult.binary.subarray(offset, offset + bytesPerLine)
            ).map(value => `0x${value.toString(16).padStart(2, "0").toUpperCase()}`);
            dataLines.push(`    ${values.join(", ")}`);
        }
    } else {
        await writeBinaryData(
            path.join(destinationFolderPath, binaryFileName),
            audioBuildResult.binary
        );
    }
    const cString = (value: string) => JSON.stringify(value);
    const usedIndexNames = new Set(["EEZ_AUDIO_INDEX_NONE"]);
    const indexConstants = audioBuildResult.manifest.resources
        .map(resource => {
            const constantName = getAudioIndexConstantName(
                resource.name,
                resource.audioIndex,
                usedIndexNames
            );
            return `    ${constantName} = ${resource.audioIndex}`;
        })
        .join(",\n");
    const resources = audioBuildResult.manifest.resources
        .map(resource =>
            `    { ${resource.audioIndex}u, ${resource.id}u, ${cString(resource.name)}, ${resource.flashOffset}u, ${resource.dataSize}u, ${resource.sampleRate}u, ${resource.channels}u, ${resource.bitsPerSample}u, ${resource.blockAlign}u }`
        )
        .join(",\n");
    const accessModeMacro =
        audioBuildResult.manifest.accessMode === "rom"
            ? "EEZ_AUDIO_ACCESS_ROM"
            : audioBuildResult.manifest.accessMode === "xip"
              ? "EEZ_AUDIO_ACCESS_XIP"
              : "EEZ_AUDIO_ACCESS_NON_XIP";
    const header = `#pragma once\n#include <stdint.h>\n\n#define EEZ_AUDIO_ACCESS_ROM 1\n#define EEZ_AUDIO_ACCESS_XIP 2\n#define EEZ_AUDIO_ACCESS_NON_XIP 3\n#define EEZ_AUDIO_ACCESS_MODE ${accessModeMacro}\n\n#ifdef __cplusplus\nextern \"C\" {\n#endif\n\ntypedef struct {\n    uint32_t id;\n    const char *name;\n    uint32_t flash_offset;\n    uint32_t data_size;\n    uint32_t sample_rate;\n    uint16_t channels;\n    uint16_t bits_per_sample;\n    uint16_t block_align;\n} eez_audio_resource_t;\n\nextern const eez_audio_resource_t eez_audio_resources[];\nextern const uint32_t eez_audio_resource_count;\nextern const uint32_t eez_audio_base_address;\nextern const uint32_t eez_audio_image_size;\n${audioBuildResult.manifest.accessMode === "rom" ? "extern const uint8_t eez_audio_data[];\nextern const uint32_t eez_audio_data_size;\n" : ""}\n#ifdef __cplusplus\n}\n#endif\n`;
    const baseAddress = parseInt(audioBuildResult.manifest.baseAddress, 0) >>> 0;
    const source = `#include \"${headerFileName}\"\n\nconst uint32_t eez_audio_base_address = 0x${baseAddress.toString(16).toUpperCase()}u;\nconst uint32_t eez_audio_image_size = ${audioBuildResult.manifest.imageSize}u;\nconst eez_audio_resource_t eez_audio_resources[] = {\n${resources}\n};\nconst uint32_t eez_audio_resource_count = ${audioBuildResult.manifest.resources.length}u;\n${audioBuildResult.manifest.accessMode === "rom" ? `const uint8_t eez_audio_data[] = {\n${dataLines.join(",\n")}\n};\nconst uint32_t eez_audio_data_size = ${audioBuildResult.binary.length}u;\n` : ""}`;
    const indexedHeader = header
        .replace(
            `#define EEZ_AUDIO_ACCESS_MODE ${accessModeMacro}\n\n`,
            `#define EEZ_AUDIO_ACCESS_MODE ${accessModeMacro}\n\n#define EEZ_AUDIO_INDEX_NONE 0u\n#define EEZ_AUDIO_INDEX_MIN 1u\n#define EEZ_AUDIO_INDEX_MAX 100u\n\ntypedef enum {\n${indexConstants}\n} eez_audio_index_t;\n\n`
        )
        .replace(
            "    uint32_t id;\n",
            "    uint32_t audio_index;\n    uint32_t id; /* Legacy resource order, retained for compatibility. */\n"
        )
        .replace(
            "extern const uint32_t eez_audio_image_size;\n",
            "extern const uint32_t eez_audio_image_size;\nconst eez_audio_resource_t *eez_audio_find_resource(uint32_t audio_index);\n"
        );
    const indexedSource = source.replace(
        `const uint32_t eez_audio_resource_count = ${audioBuildResult.manifest.resources.length}u;\n`,
        `const uint32_t eez_audio_resource_count = ${audioBuildResult.manifest.resources.length}u;\n\nconst eez_audio_resource_t *eez_audio_find_resource(uint32_t audio_index) {\n    if (audio_index == EEZ_AUDIO_INDEX_NONE) {\n        return 0;\n    }\n    for (uint32_t index = 0; index < eez_audio_resource_count; index++) {\n        if (eez_audio_resources[index].audio_index == audio_index) {\n            return &eez_audio_resources[index];\n        }\n    }\n    return 0;\n}\n`
    );
    await writeTextFile(path.join(destinationFolderPath, headerFileName), indexedHeader);
    await writeTextFile(path.join(destinationFolderPath, sourceFileName), indexedSource);
    await writeTextFile(path.join(destinationFolderPath, manifestFileName), JSON.stringify(audioBuildResult.manifest, null, 2) + "\n");
    outputSectionsStore.write(
        Section.OUTPUT,
        MessageType.INFO,
        `Audio package: ${audioBuildResult.manifest.accessMode === "rom" ? sourceFileName : binaryFileName} (${audioBuildResult.manifest.imageSize} bytes, ${audioBuildResult.manifest.resources.length} resources)`
    );
    outputSectionsStore.write(
        Section.OUTPUT,
        MessageType.INFO,
        `Audio manifest: ${manifestFileName}`
    );
}

async function writeEmbeddedImageBuildFiles(
    destinationFolderPath: string,
    imageBuildResult: EmbeddedImageBuildResult,
    outputSectionsStore: ProjectStore["outputSectionsStore"]
) {
    const binaryFileName = "image.bin";
    const manifestFileName = "image-manifest.json";
    const headerFileName = "image-data.h";
    const sourceFileName = "image-data.c";
    const bytesPerLine = 12;
    const dataLines: string[] = [];

    if (imageBuildResult.manifest.accessMode !== "non-xip") {
        for (let offset = 0; offset < imageBuildResult.binary.length; offset += bytesPerLine) {
            const values = Array.from(
                imageBuildResult.binary.subarray(offset, offset + bytesPerLine)
            ).map(value => `0x${value.toString(16).padStart(2, "0").toUpperCase()}`);
            dataLines.push(`    ${values.join(", ")}`);
        }
    } else {
        await writeBinaryData(
            path.join(destinationFolderPath, binaryFileName),
            imageBuildResult.binary
        );
    }

    const cString = (value: string) => JSON.stringify(value);
    const resources = imageBuildResult.manifest.resources
        .map(resource =>
            `    { ${resource.id}, ${cString(resource.name)}, ${resource.flashOffset}u, ${resource.dataSize}u, ${resource.width}u, ${resource.height}u, ${resource.bpp}u, ${resource.flashAddress}u }`
        )
        .join(",\n");
    const accessModeMacro =
        imageBuildResult.manifest.accessMode === "rom"
            ? "EEZ_IMAGE_ACCESS_ROM"
            : imageBuildResult.manifest.accessMode === "xip"
              ? "EEZ_IMAGE_ACCESS_XIP"
              : "EEZ_IMAGE_ACCESS_NON_XIP";
    const header = `#pragma once\n#include <stdint.h>\n\n#define EEZ_IMAGE_ACCESS_ROM 1\n#define EEZ_IMAGE_ACCESS_XIP 2\n#define EEZ_IMAGE_ACCESS_NON_XIP 3\n#define EEZ_IMAGE_ACCESS_MODE ${accessModeMacro}\n\n#ifdef __cplusplus\nextern "C" {\n#endif\n\ntypedef struct {\n    uint32_t id;\n    const char *name;\n    uint32_t flash_offset;\n    uint32_t data_size;\n    uint16_t width;\n    uint16_t height;\n    uint16_t bpp;\n    uint32_t flash_address;\n} eez_image_resource_t;\n\nextern const eez_image_resource_t eez_image_resources[];\nextern const uint32_t eez_image_resource_count;\nextern const uint32_t eez_image_base_address;\nextern const uint32_t eez_image_size;\n${imageBuildResult.manifest.accessMode !== "non-xip" ? "extern const uint8_t eez_image_data[];\nextern const uint32_t eez_image_data_size;\n" : ""}\n#ifdef __cplusplus\n}\n#endif\n`;
    const baseAddress = parseInt(imageBuildResult.manifest.baseAddress, 0) >>> 0;
    const xipAttribute =
        imageBuildResult.manifest.accessMode === "xip"
            ? `${imageBuildResult.manifest.xipSectionAttribute} `
            : "";
    const source = `#include \"${headerFileName}\"\n\nconst uint32_t eez_image_base_address = 0x${baseAddress.toString(16).toUpperCase()}u;\nconst uint32_t eez_image_size = ${imageBuildResult.manifest.imageSize}u;\nconst eez_image_resource_t eez_image_resources[] = {\n${resources}\n};\nconst uint32_t eez_image_resource_count = ${imageBuildResult.manifest.resources.length}u;\n${imageBuildResult.manifest.accessMode !== "non-xip" ? `${xipAttribute}const uint8_t eez_image_data[] = {\n${dataLines.join(",\n")}\n};\nconst uint32_t eez_image_data_size = ${imageBuildResult.binary.length}u;\n` : ""}`;

    await writeTextFile(path.join(destinationFolderPath, headerFileName), header);
    await writeTextFile(path.join(destinationFolderPath, sourceFileName), source);
    await writeTextFile(
        path.join(destinationFolderPath, manifestFileName),
        JSON.stringify(imageBuildResult.manifest, null, 2) + "\n"
    );
    outputSectionsStore.write(
        Section.OUTPUT,
        MessageType.INFO,
        `Image package: ${imageBuildResult.manifest.accessMode === "non-xip" ? binaryFileName : sourceFileName} (${imageBuildResult.manifest.imageSize} bytes, ${imageBuildResult.manifest.resources.length} resources)`
    );
    outputSectionsStore.write(
        Section.OUTPUT,
        MessageType.INFO,
        `Image manifest: ${manifestFileName}`
    );
}

export async function build(
    projectStore: ProjectStore,
    option: "check" | "buildAssets" | "buildFiles"
) {
    const timeStart = new Date().getTime();

    const OutputSections = projectStore.outputSectionsStore;

    OutputSections.clear(Section.OUTPUT);

    if (!anythingToBuild(projectStore)) {
        OutputSections.write(
            Section.OUTPUT,
            MessageType.INFO,
            `Nothing to build!`
        );
        return undefined;
    }

    OutputSections.setLoading(Section.OUTPUT, true);

    // give some time for loader to start
    await new Promise(resolve => setTimeout(resolve, 50));

    let parts: any = undefined;

    const project = projectStore.project;

    // Reset build file tracking
    currentBuildFiles = new Set();
    let previousManifest: BuildManifest | null = null;
    let audioBuildResult: AudioBuildResult | undefined;
    let imageBuildResult: EmbeddedImageBuildResult | undefined;

    try {
        let sectionNames: string[] | undefined = undefined;

        let destinationFolderPath;
        if (option == "buildFiles") {
            destinationFolderPath = projectStore.getAbsoluteFilePath(
                project.settings.build.destinationFolder || "."
            );

            if (!fs.existsSync(destinationFolderPath)) {
                await makeFolder(destinationFolderPath);
            }

            // Load previous manifest for file cleanup
            if (!project.projectTypeTraits.isDashboard) {
                previousManifest = await loadPreviousManifest(
                    destinationFolderPath
                );
                sectionNames = getSectionNames(projectStore);

                // Enable build file tracking before any files are written
                enableBuildTracking(destinationFolderPath);
                
                // Set source cleanup options based on project type
                setSourceCleanupOptions({
                    hasFlowSupport: project.projectTypeTraits.hasFlowSupport,
                    generateSourceCodeForEezFramework: project.settings.build.generateSourceCodeForEezFramework
                });
            }
        }

        let configurationBuildResults: {
            [configurationName: string]: BuildResult[];
        } = {};

        if (
            project.settings.general.projectVersion !== "v1" &&
            project.settings.build.configurations.length > 0 &&
            (!projectStore.masterProject ||
                projectStore.project.settings.general.projectType ==
                    ProjectType.FIRMWARE)
        ) {
            for (const configuration of project.settings.build.configurations) {
                OutputSections.openGroup(
                    Section.OUTPUT,
                    `Configuration: ${configuration.name}`
                );

                try {
                    configurationBuildResults[configuration.name] =
                        await getBuildResults(
                            projectStore,
                            sectionNames,
                            configuration,
                            option
                        );
                } finally {
                    OutputSections.closeGroup(Section.OUTPUT, false);
                }
            }
        } else {
            const selectedBuildConfiguration =
                projectStore.selectedBuildConfiguration ||
                project.settings.build.configurations[0];
            if (selectedBuildConfiguration) {
                OutputSections.openGroup(
                    Section.OUTPUT,
                    `Configuration: ${selectedBuildConfiguration.name}`
                );
                try {
                    configurationBuildResults[selectedBuildConfiguration.name] =
                        await getBuildResults(
                            projectStore,
                            sectionNames,
                            selectedBuildConfiguration,
                            option
                        );
                } finally {
                    OutputSections.closeGroup(Section.OUTPUT, false);
                }
            } else {
                configurationBuildResults["default"] = await getBuildResults(
                    projectStore,
                    sectionNames,
                    undefined,
                    option
                );
            }
        }

        if (project.bitmaps.length) {
            const imageBuild = await prepareEmbeddedImageBuildForProject(projectStore);
            for (const issue of imageBuild.issues) {
                OutputSections.write(
                    Section.OUTPUT,
                    MessageType.ERROR,
                    issue.message,
                    issue.object
                );
            }
            imageBuildResult = imageBuild.result;
        }

        if (project.audio?.resources.length) {
            const audioBuild = await prepareAudioBuildForProject(projectStore);
            for (const issue of audioBuild.issues) {
                OutputSections.write(
                    Section.OUTPUT,
                    MessageType.ERROR,
                    issue.message,
                    issue.object
                );
            }
            audioBuildResult = audioBuild.result;
        }

        showCheckResult(projectStore);

        if (option == "check") {
            return undefined;
        }

        if (option == "buildAssets") {
            const defaultConfiguration =
                project.settings.build.configurations[0];
            const buildResults =
                configurationBuildResults[
                    defaultConfiguration?.name ?? "default"
                ] || [];

            parts = {};
            for (const buildResult of buildResults) {
                parts = Object.assign(parts, buildResult);
            }

            OutputSections.write(
                Section.OUTPUT,
                MessageType.INFO,
                `Build duration: ${
                    (new Date().getTime() - timeStart) / 1000
                } seconds`
            );

            if (OutputSections.getSection(Section.OUTPUT).numErrors === 0) {
                OutputSections.write(
                    Section.OUTPUT,
                    MessageType.INFO,
                    `Build successfully finished at ${new Date().toLocaleString()}`
                );
            }

            return parts;
        }

        if (!project.projectTypeTraits.isDashboard) {
            parts = await generateFiles(
                projectStore,
                destinationFolderPath || "",
                configurationBuildResults
            );

            if (project.projectTypeTraits.isLVGL) {
                await generateSourceCodeForEezFramework(
                    project,
                    destinationFolderPath || "",
                    configurationBuildResults["Default"]?.[0]?.[
                        "EEZ_FLOW_IS_USING_CRYPTO_SHA256"
                    ] as any as boolean
                );
            }

            if (project.projectTypeTraits.isEezGuiLite) {
                await generateSourceCodeForEezGuiLite(
                    project,
                    destinationFolderPath || ""
                );
            }

            if (audioBuildResult) {
                await writeAudioBuildFiles(
                    destinationFolderPath || "",
                    audioBuildResult,
                    OutputSections
                );
            }

            if (imageBuildResult) {
                await writeEmbeddedImageBuildFiles(
                    destinationFolderPath || "",
                    imageBuildResult,
                    OutputSections
                );
            }

            // Disable tracking after file generation
            disableBuildTracking();
        } else {
            const baseName = path.basename(
                projectStore.filePath || "",
                ".eez-project"
            );

            const destinationFilePath =
                destinationFolderPath + "/" + baseName + ".eez-dashboard";

            const archiver = await import("archiver");

            await new Promise<void>((resolve, reject) => {
                var archive = archiver.default("zip", {
                    zlib: {
                        level: 9
                    }
                });

                var output = fs.createWriteStream(destinationFilePath);

                output.on("close", function () {
                    resolve();
                });

                archive.on("warning", function (err: any) {
                    reject(err);
                });

                archive.on("error", function (err: any) {
                    reject(err);
                });

                archive.pipe(output);

                const json = getJSON(projectStore, 0);
                archive.append(json, { name: baseName + ".eez-project" });

                archive.finalize();
            });

            {
                const destinationFilePath =
                    destinationFolderPath +
                    "/" +
                    baseName +
                    ".eez-project-build";

                const defaultConfiguration =
                    project.settings.build.configurations[0];
                const buildResults =
                    configurationBuildResults[defaultConfiguration.name];

                parts = {};
                for (const buildResult of buildResults) {
                    parts = Object.assign(parts, buildResult);
                }

                fs.writeFileSync(
                    destinationFilePath,
                    JSON.stringify({
                        GUI_ASSETS_DATA_MAP_JS: parts.GUI_ASSETS_DATA_MAP_JS,
                        GUI_ASSETS_DATA:
                            parts.GUI_ASSETS_DATA.toString("base64")
                    }),
                    "utf8"
                );
            }
        }

        OutputSections.write(
            Section.OUTPUT,
            MessageType.INFO,
            `Build duration: ${
                (new Date().getTime() - timeStart) / 1000
            } seconds`
        );

        if (OutputSections.getSection(Section.OUTPUT).numErrors === 0) {
            OutputSections.write(
                Section.OUTPUT,
                MessageType.INFO,
                `Build successfully finished at ${new Date().toLocaleString()}`
            );
        }

        // Save build manifest and delete orphaned files
        if (
            option == "buildFiles" &&
            destinationFolderPath &&
            !project.projectTypeTraits.isDashboard
        ) {
            const currentFiles = Array.from(currentBuildFiles);

            if (previousManifest && previousManifest.files.length > 0) {
                await deleteOrphanedFiles(
                    destinationFolderPath,
                    previousManifest.files,
                    currentFiles,
                    OutputSections
                );
            }

            await saveManifest(destinationFolderPath, currentFiles);
        }
    } catch (err) {
        console.error(err);
        if (err instanceof BuildException) {
            OutputSections.write(
                Section.OUTPUT,
                MessageType.ERROR,
                err.message,
                err.object
            );
        } else {
            OutputSections.write(
                Section.OUTPUT,
                MessageType.ERROR,
                `Module build error: ${err}`
            );
        }

        showCheckResult(projectStore);
    } finally {
        OutputSections.setLoading(Section.OUTPUT, false);
    }

    return parts;
}

export async function buildExtensions(projectStore: ProjectStore) {
    const timeStart = new Date().getTime();

    const OutputSections = projectStore.outputSectionsStore;

    OutputSections.clear(Section.OUTPUT);

    if (!extensionDefinitionAnythingToBuild(projectStore)) {
        OutputSections.write(
            Section.OUTPUT,
            MessageType.INFO,
            `Nothing to build!`
        );
        return [];
    }

    OutputSections.setLoading(Section.OUTPUT, true);

    // give some time for loader to start
    await new Promise(resolve => setTimeout(resolve, 50));

    const project = projectStore.project;

    let extensionFilePaths: string[] = [];

    try {
        let destinationFolderPath = projectStore.getAbsoluteFilePath(
            project.settings.build.destinationFolder || "."
        );
        if (!fs.existsSync(destinationFolderPath)) {
            throw new BuildException("Cannot find destination folder.");
        }

        showCheckResult(projectStore);

        extensionFilePaths = await extensionDefinitionBuild(projectStore);

        OutputSections.write(
            Section.OUTPUT,
            MessageType.INFO,
            `Build duration: ${
                (new Date().getTime() - timeStart) / 1000
            } seconds`
        );

        OutputSections.write(
            Section.OUTPUT,
            MessageType.INFO,
            `Build successfully finished at ${new Date().toLocaleString()}`
        );
    } catch (err) {
        console.error(err);

        if (err instanceof BuildException) {
            OutputSections.write(
                Section.OUTPUT,
                MessageType.ERROR,
                err.message,
                err.object
            );
        } else {
            OutputSections.write(
                Section.OUTPUT,
                MessageType.ERROR,
                `Module build error: ${err}`
            );
        }

        showCheckResult(projectStore);
    } finally {
        OutputSections.setLoading(Section.OUTPUT, false);
    }

    return extensionFilePaths;
}

////////////////////////////////////////////////////////////////////////////////

var checkTransformer: (object: IEezObject) => IMessage[] = createTransformer(
    (object: IEezObject): IMessage[] => {
        let messages: IMessage[] = [];

        // call check method of the object
        if (!isEezObjectArray(object)) {
            const classCheckMethod = getClassInfo(object).check;
            if (classCheckMethod) {
                classCheckMethod(object, messages);
            }
        }

        // call check from property definition
        const propertyCheckMethod =
            getPropertyInfo(object) && getPropertyInfo(object).check;
        if (propertyCheckMethod) {
            propertyCheckMethod(object, messages);
        }

        if (isEezObjectArray(object)) {
            // check array elements
            for (const childObject of object) {
                messages = messages.concat(checkTransformer(childObject));
            }
        } else {
            // check all child array and object properties
            for (const propertyInfo of getArrayAndObjectProperties(object)) {
                const childObject = (object as any)[propertyInfo.name];
                if (childObject) {
                    messages = messages.concat(checkTransformer(childObject));
                }
            }
        }

        if (messages.length == 0) {
            return messages;
        }

        return [
            new Message(
                MessageType.GROUP,
                getLabel(object),
                object,
                messages as Message[]
            )
        ];
    }
);

let setMessagesTimeoutId: any;

export function backgroundCheck(projectStore: ProjectStore) {
    // console.time("backgroundCheck");

    projectStore.outputSectionsStore.setLoading(Section.CHECKS, true);

    const messages = checkTransformer(projectStore.project);

    if (setMessagesTimeoutId) {
        clearTimeout(setMessagesTimeoutId);
    }

    setMessagesTimeoutId = setTimeout(() => {
        projectStore.outputSectionsStore.setMessages(
            Section.CHECKS,
            messages.length == 1 ? messages[0].messages! : messages
        );
        projectStore.outputSectionsStore.setLoading(Section.CHECKS, false);
    }, 100);

    // console.timeEnd("backgroundCheck");
    return messages;
}
