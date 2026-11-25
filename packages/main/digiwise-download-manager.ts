import electron from "electron";
import type { BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getDigiwiseAuthGuard } from "main/digiwise-auth";
import {
    buildScopedToolchainEnv,
    inspectToolchainEnvironment,
    mergeToolchainEnvRoots
} from "main/digiwise-toolchain-manager";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import type { DigiwiseBspManifest } from "eez-studio-shared/digiwise-bsp-catalog";
import type {
    LocalDownloadLogEvent,
    LocalDownloadRecord,
    LocalDownloadRequest,
    LocalDownloadStage,
    LocalProbeDetectResult,
    SupportedProbeType
} from "eez-studio-shared/digiwise-download";
import type { ToolchainToolId } from "eez-studio-shared/digiwise-toolchain";

const LOG_CHANNEL = "digistudio:download:log";
const DEFAULT_FLASH_TIMEOUT_MS = 180_000;
const activeDownloads = new Map<string, { cancel: () => void }>();
let registered = false;

function toolchainStoreRoot(): string {
    return path.join(electron.app.getPath("userData"), "toolchains");
}

function toolchainConfigPath(): string {
    return path.join(electron.app.getPath("userData"), "toolchain-config.json");
}

async function loadCustomEnvRoots(): Promise<string[]> {
    try {
        const parsed = JSON.parse(await fs.promises.readFile(toolchainConfigPath(), "utf8"));
        if (parsed && Array.isArray(parsed.customEnvRoots)) {
            return mergeToolchainEnvRoots(
                parsed.customEnvRoots.filter((r: unknown) => typeof r === "string" && r.trim())
            );
        }
    } catch {
        // Ignore missing config
    }
    return mergeToolchainEnvRoots([]);
}

function killProcessTree(child: ChildProcess): void {
    if (!child.pid) {
        try {
            child.kill();
        } catch {
            // ignore
        }
        return;
    }
    if (process.platform === "win32") {
        try {
            const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore"
            });
            killer.unref();
        } catch {
            try {
                child.kill();
            } catch {
                // ignore
            }
        }
    } else {
        try {
            child.kill("SIGTERM");
        } catch {
            // ignore
        }
    }
}

export function normalizeProbeType(probe: string): SupportedProbeType | null {
    const p = (probe || "").trim().toLowerCase();
    if (p === "pyocd" || p === "cmsis-dap") return "pyocd";
    if (p === "jlink" || p === "segger" || p === "j-link") return "jlink";
    if (p === "stlink" || p === "st-link") return "stlink";
    if (p === "dplink") return "dplink";
    return null;
}

export function isValidFlashAddress(addr: string): boolean {
    const trimmed = (addr || "").trim();
    if (!/^(0x[0-9a-f]+|\d+)$/i.test(trimmed)) return false;
    const n = Number(trimmed);
    return Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
}

async function sha256File(filePath: string): Promise<{ sha256: string; fileSize: number }> {
    const hash = createHash("sha256");
    let fileSize = 0;
    await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        stream.on("data", chunk => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            fileSize += buf.length;
            hash.update(buf);
        });
        stream.on("error", reject);
        stream.on("end", resolve);
    });
    return { sha256: hash.digest("hex"), fileSize };
}

function buildJLinkFlashScript(
    firmwarePath: string,
    flashAddress: string,
    verifyAfterFlash: boolean,
    resetAfterFlash: boolean
): string {
    const lines = [
        "r",
        "h",
        `loadfile "${firmwarePath}", ${flashAddress}`
    ];
    if (verifyAfterFlash) {
        lines.push(`verifyfile "${firmwarePath}", ${flashAddress}`);
    }
    if (resetAfterFlash) {
        lines.push("r", "g");
    }
    lines.push("q");
    return lines.join("\n") + "\n";
}

