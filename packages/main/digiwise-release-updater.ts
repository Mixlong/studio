import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

import {
    callDigiwisePublicApiWithSession,
    getDigiwiseAuthGuard,
    getDigiwiseDownloadUrlPolicy,
    onDigiwiseAuthSessionChanged
} from "./digiwise-auth";
import { compareSemVer, readUpdateReleaseIdentity } from "./update-discovery";
import { serveAuthorizedUpdate, AuthorizedUpdateFeed } from "./digiwise-update-feed";
import {
    IdeRelease,
    validateReleaseCheck,
    validateReleaseDownload
} from "./digiwise-update-policy";

type Platform = "win32" | "darwin";
type Arch = "x64" | "arm64";
type EventType = "install_success" | "install_error";

interface ActiveUpdate {
    release: IdeRelease;
    generation: number;
    userId: string;
    fromVersion: string;
    forceUpdate: boolean;
    downloaded: boolean;
    feed: AuthorizedUpdateFeed;
}

interface PendingInstallation {
    releaseId: string;
    version: string;
    fromVersion: string;
    userId: string;
    platform: Platform;
    arch: Arch;
    clientId: string;
    createdAt: number;
}

function isPending(value: unknown): value is PendingInstallation {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<PendingInstallation>;
    return (
        typeof item.releaseId === "string" &&
        /^[1-9][0-9]{0,18}$/.test(item.releaseId) &&
        typeof item.version === "string" &&
        typeof item.fromVersion === "string" &&
        typeof item.userId === "string" &&
        (item.platform === "win32" || item.platform === "darwin") &&
        (item.arch === "x64" || item.arch === "arm64") &&
        typeof item.clientId === "string" &&
        typeof item.createdAt === "number"
    );
}

function clientId(): string {
    const directory = app.getPath("userData");
    const file = join(directory, "digiwise-update-client-id");
    try {
        const existing = readFileSync(file, "utf8").trim();
        if (/^[0-9a-f-]{36}$/.test(existing)) return existing;
    } catch (_error) {
        // New installations create a stable, non-account-specific client ID.
    }
    const id = randomUUID();
    mkdirSync(directory, { recursive: true });
    writeFileSync(file, id, { mode: 0o600 });
    return id;
}

function pendingPath() {
    return join(app.getPath("userData"), "digiwise-update-pending.json");
}

function loadPending(): PendingInstallation | undefined {
    try {
        if (!existsSync(pendingPath())) return undefined;
        const value: unknown = JSON.parse(readFileSync(pendingPath(), "utf8"));
        if (isPending(value) && value.createdAt > Date.now() - 14 * 86400_000) {
            return value;
        }
    } catch (_error) {
        // Ignore malformed historical markers.
    }
    return undefined;
}

function savePending(pending: PendingInstallation) {
    writeFileSync(pendingPath(), JSON.stringify(pending), { mode: 0o600 });
}

function clearPending() {
    try { unlinkSync(pendingPath()); } catch (_error) {}
}

/**
 * Server-authorized staged updates only. Never discover OSS release.json or
 * electron-builder latest.yml globally: those would bypass whitelist/percentage rollout.
 */
