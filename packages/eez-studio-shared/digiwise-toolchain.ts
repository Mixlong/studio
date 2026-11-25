// Shared types, licensing classification, and version helpers for T04-LB03 Toolchain Manager.

export type ToolchainToolId =
    | "arm-none-eabi-gcc"
    | "cmake"
    | "ninja"
    | "python"
    | "pyocd"
    | "jlink"
    | "ffmpeg"
    | "mingw64"
    | "sdl2";

export type ToolchainCategory =
    | "compiler"
    | "build-system"
    | "resource-tool"
    | "simulator"
    | "flasher";

export type ToolchainRedistributionPolicy =
    | "redistributable-portable"
    | "vendor-installer-guided";

export interface ToolchainCatalogEntry {
    id: ToolchainToolId;
    displayName: string;
    category: ToolchainCategory;
    license: string;
    redistribution: ToolchainRedistributionPolicy;
    executableWin: string;
    executablePosix: string;
    recoveryHint: string;
}

export const TOOLCHAIN_CATALOG: Record<ToolchainToolId, ToolchainCatalogEntry> = {
    "arm-none-eabi-gcc": {
        id: "arm-none-eabi-gcc",
        displayName: "ARM GNU Toolchain (arm-none-eabi-gcc)",
        category: "compiler",
        license: "GPL-3.0-with-GCC-exception (Arm official binary)",
        redistribution: "redistributable-portable",
        executableWin: "arm-none-eabi-gcc.exe",
        executablePosix: "arm-none-eabi-gcc",
        recoveryHint: "Install the matching portable ARM GNU Toolchain via Toolchain Manager or point to a local toolchain root."
    },
    cmake: {
        id: "cmake",
        displayName: "CMake",
        category: "build-system",
        license: "BSD-3-Clause",
        redistribution: "redistributable-portable",
        executableWin: "cmake.exe",
        executablePosix: "cmake",
        recoveryHint: "Install portable CMake via Toolchain Manager or configure a local CMake bin directory."
    },
    ninja: {
        id: "ninja",
        displayName: "Ninja Build",
        category: "build-system",
        license: "Apache-2.0",
        redistribution: "redistributable-portable",
        executableWin: "ninja.exe",
        executablePosix: "ninja",
        recoveryHint: "Install portable Ninja via Toolchain Manager."
    },
    python: {
        id: "python",
        displayName: "Python Runtime",
        category: "resource-tool",
        license: "PSF-2.0",
        redistribution: "redistributable-portable",
        executableWin: "python.exe",
        executablePosix: "python3",
        recoveryHint: "Install the managed portable Python runtime via Toolchain Manager."
    },
    pyocd: {
        id: "pyocd",
        displayName: "pyOCD (CMSIS-DAP Flasher)",
        category: "flasher",
        license: "Apache-2.0",
        redistribution: "redistributable-portable",
        executableWin: "pyocd.exe",
        executablePosix: "pyocd",
        recoveryHint: "Install pyOCD into the managed Python environment (Windows 10/11 CMSIS-DAP uses built-in WinUSB)."
    },
    jlink: {
        id: "jlink",
        displayName: "SEGGER J-Link Software & USB Driver",
        category: "flasher",
        license: "Proprietary (SEGGER EULA — vendor installer required)",
        redistribution: "vendor-installer-guided",
        executableWin: "JLink.exe",
        executablePosix: "JLinkExe",
        recoveryHint: "Install SEGGER J-Link Software and Documentation Pack (with USB Driver) from segger.com, or point Toolchain Manager to your local SEGGER JLink folder. Note: Java JDK jlink.exe is not SEGGER J-Link."
    },
    ffmpeg: {
        id: "ffmpeg",
        displayName: "FFmpeg (Audio Resource Converter)",
        category: "resource-tool",
        license: "LGPL-2.1 / GPL-3.0 (check build flags before bundling)",
        redistribution: "redistributable-portable",
        executableWin: "ffmpeg.exe",
        executablePosix: "ffmpeg",
        recoveryHint: "Install portable FFmpeg via Toolchain Manager for MP3/WAV audio asset conversion."
    },
    mingw64: {
        id: "mingw64",
        displayName: "MinGW-w64 GCC (PC Simulator)",
        category: "simulator",
        license: "GPL-3.0-with-GCC-exception + MinGW-w64 ZPL",
        redistribution: "redistributable-portable",
        executableWin: "gcc.exe",
        executablePosix: "gcc",
        recoveryHint: "Only needed for native PC simulator builds; install portable MinGW-w64 if required."
    },
    sdl2: {
        id: "sdl2",
        displayName: "SDL2 Development Library (PC Simulator)",
        category: "simulator",
        license: "zlib",
        redistribution: "redistributable-portable",
        executableWin: "SDL2.dll",
        executablePosix: "libSDL2.so",
        recoveryHint: "Only needed for native PC simulator builds."
    }
};