export function buildFlashCommandSpec(
    probe: SupportedProbeType,
    executablePath: string,
    manifest: DigiwiseBspManifest,
    firmwarePath: string,
    options: { bspInstallDir?: string; tempScriptPath?: string } = {}
): { command: string; args: string[]; generatedScriptContent?: string } {
    const dl = manifest.download;
    const kHz = Math.max(1, Math.round(dl.frequencyHz / 1000));
    const verify = dl.verifyAfterFlash !== false;
    const reset = dl.resetAfterFlash !== false;

    if (probe === "pyocd") {
        const args = ["flash", "-t", dl.target, "-f", String(dl.frequencyHz)];
        if (dl.pack && options.bspInstallDir) {
            args.push("--pack", path.resolve(options.bspInstallDir, dl.pack));
        }
        if (/\.bin$/i.test(firmwarePath)) {
            args.push("--base-address", dl.flashAddress);
        }
        if (!reset) {
            args.push("--no-reset");
        }
        args.push(firmwarePath);
        return { command: executablePath, args };
    }

    if (probe === "jlink") {
        const scriptPath = options.tempScriptPath || path.join(os.tmpdir(), `digiwise-jlink-${randomUUID()}.jlink`);
        const scriptContent = buildJLinkFlashScript(firmwarePath, dl.flashAddress, verify, reset);
        return {
            command: executablePath,
            args: [
                "-device",
                dl.target,
                "-if",
                dl.interface || "SWD",
                "-speed",
                String(kHz),
                "-autoconnect",
                "1",
                "-ExitOnError",
                "1",
                "-NoGui",
                "1",
                "-CommanderScript",
                scriptPath
            ],
            generatedScriptContent: scriptContent
        };
    }

    if (probe === "stlink") {
        const args = [
            "-c",
            `port=${(dl.interface || "SWD").toLowerCase()}`,
            `freq=${kHz}`,
            "-w",
            firmwarePath,
            dl.flashAddress
        ];
        if (verify) args.push("-v");
        if (reset) args.push("-rst");
        return { command: executablePath, args };
    }

    // dplink
    const args = ["--download", firmwarePath, "--address", dl.flashAddress];
    if (verify) args.push("--verify");
    return { command: executablePath, args };
}

/**
 * Inspect flasher CLI output to ensure we NEVER treat a silent exit code 0 with probe errors
 * as a successful verified flash.
 */
export function evaluateFlashOutput(
    probe: SupportedProbeType,
    exitCode: number | null,
    combinedOutput: string,
    verifyRequested: boolean
): { success: boolean; verifiedByProbe: boolean; errorCode?: string; errorMessage?: string } {
    const text = combinedOutput || "";
    if (
        /no\s+(?:available\s+)?(?:debug\s+)?probes?|no\s+j-?link\s+found|cannot\s+connect\s+to\s+j-?link|no\s+st-?link\s+detected|target\s+not\s+found|failed\s+to\s+open\s+usb/i.test(
            text
        )
    ) {
        return {
            success: false,
            verifiedByProbe: false,
            errorCode: "PROBE_NOT_CONNECTED",
            errorMessage: "Debug probe or target board is not connected."
        };
    }

    if (
        /verification\s+failed|verify\s+failed|mismatch\s+at|flash\s+download\s+failed|programming\s+failed|unknown\s+target|invalid\s+device/i.test(
            text
        )
    ) {
        return {
            success: false,
            verifiedByProbe: false,
            errorCode: "FLASH_VERIFY_FAILED",
            errorMessage: "Firmware flashing or verification failed on target."
        };
    }

    if (exitCode !== 0) {
        return {
            success: false,
            verifiedByProbe: false,
            errorCode: "FLASH_COMMAND_FAILED",
            errorMessage: `Flasher exited with code ${exitCode}`
        };
    }

    const explicitVerifyOk =
        probe === "jlink"
            ? /(?:o\.k\.|verified|verification.*(?:ok|succeeded)|programming\s+done)/i.test(text)
            : probe === "pyocd"
              ? /(?:erased|programmed|flashed|loaded|100%)/i.test(text)
              : /(?:verified|download\s+verified|success|completed|o\.k\.)/i.test(text);

    if (verifyRequested && !explicitVerifyOk) {
        return {
            success: false,
            verifiedByProbe: false,
            errorCode: "FLASH_VERIFICATION_UNCONFIRMED",
            errorMessage:
                "Flasher exited with code 0 but did not emit explicit programming/verification confirmation."
        };
    }

    return {
        success: true,
        verifiedByProbe: explicitVerifyOk
    };
}

export function cancelLocalFirmwareDownload(downloadId: string): boolean {
    const entry = activeDownloads.get(downloadId);
    if (!entry) return false;
    entry.cancel();
    return true;
}

export interface LocalDownloadDependencies {
    toolchainStoreRoot: string;
    customEnvRoots?: string[];
    allowSystemPathFallback?: boolean;
    /** Optional executable override for testing or custom probe CLI paths. */
    executableOverride?: string;
    onLog?: (event: LocalDownloadLogEvent) => void;
    downloadId?: string;
}