export function setupDigiwiseReleaseUpdater(
    homeWindow: BrowserWindow,
    installMacUpdate: (file: string, version: string) => void,
    setForceQuit: () => void
) {
    if (!app.isPackaged) return;

    const platform = process.platform;
    const arch = process.arch;
    if ((platform !== "win32" && platform !== "darwin") ||
        (arch !== "x64" && arch !== "arm64")) {
        console.log("[auto-update] Platform or architecture not supported by Java rollout");
        return;
    }
    const targetPlatform: Platform = platform;
    const targetArch: Arch = arch;
    const identity = readUpdateReleaseIdentity(
        app.getAppPath(), file => readFileSync(file, "utf8")
    );
    const channel = identity?.channel || "stable";
    const currentVersion = app.getVersion();
    const deviceId = clientId();

    autoUpdater.allowDowngrade = false;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.channel = "latest";

    let active: ActiveUpdate | undefined;
    let checking = false;
    let recheckAfterLogin = false;
    let closed = false;

    const validGeneration = (generation: number) => {
        const guard = getDigiwiseAuthGuard();
        return !closed && guard.authenticated && guard.generation === generation;
    };

    const report = async (
        releaseId: string,
        fromVersion: string,
        eventType: EventType,
        errorMessage?: string
    ) => {
        const result = await callDigiwisePublicApiWithSession((api, token) =>
            api.reportIdeReleaseEvent(token, releaseId, {
                fromVersion,
                platform: targetPlatform,
                arch: targetArch,
                clientId: deviceId,
                eventType,
                ...(errorMessage ? { errorMessage: errorMessage.slice(0, 450) } : {})
            })
        );
        if (!result.ok) console.warn("[auto-update] Update telemetry not accepted:", result.error.code);
        return result.ok;
    };

    const invalidate = () => {
        const stale = active;
        active = undefined;
        // Close the only permitted update source; no OSS fallback is possible.
        if (stale) void stale.feed.close();
    };

    async function checkCurrentAuthorization(): Promise<boolean> {
        const candidate = active;
        if (!candidate || !validGeneration(candidate.generation)) return false;
        const result = await callDigiwisePublicApiWithSession(async (api, token) => {
            const check = validateReleaseCheck(
                await api.checkIdeRelease(
                    token, candidate.fromVersion, channel, targetPlatform, targetArch, deviceId
                ),
                channel, candidate.fromVersion, targetPlatform
            );
            return check;
        });
        return result.ok && result.data.hasUpdate &&
            result.data.release?.id === candidate.release.id &&
            result.data.release.version === candidate.release.version &&
            validGeneration(candidate.generation);
    }

    async function confirmAndInstall(file: string, version: string) {
        const candidate = active;
        if (!candidate || !candidate.downloaded || candidate.release.version !== version) return;
        if (!(await checkCurrentAuthorization())) {
            console.warn("[auto-update] Rollout approval expired before installation");
            invalidate();
            return;
        }
        if (!homeWindow || homeWindow.isDestroyed()) return;

        const options = candidate.forceUpdate
            ? ["立即重启安装"]
            : ["立即重启安装", "稍后"];
        const result = await dialog.showMessageBox(homeWindow, {
            type: candidate.forceUpdate ? "warning" : "info",
            title: candidate.forceUpdate ? "需要更新 DigiwiseStudio" : "更新已下载",
            message: `DigiwiseStudio ${version} 已准备完成。`,
            detail: candidate.forceUpdate
                ? "该版本被后台标记为必须更新。"
                : "现在重启应用即可安装更新。",
            buttons: options,
            defaultId: 0,
            cancelId: candidate.forceUpdate ? undefined : 1
        });
        if (result.response !== 0) return;
        if (!(await checkCurrentAuthorization())) {
            invalidate();
            return;
        }

        savePending({
            releaseId: candidate.release.id,
            version,
            fromVersion: candidate.fromVersion,
            userId: candidate.userId,
            platform: targetPlatform,
            arch: targetArch,
            clientId: deviceId,
            createdAt: Date.now()
        });

        try {
            if (targetPlatform === "darwin") {
                installMacUpdate(file, version);
            } else {
                setForceQuit();
                autoUpdater.quitAndInstall(false, true);
            }
        } catch (error) {
            clearPending();
            await report(candidate.release.id, candidate.fromVersion,
                "install_error", error instanceof Error ? error.message : "Install failed");
            console.error("[auto-update] Installation launch failed");
        }
    }

    autoUpdater.on("checking-for-update", () => {
        console.log("[auto-update] Checking authorized release manifest");
    });
    autoUpdater.on("update-available", info => {
        if (!active || info.version !== active.release.version) {
            console.warn("[auto-update] Unexpected version from local update manifest");
            invalidate();
        }
    });
    autoUpdater.on("update-downloaded", info => {
        const candidate = active;
        if (!candidate || !validGeneration(candidate.generation) ||
            info.version !== candidate.release.version) return;
        candidate.downloaded = true;
        void candidate.feed.close();
        void confirmAndInstall(info.downloadedFile, info.version);
    });
    autoUpdater.on("error", error => {
        const candidate = active;
        console.error("[auto-update] Authorized update failed:", error.name);
        if (candidate && validGeneration(candidate.generation)) {
            void report(candidate.release.id, candidate.fromVersion, "install_error",
                error.message).catch(() => {});
        }
        invalidate();
    });

    async function reportCompletedInstall() {
        const pending = loadPending();
        if (!pending || pending.version !== currentVersion ||
            pending.platform !== targetPlatform || pending.arch !== targetArch ||
            pending.clientId !== deviceId) return;
        const result = await callDigiwisePublicApiWithSession((api, token) =>
            api.getCurrentUser(token)
        );
        if (!result.ok || result.data.user.id !== pending.userId) return;
        if (await report(pending.releaseId, pending.fromVersion, "install_success")) {
            clearPending();
        }
    }

    async function checkForUpdates() {
        if (closed || checking || active) return;
        const guard = getDigiwiseAuthGuard();
        if (!guard.authenticated) return;
        checking = true;
        const generation = guard.generation;
        try {
            await reportCompletedInstall();
            if (!validGeneration(generation)) return;
            const result = await callDigiwisePublicApiWithSession(async (api, token) => {
                // Revalidate the account rather than trusting a restored local token.
                const me = await api.getCurrentUser(token);
                if (me.user.accountStatus !== "active") throw new Error("IDE account disabled");
                const check = validateReleaseCheck(
                    await api.checkIdeRelease(
                        token, currentVersion, channel, targetPlatform, targetArch, deviceId
                    ),
                    channel, currentVersion, targetPlatform
                );
                return { check, userId: me.user.id };
            });
            if (!result.ok) {
                console.warn("[auto-update] Java rollout check failed:", result.error.code);
                return; // Fail closed: never probe the public OSS feed.
            }
            const { check, userId } = result.data;
            if (!check.hasUpdate || !check.release) return;
            if (compareSemVer(check.release.version, currentVersion) <= 0 ||
                !validGeneration(generation)) return;

            const signed = await callDigiwisePublicApiWithSession((api, token) =>
                api.prepareIdeReleaseDownload(
                    token, check.release!.id, targetPlatform, targetArch, deviceId
                )
            );
            if (!signed.ok || !validGeneration(generation)) return;
            const download = validateReleaseDownload(
                signed.data,
                check.release,
                targetPlatform,
                targetArch,
                getDigiwiseDownloadUrlPolicy()
            );
            const feed = await serveAuthorizedUpdate(
                check.release, download, targetPlatform
            );
            if (!validGeneration(generation)) {
                await feed.close();
                return;
            }
            active = {
                release: check.release,
                generation,
                userId,
                fromVersion: currentVersion,
                forceUpdate: check.forceUpdate,
                downloaded: false,
                feed
            };
            autoUpdater.setFeedURL({ provider: "generic", url: feed.url });
            const checked = await autoUpdater.checkForUpdates();
            if (!checked?.isUpdateAvailable ||
                checked.updateInfo.version !== check.release.version ||
                !validGeneration(generation)) {
                invalidate();
                return;
            }
            await autoUpdater.downloadUpdate();
        } catch (error) {
            console.error("[auto-update] Rollout integration failed:",
                error instanceof Error ? error.name : "UnknownError");
            invalidate();
        } finally {
            checking = false;
            if (recheckAfterLogin) {
                recheckAfterLogin = false;
                void checkForUpdates();
            }
        }
    }

    const unlisten = onDigiwiseAuthSessionChanged(() => {
        invalidate();
        if (checking) recheckAfterLogin = true;
        else void checkForUpdates();
    });
    const interval = setInterval(() => { void checkForUpdates(); }, 6 * 60 * 60 * 1000);
    app.once("before-quit", () => {
        closed = true;
        clearInterval(interval);
        unlisten();
        invalidate();
    });

    void checkForUpdates();
}
