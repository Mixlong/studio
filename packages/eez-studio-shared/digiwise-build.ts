// Shared types for T04-LB04 Local Build Engine & Firmware Artifact Management.

import type {
    DigiwiseBspManifestArtifact,
    DigiwiseProjectBspBinding
} from "eez-studio-shared/digiwise-bsp-catalog";

export type LocalBuildStage =
    | "auth-gate"
    | "toolchain-check"
    | "prepare-workspace"
    | "pre-configure"
    | "configure"
    | "build"
    | "collect-artifacts"
    | "completed"
    | "failed"
    | "cancelled";

export interface LocalBuildRequest {
    projectDir: string;
    binding: DigiwiseProjectBspBinding;
    /** Optional directory containing Studio-generated LVGL UI/resource files to inject into the BSP working copy. */
    generatedUiSourceDir?: string;
    /** Optional build output root; defaults to `<projectDir>/build`. */
    outputDir?: string;
}

export interface LocalBuildLogEvent {
    buildId: string;
    stage: LocalBuildStage;
    stream: "info" | "stdout" | "stderr" | "error";
    line: string;
    progress?: number;
    timestamp: string;
}

export interface LocalBuildDiagnostic {
    file: string;
    line: number;
    column?: number;
    severity: "error" | "warning";
    message: string;
}

export interface LocalBuildCommandRecord {
    stage: LocalBuildStage;
    command: string;
    args: string[];
    cwd: string;
    exitCode: number | null;
    durationMs: number;
}

export interface LocalBuildArtifactRecord {
    role: DigiwiseBspManifestArtifact["role"];
    format: DigiwiseBspManifestArtifact["format"];
    required: boolean;
    relativePath: string;
    path: string;
    fileSize: number;
    sha256: string;
}

export interface LocalBuildRecord {
    buildId: string;
    status: "completed" | "failed" | "cancelled";
    errorCode?: string;
    errorMessage?: string;
    projectDir: string;
    workDir: string;
    recordPath: string;
    logPath: string;
    bsp: {
        bspId: number;
        categoryCode: string;
        version: string;
        sha256: string;
    };
    toolchain: {
        hostOs: string;
        resolvedVersions: Record<string, string>;
    };
    commands: LocalBuildCommandRecord[];
    artifacts: LocalBuildArtifactRecord[];
    diagnostics: LocalBuildDiagnostic[];
    startedAt: string;
    finishedAt: string;
    durationMs: number;
}
