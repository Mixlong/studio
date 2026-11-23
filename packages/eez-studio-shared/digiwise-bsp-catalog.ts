// Shared types & manifest validator for controlled BSP catalog, install, and project binding (T04-LB02).
// These are product authorization categories, not template categories.

export interface DigiwiseCategory {
    id: number;
    modelCode: string;
    categoryCode: string;
    modelName: string;
    categoryName: string;
    chipFamily: string | null;
    externalId: string | null;
    productType: number | null;
}

export interface DigiwiseBspVersion {
    id: number;
    modelId: number;
    modelCode: string;
    categoryCode: string;
    modelName: string;
    categoryName: string;
    version: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    publishedAt: string | null;
}

export interface DigiwiseBspDownloadMeta {
    bspId?: number;
    modelId?: number;
    downloadUrl: string;
    expiresAt: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    version: string;
    modelCode: string;
    categoryCode: string;
}

export interface DigiwiseBspManifestArtifact {
    role: "firmware" | "symbols" | "map" | "image-bin" | "audio-bin";
    format: "bin" | "hex" | "elf" | "map" | "json";
    path: string;
    required: boolean;
}

export interface DigiwiseBspManifest {
    schemaVersion: "1.0";
    bsp: {
        id: string;
        categoryCode: string;
        version: string;
        name: string;
        minStudioVersion: string;
        supportedHostOs: Array<"windows-x64" | "macos-arm64" | "macos-x64" | "linux-x64">;
    };
    target: {
        chip: string;
        arch: string;
        display?: {
            width: number;
            height: number;
            colorBpp?: number;
        };
    };
    build: {
        system: "cmake" | "make" | "python-script" | "platformio";
        sourceDir: string;
        cmakeLists?: string | null;
        preConfigureScript?: string | null;
        toolchainFile?: string | null;
        generator?: string | null;
        uiSync?: {
            strategy?: "cmake-include-marker" | "makefile-include-marker" | "copy-to-dir";
            generatedUiDir?: string;
            resourceManifest?: string;
        };
        env?: Record<string, string>;
        extraArgs?: string[];
        artifacts: DigiwiseBspManifestArtifact[];
    };
    toolchain: {
        compiler: {
            id: string;
            version: string;
        };
        cmake?: { minVersion?: string };
        ninja?: { minVersion?: string };
        python?: { minVersion?: string; requirementsFile?: string | null };
    };
    download: {
        probe: string;
        target: string;
        interface: "SWD" | "JTAG" | "UART" | "USB";
        frequencyHz: number;
        flashAddress: string;
        pack?: string | null;
        script?: string | null;
        verifyAfterFlash?: boolean;
        resetAfterFlash?: boolean;
    };
}

export interface DigiwiseInstalledBspRecord {
    bspId: number;
    modelId: number;
    modelCode: string;
    categoryCode: string;
    version: string;
    fileName: string;
    fileSize: number;
    sha256: string;
    installPath: string;
    installedAt: string;
    manifest?: DigiwiseBspManifest | null;
}

export interface DigiwiseProjectBspBinding {
    bspId: number;
    modelId?: number;
    modelCode?: string;
    categoryCode: string;
    version: string;
    sha256: string;
    boundAt?: string;
}

export interface DigiwiseBspBuildGateResult {
    authorized: boolean;
    installed: DigiwiseInstalledBspRecord;
    manifest: DigiwiseBspManifest | null;
    checkedAt: string;
}

export interface DigiwiseBspDownloadProgress {
    bspId: number;
    stage:
        | "requesting"
        | "downloading"
        | "verifying"
        | "extracting"
        | "completed"
        | "cancelled";
    receivedBytes: number;
    totalBytes: number;
}

