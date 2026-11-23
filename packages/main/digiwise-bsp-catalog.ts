import electron from "electron";
import type { BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { callDigiwisePublicApiWithSession, getDigiwiseAuthGuard } from "main/digiwise-auth";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import {
    validateBspManifest,
    type DigiwiseBspBuildGateResult,
    type DigiwiseBspDownloadMeta,
    type DigiwiseBspDownloadProgress,
    type DigiwiseBspManifest,
    type DigiwiseInstalledBspRecord,
    type DigiwiseProjectBspBinding
} from "eez-studio-shared/digiwise-bsp-catalog";

const MAX_BSP_FILE_SIZE = 500 * 1024 * 1024;
const MAX_BSP_ARCHIVE_ENTRIES = 20_000;
const MAX_BSP_ARCHIVE_EXPANDED_SIZE = 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const PROGRESS_CHANNEL = "digistudio:bsp:download-progress";
const META_FILENAME = "bsp-install-meta.json";
const MANIFEST_FILENAME = "bsp-manifest.json";

let registered = false;
const activeDownloadControllers = new Map<number, AbortController>();

function isSafeSegment(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function isAllowedDownloadUrl(url: URL): boolean {
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    // Allow plain HTTP only for local loopback development servers.
    return (
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")
    );
}

function bspStoreRoot(): string {
    return path.join(electron.app.getPath("userData"), "bsp-store");
}

function validateZipEntryPath(entryName: string, stageDir: string): string {
    const normalized = entryName.replace(/\\/g, "/");
    if (
        !normalized ||
        normalized.startsWith("/") ||
        /^[a-zA-Z]:/.test(normalized) ||
        normalized.includes("\0")
    ) {
        throw new Error("BSP_ARCHIVE_INVALID");
    }
    const segments = normalized.split("/").filter(Boolean);
    if (segments.some(seg => seg === "." || seg === ".." || /[<>:"|?*\x00-\x1f]/.test(seg))) {
        throw new Error("BSP_ARCHIVE_INVALID");
    }
    const destination = path.resolve(stageDir, segments.join(path.sep));
    if (destination !== stageDir && !destination.startsWith(stageDir + path.sep)) {
        throw new Error("BSP_ARCHIVE_INVALID");
    }
    return destination;
}

function makeCancelledError(): Error {
    return Object.assign(new Error("BSP download was cancelled"), {
        code: "BSP_DOWNLOAD_CANCELLED",
        status: 499
    });
}

export function cancelBspDownload(bspId: number): boolean {
    const controller = activeDownloadControllers.get(bspId);
    if (!controller) return false;
    controller.abort();
    activeDownloadControllers.delete(bspId);
    return true;
}

export async function downloadAndVerifyBspArchive(
    meta: DigiwiseBspDownloadMeta,
    tempFilePath: string,
    onProgress: (progress: DigiwiseBspDownloadProgress) => void,
    bspId: number,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal
): Promise<void> {
    if (signal?.aborted) {
        onProgress({ bspId, stage: "cancelled", receivedBytes: 0, totalBytes: meta.fileSize });
        throw makeCancelledError();
    }

    let currentUrl: URL;
    try {
        currentUrl = new URL(meta.downloadUrl);
    } catch {
        throw Object.assign(new Error("Invalid BSP download URL"), {
            code: "BSP_DOWNLOAD_FAILED",
            status: 502
        });
    }

    let response: Response | undefined;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
        if (signal?.aborted) {
            onProgress({ bspId, stage: "cancelled", receivedBytes: 0, totalBytes: meta.fileSize });
            throw makeCancelledError();
        }
        if (!isAllowedDownloadUrl(currentUrl)) {
            throw Object.assign(
                new Error("BSP download URL must use HTTPS (or loopback HTTP for local development)"),
                { code: "BSP_DOWNLOAD_FAILED", status: 502 }
            );
        }
        try {
            response = await fetchImpl(currentUrl.toString(), {
                method: "GET",
                headers: { Accept: "application/zip, application/octet-stream" },
                redirect: "manual",
                signal
            });
        } catch (err: any) {
            if (signal?.aborted || err?.name === "AbortError") {
                onProgress({ bspId, stage: "cancelled", receivedBytes: 0, totalBytes: meta.fileSize });
                throw makeCancelledError();
            }
            throw Object.assign(new Error("BSP file could not be downloaded"), {
                code: "BSP_DOWNLOAD_FAILED",
                status: 502
            });
        }
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location || redirectCount === 3) {
            throw Object.assign(new Error("BSP download redirect is invalid"), {
                code: "BSP_DOWNLOAD_FAILED",
                status: 502
            });
        }
        try {
            currentUrl = new URL(location, currentUrl);
        } catch {
            throw Object.assign(new Error("BSP download redirect is invalid"), {
                code: "BSP_DOWNLOAD_FAILED",
                status: 502
            });
        }
    }

    if (!response || !response.ok) {
        throw Object.assign(new Error("BSP file download failed"), {
            code: response?.status === 403 ? "ACCESS_DENIED" : "BSP_DOWNLOAD_FAILED",
            status: response?.status || 502
        });
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BSP_FILE_SIZE) {
        throw Object.assign(new Error("BSP file exceeds allowed size"), {
            code: "BSP_FILE_TOO_LARGE",
            status: 413
        });
    }

    await fs.promises.mkdir(path.dirname(tempFilePath), { recursive: true });
    const hash = createHash("sha256");
    let received = 0;
    onProgress({ bspId, stage: "downloading", receivedBytes: 0, totalBytes: meta.fileSize });

    const handle = await fs.promises.open(tempFilePath, "w");
    try {
        if (response.body && typeof response.body.getReader === "function") {
            const reader = response.body.getReader();
            try {
                while (true) {
                    if (signal?.aborted) {
                        await reader.cancel().catch(() => undefined);
                        onProgress({ bspId, stage: "cancelled", receivedBytes: received, totalBytes: meta.fileSize });
                        throw makeCancelledError();
                    }
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!value || value.byteLength === 0) continue;
                    received += value.byteLength;
                    if (received > MAX_BSP_FILE_SIZE || received > meta.fileSize) {
                        await reader.cancel().catch(() => undefined);
                        throw Object.assign(new Error("BSP file size exceeds declared metadata"), {
                            code: "BSP_FILE_INTEGRITY_FAILED",
                            status: 502
                        });
                    }
                    const buf = Buffer.from(value);
                    hash.update(buf);
                    await handle.write(buf);
                    onProgress({ bspId, stage: "downloading", receivedBytes: received, totalBytes: meta.fileSize });
                }
            } catch (err: any) {
                if (signal?.aborted || err?.name === "AbortError" || err?.code === "BSP_DOWNLOAD_CANCELLED") {
                    onProgress({ bspId, stage: "cancelled", receivedBytes: received, totalBytes: meta.fileSize });
                    throw makeCancelledError();
                }
                if (err && typeof err.code === "string") throw err;
                throw Object.assign(new Error("BSP download stream was interrupted"), {
                    code: "BSP_DOWNLOAD_FAILED",
                    status: 502
                });
            }
        } else {
            const ab = await response.arrayBuffer();
            if (signal?.aborted) {
                onProgress({ bspId, stage: "cancelled", receivedBytes: 0, totalBytes: meta.fileSize });
                throw makeCancelledError();
            }
            const buf = Buffer.from(ab);
            received = buf.byteLength;
            if (received > MAX_BSP_FILE_SIZE || received > meta.fileSize) {
                throw Object.assign(new Error("BSP file size exceeds declared metadata"), {
                    code: "BSP_FILE_INTEGRITY_FAILED",
                    status: 502
                });
            }
            hash.update(buf);
            await handle.write(buf);
            onProgress({ bspId, stage: "downloading", receivedBytes: received, totalBytes: meta.fileSize });
        }
    } finally {
        await handle.close();
    }

    onProgress({ bspId, stage: "verifying", receivedBytes: received, totalBytes: meta.fileSize });
    const actualSha256 = hash.digest("hex");
    if (received !== meta.fileSize || actualSha256 !== meta.sha256.toLowerCase()) {
        throw Object.assign(new Error("BSP file size or SHA-256 verification failed"), {
            code: "BSP_FILE_INTEGRITY_FAILED",
            status: 502
        });
    }
}

export async function extractVerifiedBspArchive(zipFilePath: string, stageDir: string): Promise<void> {
    const { default: AdmZip } = await import("adm-zip");
    let zip: InstanceType<typeof AdmZip>;
    try {
        zip = new AdmZip(zipFilePath);
    } catch {
        throw Object.assign(new Error("BSP archive is not a valid ZIP"), {
            code: "BSP_ARCHIVE_INVALID",
            status: 422
        });
    }
    const entries = zip.getEntries();
    if (!entries.length || entries.length > MAX_BSP_ARCHIVE_ENTRIES) {
        throw Object.assign(new Error("BSP archive entry count is invalid"), {
            code: "BSP_ARCHIVE_INVALID",
            status: 422
        });
    }
    let expandedSize = 0;
    for (const entry of entries) {
        let destination: string;
        try {
            destination = validateZipEntryPath(entry.entryName, stageDir);
        } catch {
            throw Object.assign(new Error("BSP archive contains an unsafe path"), {
                code: "BSP_ARCHIVE_INVALID",
                status: 422
            });
        }
        const unixMode = (entry.attr >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) {
            throw Object.assign(new Error("BSP archive must not contain symbolic links"), {
                code: "BSP_ARCHIVE_INVALID",
                status: 422
            });
        }
        if (entry.header.encrypted) {
            throw Object.assign(new Error("Encrypted BSP archives are not supported"), {
                code: "BSP_ARCHIVE_INVALID",
                status: 422
            });
        }
        if (entry.isDirectory) {
            await fs.promises.mkdir(destination, { recursive: true });
            continue;
        }
        const declaredSize = entry.header.size;
        if (
            !Number.isSafeInteger(declaredSize) ||
            declaredSize < 0 ||
            expandedSize + declaredSize > MAX_BSP_ARCHIVE_EXPANDED_SIZE
        ) {
            throw Object.assign(new Error("BSP archive expands beyond allowed size"), {
                code: "BSP_ARCHIVE_INVALID",
                status: 422
            });
        }
        expandedSize += declaredSize;
        const data = entry.getData();
        if (data.length !== declaredSize) {
            throw Object.assign(new Error("BSP archive contains a corrupted entry"), {
                code: "BSP_ARCHIVE_INVALID",
                status: 422
            });
        }
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.writeFile(destination, data, { flag: "wx" });
    }
}

export async function readAndValidateInstalledManifest(
    bspDir: string,
    expected?: { categoryCode?: string; version?: string }
): Promise<DigiwiseBspManifest | null> {
    const manifestPath = path.join(bspDir, MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) {
        return null;
    }
    const stat = await fs.promises.stat(manifestPath);
    if (stat.size > MAX_MANIFEST_BYTES) {
        throw Object.assign(new Error("bsp-manifest.json exceeds maximum allowed size"), {
            code: "BSP_MANIFEST_INVALID",
            status: 422
        });
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    } catch {
        throw Object.assign(new Error("bsp-manifest.json is not valid JSON"), {
            code: "BSP_MANIFEST_INVALID",
            status: 422
        });
    }
    const result = validateBspManifest(parsed, expected);
    if (!result.ok) {
        throw Object.assign(new Error(`Invalid bsp-manifest.json: ${result.errors.join("; ")}`), {
            code: "BSP_MANIFEST_INVALID",
            status: 422
        });
    }
    return result.manifest;
}

export async function installVerifiedBsp(
    storeRoot: string,
    bspId: number,
    meta: DigiwiseBspDownloadMeta,
    onProgress: (progress: DigiwiseBspDownloadProgress) => void,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal
): Promise<DigiwiseInstalledBspRecord> {
    if (!isSafeSegment(meta.categoryCode) || !isSafeSegment(meta.version)) {
        throw Object.assign(new Error("Invalid BSP category or version"), {
            code: "INVALID_REQUEST",
            status: 422
        });
    }
    const tempId = randomUUID();
    const tempZip = path.join(storeRoot, `.tmp-${tempId}.zip`);
    const stageDir = path.join(storeRoot, `.stage-${tempId}`);
    const targetDir = path.join(storeRoot, meta.categoryCode, meta.version);

    try {
        await downloadAndVerifyBspArchive(meta, tempZip, onProgress, bspId, fetchImpl, signal);
        onProgress({ bspId, stage: "extracting", receivedBytes: meta.fileSize, totalBytes: meta.fileSize });
        await fs.promises.mkdir(stageDir, { recursive: true });
        await extractVerifiedBspArchive(tempZip, stageDir);

        const manifest = await readAndValidateInstalledManifest(stageDir, {
            categoryCode: meta.categoryCode,
            version: meta.version
        });

        const record: DigiwiseInstalledBspRecord = {
            bspId: meta.bspId ?? bspId,
            modelId: meta.modelId ?? 0,
            modelCode: meta.modelCode,
            categoryCode: meta.categoryCode,
            version: meta.version,
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            sha256: meta.sha256.toLowerCase(),
            installPath: targetDir,
            installedAt: new Date().toISOString(),
            manifest
        };
        await fs.promises.writeFile(
            path.join(stageDir, META_FILENAME),
            JSON.stringify(record, null, 2),
            "utf8"
        );

        await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
        await fs.promises.rm(targetDir, { recursive: true, force: true });
        await fs.promises.rename(stageDir, targetDir);
        onProgress({ bspId, stage: "completed", receivedBytes: meta.fileSize, totalBytes: meta.fileSize });
        return record;
    } finally {
        await fs.promises.rm(tempZip, { force: true }).catch(() => undefined);
        await fs.promises.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

export async function scanInstalledBsps(storeRoot: string): Promise<DigiwiseInstalledBspRecord[]> {
    const records: DigiwiseInstalledBspRecord[] = [];
    let categories: fs.Dirent[];
    try {
        categories = await fs.promises.readdir(storeRoot, { withFileTypes: true });
    } catch {
        return records;
    }
    for (const cat of categories) {
        if (!cat.isDirectory() || cat.name.startsWith(".")) continue;
        const catDir = path.join(storeRoot, cat.name);
        let versions: fs.Dirent[];
        try {
            versions = await fs.promises.readdir(catDir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const ver of versions) {
            if (!ver.isDirectory() || ver.name.startsWith(".")) continue;
            const installDir = path.join(catDir, ver.name);
            const metaPath = path.join(installDir, META_FILENAME);
            try {
                const parsed = JSON.parse(await fs.promises.readFile(metaPath, "utf8"));
                if (
                    parsed &&
                    typeof parsed.categoryCode === "string" &&
                    typeof parsed.version === "string" &&
                    typeof parsed.sha256 === "string"
                ) {
                    records.push({ ...parsed, installPath: installDir });
                }
            } catch {
                // Ignore incomplete/corrupt directories.
            }
        }
    }
    return records;
}

/**
 * Online authorization gate required before Build:
 * Local cached BSP files MUST NOT bypass current online authorization or unpublish status.
 */
export async function verifyBspBuildAccess(
    storeRoot: string,
    binding: DigiwiseProjectBspBinding,
    listAuthorizedVersions: (categoryCode: string) => Promise<
        Array<{ id: number; categoryCode: string; version: string; sha256: string }>
    >
): Promise<DigiwiseBspBuildGateResult> {
    if (
        !binding ||
        !Number.isSafeInteger(binding.bspId) ||
        binding.bspId <= 0 ||
        !isSafeSegment(binding.categoryCode) ||
        !isSafeSegment(binding.version) ||
        typeof binding.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/i.test(binding.sha256)
    ) {
        throw Object.assign(new Error("Invalid project BSP binding"), {
            code: "INVALID_REQUEST",
            status: 422
        });
    }

    const authorizedList = await listAuthorizedVersions(binding.categoryCode);
    const match = authorizedList.find(
        item =>
            item.id === binding.bspId &&
            item.categoryCode === binding.categoryCode &&
            item.version === binding.version &&
            item.sha256.toLowerCase() === binding.sha256.toLowerCase()
    );
    if (!match) {
        throw Object.assign(
            new Error("Bound BSP is no longer authorized, published, or digest-matched on the server"),
            { code: "BSP_NOT_AUTHORIZED", status: 403 }
        );
    }

    const installedList = await scanInstalledBsps(storeRoot);
    const installed = installedList.find(
        item =>
            item.categoryCode === binding.categoryCode &&
            item.version === binding.version &&
            item.sha256.toLowerCase() === binding.sha256.toLowerCase()
    );
    if (!installed) {
        throw Object.assign(new Error("Bound BSP is not installed locally; please re-download"), {
            code: "BSP_NOT_INSTALLED",
            status: 404
        });
    }

    const manifest = await readAndValidateInstalledManifest(installed.installPath, {
        categoryCode: installed.categoryCode,
        version: installed.version
    });

    return {
        authorized: true,
        installed: { ...installed, manifest },
        manifest,
        checkedAt: new Date().toISOString()
    };
}

export function registerDigiwiseBspCatalogIpc(
    windowOrResolver: BrowserWindow | (() => BrowserWindow)
) {
    if (registered) return;
    registered = true;
    const resolveWindow = () =>
        typeof windowOrResolver === "function" ? windowOrResolver() : windowOrResolver;

    const checkSender = (event: Electron.IpcMainInvokeEvent) => {
        const window = resolveWindow();
        if (
            window.isDestroyed() ||
            window.webContents.isDestroyed() ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame
        ) {
            throw new Error("Unauthorized BSP catalog request");
        }
    };
    const current = async <T>(
        operation: () => Promise<DigiwiseIpcResult<T>>
    ): Promise<DigiwiseIpcResult<T>> => {
        const initialGuard = getDigiwiseAuthGuard();
        const generation = initialGuard.generation;
        const result = await operation();
        const finalGuard = getDigiwiseAuthGuard();
        if (!initialGuard.authenticated || !finalGuard.authenticated || finalGuard.generation !== generation) {
            return {
                ok: false,
                error: {
                    status: 401,
                    code: "AUTH_REQUIRED",
                    message: "Session changed",
                    requestId: "session-changed"
                }
            };
        }
        return result;
    };

    const { ipcMain } = electron;
    ipcMain.handle("digistudio:bsp:categories", event => {
        checkSender(event);
        return current(() => callDigiwisePublicApiWithSession((api, token) => api.listCategories(token)));
    });
    ipcMain.handle("digistudio:bsp:versions", (event, categoryCode: unknown) => {
        checkSender(event);
        return current(() =>
            callDigiwisePublicApiWithSession((api, token) =>
                api.listBspVersions(token, categoryCode as string | undefined)
            )
        );
    });
    ipcMain.handle("digistudio:bsp:installed", async event => {
        checkSender(event);
        const guard = getDigiwiseAuthGuard();
        if (!guard.authenticated) {
            return {
                ok: false,
                error: { status: 401, code: "AUTH_REQUIRED", message: "Sign in required", requestId: "local-auth" }
            };
        }
        const items = await scanInstalledBsps(bspStoreRoot());
        return { ok: true, data: items };
    });
    ipcMain.handle(
        "digistudio:bsp:download",
        async (event, bspId: unknown): Promise<DigiwiseIpcResult<DigiwiseInstalledBspRecord>> => {
            checkSender(event);
            if (typeof bspId !== "number" || !Number.isSafeInteger(bspId) || bspId <= 0) {
                return {
                    ok: false,
                    error: {
                        status: 422,
                        code: "INVALID_REQUEST",
                        message: "Invalid BSP id",
                        requestId: "local-validation"
                    }
                };
            }
            const initialGuard = getDigiwiseAuthGuard();
            if (!initialGuard.authenticated) {
                return {
                    ok: false,
                    error: { status: 401, code: "AUTH_REQUIRED", message: "Sign in required", requestId: "local-auth" }
                };
            }
            const emitProgress = (progress: DigiwiseBspDownloadProgress) => {
                const win = resolveWindow();
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(PROGRESS_CHANNEL, progress);
                }
            };
            const controller = new AbortController();
            activeDownloadControllers.set(bspId, controller);
            emitProgress({ bspId, stage: "requesting", receivedBytes: 0, totalBytes: 0 });
            try {
                const metaResult = await callDigiwisePublicApiWithSession((api, token) =>
                    api.prepareBspDownload(token, bspId)
                );
                const afterMetaGuard = getDigiwiseAuthGuard();
                if (!afterMetaGuard.authenticated || afterMetaGuard.generation !== initialGuard.generation) {
                    return {
                        ok: false,
                        error: {
                            status: 401,
                            code: "AUTH_REQUIRED",
                            message: "Session changed",
                            requestId: "session-changed"
                        }
                    };
                }
                if (!metaResult.ok) {
                    return metaResult;
                }
                const installed = await installVerifiedBsp(
                    bspStoreRoot(),
                    bspId,
                    metaResult.data,
                    emitProgress,
                    fetch,
                    controller.signal
                );
                const afterInstallGuard = getDigiwiseAuthGuard();
                if (!afterInstallGuard.authenticated || afterInstallGuard.generation !== initialGuard.generation) {
                    await fs.promises.rm(installed.installPath, { recursive: true, force: true }).catch(() => undefined);
                    return {
                        ok: false,
                        error: {
                            status: 401,
                            code: "AUTH_REQUIRED",
                            message: "Session changed during BSP download",
                            requestId: "session-changed"
                        }
                    };
                }
                return { ok: true, data: installed };
            } catch (error: any) {
                return {
                    ok: false,
                    error: {
                        status: typeof error?.status === "number" ? error.status : 502,
                        code: typeof error?.code === "string" ? error.code : "BSP_DOWNLOAD_FAILED",
                        message: typeof error?.message === "string" ? error.message : "BSP download failed",
                        requestId: "bsp-download"
                    }
                };
            } finally {
                if (activeDownloadControllers.get(bspId) === controller) {
                    activeDownloadControllers.delete(bspId);
                }
            }
        }
    );
    ipcMain.handle(
        "digistudio:bsp:cancel",
        async (event, bspId: unknown): Promise<DigiwiseIpcResult<{ cancelled: boolean }>> => {
            checkSender(event);
            if (typeof bspId !== "number" || !Number.isSafeInteger(bspId) || bspId <= 0) {
                return {
                    ok: false,
                    error: { status: 422, code: "INVALID_REQUEST", message: "Invalid BSP id", requestId: "local-validation" }
                };
            }
            return { ok: true, data: { cancelled: cancelBspDownload(bspId) } };
        }
    );
    ipcMain.handle(
        "digistudio:bsp:remove",
        async (event, categoryCode: unknown, version: unknown): Promise<DigiwiseIpcResult<{ removed: true }>> => {
            checkSender(event);
            const guard = getDigiwiseAuthGuard();
            if (!guard.authenticated) {
                return {
                    ok: false,
                    error: { status: 401, code: "AUTH_REQUIRED", message: "Sign in required", requestId: "local-auth" }
                };
            }
            if (!isSafeSegment(categoryCode) || !isSafeSegment(version)) {
                return {
                    ok: false,
                    error: {
                        status: 422,
                        code: "INVALID_REQUEST",
                        message: "Invalid BSP identifier",
                        requestId: "local-validation"
                    }
                };
            }
            const targetDir = path.join(bspStoreRoot(), categoryCode, version);
            await fs.promises.rm(targetDir, { recursive: true, force: true });
            return { ok: true, data: { removed: true } };
        }
    );
    ipcMain.handle(
        "digistudio:bsp:verify-build-access",
        async (event, binding: unknown): Promise<DigiwiseIpcResult<DigiwiseBspBuildGateResult>> => {
            checkSender(event);
            const initialGuard = getDigiwiseAuthGuard();
            if (!initialGuard.authenticated) {
                return {
                    ok: false,
                    error: { status: 401, code: "AUTH_REQUIRED", message: "Sign in required", requestId: "local-auth" }
                };
            }
            try {
                const result = await verifyBspBuildAccess(
                    bspStoreRoot(),
                    binding as DigiwiseProjectBspBinding,
                    async categoryCode => {
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
                    }
                );
                const finalGuard = getDigiwiseAuthGuard();
                if (!finalGuard.authenticated || finalGuard.generation !== initialGuard.generation) {
                    return {
                        ok: false,
                        error: {
                            status: 401,
                            code: "AUTH_REQUIRED",
                            message: "Session changed",
                            requestId: "session-changed"
                        }
                    };
                }
                return { ok: true, data: result };
            } catch (error: any) {
                return {
                    ok: false,
                    error: {
                        status: typeof error?.status === "number" ? error.status : 403,
                        code: typeof error?.code === "string" ? error.code : "BSP_NOT_AUTHORIZED",
                        message: typeof error?.message === "string" ? error.message : "BSP build authorization failed",
                        requestId: "bsp-build-gate"
                    }
                };
            }
        }
    );
}
