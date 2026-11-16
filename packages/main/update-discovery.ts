export interface UpdateReleaseIdentity {
    channel: "dev" | "stable";
    buildNumber: number;
    version: string;
    probeWindow: number;
}

export function readUpdateReleaseIdentity(
    appPath: string,
    readFile: (path: string) => string
): UpdateReleaseIdentity | undefined {
    try {
        const value = JSON.parse(readFile(appPath + "/build/main/update-release.json"));
        if (
            (value.channel !== "dev" && value.channel !== "stable") ||
            !Number.isSafeInteger(value.buildNumber) ||
            value.buildNumber < 1 ||
            typeof value.version !== "string"
        ) {
            return undefined;
        }
        return {
            channel: value.channel,
            buildNumber: value.buildNumber,
            version: value.version,
            probeWindow: Number.isInteger(value.probeWindow)
                ? Math.max(5, Math.min(20, value.probeWindow))
                : 10
        };
    } catch (_error) {
        return undefined;
    }
}

function parseSemVer(version: string) {
    const match = version.match(
        /^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:[+][0-9A-Za-z.-]+)?$/
    );
    if (!match) {
        throw new Error("Invalid semantic version in update manifest: " + version);
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split(".") : []
    };
}

export function compareSemVer(leftVersion: string, rightVersion: string) {
    const left = parseSemVer(leftVersion);
    const right = parseSemVer(rightVersion);
    for (const key of ["major", "minor", "patch"] as const) {
        if (left[key] !== right[key]) {
            return left[key] > right[key] ? 1 : -1;
        }
    }
    if (left.prerelease.length === 0 || right.prerelease.length === 0) {
        if (left.prerelease.length === right.prerelease.length) return 0;
        return left.prerelease.length === 0 ? 1 : -1;
    }
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index++) {
        const a = left.prerelease[index];
        const b = right.prerelease[index];
        if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
        if (a === b) continue;
        const aNumeric = /^[0-9]+$/.test(a);
        const bNumeric = /^[0-9]+$/.test(b);
        if (aNumeric && bNumeric) {
            const av = BigInt(a);
            const bv = BigInt(b);
            return av > bv ? 1 : -1;
        }
        if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
        return a > b ? 1 : -1;
    }
    return 0;
}

export async function discoverImmutableUpdateFeed(
    channelRoot: string,
    identity: UpdateReleaseIdentity,
    platformKey: "win32-x64" | "win32-ia32" | "darwin",
    fetcher: typeof fetch = fetch
): Promise<string | undefined> {
    const root = channelRoot.replace(/[/]+$/, "");
    const rootUrl = new URL(root + "/");
    if (rootUrl.protocol !== "https:") {
        throw new Error("Update discovery requires HTTPS");
    }

    let latest:
        | { version: string; buildNumber: number; feedUrl: string }
        | undefined;
    for (
        let buildNumber = identity.buildNumber + 1;
        buildNumber <= identity.buildNumber + identity.probeWindow;
        buildNumber++
    ) {
        const markerUrl = root + "/builds/" + buildNumber + "/" + platformKey + "/release.json";
        const markerResponse = await fetcher(markerUrl, { method: "GET" });
        if (markerResponse.status === 404) continue;
        if (!markerResponse.ok) {
            throw new Error(
                "Release discovery failed (" + markerResponse.status + ") at build " + buildNumber
            );
        }

        const manifest: any = await markerResponse.json();
        if (
            manifest?.schemaVersion !== 1 ||
            manifest?.app !== "DigiwiseStudio" ||
            manifest?.status !== "published" ||
            manifest?.channel !== identity.channel ||
            manifest?.platform !== platformKey ||
            manifest?.buildNumber !== buildNumber ||
            typeof manifest?.version !== "string"
        ) {
            throw new Error("Invalid release marker for " + identity.channel + " build " + buildNumber);
        }
        if (compareSemVer(manifest.version, identity.version) <= 0) continue;

        const feedPath = manifest.feed || manifest.feeds?.[platformKey];
        const artifactBase = manifest.artifactBase;
        if (
            typeof feedPath !== "string" ||
            !feedPath.startsWith("versions/") ||
            typeof artifactBase !== "string" ||
            !artifactBase.startsWith("versions/") ||
            !Array.isArray(manifest.artifacts) ||
            manifest.artifacts.length === 0
        ) continue;
        const feedUrl = new URL(feedPath, rootUrl);
        const artifactBaseUrl = new URL(artifactBase, rootUrl);
        if (
            feedUrl.protocol !== "https:" ||
            feedUrl.origin !== rootUrl.origin ||
            !feedUrl.pathname.startsWith(rootUrl.pathname + "versions/") ||
            artifactBaseUrl.protocol !== "https:" ||
            artifactBaseUrl.origin !== rootUrl.origin ||
            !artifactBaseUrl.pathname.startsWith(rootUrl.pathname + "versions/")
        ) {
            throw new Error("Untrusted update feed URL in build " + buildNumber);
        }

        const platformDirectory = platformKey === "darwin" ? "dist-mac" : platformKey === "win32-ia32" ? "win-ia32" : "dist-win-x64";
        let complete = true;
        for (const artifact of manifest.artifacts) {
            if (
                typeof artifact?.path !== "string" ||
                !artifact.path.startsWith(platformDirectory + "/") ||
                !Number.isSafeInteger(artifact.size) ||
                artifact.size < 1 ||
                typeof artifact.sha512 !== "string"
            ) {
                throw new Error("Invalid artifact entry in build " + buildNumber);
            }
            const artifactUrl = new URL(artifact.path, artifactBaseUrl);
            if (
                artifactUrl.origin !== rootUrl.origin ||
                !artifactUrl.pathname.startsWith(artifactBaseUrl.pathname)
            ) {
                throw new Error("Untrusted artifact URL in build " + buildNumber);
            }
            const artifactResponse = await fetcher(artifactUrl, { method: "HEAD" });
            if (artifactResponse.status === 404) {
                complete = false;
                break;
            }
            if (!artifactResponse.ok) {
                throw new Error("Release artifact check failed (" + artifactResponse.status + ") in build " + buildNumber);
            }
            const contentLength = artifactResponse.headers?.get("content-length");
            if (contentLength && Number(contentLength) !== artifact.size) {
                throw new Error("Release artifact size mismatch in build " + buildNumber);
            }
        }
        if (!complete) continue;

        if (
            !latest ||
            compareSemVer(manifest.version, latest.version) > 0 ||
            (compareSemVer(manifest.version, latest.version) === 0 &&
                buildNumber > latest.buildNumber)
        ) {
            latest = {
                version: manifest.version,
                buildNumber,
                feedUrl: feedUrl.toString()
            };
        }
    }
    return latest?.feedUrl;
}