const SAFE_REL_PATH_RE = /^(?!\/)(?!.*\\)(?!.*:)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VALID_OS = new Set(["windows-x64", "macos-arm64", "macos-x64", "linux-x64"]);
const VALID_BUILD_SYSTEMS = new Set(["cmake", "make", "python-script", "platformio"]);
const VALID_INTERFACES = new Set(["SWD", "JTAG", "UART", "USB"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeManifestRelativePath(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 256 &&
        SAFE_REL_PATH_RE.test(value)
    );
}

function isSafeManifestRelativePathOrNull(value: unknown): boolean {
    return value === undefined || value === null || isSafeManifestRelativePath(value);
}

export function validateBspManifest(
    raw: unknown,
    expected?: { categoryCode?: string; version?: string }
): { ok: true; manifest: DigiwiseBspManifest } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    if (!isRecord(raw)) {
        return { ok: false, errors: ["bsp-manifest.json must be a JSON object"] };
    }
    if (raw.schemaVersion !== "1.0") {
        errors.push("schemaVersion must be '1.0'");
    }

    const bsp = raw.bsp;
    if (!isRecord(bsp)) {
        errors.push("bsp section is required");
    } else {
        if (typeof bsp.id !== "string" || !bsp.id.trim()) errors.push("bsp.id is required");
        if (typeof bsp.categoryCode !== "string" || !bsp.categoryCode.trim()) {
            errors.push("bsp.categoryCode is required");
        } else if (expected?.categoryCode && bsp.categoryCode !== expected.categoryCode) {
            errors.push(`bsp.categoryCode (${bsp.categoryCode}) does not match expected (${expected.categoryCode})`);
        }
        if (typeof bsp.version !== "string" || !bsp.version.trim()) {
            errors.push("bsp.version is required");
        } else if (expected?.version && bsp.version !== expected.version) {
            errors.push(`bsp.version (${bsp.version}) does not match expected (${expected.version})`);
        }
        if (typeof bsp.name !== "string" || !bsp.name.trim()) errors.push("bsp.name is required");
        if (typeof bsp.minStudioVersion !== "string" || !SEMVER_RE.test(bsp.minStudioVersion)) {
            errors.push("bsp.minStudioVersion must be a valid semver string");
        }
        if (
            !Array.isArray(bsp.supportedHostOs) ||
            bsp.supportedHostOs.length === 0 ||
            !bsp.supportedHostOs.every(os => typeof os === "string" && VALID_OS.has(os))
        ) {
            errors.push("bsp.supportedHostOs must contain valid host OS targets");
        }
    }

    const target = raw.target;
    if (!isRecord(target)) {
        errors.push("target section is required");
    } else {
        if (typeof target.chip !== "string" || !target.chip.trim()) errors.push("target.chip is required");
        if (typeof target.arch !== "string" || !target.arch.trim()) errors.push("target.arch is required");
    }

    const build = raw.build;
    if (!isRecord(build)) {
        errors.push("build section is required");
    } else {
        if (typeof build.system !== "string" || !VALID_BUILD_SYSTEMS.has(build.system)) {
            errors.push("build.system is invalid");
        }
        if (!isSafeManifestRelativePath(build.sourceDir)) {
            errors.push("build.sourceDir must be a safe relative path");
        }
        if (!isSafeManifestRelativePathOrNull(build.cmakeLists)) {
            errors.push("build.cmakeLists must be a safe relative path");
        }
        if (!isSafeManifestRelativePathOrNull(build.preConfigureScript)) {
            errors.push("build.preConfigureScript must be a safe relative path");
        }
        if (!isSafeManifestRelativePathOrNull(build.toolchainFile)) {
            errors.push("build.toolchainFile must be a safe relative path");
        }
        if (!Array.isArray(build.artifacts) || build.artifacts.length === 0) {
            errors.push("build.artifacts must be a non-empty array");
        } else {
            for (const art of build.artifacts) {
                if (!isRecord(art) || !isSafeManifestRelativePath(art.path)) {
                    errors.push("every build.artifacts entry must have a safe relative path");
                    break;
                }
            }
        }
    }

    const toolchain = raw.toolchain;
    if (!isRecord(toolchain) || !isRecord(toolchain.compiler)) {
        errors.push("toolchain.compiler section is required");
    } else {
        if (typeof toolchain.compiler.id !== "string" || !toolchain.compiler.id.trim()) {
            errors.push("toolchain.compiler.id is required");
        }
        if (typeof toolchain.compiler.version !== "string" || !toolchain.compiler.version.trim()) {
            errors.push("toolchain.compiler.version is required");
        }
    }

    const download = raw.download;
    if (!isRecord(download)) {
        errors.push("download section is required");
    } else {
        if (typeof download.probe !== "string" || !download.probe.trim()) errors.push("download.probe is required");
        if (typeof download.target !== "string" || !download.target.trim()) errors.push("download.target is required");
        if (typeof download.interface !== "string" || !VALID_INTERFACES.has(download.interface)) {
            errors.push("download.interface is invalid");
        }
        if (typeof download.frequencyHz !== "number" || !Number.isSafeInteger(download.frequencyHz) || download.frequencyHz < 1000) {
            errors.push("download.frequencyHz must be an integer >= 1000");
        }
        if (typeof download.flashAddress !== "string" || !download.flashAddress.trim()) {
            errors.push("download.flashAddress is required");
        }
        if (!isSafeManifestRelativePathOrNull(download.pack)) {
            errors.push("download.pack must be a safe relative path");
        }
        if (!isSafeManifestRelativePathOrNull(download.script)) {
            errors.push("download.script must be a safe relative path");
        }
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true, manifest: raw as unknown as DigiwiseBspManifest };
}

