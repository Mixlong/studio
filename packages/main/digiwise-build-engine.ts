import electron from "electron";
import type { BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { callDigiwisePublicApiWithSession, getDigiwiseAuthGuard } from "main/digiwise-auth";
import { verifyBspBuildAccess } from "main/digiwise-bsp-catalog";
import {
    buildScopedToolchainEnv,
    inspectToolchainEnvironment,
    resolveBspToolchainRequirements
} from "main/digiwise-toolchain-manager";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import type { DigiwiseBspManifest } from "eez-studio-shared/digiwise-bsp-catalog";
import type {
    LocalBuildArtifactRecord,
    LocalBuildCommandRecord,
    LocalBuildDiagnostic,
    LocalBuildLogEvent,
    LocalBuildRecord,
    LocalBuildRequest,
    LocalBuildStage
} from "eez-studio-shared/digiwise-build";

const LOG_CHANNEL = "digistudio:build:log";
const activeBuilds = new Map<string, { cancel: () => void }>();
let registered = false;

function bspStoreRoot(): string {
    return path.join(electron.app.getPath("userData"), "bsp-store");
}

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
            return parsed.customEnvRoots.filter((r: unknown) => typeof r === "string" && r.trim());
        }
    } catch {
        // Ignore missing config
    }
    return [];
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

export function parseCompilerDiagnostics(line: string): LocalBuildDiagnostic | null {
    // Matches GCC/Clang: path/to/file.c:12:5: error: message (including Windows drive letter C:\...)
    const m = line.match(/^((?:[A-Za-z]:)?[^:\r\n]+):(\d+):(?:(\d+):)?\s*(error|warning):\s*(.+)$/i);
    if (!m) return null;
    return {
        file: m[1].trim(),
        line: Number(m[2]),
        ...(m[3] ? { column: Number(m[3]) } : {}),
        severity: m[4].toLowerCase() === "warning" ? "warning" : "error",
        message: m[5].trim()
    };
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

async function copyDirectoryRecursive(srcDir: string, dstDir: string): Promise<void> {
    await fs.promises.mkdir(dstDir, { recursive: true });
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === "bsp-install-meta.json") continue;
        const src = path.join(srcDir, entry.name);
        const dst = path.join(dstDir, entry.name);
        if (entry.isDirectory()) {
            await copyDirectoryRecursive(src, dst);
        } else if (entry.isFile()) {
            await fs.promises.copyFile(src, dst);
        }
    }
}

function resolveInsideDir(baseDir: string, relPath: string): string {
    const resolved = path.resolve(baseDir, relPath);
    const rel = path.relative(baseDir, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw Object.assign(new Error(`Path escapes build workspace: ${relPath}`), {
            code: "BUILD_PATH_INVALID",
            status: 422
        });
    }
    return resolved;
}

export function cancelLocalFirmwareBuild(buildId: string): boolean {
    const entry = activeBuilds.get(buildId);
    if (!entry) return false;
    entry.cancel();
    return true;
}

export interface RunLocalBuildDependencies {
    bspStoreRoot: string;
    toolchainStoreRoot: string;
    customEnvRoots?: string[];
    allowSystemPathFallback?: boolean;
    listAuthorizedVersions: (
        categoryCode: string
    ) => Promise<Array<{ id: number; categoryCode: string; version: string; sha256: string }>>;
    onLog?: (event: LocalBuildLogEvent) => void;
    buildId?: string;
}

/**
 * Execute a controlled local firmware build:
 * 1. Online authorization gate (local cache NEVER bypasses server revocation)
 * 2. Toolchain Manager verification (blocks cleanly on missing/mismatched tools)
 * 3. Fresh isolated BSP working copy + UI resource injection (never mutates immutable BSP store or reuses stale firmware)
 * 4. Execute manifest-declared build pipeline with scoped PATH, streaming logs, and process-tree cancellation
 * 5. Locate & SHA-256 hash manifest-declared artifacts + write immutable build-record.json
 */