export async function detectLocalProbe(
    probeInput: string,
    deps: Omit<LocalDownloadDependencies, "onLog" | "downloadId">
): Promise<LocalProbeDetectResult> {
    const probe = normalizeProbeType(probeInput);
    const checkedAt = new Date().toISOString();
    if (!probe) {
        return {
            probe: "pyocd",
            executablePath: null,
            connected: false,
            devices: [],
            message: `Unsupported probe type: ${probeInput}`,
            checkedAt
        };
    }

    let exePath = deps.executableOverride || null;
    let scopedEnv: NodeJS.ProcessEnv = process.env;
    if (!exePath && (probe === "pyocd" || probe === "jlink")) {
        const rep = await inspectToolchainEnvironment(
            deps.toolchainStoreRoot,
            [{ id: probe as ToolchainToolId, category: "flasher", required: true }],
            {
                customEnvRoots: deps.customEnvRoots,
                allowSystemPathFallback: deps.allowSystemPathFallback
            }
        );
        if (!rep.ready) {
            return {
                probe,
                executablePath: null,
                connected: false,
                devices: [],
                message: rep.blockingIssues[0]?.message || `${probe} is not installed`,
                recoveryHint: rep.blockingIssues[0]?.recoveryHint,
                checkedAt
            };
        }
        exePath = rep.resolvedExecutables[probe as ToolchainToolId] || null;
        scopedEnv = buildScopedToolchainEnv(rep, process.env);
    } else if (!exePath) {
        exePath = probe === "stlink" ? "STM32_Programmer_CLI" : "dplink";
    }

    let args: string[] = [];
    let tempDetectScript: string | null = null;
    if (probe === "pyocd") {
        args = ["list", "--probes"];
    } else if (probe === "jlink") {
        tempDetectScript = path.join(os.tmpdir(), `digiwise-jlink-detect-${randomUUID()}.jlink`);
        await fs.promises.writeFile(tempDetectScript, "ShowEmuList\nq\n", "utf8");
        args = ["-NoGui", "1", "-CommandFile", tempDetectScript];
    } else if (probe === "stlink") {
        args = ["-l"];
    } else {
        args = ["--list"];
    }

    try {
        const output = await new Promise<{ code: number | null; text: string }>((resolve, reject) => {
            const child = spawn(exePath!, args, {
                env: scopedEnv,
                shell: false,
                windowsHide: true
            });
            const chunks: string[] = [];
            const timer = setTimeout(() => {
                killProcessTree(child);
                resolve({ code: 124, text: chunks.join("") + "\nTimed out detecting probe." });
            }, 8000);
            child.stdout?.on("data", d => chunks.push(d.toString("utf8")));
            child.stderr?.on("data", d => chunks.push(d.toString("utf8")));
            child.once("error", err => {
                clearTimeout(timer);
                reject(err);
            });
            child.once("close", code => {
                clearTimeout(timer);
                resolve({ code, text: chunks.join("") });
            });
        });

        const devices: string[] = [];
        if (probe === "jlink") {
            for (const line of output.text.split(/\r?\n/)) {
                if (/J-Link\[\d+\]/i.test(line)) devices.push(line.trim());
            }
        } else if (probe === "pyocd") {
            for (const line of output.text.split(/\r?\n/)) {
                if (/^\s*\d+\s+\S+/.test(line) && !/no available debug probes/i.test(line)) {
                    devices.push(line.trim());
                }
            }
        } else if (output.code === 0 && output.text.trim() && !/no\s+.*detected|no\s+.*found/i.test(output.text)) {
            devices.push(output.text.trim().split(/\r?\n/)[0]);
        }

        const connected = devices.length > 0;
        return {
            probe,
            executablePath: exePath,
            connected,
            devices,
            message: connected
                ? `Detected ${devices.length} ${probe} probe(s).`
                : `No ${probe} probe connected.`,
            recoveryHint: connected
                ? undefined
                : `Connect the ${probe} debug probe to USB and check Windows Device Manager driver status.`,
            checkedAt
        };
    } catch (error: any) {
        return {
            probe,
            executablePath: exePath,
            connected: false,
            devices: [],
            message: `Failed to execute ${probe} probe detection: ${error?.message || error}`,
            checkedAt
        };
    } finally {
        if (tempDetectScript) {
            await fs.promises.rm(tempDetectScript, { force: true }).catch(() => undefined);
        }
    }
}

