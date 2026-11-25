import electron from "electron";
import type { BrowserWindow } from "electron";
import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import type { DigiwiseBspManifest } from "eez-studio-shared/digiwise-bsp-catalog";
import {
    TOOLCHAIN_CATALOG,
    versionSatisfiesRequirement,
    type InstalledToolchainRecord,
    type ToolchainEnvironmentReport,
    type ToolchainManagerConfig,
    type ToolchainPackageSpec,
    type ToolchainPrepareProgress,
    type ToolchainRequirement,
    type ToolchainToolId,
    type ToolchainToolStatus
} from "eez-studio-shared/digiwise-toolchain";

const MAX_TOOLCHAIN_ARCHIVE_SIZE = 1500 * 1024 * 1024;
const MAX_TOOLCHAIN_ENTRIES = 60_000;
const MAX_TOOLCHAIN_EXPANDED_SIZE = 4 * 1024 * 1024 * 1024;
const META_FILENAME = "toolchain-meta.json";
const CONFIG_FILENAME = "toolchain-config.json";
const PROGRESS_CHANNEL = "digistudio:toolchain:progress";

let registered = false;
const activeControllers = new Map<string, AbortController>();

function isSafeSegment(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function isAllowedDownloadUrl(url: URL): boolean {
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return (
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")
    );
}

function toolchainStoreRoot(): string {
    return path.join(electron.app.getPath("userData"), "toolchains");
}

function toolchainConfigPath(): string {
    return path.join(electron.app.getPath("userData"), CONFIG_FILENAME);
}

/**
 * Resolve built-in isolated toolchain root bundled inside the client app/installer:
 * - Packaged builds: <resourcesPath>/toolchains
 * - Dev builds: <appPath>/resources/toolchains
 */
export function getBundledToolchainRoots(): string[] {
    const candidates: string[] = [];
    const isPackaged = Boolean(electron.app?.isPackaged);
    if (isPackaged && typeof process.resourcesPath === "string" && process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, "toolchains"));
    } else {
        const appPath =
            typeof electron.app?.getAppPath === "function"
                ? electron.app.getAppPath()
                : process.cwd();
        candidates.push(path.join(appPath, "resources", "toolchains"));
    }
    return candidates.filter(dir => {
        try {
            return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
        } catch {
            return false;
        }
    });
}

export function mergeToolchainEnvRoots(customEnvRoots: string[] = []): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const dir of [...customEnvRoots, ...getBundledToolchainRoots()]) {
        const trimmed = typeof dir === "string" ? dir.trim() : "";
        if (!trimmed) continue;
        const key = process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(trimmed);
    }
    return merged;
}

function getHostOsTag(): string {
    if (process.platform === "win32") return "windows-x64";
    if (process.platform === "darwin") return process.arch === "arm64" ? "macos-arm64" : "macos-x64";
    return "linux-x64";
}

function executableNameFor(id: ToolchainToolId): string {
    const entry = TOOLCHAIN_CATALOG[id];
    return process.platform === "win32" ? entry.executableWin : entry.executablePosix;
}

function makeArchiveInvalidError(detail: string): Error {
    return Object.assign(new Error(detail), {
        code: "TOOLCHAIN_ARCHIVE_INVALID",
        status: 422
    });
}

