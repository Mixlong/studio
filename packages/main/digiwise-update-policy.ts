export interface IdeReleaseAsset {
    fileName: string;
    fileSize: number;
    sha256: string;
    sha512: string;
}

export interface IdeRelease {
    id: string;
    channel: "stable" | "dev";
    version: string;
    asset: IdeReleaseAsset;
}

export interface IdeReleaseCheck {
    hasUpdate: boolean;
    forceUpdate: boolean;
    currentVersion: string;
    channel: "stable" | "dev";
    release?: IdeRelease;
}

export interface IdeReleaseDownload extends IdeReleaseAsset {
    releaseId: string;
    channel: "stable" | "dev";
    version: string;
    platform: string;
    arch: string;
    assetType: "installer";
    downloadUrl: string;
    expiresAt: string;
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SHA_512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const SHA_256_HEX = /^[a-fA-F0-9]{64}$/;
const VERSION = /^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})(?:-[0-9A-Za-z.-]{1,40})?$/;

function validAsset(value: unknown): value is IdeReleaseAsset {
    return object(value) &&
        typeof value.fileName === "string" &&
        /^[^/\\\r\n]{1,200}$/.test(value.fileName) &&
        !value.fileName.includes("..") &&
        Number.isSafeInteger(value.fileSize) &&
        (value.fileSize as number) > 0 &&
        typeof value.sha256 === "string" &&
        SHA_256_HEX.test(value.sha256) &&
        typeof value.sha512 === "string" &&
        SHA_512_BASE64.test(value.sha512);
}

/** Fail closed if the Java Public API returns incomplete or inconsistent update metadata. */
export function validateReleaseCheck(
    value: unknown,
    channel: "stable" | "dev",
    currentVersion: string,
    platform: "win32" | "darwin"
): IdeReleaseCheck {
    if (!object(value) ||
        typeof value.hasUpdate !== "boolean" ||
        typeof value.forceUpdate !== "boolean" ||
        value.channel !== channel ||
        value.currentVersion !== currentVersion) {
        throw new Error("Invalid Java rollout check response");
    }
    if (!value.hasUpdate) {
        if (value.release != null) throw new Error("Unexpected rollout release");
        return {
            hasUpdate: false,
            forceUpdate: false,
            channel,
            currentVersion
        };
    }
    const release = value.release;
    if (!object(release) ||
        !/^[1-9][0-9]{0,18}$/.test(String(release.id)) ||
        release.channel !== channel ||
        typeof release.version !== "string" ||
        !VERSION.test(release.version) ||
        !validAsset(release.asset)) {
        throw new Error("Invalid authorized IDE update release");
    }
    const requiredExt = platform === "win32" ? ".exe" : ".zip";
    if (!release.asset.fileName.toLowerCase().endsWith(requiredExt)) {
        throw new Error("Unsupported installer format for Electron updater");
    }
    return {
        hasUpdate: true,
        forceUpdate: value.forceUpdate,
        currentVersion,
        channel,
        release: {
            id: String(release.id),
            channel,
            version: release.version,
            asset: release.asset
        }
    };
}

export function validateReleaseDownload(
    value: unknown,
    release: IdeRelease,
    platform: "win32" | "darwin",
    arch: "x64" | "arm64"
): IdeReleaseDownload {
    if (!object(value) ||
        String(value.releaseId) !== release.id ||
        value.channel !== release.channel ||
        value.version !== release.version ||
        value.platform !== platform ||
        value.arch !== arch ||
        value.assetType !== "installer" ||
        !validAsset(value) ||
        value.fileName !== release.asset.fileName ||
        value.fileSize !== release.asset.fileSize ||
        value.sha256.toLowerCase() !== release.asset.sha256.toLowerCase() ||
        value.sha512 !== release.asset.sha512 ||
        typeof value.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(value.expiresAt)) ||
        Date.parse(value.expiresAt) <= Date.now() + 60_000 ||
        typeof value.downloadUrl !== "string") {
        throw new Error("Untrusted or expired update asset authorization");
    }
    let url: URL;
    try {
        url = new URL(value.downloadUrl);
    } catch (_error) {
        throw new Error("Invalid signed download URL");
    }
    if (url.protocol !== "https:" || url.username || url.password ||
        !url.hostname || url.hash) {
        throw new Error("Signed update URL must be HTTPS");
    }
    return value as unknown as IdeReleaseDownload;
}

/** electron-updater checks an immutable local manifest; the Java backend remains the sole selector. */
export function makeAuthorizedUpdateManifest(
    release: IdeRelease,
    installerPath: string
): string {
    if (!/^installer\.(exe|zip)$/.test(installerPath) ||
        !VERSION.test(release.version) ||
        !validAsset(release.asset)) {
        throw new Error("Invalid update feed manifest");
    }
    return [
        `version: ${release.version}`,
        "files:",
        `  - url: ${installerPath}`,
        `    sha512: ${release.asset.sha512}`,
        `    size: ${release.asset.fileSize}`,
        `path: ${installerPath}`,
        `sha512: ${release.asset.sha512}`,
        ""
    ].join("\n");
}