export async function runLocalFirmwareDownload(
    request: LocalDownloadRequest,
    deps: LocalDownloadDependencies
): Promise<LocalDownloadRecord> {
    const downloadId = deps.downloadId || `dl-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const dl = request.manifest.download;
    const probe = normalizeProbeType(dl.probe);
    const recordsDir = path.resolve(
        request.recordsDir || path.join(request.projectDir, "build", "downloads")
    );
    await fs.promises.mkdir(recordsDir, { recursive: true });
    const recordPath = path.join(recordsDir, `${downloadId}.json`);
    const logPath = path.join(recordsDir, `${downloadId}.log`);
    const logLines: string[] = [];

    let cancelled = false;
    let activeChild: ChildProcess | null = null;
    let tempScriptPath: string | null = null;

    const emit = (
        stage: LocalDownloadStage,
        stream: LocalDownloadLogEvent["stream"],
        line: string,
        progress?: number
    ) => {
        const timestamp = new Date().toISOString();
        logLines.push(`[${timestamp}] [${stage}] [${stream}] ${line}`);
        deps.onLog?.({ downloadId, stage, stream, line, progress, timestamp });
    };

    const finalize = async (params: {
        status: LocalDownloadRecord["status"];
        firmwareSize?: number;
        firmwareSha256?: string;
        command?: string;
        args?: string[];
        exitCode?: number | null;
        verifiedByProbe?: boolean;
        errorCode?: string;
        errorMessage?: string;
    }): Promise<LocalDownloadRecord> => {
        activeDownloads.delete(downloadId);
        if (tempScriptPath) {
            await fs.promises.rm(tempScriptPath, { force: true }).catch(() => undefined);
        }
        const finishedAt = new Date().toISOString();
        const record: LocalDownloadRecord = {
            downloadId,
            status: params.status,
            ...(params.errorCode ? { errorCode: params.errorCode } : {}),
            ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
            probe: probe || "pyocd",
            target: dl.target || "",
            interface: dl.interface || "SWD",
            frequencyHz: dl.frequencyHz || 500000,
            flashAddress: dl.flashAddress || "",
            firmwarePath: request.firmwarePath,
            firmwareSize: params.firmwareSize ?? 0,
            firmwareSha256: params.firmwareSha256 ?? "",
            command: params.command ?? "",
            args: params.args ?? [],
            exitCode: params.exitCode ?? null,
            verifiedByProbe: Boolean(params.verifiedByProbe),
            boardRuntimeVerified: false,
            recordPath,
            logPath,
            startedAt,
            finishedAt,
            durationMs: Date.now() - startedMs
        };
        await fs.promises.writeFile(logPath, logLines.join("\n") + "\n", "utf8");
        await fs.promises.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
        return record;
    };

    activeDownloads.set(downloadId, {
        cancel: () => {
            cancelled = true;
            emit("cancelled", "info", "Firmware download cancellation requested by user.");
            if (activeChild) killProcessTree(activeChild);
        }
    });

    try {
        // Stage 1: Validate inputs, address, target, firmware integrity
        emit("validate-inputs", "info", "Validating firmware, target, and flash address...", 10);
        if (!probe) {
            return await finalize({
                status: "failed",
                errorCode: "UNSUPPORTED_PROBE",
                errorMessage: `Unsupported probe in BSP manifest: ${dl.probe}`
            });
        }
        if (!dl.target || !dl.target.trim() || dl.target.includes("BLOCKED")) {
            return await finalize({
                status: "failed",
                errorCode: "INVALID_TARGET",
                errorMessage: `Invalid or unconfirmed target chip in BSP manifest: ${dl.target}`
            });
        }
        if (!isValidFlashAddress(dl.flashAddress)) {
            return await finalize({
                status: "failed",
                errorCode: "INVALID_FLASH_ADDRESS",
                errorMessage: `Invalid flash address: ${dl.flashAddress}`
            });
        }
        if (!request.firmwarePath || !fs.existsSync(request.firmwarePath)) {
            return await finalize({
                status: "failed",
                errorCode: "FIRMWARE_NOT_FOUND",
                errorMessage: `Firmware file does not exist: ${request.firmwarePath}`
            });
        }

        const { sha256: actualSha, fileSize } = await sha256File(request.firmwarePath);
        if (fileSize === 0) {
            return await finalize({
                status: "failed",
                firmwareSize: 0,
                firmwareSha256: actualSha,
                errorCode: "FIRMWARE_EMPTY",
                errorMessage: "Firmware image is empty (0 bytes)."
            });
        }
        if (
            request.expectedSha256 &&
            actualSha.toLowerCase() !== request.expectedSha256.toLowerCase()
        ) {
            return await finalize({
                status: "failed",
                firmwareSize: fileSize,
                firmwareSha256: actualSha,
                errorCode: "FIRMWARE_INTEGRITY_FAILED",
                errorMessage: "Firmware SHA-256 does not match the build record; refusing to flash."
            });
        }

        // Stage 2: Resolve flasher executable via Toolchain Manager
        emit("toolchain-check", "info", `Resolving ${probe} flasher executable...`, 25);
        let executablePath = deps.executableOverride || null;
        let scopedEnv: NodeJS.ProcessEnv = process.env;
        if (!executablePath && (probe === "pyocd" || probe === "jlink")) {
            const tcRep = await inspectToolchainEnvironment(
                deps.toolchainStoreRoot,
                [{ id: probe as ToolchainToolId, category: "flasher", required: true }],
                {
                    customEnvRoots: deps.customEnvRoots,
                    allowSystemPathFallback: deps.allowSystemPathFallback
                }
            );
            if (!tcRep.ready) {
                const issue = tcRep.blockingIssues[0];
                return await finalize({
                    status: "failed",
                    firmwareSize: fileSize,
                    firmwareSha256: actualSha,
                    errorCode: issue?.code || "FLASHER_NOT_READY",
                    errorMessage: issue?.message || `${probe} flasher is not ready`
                });
            }
            executablePath = tcRep.resolvedExecutables[probe as ToolchainToolId] || null;
            scopedEnv = buildScopedToolchainEnv(tcRep, process.env);
        } else if (!executablePath) {
            executablePath = probe === "stlink" ? "STM32_Programmer_CLI" : "dplink";
        }

        if (cancelled) {
            return await finalize({
                status: "cancelled",
                firmwareSize: fileSize,
                firmwareSha256: actualSha,
                errorCode: "DOWNLOAD_CANCELLED",
                errorMessage: "Download cancelled before flashing"
            });
        }

        // Stage 3: Build flasher command & execute
        tempScriptPath =
            probe === "jlink"
                ? path.join(os.tmpdir(), `digiwise-jlink-flash-${downloadId}.jlink`)
                : null;
        const spec = buildFlashCommandSpec(probe, executablePath!, request.manifest, request.firmwarePath, {
            bspInstallDir: request.bspInstallDir,
            tempScriptPath: tempScriptPath || undefined
        });
        if (tempScriptPath && spec.generatedScriptContent) {
            await fs.promises.writeFile(tempScriptPath, spec.generatedScriptContent, "utf8");
        }

        emit("flashing", "info", `$ ${spec.command} ${spec.args.join(" ")}`, 45);
        const timeoutMs = request.timeoutMs ?? DEFAULT_FLASH_TIMEOUT_MS;
        let timedOut = false;
        const outputChunks: string[] = [];

        const exitCode = await new Promise<number | null>((resolve, reject) => {
            const child = spawn(spec.command, spec.args, {
                cwd: request.projectDir,
                env: scopedEnv,
                shell: false,
                windowsHide: true
            });
            activeChild = child;

            const timer = setTimeout(() => {
                timedOut = true;
                emit("flashing", "error", `Flasher timed out after ${timeoutMs} ms.`);
                killProcessTree(child);
            }, timeoutMs);

            const forward = (stream: "stdout" | "stderr", chunk: Buffer) => {
                const text = chunk.toString("utf8");
                outputChunks.push(text);
                for (const line of text.split(/\r?\n/)) {
                    if (line.trim()) emit("flashing", stream, line);
                }
            };
            child.stdout?.on("data", c => forward("stdout", c));
            child.stderr?.on("data", c => forward("stderr", c));
            child.once("error", err => {
                clearTimeout(timer);
                activeChild = null;
                reject(err);
            });
            child.once("close", code => {
                clearTimeout(timer);
                activeChild = null;
                resolve(code);
            });
        });

        if (cancelled) {
            return await finalize({
                status: "cancelled",
                firmwareSize: fileSize,
                firmwareSha256: actualSha,
                command: spec.command,
                args: spec.args,
                exitCode,
                errorCode: "DOWNLOAD_CANCELLED",
                errorMessage: "Firmware download cancelled by user"
            });
        }
        if (timedOut) {
            return await finalize({
                status: "failed",
                firmwareSize: fileSize,
                firmwareSha256: actualSha,
                command: spec.command,
                args: spec.args,
                exitCode,
                errorCode: "FLASH_TIMEOUT",
                errorMessage: `Firmware download timed out after ${timeoutMs} ms`
            });
        }

        // Stage 4: Evaluate output & explicit probe verification
        emit("verifying", "info", "Evaluating flasher programming & verification receipt...", 85);
        const evalRes = evaluateFlashOutput(
            probe,
            exitCode,
            outputChunks.join(""),
            dl.verifyAfterFlash !== false
        );
        if (!evalRes.success) {
            emit("failed", "error", `${evalRes.errorCode}: ${evalRes.errorMessage}`);
            return await finalize({
                status: "failed",
                firmwareSize: fileSize,
                firmwareSha256: actualSha,
                command: spec.command,
                args: spec.args,
                exitCode,
                verifiedByProbe: false,
                errorCode: evalRes.errorCode,
                errorMessage: evalRes.errorMessage
            });
        }

        emit(
            "completed",
            "info",
            `Firmware flashed & verified by ${probe} (sha256=${actualSha.slice(0, 16)}...). Physical board boot/runtime must be confirmed separately.`,
            100
        );
        return await finalize({
            status: "completed",
            firmwareSize: fileSize,
            firmwareSha256: actualSha,
            command: spec.command,
            args: spec.args,
            exitCode,
            verifiedByProbe: evalRes.verifiedByProbe
        });
    } catch (error: any) {
        return await finalize({
            status: cancelled ? "cancelled" : "failed",
            errorCode: cancelled ? "DOWNLOAD_CANCELLED" : error?.code || "FLASH_FAILED",
            errorMessage: error?.message || "Firmware download failed"
        });
    }
}

export function registerDigiwiseDownloadIpc(
    windowOrResolver: BrowserWindow | (() => BrowserWindow)
) {
    if (registered) return;
    registered = true;
    const resolveWindow = () =>
        typeof windowOrResolver === "function" ? windowOrResolver() : windowOrResolver;

    const checkSender = (event: Electron.IpcMainInvokeEvent) => {
        const windows = electron.BrowserWindow.getAllWindows();
        const allowed = windows.some(
            w =>
                !w.isDestroyed() &&
                !w.webContents.isDestroyed() &&
                event.sender === w.webContents &&
                event.senderFrame === w.webContents.mainFrame
        );
        if (!allowed) {
            throw new Error("Unauthorized download request");
        }
    };

    const { ipcMain } = electron;

    ipcMain.handle(
        "digistudio:download:detect",
        async (event, probe: unknown): Promise<DigiwiseIpcResult<LocalProbeDetectResult>> => {
            checkSender(event);
            const guard = getDigiwiseAuthGuard();
            if (!guard.authenticated) {
                return {
                    ok: false,
                    error: { status: 401, code: "AUTH_REQUIRED", message: "Sign in required", requestId: "local-auth" }
                };
            }
            const customEnvRoots = await loadCustomEnvRoots();
            const res = await detectLocalProbe(String(probe || ""), {
                toolchainStoreRoot: toolchainStoreRoot(),
                customEnvRoots
            });
            return { ok: true, data: res };
        }
    );

    ipcMain.handle(
        "digistudio:download:run",
        async (event, request: unknown): Promise<DigiwiseIpcResult<LocalDownloadRecord>> => {
            checkSender(event);
            const guard = getDigiwiseAuthGuard();
            if (!guard.authenticated) {
                return {
                    ok: false,
                    error: { status: 401, code: "AUTH_REQUIRED", message: "Sign in required", requestId: "local-auth" }
                };
            }
            const customEnvRoots = await loadCustomEnvRoots();
            const record = await runLocalFirmwareDownload(request as LocalDownloadRequest, {
                toolchainStoreRoot: toolchainStoreRoot(),
                customEnvRoots,
                onLog: logEvent => {
                    const win = resolveWindow();
                    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                        win.webContents.send(LOG_CHANNEL, logEvent);
                    }
                }
            });
            if (record.status !== "completed") {
                return {
                    ok: false,
                    error: {
                        status: 500,
                        code: record.errorCode || "FLASH_FAILED",
                        message: record.errorMessage || "Firmware download failed",
                        requestId: record.downloadId
                    }
                };
            }
            return { ok: true, data: record };
        }
    );

    ipcMain.handle(
        "digistudio:download:cancel",
        async (event, downloadId: unknown): Promise<DigiwiseIpcResult<{ cancelled: boolean }>> => {
            checkSender(event);
            return { ok: true, data: { cancelled: cancelLocalFirmwareDownload(String(downloadId || "")) } };
        }
    );
}