function validateZipEntryPath(entryName: string, stageDir: string): string {
    const normalized = entryName.replace(/\\/g, "/");
    if (
        !normalized ||
        normalized.startsWith("/") ||
        /^[a-zA-Z]:/.test(normalized) ||
        normalized.includes("\0")
    ) {
        throw makeArchiveInvalidError("Toolchain archive contains an unsafe path");
    }
    const segments = normalized.split("/").filter(Boolean);
    if (segments.some(seg => seg === "." || seg === ".." || /[<>:"|?*\x00-\x1f]/.test(seg))) {
        throw makeArchiveInvalidError("Toolchain archive contains an unsafe path");
    }
    const destination = path.resolve(stageDir, segments.join(path.sep));
    if (destination !== stageDir && !destination.startsWith(stageDir + path.sep)) {
        throw makeArchiveInvalidError("Toolchain archive escapes target directory");
    }
    return destination;
}

/**
 * Guard against confusing Java JDK's `jlink.exe` with SEGGER `JLink.exe`!
 * Real SEGGER J-Link installations contain JLinkARM.dll / JLink_x64.dll (Windows)
 * or reside under a SEGGER/JLink directory, never under a Java/JDK/bin directory.
 */
export function isAuthenticSeggerJLinkExecutable(exePath: string): boolean {
    const normalized = exePath.replace(/\\/g, "/").toLowerCase();
    if (/(?:^|\/)(?:jdk|jre|java|temurin|corretto|zulu|graalvm)[^/]*\/bin\/jlink(?:\.exe)?$/i.test(normalized)) {
        return false;
    }
    const dir = path.dirname(exePath);
    if (process.platform === "win32") {
        if (
            fs.existsSync(path.join(dir, "JLinkARM.dll")) ||
            fs.existsSync(path.join(dir, "JLink_x64.dll")) ||
            fs.existsSync(path.join(dir, "JLinkDevices.xml"))
        ) {
            return true;
        }
        return false;
    }
    return normalized.includes("segger") || normalized.includes("jlink");
}

function execText(exePath: string, args: string[], timeoutMs = 4000): Promise<string | null> {
    return new Promise(resolve => {
        try {
            execFile(exePath, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
                const combined = `${stdout || ""}\n${stderr || ""}`.trim();
                if (combined) {
                    resolve(combined);
                } else if (err) {
                    resolve(null);
                } else {
                    resolve("");
                }
            });
        } catch {
            resolve(null);
        }
    });
}

export async function probeExecutableVersion(
    id: ToolchainToolId,
    exePath: string
): Promise<string | null> {
    if (!fs.existsSync(exePath)) return null;

    if (id === "jlink") {
        if (!isAuthenticSeggerJLinkExecutable(exePath)) return null;
        // Extract version from parent folder like JLink_V634b without launching GUI
        const folderMatch = path.dirname(exePath).match(/JLink[_-]?V?(\d+[.\da-z]*)/i);
        if (folderMatch) return folderMatch[1];
        return "installed";
    }

    if (id === "arm-none-eabi-gcc") {
        const out = await execText(exePath, ["--version"]);
        if (!out) return null;
        const relMatch = out.match(/(\d+\.\d+\.rel\d+)/i);
        if (relMatch) return relMatch[1];
        const verMatch = out.match(/(\d+\.\d+\.\d+)/);
        return verMatch ? verMatch[1] : null;
    }

    if (id === "cmake") {
        const out = await execText(exePath, ["--version"]);
        return out?.match(/cmake version\s+(\d+\.\d+\.\d+)/i)?.[1] ?? null;
    }

    if (id === "ninja") {
        const out = await execText(exePath, ["--version"]);
        return out?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
    }

    if (id === "python") {
        const out = await execText(exePath, ["--version"]);
        return out?.match(/Python\s+(\d+\.\d+\.\d+)/i)?.[1] ?? null;
    }

    if (id === "pyocd") {
        const out = await execText(exePath, ["--version"]);
        return out?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
    }

    if (id === "ffmpeg") {
        const out = await execText(exePath, ["-version"]);
        return out?.match(/ffmpeg version\s+([0-9]+(?:\.[0-9]+)+)/i)?.[1] ?? null;
    }

    const out = await execText(exePath, ["--version"]);
    return out?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function resolveBspToolchainRequirements(manifest: DigiwiseBspManifest): ToolchainRequirement[] {
    const reqs: ToolchainRequirement[] = [];
    const compilerId = manifest.toolchain.compiler.id as ToolchainToolId;
    if (TOOLCHAIN_CATALOG[compilerId]) {
        reqs.push({
            id: compilerId,
            category: "compiler",
            required: true,
            exactVersion: manifest.toolchain.compiler.version
        });
    }

    if (manifest.build.system === "cmake" || manifest.toolchain.cmake) {
        reqs.push({
            id: "cmake",
            category: "build-system",
            required: true,
            minVersion: manifest.toolchain.cmake?.minVersion || "3.20.0"
        });
    }

    if (
        (manifest.build.generator && manifest.build.generator.toLowerCase() === "ninja") ||
        manifest.toolchain.ninja
    ) {
        reqs.push({
            id: "ninja",
            category: "build-system",
            required: manifest.build.generator?.toLowerCase() === "ninja",
            minVersion: manifest.toolchain.ninja?.minVersion || "1.10.0"
        });
    }

    if (manifest.build.preConfigureScript || manifest.toolchain.python) {
        reqs.push({
            id: "python",
            category: "resource-tool",
            required: Boolean(manifest.build.preConfigureScript),
            minVersion: manifest.toolchain.python?.minVersion || "3.10.0"
        });
    }

    const probe = manifest.download.probe.toLowerCase();
    if (probe === "pyocd" || probe === "cmsis-dap") {
        reqs.push({ id: "pyocd", category: "flasher", required: true });
    } else if (probe === "jlink" || probe === "segger") {
        reqs.push({ id: "jlink", category: "flasher", required: true });
    }

    return reqs;
}

export async function scanInstalledToolchains(storeRoot: string): Promise<InstalledToolchainRecord[]> {
    const records: InstalledToolchainRecord[] = [];
    let toolDirs: fs.Dirent[];
    try {
        toolDirs = await fs.promises.readdir(storeRoot, { withFileTypes: true });
    } catch {
        return records;
    }
    for (const toolDir of toolDirs) {
        if (!toolDir.isDirectory() || toolDir.name.startsWith(".")) continue;
        const toolPath = path.join(storeRoot, toolDir.name);
        let verDirs: fs.Dirent[];
        try {
            verDirs = await fs.promises.readdir(toolPath, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const verDir of verDirs) {
            if (!verDir.isDirectory() || verDir.name.startsWith(".")) continue;
            const installPath = path.join(toolPath, verDir.name);
            const metaPath = path.join(installPath, META_FILENAME);
            try {
                const parsed = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
                if (parsed && typeof parsed.id === "string" && typeof parsed.version === "string") {
                    records.push({
                        ...parsed,
                        installPath,
                        binDir: parsed.binDir && fs.existsSync(parsed.binDir) ? parsed.binDir : installPath
                    });
                }
            } catch {
                // Ignore incomplete/corrupt folders.
            }
        }
    }
    return records;
}

/** Search a user-configured offline root (such as a local __ENV__ archive) up to depth 3 without hardcoding paths. */
function findExecutableInCustomRoot(rootDir: string, id: ToolchainToolId): string | null {
    if (!rootDir || !fs.existsSync(rootDir)) return null;
    const targetName = executableNameFor(id).toLowerCase();
    const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
    while (queue.length > 0) {
        const { dir, depth } = queue.shift()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isFile() && entry.name.toLowerCase() === targetName) {
                if (id === "jlink" && !isAuthenticSeggerJLinkExecutable(full)) {
                    continue;
                }
                return full;
            }
            if (entry.isDirectory() && depth < 3 && !entry.name.startsWith(".")) {
                queue.push({ dir: full, depth: depth + 1 });
            }
        }
    }
    return null;
}

function findExecutableInSystemPath(id: ToolchainToolId, systemPathEnv?: string): string | null {
    const rawPath = systemPathEnv ?? process.env.PATH ?? "";
    const targetName = executableNameFor(id);
    for (const dir of rawPath.split(path.delimiter)) {
        if (!dir) continue;
        const candidate = path.join(dir, targetName);
        if (fs.existsSync(candidate)) {
            if (id === "jlink" && !isAuthenticSeggerJLinkExecutable(candidate)) {
                // Skip Java JDK jlink.exe!
                continue;
            }
            return candidate;
        }
    }
    return null;
}

export async function inspectToolchainEnvironment(
    storeRoot: string,
    requirements: ToolchainRequirement[],
    options: {
        customEnvRoots?: string[];
        allowSystemPathFallback?: boolean;
        systemPathEnv?: string;
        bspMeta?: { bspId?: string; categoryCode?: string; bspVersion?: string };
    } = {}
): Promise<ToolchainEnvironmentReport> {
    const installedManaged = await scanInstalledToolchains(storeRoot);
    const customRoots = options.customEnvRoots || [];
    const allowSystemPath = options.allowSystemPathFallback !== false;

    const tools: ToolchainToolStatus[] = [];
    const resolvedExecutables: Partial<Record<ToolchainToolId, string>> = {};
    const envPathEntries: string[] = [];
    const blockingIssues: ToolchainEnvironmentReport["blockingIssues"] = [];

    for (const req of requirements) {
        const catalog = TOOLCHAIN_CATALOG[req.id];
        const expectedVersion = req.exactVersion
            ? req.exactVersion
            : req.minVersion
              ? `>=${req.minVersion}`
              : "any";

        let foundExe: string | null = null;
        let foundBinDir: string | null = null;
        let foundSource: ToolchainToolStatus["source"] = null;
        let detectedVersion: string | null = null;

        // 1. Prefer version-isolated managed toolchain in <storeRoot>/<id>/<version>
        const managedCandidates = installedManaged.filter(r => r.id === req.id);
        for (const rec of managedCandidates) {
            const exeCandidate = path.join(rec.binDir, executableNameFor(req.id));
            if (!fs.existsSync(exeCandidate)) continue;
            const probed = (await probeExecutableVersion(req.id, exeCandidate)) || rec.version;
            if (versionSatisfiesRequirement(probed, req)) {
                foundExe = exeCandidate;
                foundBinDir = rec.binDir;
                foundSource = "managed";
                detectedVersion = probed;
                break;
            }
        }

        // 2. Check user-configured custom offline environment roots (never hardcoded!)
        if (!foundExe) {
            for (const customRoot of customRoots) {
                const exeCandidate = findExecutableInCustomRoot(customRoot, req.id);
                if (!exeCandidate) continue;
                const probed = await probeExecutableVersion(req.id, exeCandidate);
                foundExe = exeCandidate;
                foundBinDir = path.dirname(exeCandidate);
                foundSource = "custom-root";
                detectedVersion = probed;
                if (versionSatisfiesRequirement(probed, req)) break;
            }
        }

        // 3. Optional fallback to system PATH (with strict SEGGER vs JDK jlink guard)
        if (!foundExe && allowSystemPath) {
            const exeCandidate = findExecutableInSystemPath(req.id, options.systemPathEnv);
            if (exeCandidate) {
                const probed = await probeExecutableVersion(req.id, exeCandidate);
                foundExe = exeCandidate;
                foundBinDir = path.dirname(exeCandidate);
                foundSource = "system-path";
                detectedVersion = probed;
            }
        }

        if (!foundExe) {
            const isVendor = catalog.redistribution === "vendor-installer-guided";
            const status: ToolchainToolStatus["status"] = isVendor ? "vendor-driver-required" : "missing";
            const message = isVendor
                ? `${catalog.displayName} is not installed (vendor installer/driver required).`
                : `${catalog.displayName} (${expectedVersion}) is missing.`;
            tools.push({
                id: req.id,
                displayName: catalog.displayName,
                category: req.category,
                required: req.required,
                expectedVersion,
                status,
                executablePath: null,
                binDir: null,
                detectedVersion: null,
                source: null,
                redistribution: catalog.redistribution,
                message,
                recoveryHint: catalog.recoveryHint
            });
            if (req.required) {
                blockingIssues.push({
                    toolId: req.id,
                    code: isVendor ? "VENDOR_INSTALLER_REQUIRED" : "TOOL_MISSING",
                    message,
                    recoveryHint: catalog.recoveryHint
                });
            }
            continue;
        }

        const versionOk = versionSatisfiesRequirement(detectedVersion, req);
        if (!versionOk) {
            const message = `${catalog.displayName} version mismatch: found ${detectedVersion || "unknown"}, expected ${expectedVersion}.`;
            tools.push({
                id: req.id,
                displayName: catalog.displayName,
                category: req.category,
                required: req.required,
                expectedVersion,
                status: "version-mismatch",
                executablePath: foundExe,
                binDir: foundBinDir,
                detectedVersion,
                source: foundSource,
                redistribution: catalog.redistribution,
                message,
                recoveryHint: catalog.recoveryHint
            });
            if (req.required) {
                blockingIssues.push({
                    toolId: req.id,
                    code: "TOOL_VERSION_MISMATCH",
                    message,
                    recoveryHint: catalog.recoveryHint
                });
            }
            continue;
        }

        resolvedExecutables[req.id] = foundExe;
        if (foundBinDir && !envPathEntries.includes(foundBinDir)) {
            envPathEntries.push(foundBinDir);
        }
        tools.push({
            id: req.id,
            displayName: catalog.displayName,
            category: req.category,
            required: req.required,
            expectedVersion,
            status: "ready",
            executablePath: foundExe,
            binDir: foundBinDir,
            detectedVersion,
            source: foundSource,
            redistribution: catalog.redistribution,
            message: `Ready (${detectedVersion || "ok"} via ${foundSource})`
        });
    }

    return {
        ready: blockingIssues.length === 0,
        hostOs: getHostOsTag(),
        bspId: options.bspMeta?.bspId,
        categoryCode: options.bspMeta?.categoryCode,
        bspVersion: options.bspMeta?.bspVersion,
        tools,
        resolvedExecutables,
        envPathEntries,
        blockingIssues,
        checkedAt: new Date().toISOString()
    };
}

/**
 * Build an isolated environment object for child build/download processes.
 * Prepends ONLY this BSP's resolved tool bin directories without mutating global system PATH.
 */
export function buildScopedToolchainEnv(
    report: Pick<ToolchainEnvironmentReport, "envPathEntries">,
    baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const existingPath = baseEnv.PATH || baseEnv.Path || "";
    const mergedPath = [...report.envPathEntries, existingPath].filter(Boolean).join(path.delimiter);
    const scoped: NodeJS.ProcessEnv = { ...baseEnv, PATH: mergedPath };
    if ("Path" in scoped) {
        scoped.Path = mergedPath;
    }
    return scoped;
}

export function cancelToolchainInstall(toolId: ToolchainToolId, version: string): boolean {
    const key = `${toolId}@${version}`;
    const ctrl = activeControllers.get(key);
    if (!ctrl) return false;
    ctrl.abort();
    activeControllers.delete(key);
    return true;
}

export async function installToolchainPackage(
    storeRoot: string,
    spec: ToolchainPackageSpec,
    onProgress: (progress: ToolchainPrepareProgress) => void,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal
): Promise<InstalledToolchainRecord> {
    if (!TOOLCHAIN_CATALOG[spec.id] || !isSafeSegment(spec.version)) {
        throw Object.assign(new Error("Invalid toolchain package specification"), {
            code: "INVALID_REQUEST",
            status: 422
        });
    }
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(spec.downloadUrl);
    } catch {
        throw Object.assign(new Error("Invalid toolchain download URL"), {
            code: "TOOLCHAIN_DOWNLOAD_FAILED",
            status: 502
        });
    }
    if (!isAllowedDownloadUrl(parsedUrl)) {
        throw Object.assign(new Error("Toolchain download URL must use HTTPS (or loopback HTTP)"), {
            code: "TOOLCHAIN_DOWNLOAD_FAILED",
            status: 502
        });
    }
    if (!Number.isSafeInteger(spec.fileSize) || spec.fileSize <= 0 || spec.fileSize > MAX_TOOLCHAIN_ARCHIVE_SIZE) {
        throw Object.assign(new Error("Toolchain archive size is invalid"), {
            code: "TOOLCHAIN_DOWNLOAD_FAILED",
            status: 422
        });
    }

    const tempId = randomUUID();
    const tempZip = path.join(storeRoot, `.tmp-${spec.id}-${tempId}.zip`);
    const stageDir = path.join(storeRoot, `.stage-${spec.id}-${tempId}`);
    const targetDir = path.join(storeRoot, spec.id, spec.version);

    try {
        onProgress({
            toolId: spec.id,
            version: spec.version,
            stage: "downloading",
            receivedBytes: 0,
            totalBytes: spec.fileSize
        });

        let response: Response;
        try {
            response = await fetchImpl(parsedUrl.toString(), {
                method: "GET",
                headers: { Accept: "application/zip, application/octet-stream" },
                signal
            });
        } catch (err: any) {
            if (signal?.aborted || err?.name === "AbortError") {
                onProgress({
                    toolId: spec.id,
                    version: spec.version,
                    stage: "cancelled",
                    receivedBytes: 0,
                    totalBytes: spec.fileSize
                });
                throw Object.assign(new Error("Toolchain download cancelled"), {
                    code: "TOOLCHAIN_DOWNLOAD_CANCELLED",
                    status: 499
                });
            }
            throw Object.assign(new Error("Toolchain download failed"), {
                code: "TOOLCHAIN_DOWNLOAD_FAILED",
                status: 502
            });
        }

        if (!response.ok) {
            throw Object.assign(new Error(`Toolchain download HTTP ${response.status}`), {
                code: "TOOLCHAIN_DOWNLOAD_FAILED",
                status: response.status
            });
        }

        await fs.promises.mkdir(storeRoot, { recursive: true });
        const hash = createHash("sha256");
        let received = 0;
        const handle = await fs.promises.open(tempZip, "w");
        try {
            if (response.body && typeof response.body.getReader === "function") {
                const reader = response.body.getReader();
                while (true) {
                    if (signal?.aborted) {
                        await reader.cancel().catch(() => undefined);
                        throw Object.assign(new Error("Toolchain download cancelled"), {
                            code: "TOOLCHAIN_DOWNLOAD_CANCELLED",
                            status: 499
                        });
                    }
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!value || value.byteLength === 0) continue;
                    received += value.byteLength;
                    if (received > spec.fileSize) {
                        await reader.cancel().catch(() => undefined);
                        throw Object.assign(new Error("Toolchain archive size exceeds metadata"), {
                            code: "TOOLCHAIN_INTEGRITY_FAILED",
                            status: 502
                        });
                    }
                    const buf = Buffer.from(value);
                    hash.update(buf);
                    await handle.write(buf);
                    onProgress({
                        toolId: spec.id,
                        version: spec.version,
                        stage: "downloading",
                        receivedBytes: received,
                        totalBytes: spec.fileSize
                    });
                }
            } else {
                const buf = Buffer.from(await response.arrayBuffer());
                received = buf.byteLength;
                hash.update(buf);
                await handle.write(buf);
            }
        } finally {
            await handle.close();
        }

        onProgress({
            toolId: spec.id,
            version: spec.version,
            stage: "verifying",
            receivedBytes: received,
            totalBytes: spec.fileSize
        });

        const actualSha = hash.digest("hex");
        if (received !== spec.fileSize || actualSha !== spec.sha256.toLowerCase()) {
            throw Object.assign(new Error("Toolchain archive SHA-256 or size verification failed"), {
                code: "TOOLCHAIN_INTEGRITY_FAILED",
                status: 502
            });
        }

        onProgress({
            toolId: spec.id,
            version: spec.version,
            stage: "extracting",
            receivedBytes: received,
            totalBytes: spec.fileSize
        });

        await fs.promises.mkdir(stageDir, { recursive: true });
        const { default: AdmZip } = await import("adm-zip");
        const zip = new AdmZip(tempZip);
        const entries = zip.getEntries();
        if (!entries.length || entries.length > MAX_TOOLCHAIN_ENTRIES) {
            throw Object.assign(new Error("Toolchain archive entry count invalid"), {
                code: "TOOLCHAIN_ARCHIVE_INVALID",
                status: 422
            });
        }
        let expanded = 0;
        for (const entry of entries) {
            const dest = validateZipEntryPath(entry.entryName, stageDir);
            const unixMode = (entry.attr >>> 16) & 0xffff;
            if ((unixMode & 0o170000) === 0o120000 || entry.header.encrypted) {
                throw Object.assign(new Error("Toolchain archive contains unsupported entry"), {
                    code: "TOOLCHAIN_ARCHIVE_INVALID",
                    status: 422
                });
            }
            if (entry.isDirectory) {
                await fs.promises.mkdir(dest, { recursive: true });
                continue;
            }
            expanded += entry.header.size;
            if (expanded > MAX_TOOLCHAIN_EXPANDED_SIZE) {
                throw Object.assign(new Error("Toolchain archive expands beyond safety limit"), {
                    code: "TOOLCHAIN_ARCHIVE_INVALID",
                    status: 422
                });
            }
            await fs.promises.mkdir(path.dirname(dest), { recursive: true });
            await fs.promises.writeFile(dest, entry.getData(), { flag: "wx" });
        }

        const relBin = spec.binRelativeDir && spec.binRelativeDir !== "." ? spec.binRelativeDir : "";
        const binDir = relBin ? path.join(targetDir, relBin) : targetDir;
        const record: InstalledToolchainRecord = {
            id: spec.id,
            version: spec.version,
            sha256: spec.sha256.toLowerCase(),
            fileSize: spec.fileSize,
            installPath: targetDir,
            binDir,
            installedAt: new Date().toISOString()
        };
        await fs.promises.writeFile(path.join(stageDir, META_FILENAME), JSON.stringify(record, null, 2), "utf8");

        await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
        await fs.promises.rm(targetDir, { recursive: true, force: true });
        await fs.promises.rename(stageDir, targetDir);

        onProgress({
            toolId: spec.id,
            version: spec.version,
            stage: "ready",
            receivedBytes: spec.fileSize,
            totalBytes: spec.fileSize
        });
        return record;
    } finally {
        await fs.promises.rm(tempZip, { force: true }).catch(() => undefined);
        await fs.promises.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

export async function removeToolchainPackage(
    storeRoot: string,
    id: ToolchainToolId,
    version: string
): Promise<void> {
    if (!TOOLCHAIN_CATALOG[id] || !isSafeSegment(version)) {
        throw Object.assign(new Error("Invalid toolchain identifier"), {
            code: "INVALID_REQUEST",
            status: 422
        });
    }
    await fs.promises.rm(path.join(storeRoot, id, version), { recursive: true, force: true });
}

async function loadConfig(): Promise<ToolchainManagerConfig> {
    try {
        const parsed = JSON.parse(await fs.promises.readFile(toolchainConfigPath(), "utf8"));
        if (parsed && Array.isArray(parsed.customEnvRoots)) {
            return {
                customEnvRoots: parsed.customEnvRoots.filter((r: unknown) => typeof r === "string" && r.trim())
            };
        }
    } catch {
        // Default empty config
    }
    return { customEnvRoots: [] };
}

async function saveConfig(config: ToolchainManagerConfig): Promise<void> {
    await fs.promises.mkdir(path.dirname(toolchainConfigPath()), { recursive: true });
    await fs.promises.writeFile(toolchainConfigPath(), JSON.stringify(config, null, 2), "utf8");
}

export function registerDigiwiseToolchainIpc(
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
            throw new Error("Unauthorized toolchain request");
        }
    };

    const { ipcMain } = electron;

    ipcMain.handle(
        "digistudio:toolchain:get-config",
        async (event): Promise<DigiwiseIpcResult<ToolchainManagerConfig>> => {
            checkSender(event);
            return { ok: true, data: await loadConfig() };
        }
    );

    ipcMain.handle(
        "digistudio:toolchain:set-custom-roots",
        async (event, roots: unknown): Promise<DigiwiseIpcResult<ToolchainManagerConfig>> => {
            checkSender(event);
            if (!Array.isArray(roots) || !roots.every(r => typeof r === "string")) {
                return {
                    ok: false,
                    error: { status: 422, code: "INVALID_REQUEST", message: "customEnvRoots must be string[]", requestId: "toolchain-config" }
                };
            }
            const next: ToolchainManagerConfig = {
                customEnvRoots: roots.map(r => r.trim()).filter(Boolean)
            };
            await saveConfig(next);
            return { ok: true, data: next };
        }
    );

    ipcMain.handle(
        "digistudio:toolchain:inspect",
        async (event, manifest: unknown): Promise<DigiwiseIpcResult<ToolchainEnvironmentReport>> => {
            checkSender(event);
            try {
                const cfg = await loadConfig();
                const reqs = resolveBspToolchainRequirements(manifest as DigiwiseBspManifest);
                const bsp = (manifest as DigiwiseBspManifest)?.bsp;
                const report = await inspectToolchainEnvironment(toolchainStoreRoot(), reqs, {
                    customEnvRoots: mergeToolchainEnvRoots(cfg.customEnvRoots),
                    bspMeta: bsp
                        ? { bspId: bsp.id, categoryCode: bsp.categoryCode, bspVersion: bsp.version }
                        : undefined
                });
                return { ok: true, data: report };
            } catch (error: any) {
                return {
                    ok: false,
                    error: {
                        status: 422,
                        code: error?.code || "TOOLCHAIN_INSPECT_FAILED",
                        message: error?.message || "Failed to inspect toolchain environment",
                        requestId: "toolchain-inspect"
                    }
                };
            }
        }
    );

    ipcMain.handle(
        "digistudio:toolchain:install",
        async (event, spec: unknown): Promise<DigiwiseIpcResult<InstalledToolchainRecord>> => {
            checkSender(event);
            const pkg = spec as ToolchainPackageSpec;
            const key = `${pkg?.id}@${pkg?.version}`;
            const ctrl = new AbortController();
            activeControllers.set(key, ctrl);
            const emitProgress = (progress: ToolchainPrepareProgress) => {
                const win = resolveWindow();
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(PROGRESS_CHANNEL, progress);
                }
            };
            try {
                const record = await installToolchainPackage(
                    toolchainStoreRoot(),
                    pkg,
                    emitProgress,
                    fetch,
                    ctrl.signal
                );
                return { ok: true, data: record };
            } catch (error: any) {
                return {
                    ok: false,
                    error: {
                        status: typeof error?.status === "number" ? error.status : 502,
                        code: error?.code || "TOOLCHAIN_INSTALL_FAILED",
                        message: error?.message || "Toolchain installation failed",
                        requestId: "toolchain-install"
                    }
                };
            } finally {
                if (activeControllers.get(key) === ctrl) {
                    activeControllers.delete(key);
                }
            }
        }
    );

    ipcMain.handle(
        "digistudio:toolchain:cancel",
        async (event, id: unknown, version: unknown): Promise<DigiwiseIpcResult<{ cancelled: boolean }>> => {
            checkSender(event);
            return {
                ok: true,
                data: { cancelled: cancelToolchainInstall(id as ToolchainToolId, String(version || "")) }
            };
        }
    );

    ipcMain.handle(
        "digistudio:toolchain:remove",
        async (event, id: unknown, version: unknown): Promise<DigiwiseIpcResult<{ removed: true }>> => {
            checkSender(event);
            try {
                await removeToolchainPackage(toolchainStoreRoot(), id as ToolchainToolId, String(version || ""));
                return { ok: true, data: { removed: true } };
            } catch (error: any) {
                return {
                    ok: false,
                    error: {
                        status: 422,
                        code: error?.code || "INVALID_REQUEST",
                        message: error?.message || "Failed to remove toolchain",
                        requestId: "toolchain-remove"
                    }
                };
            }
        }
    );
}
