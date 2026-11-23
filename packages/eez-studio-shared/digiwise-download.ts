// Shared types for T04-LB05 Local Download Manager & Hardware Flash Verification.

import type { DigiwiseBspManifest } from "eez-studio-shared/digiwise-bsp-catalog";

export type LocalDownloadStage =
    | "validate-inputs"
    | "toolchain-check"
    | "detect-probe"
    | "flashing"
    | "verifying"
    | "resetting"
    | "completed"
    | "failed"
    | "cancelled";

export type SupportedProbeType = "pyocd" | "jlink" | "stlink" | "dplink";

export interface LocalProbeDetectResult {
    probe: SupportedProbeType;
    executablePath: string | null;
    connected: boolean;
    devices: string[];
    message: string;
    recoveryHint?: string;
    checkedAt: string;
}

export interface LocalDownloadRequest {
    projectDir: string;
    manifest: DigiwiseBspManifest;
    firmwarePath: string;
    /** Expected SHA-256 from LB04 build record; when provided, firmware is verified before flashing. */
    expectedSha256?: string;
    /** Optional directory where download logs and receipts are stored (defaults to `<projectDir>/build/downloads`). */
    recordsDir?: string;
    /** Optional BSP install directory to resolve relative pack/script paths from manifest.download. */
    bspInstallDir?: string;
    /** Optional timeout in milliseconds (default 180000). */
    timeoutMs?: number;
}

export interface LocalDownloadLogEvent {
    downloadId: string;
    stage: LocalDownloadStage;
    stream: "info" | "stdout" | "stderr" | "error";
    line: string;
    progress?: number;
    timestamp: string;
}

export interface LocalDownloadRecord {
    downloadId: string;
    status: "completed" | "failed" | "cancelled";
    errorCode?: string;
    errorMessage?: string;
    probe: SupportedProbeType;
    target: string;
    interface: string;
    frequencyHz: number;
    flashAddress: string;
    firmwarePath: string;
    firmwareSize: number;
    firmwareSha256: string;
    command: string;
    args: string[];
    exitCode: number | null;
    /** True ONLY when the flasher explicitly reported flash+verify success (never assumed solely from exit code 0). */
    verifiedByProbe: boolean;
    /** Always false in automated CLI flashing; physical board boot/runtime must be verified in LB06. */
    boardRuntimeVerified: false;
    recordPath: string;
    logPath: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
}