export interface ToolchainRequirement {
    id: ToolchainToolId;
    category: ToolchainCategory;
    required: boolean;
    exactVersion?: string;
    minVersion?: string;
}

export interface ToolchainToolStatus {
    id: ToolchainToolId;
    displayName: string;
    category: ToolchainCategory;
    required: boolean;
    expectedVersion: string;
    status: "ready" | "missing" | "version-mismatch" | "vendor-driver-required" | "error";
    executablePath: string | null;
    binDir: string | null;
    detectedVersion: string | null;
    source: "managed" | "custom-root" | "system-path" | null;
    redistribution: ToolchainRedistributionPolicy;
    message: string;
    recoveryHint?: string;
}

export interface ToolchainEnvironmentReport {
    ready: boolean;
    hostOs: string;
    bspId?: string;
    categoryCode?: string;
    bspVersion?: string;
    tools: ToolchainToolStatus[];
    resolvedExecutables: Partial<Record<ToolchainToolId, string>>;
    envPathEntries: string[];
    blockingIssues: Array<{
        toolId: ToolchainToolId;
        code: "TOOL_MISSING" | "TOOL_VERSION_MISMATCH" | "VENDOR_INSTALLER_REQUIRED";
        message: string;
        recoveryHint: string;
    }>;
    checkedAt: string;
}

export interface ToolchainPackageSpec {
    id: ToolchainToolId;
    version: string;
    downloadUrl: string;
    fileSize: number;
    sha256: string;
    /** Relative folder inside the extracted archive containing executables (e.g. "bin" or "."). */
    binRelativeDir?: string;
}

export interface InstalledToolchainRecord {
    id: ToolchainToolId;
    version: string;
    sha256: string;
    fileSize: number;
    installPath: string;
    binDir: string;
    installedAt: string;
}

export interface ToolchainPrepareProgress {
    toolId: ToolchainToolId;
    version: string;
    stage: "checking" | "downloading" | "verifying" | "extracting" | "ready" | "cancelled" | "failed";
    receivedBytes: number;
    totalBytes: number;
    message?: string;
}

export interface ToolchainManagerConfig {
    customEnvRoots: string[];
}

/** Compare numeric version prefixes (e.g. "14.3.rel1" vs "14.3.0" -> 0, "3.28.1" vs "3.25.0" -> 1). */
export function compareVersionTuples(actual: string, expected: string): number {
    const parse = (v: string): number[] => {
        const matches = v.match(/\d+/g);
        return matches ? matches.slice(0, 4).map(Number) : [];
    };
    const a = parse(actual);
    const b = parse(expected);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const av = a[i] ?? 0;
        const bv = b[i] ?? 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }
    return 0;
}

export function versionSatisfiesRequirement(
    detectedVersion: string | null,
    requirement: { exactVersion?: string; minVersion?: string }
): boolean {
    if (!detectedVersion) return false;
    if (requirement.exactVersion) {
        const normActual = detectedVersion.toLowerCase();
        const normExpected = requirement.exactVersion.toLowerCase();
        if (normActual === normExpected || normActual.includes(normExpected)) {
            return true;
        }
        // Also match if major.minor match and expected has suffix like "14.3.rel1" while gcc reports "14.3.1"
        const expectedPrefix = normExpected.match(/^(\d+\.\d+)/)?.[1];
        const actualPrefix = normActual.match(/^(\d+\.\d+)/)?.[1];
        if (expectedPrefix && actualPrefix && expectedPrefix === actualPrefix && normExpected.includes("rel")) {
            return true;
        }
        return false;
    }
    if (requirement.minVersion) {
        return compareVersionTuples(detectedVersion, requirement.minVersion) >= 0;
    }
    return true;
}
