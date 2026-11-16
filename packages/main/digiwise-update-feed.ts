import { randomBytes } from "crypto";
import { createServer, Server } from "http";
import type { AddressInfo } from "net";
import type { IdeRelease, IdeReleaseDownload } from "./digiwise-update-policy";
import { makeAuthorizedUpdateManifest } from "./digiwise-update-policy";

export interface AuthorizedUpdateFeed {
    url: string;
    close(): Promise<void>;
}

/**
 * Loopback-only generic updater manifest: never discovers an OSS version.
 * An unguessable path gates access to one server-approved installer.
 * No bearer token, cookies or persistent credential are sent to the update provider.
 */
export async function serveAuthorizedUpdate(
    release: IdeRelease,
    download: IdeReleaseDownload,
    platform: "win32" | "darwin"
): Promise<AuthorizedUpdateFeed> {
    const nonce = randomBytes(24).toString("hex");
    const root = `/${nonce}/`;
    const artifactPath = platform === "win32" ? "installer.exe" : "installer.zip";
    const manifestPath = platform === "win32" ? "latest.yml" : "latest-mac.yml";
    const manifest = makeAuthorizedUpdateManifest(release, artifactPath);

    const server: Server = createServer((request, response) => {
        const path = (request.url || "").split("?")[0];
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405).end();
            return;
        }
        if (path === root + manifestPath) {
            response.writeHead(200, {
                "Content-Type": "text/yaml; charset=utf-8",
                "Content-Length": Buffer.byteLength(manifest)
            });
            response.end(request.method === "HEAD" ? undefined : manifest);
            return;
        }
        if (path === root + artifactPath && Date.parse(download.expiresAt) > Date.now() + 5000) {
            response.writeHead(302, {
                Location: download.downloadUrl,
                "Content-Length": "0"
            });
            response.end();
            return;
        }
        response.writeHead(404).end();
    });

    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                server.off("error", reject);
                resolve();
            });
        });
    } catch (error) {
        server.close();
        throw error;
    }

    const port = (server.address() as AddressInfo).port;
    let closed = false;
    return {
        url: `http://127.0.0.1:${port}${root}`,
        close: () => new Promise(resolve => {
            if (closed) { resolve(); return; }
            closed = true;
            server.close(() => resolve());
        })
    };
}