export interface ManagedEmbeddedBspFields {
    name: string;
    bspId: number;
    categoryCode: string;
    version: string;
    sha256: string;
    rootPath: string;
    cmakeListsPath: string;
    toolchainFile: string;
}

export function applyManagedBspToEmbeddedBsp(
    target: ManagedEmbeddedBspFields,
    installed: {
        bspId: number;
        categoryCode: string;
        version: string;
        sha256: string;
        installPath: string;
        manifest?: {
            bsp?: { name?: string };
            build?: { sourceDir?: string; cmakeLists?: string | null; toolchainFile?: string | null };
        } | null;
    }
): void {
    target.bspId = installed.bspId;
    target.categoryCode = installed.categoryCode;
    target.version = installed.version;
    target.sha256 = installed.sha256.toLowerCase();
    target.name = installed.manifest?.bsp?.name || `${installed.categoryCode} ${installed.version}`;

    const sourceDir = installed.manifest?.build?.sourceDir;
    const baseRoot =
        sourceDir && sourceDir !== "."
            ? `${installed.installPath}/${sourceDir}`
            : installed.installPath;
    target.rootPath = baseRoot;
    target.cmakeListsPath = installed.manifest?.build?.cmakeLists
        ? `${installed.installPath}/${installed.manifest.build.cmakeLists}`
        : `${baseRoot}/CMakeLists.txt`;
    target.toolchainFile = installed.manifest?.build?.toolchainFile
        ? `${installed.installPath}/${installed.manifest.build.toolchainFile}`
        : "";
}

export function restoreManagedBspOnOpen(
    target: ManagedEmbeddedBspFields,
    installedList: Array<{
        bspId: number;
        categoryCode: string;
        version: string;
        sha256: string;
        installPath: string;
        manifest?: {
            bsp?: { name?: string };
            build?: { sourceDir?: string; cmakeLists?: string | null; toolchainFile?: string | null };
        } | null;
    }>
): boolean {
    if (!target.categoryCode || !target.version || !target.sha256) {
        return false;
    }
    const matched = installedList.find(
        item =>
            item.categoryCode === target.categoryCode &&
            item.version === target.version &&
            item.sha256.toLowerCase() === target.sha256.toLowerCase()
    );
    if (!matched) {
        return false;
    }
    applyManagedBspToEmbeddedBsp(target, matched);
    return true;
}
