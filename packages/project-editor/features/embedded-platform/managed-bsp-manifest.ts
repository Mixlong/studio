const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

////////////////////////////////////////////////////////////////////////////////

export interface ManagedBspManifest {
    schemaVersion?: string;
    bsp?: {
        categoryCode?: string;
        version?: string;
        name?: string;
    };
    build?: {
        system?: string;
        sourceDir?: string;
        cmakeLists?: string | null;
        toolchainFile?: string | null;
        generator?: string | null;
        extraArgs?: string[];
        artifacts?: Array<{
            role?: string;
            format?: string;
            path?: string;
            required?: boolean;
        }>;
    };
    download?: {
        target?: string;
        interface?: string;
        frequencyHz?: number;
        flashAddress?: string;
        pack?: string | null;
        script?: string | null;
    };
}

export interface ManagedBspConfiguration {
    manifestPath: string;
    manifestRoot: string;
    manifest: ManagedBspManifest;
    sourceDirectory: string;
    cmakeListsPath: string;
    toolchainFile: string;
    generator: string;
    extraArguments: string[];
    firmwareCandidates: string[];
    download?: {
        target: string;
        interface: string;
        frequency: string;
        address: string;
        pack: string;
        script: string;
    };
}

function isSafeRelativePath(value: unknown): value is string {
    if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) {
        return false;
    }
    const normalized = path.normalize(value);
    return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}

function resolveManifestPath(root: string, value: string, label: string) {
    if (!isSafeRelativePath(value)) {
        throw new Error(`Managed BSP manifest contains an unsafe path for ${label}.`);
    }
    const resolved = path.resolve(root, value);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Managed BSP manifest contains an unsafe path for ${label}.`);
    }
    return resolved;
}

function readManifest(manifestPath: string) {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
        throw new Error(`Unable to read managed BSP manifest: ${error}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Managed BSP manifest must be a JSON object.");
    }
    const manifest = raw as ManagedBspManifest;
    if (manifest.schemaVersion && manifest.schemaVersion !== "1.0") {
        throw new Error(`Unsupported managed BSP manifest schema: ${manifest.schemaVersion}`);
    }
    return manifest;
}

function findManifest(rootPath: string) {
    const roots = [path.resolve(rootPath), path.dirname(path.resolve(rootPath))];
    for (const root of roots) {
        const manifestPath = path.join(root, "bsp-manifest.json");
        if (fs.existsSync(manifestPath)) {
            return { manifestPath, manifestRoot: root };
        }
    }
    return undefined;
}

export function readManagedBspConfiguration(
    rootPath: string,
    projectOutputDirectory = ""
): ManagedBspConfiguration | undefined {
    if (!rootPath.trim()) {
        return undefined;
    }
    const located = findManifest(rootPath);
    if (!located) {
        return undefined;
    }

    const manifest = readManifest(located.manifestPath);
    const build = manifest.build || {};
    const sourceDirectory = resolveManifestPath(
        located.manifestRoot,
        build.sourceDir || ".",
        "build.sourceDir"
    );
    const cmakeListsPath = resolveManifestPath(
        located.manifestRoot,
        build.cmakeLists || path.join(build.sourceDir || ".", "CMakeLists.txt"),
        "build.cmakeLists"
    );
    const toolchainFile = build.toolchainFile
        ? resolveManifestPath(
              located.manifestRoot,
              build.toolchainFile,
              "build.toolchainFile"
          )
        : "";
    const firmwareCandidates: string[] = [];
    for (const artifact of build.artifacts || []) {
        if (artifact.role !== "firmware" || !artifact.path) {
            continue;
        }
        const artifactPath = resolveManifestPath(
            located.manifestRoot,
            artifact.path,
            "build.artifacts.path"
        );
        firmwareCandidates.push(artifactPath);
        if (projectOutputDirectory) {
            const relativeArtifact = path.relative(located.manifestRoot, artifactPath);
            firmwareCandidates.push(
                path.resolve(projectOutputDirectory, relativeArtifact),
                path.join(projectOutputDirectory, path.basename(artifactPath))
            );
        }
    }

    const download = manifest.download;
    const resolvedDownload =
        download?.target &&
        download.interface &&
        Number.isSafeInteger(download.frequencyHz) &&
        download.flashAddress
            ? {
                  target: download.target,
                  interface: download.interface,
                  frequency: String(download.frequencyHz),
                  address: download.flashAddress,
                  pack: download.pack || "null",
                  script: download.script || "null"
              }
            : undefined;

    return {
        manifestPath: located.manifestPath,
        manifestRoot: located.manifestRoot,
        manifest,
        sourceDirectory,
        cmakeListsPath,
        toolchainFile,
        generator: build.generator || "",
        extraArguments: Array.isArray(build.extraArgs)
            ? build.extraArgs.filter(value => typeof value === "string")
            : [],
        firmwareCandidates: [...new Set(firmwareCandidates)],
        download: resolvedDownload
    };
}