export async function runLocalFirmwareBuild(
    request: LocalBuildRequest,
    deps: RunLocalBuildDependencies
): Promise<LocalBuildRecord> {
    const buildId = deps.buildId || `build-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const projectDir = path.resolve(request.projectDir);
    const outputRoot = path.resolve(request.outputDir || path.join(projectDir, "build"));
    const workDir = path.join(outputRoot, "work", buildId);
    const artifactsOutDir = path.join(outputRoot, "artifacts", buildId);
    const recordsDir = path.join(outputRoot, "records");
    const recordPath = path.join(recordsDir, `${buildId}.json`);
    const logPath = path.join(recordsDir, `${buildId}.log`);

    await fs.promises.mkdir(recordsDir, { recursive: true });
    const logLines: string[] = [];
    const diagnostics: LocalBuildDiagnostic[] = [];
    const commands: LocalBuildCommandRecord[] = [];
    let cancelled = false;
    let activeChild: ChildProcess | null = null;

    const emit = (
        stage: LocalBuildStage,
        stream: LocalBuildLogEvent["stream"],
        line: string,
        progress?: number
    ) => {
        const timestamp = new Date().toISOString();
        logLines.push(`[${timestamp}] [${stage}] [${stream}] ${line}`);
        if (stream === "stderr" || stream === "stdout") {
            const diag = parseCompilerDiagnostics(line);
            if (diag) diagnostics.push(diag);
        }
        deps.onLog?.({ buildId, stage, stream, line, progress, timestamp });
    };

    const finalize = async (
        status: LocalBuildRecord["status"],
        artifacts: LocalBuildArtifactRecord[],
        resolvedVersions: Record<string, string>,
        hostOs: string,
        errorCode?: string,
        errorMessage?: string
    ): Promise<LocalBuildRecord> => {
        activeBuilds.delete(buildId);
        const finishedAt = new Date().toISOString();
        const record: LocalBuildRecord = {
            buildId,
            status,
            ...(errorCode ? { errorCode } : {}),
            ...(errorMessage ? { errorMessage } : {}),
            projectDir,
            workDir,
            recordPath,
            logPath,
            bsp: {
                bspId: request.binding.bspId,
                categoryCode: request.binding.categoryCode,
                version: request.binding.version,
                sha256: request.binding.sha256.toLowerCase()
            },
            toolchain: {
                hostOs,
                resolvedVersions
            },
            commands,
            artifacts,
            diagnostics,
            startedAt,
            finishedAt,
            durationMs: Date.now() - startedMs
        };
        await fs.promises.writeFile(logPath, logLines.join("\n") + "\n", "utf8");
        await fs.promises.writeFile(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
        return record;
    };

    activeBuilds.set(buildId, {
        cancel: () => {
            cancelled = true;
            emit("cancelled", "info", "Build cancellation requested by user.");
            if (activeChild) {
                killProcessTree(activeChild);
            }
        }
    });

    let resolvedVersions: Record<string, string> = {};
    let hostOs = process.platform === "win32" ? "windows-x64" : process.platform;

    try {
        // Stage 1: Online authorization gate
        emit("auth-gate", "info", `Verifying online authorization for BSP ${request.binding.categoryCode}@${request.binding.version}...`, 5);
        const gate = await verifyBspBuildAccess(
            deps.bspStoreRoot,
            request.binding,
            deps.listAuthorizedVersions
        );
        if (!gate.manifest) {
            throw Object.assign(new Error("Installed BSP is missing bsp-manifest.json"), {
                code: "BSP_MANIFEST_MISSING"
            });
        }
        const manifest: DigiwiseBspManifest = gate.manifest;

        if (cancelled) {
            return await finalize("cancelled", [], resolvedVersions, hostOs, "BUILD_CANCELLED", "Build cancelled");
        }

        // Stage 2: Toolchain readiness check (compile/build tools only; flasher is checked at Download time)
        emit("toolchain-check", "info", "Checking locked toolchain requirements...", 15);
        const allReqs = resolveBspToolchainRequirements(manifest);
        const buildReqs = allReqs.filter(r => r.category !== "flasher");
        const tcReport = await inspectToolchainEnvironment(deps.toolchainStoreRoot, buildReqs, {
            customEnvRoots: deps.customEnvRoots,
            allowSystemPathFallback: deps.allowSystemPathFallback,
            bspMeta: {
                bspId: manifest.bsp.id,
                categoryCode: manifest.bsp.categoryCode,
                bspVersion: manifest.bsp.version
            }
        });
        hostOs = tcReport.hostOs;
        for (const tool of tcReport.tools) {
            if (tool.detectedVersion) {
                resolvedVersions[tool.id] = tool.detectedVersion;
            }
        }
        if (!tcReport.ready) {
            const summary = tcReport.blockingIssues.map(i => `${i.toolId}: ${i.message}`).join("; ");
            emit("toolchain-check", "error", `Toolchain check failed: ${summary}`);
            return await finalize("failed", [], resolvedVersions, hostOs, "TOOLCHAIN_NOT_READY", summary);
        }

        if (cancelled) {
            return await finalize("cancelled", [], resolvedVersions, hostOs, "BUILD_CANCELLED", "Build cancelled");
        }

        // Stage 3: Prepare fresh isolated BSP working copy & inject Studio UI resources
        emit("prepare-workspace", "info", `Preparing clean BSP working copy in ${workDir}...`, 25);
        await fs.promises.rm(workDir, { recursive: true, force: true });
        await copyDirectoryRecursive(gate.installed.installPath, workDir);

        if (request.generatedUiSourceDir && fs.existsSync(request.generatedUiSourceDir)) {
            const uiTargetRel = manifest.build.uiSync?.generatedUiDir || "ui/generated";
            const uiTargetDir = resolveInsideDir(workDir, uiTargetRel);
            await copyDirectoryRecursive(request.generatedUiSourceDir, uiTargetDir);
            emit("prepare-workspace", "info", `Injected Studio UI assets into ${uiTargetRel}`);
        }

        const manifestEnv = { ...(manifest.build.env || {}) };
        const extraManifestPath = manifestEnv.PATH || manifestEnv.Path || "";
        delete manifestEnv.PATH;
        delete manifestEnv.Path;
        const baseForScope: NodeJS.ProcessEnv = {
            ...process.env,
            ...manifestEnv,
            ...(extraManifestPath
                ? { PATH: [extraManifestPath, process.env.PATH || ""].filter(Boolean).join(path.delimiter) }
                : {})
        };
        const scopedEnv: NodeJS.ProcessEnv = {
            ...buildScopedToolchainEnv(tcReport, baseForScope),
            DIGIWISE_PROJECT_DIR: projectDir,
            DIGIWISE_BSP_DIR: workDir,
            DIGIWISE_BUILD_ID: buildId
        };

        const runSubprocess = async (
            stage: LocalBuildStage,
            command: string,
            args: string[],
            cwd: string
        ): Promise<void> => {
            if (cancelled) {
                throw Object.assign(new Error("Build cancelled"), { code: "BUILD_CANCELLED" });
            }
            const cmdStart = Date.now();
            emit(stage, "info", `$ ${command} ${args.join(" ")}`);
            const exitCode = await new Promise<number | null>((resolve, reject) => {
                const child = spawn(command, args, {
                    cwd,
                    env: scopedEnv,
                    shell: false,
                    windowsHide: true
                });
                activeChild = child;

                const forward = (stream: "stdout" | "stderr", chunk: Buffer) => {
                    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
                        if (line.trim()) emit(stage, stream, line);
                    }
                };
                child.stdout?.on("data", chunk => forward("stdout", chunk));
                child.stderr?.on("data", chunk => forward("stderr", chunk));
                child.once("error", err => {
                    activeChild = null;
                    reject(err);
                });
                child.once("close", code => {
                    activeChild = null;
                    resolve(code);
                });
            });

            commands.push({
                stage,
                command,
                args,
                cwd,
                exitCode,
                durationMs: Date.now() - cmdStart
            });

            if (cancelled) {
                throw Object.assign(new Error("Build cancelled"), { code: "BUILD_CANCELLED" });
            }
            if (exitCode !== 0) {
                throw Object.assign(
                    new Error(`${stage} command exited with code ${exitCode}`),
                    { code: "BUILD_COMMAND_FAILED" }
                );
            }
        };

        const sourceDir = resolveInsideDir(workDir, manifest.build.sourceDir || ".");
        const buildOutDir = path.join(workDir, "build");
        await fs.promises.mkdir(buildOutDir, { recursive: true });

        // Stage 4: Optional pre-configure script (e.g. cmake_config_*.py)
        if (manifest.build.preConfigureScript) {
            const scriptPath = resolveInsideDir(workDir, manifest.build.preConfigureScript);
            const pythonExe = tcReport.resolvedExecutables.python || (process.platform === "win32" ? "python" : "python3");
            emit("pre-configure", "info", `Running pre-configure script: ${manifest.build.preConfigureScript}`, 40);
            await runSubprocess("pre-configure", pythonExe, [scriptPath, "--output", buildOutDir], workDir);
        }

        // Stage 5 & 6: Configure + Build according to manifest.build.system
        if (manifest.build.system === "cmake") {
            const cmakeExe = tcReport.resolvedExecutables.cmake || "cmake";
            const configureArgs = ["-S", sourceDir, "-B", buildOutDir];
            if (manifest.build.generator) {
                configureArgs.push("-G", manifest.build.generator);
            }
            if (manifest.build.toolchainFile) {
                const tcFile = resolveInsideDir(workDir, manifest.build.toolchainFile);
                configureArgs.push(`-DCMAKE_TOOLCHAIN_FILE=${tcFile}`);
            }
            if (manifest.build.extraArgs?.length) {
                configureArgs.push(...manifest.build.extraArgs);
            }
            emit("configure", "info", "Running CMake configure...", 55);
            await runSubprocess("configure", cmakeExe, configureArgs, workDir);

            emit("build", "info", "Running CMake build...", 75);
            await runSubprocess("build", cmakeExe, ["--build", buildOutDir], workDir);
        } else if (manifest.build.system === "python-script") {
            const scriptRel = manifest.build.preConfigureScript || "build.py";
            const scriptPath = resolveInsideDir(workDir, scriptRel);
            const pythonExe = tcReport.resolvedExecutables.python || (process.platform === "win32" ? "python" : "python3");
            const extra = manifest.build.extraArgs || [];
            emit("build", "info", `Running Python build script: ${scriptRel}`, 70);
            await runSubprocess(
                "build",
                pythonExe,
                [scriptPath, "--project", projectDir, "--output", buildOutDir, ...extra],
                workDir
            );
        } else if (manifest.build.system === "make") {
            const extra = manifest.build.extraArgs || [];
            let makeCmd = "make";
            if (process.platform === "win32") {
                const pathDirs = (scopedEnv.PATH || "").split(path.delimiter).filter(Boolean);
                const foundMake = pathDirs.find(d => fs.existsSync(path.join(d, "make.exe")));
                const foundMingwMake = pathDirs.find(d => fs.existsSync(path.join(d, "mingw32-make.exe")));
                if (foundMake) makeCmd = path.join(foundMake, "make.exe");
                else if (foundMingwMake) makeCmd = path.join(foundMingwMake, "mingw32-make.exe");
            }
            emit("build", "info", `Running Make build (${makeCmd})...`, 70);
            await runSubprocess("build", makeCmd, extra, sourceDir);
        } else {
            const extra = manifest.build.extraArgs || [];
            emit("build", "info", "Running PlatformIO build...", 70);
            await runSubprocess("build", "pio", ["run", ...extra], sourceDir);
        }

        // Stage 7: Collect & SHA-256 verify artifacts declared in manifest.build.artifacts
        emit("collect-artifacts", "info", "Collecting and hashing build artifacts...", 90);
        await fs.promises.mkdir(artifactsOutDir, { recursive: true });
        const collected: LocalBuildArtifactRecord[] = [];
        for (const spec of manifest.build.artifacts) {
            const producedPath = resolveInsideDir(workDir, spec.path);
            if (!fs.existsSync(producedPath)) {
                if (spec.required) {
                    throw Object.assign(
                        new Error(`Required build artifact missing: ${spec.path}`),
                        { code: "BUILD_ARTIFACT_MISSING" }
                    );
                }
                continue;
            }
            const destPath = path.join(artifactsOutDir, path.basename(producedPath));
            await fs.promises.copyFile(producedPath, destPath);
            const { sha256, fileSize } = await sha256File(destPath);
            if (spec.required && fileSize === 0) {
                throw Object.assign(
                    new Error(`Required build artifact is empty: ${spec.path}`),
                    { code: "BUILD_ARTIFACT_EMPTY" }
                );
            }
            collected.push({
                role: spec.role,
                format: spec.format,
                required: spec.required,
                relativePath: spec.path,
                path: destPath,
                fileSize,
                sha256
            });
        }

        emit("completed", "info", `Build succeeded with ${collected.length} artifact(s).`, 100);
        return await finalize("completed", collected, resolvedVersions, hostOs);
    } catch (error: any) {
        const code = cancelled ? "BUILD_CANCELLED" : error?.code || "BUILD_FAILED";
        const message = error?.message || "Local firmware build failed";
        const status: LocalBuildRecord["status"] = cancelled ? "cancelled" : "failed";
        emit(status, "error", `${code}: ${message}`);
        return await finalize(status, [], resolvedVersions, hostOs, code, message);
    }
}

export function registerDigiwiseBuildIpc(
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
            throw new Error("Unauthorized build request");
        }
    };

    const { ipcMain } = electron;

    ipcMain.handle(
        "digistudio:build:run",
        async (event, request: unknown): Promise<DigiwiseIpcResult<LocalBuildRecord>> => {
            checkSender(event);
            const initialGuard = getDigiwiseAuthGuard();
            if (!initialGuard.authenticated) {
                return {
                    ok: false,
                    error: { status: 401, code: "AUTH_REQUIRED", message: "Sign in required", requestId: "local-auth" }
                };
            }
            const customEnvRoots = await loadCustomEnvRoots();
            const record = await runLocalFirmwareBuild(request as LocalBuildRequest, {
                bspStoreRoot: bspStoreRoot(),
                toolchainStoreRoot: toolchainStoreRoot(),
                customEnvRoots,
                listAuthorizedVersions: async categoryCode => {
                    const res = await callDigiwisePublicApiWithSession((api, token) =>
                        api.listBspVersions(token, categoryCode)
                    );
                    if (!res.ok) {
                        throw Object.assign(new Error(res.error.message), {
                            code: res.error.code,
                            status: res.error.status
                        });
                    }
                    return res.data;
                },
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
                        status: record.errorCode === "BSP_NOT_AUTHORIZED" ? 403 : 500,
                        code: record.errorCode || "BUILD_FAILED",
                        message: record.errorMessage || "Build failed",
                        requestId: record.buildId
                    }
                };
            }
            return { ok: true, data: record };
        }
    );

    ipcMain.handle(
        "digistudio:build:cancel",
        async (event, buildId: unknown): Promise<DigiwiseIpcResult<{ cancelled: boolean }>> => {
            checkSender(event);
            return { ok: true, data: { cancelled: cancelLocalFirmwareBuild(String(buildId || "")) } };
        }
    );
}
