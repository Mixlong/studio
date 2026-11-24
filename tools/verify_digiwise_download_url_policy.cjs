const assert = require("node:assert/strict");
const {
    MAX_DIGIWISE_DOWNLOAD_REDIRECTS,
    createDigiwiseDownloadUrlPolicy,
    fetchDigiwiseDownload
} = require("../build/main/digiwise-download-policy.js");
const { validateReleaseDownload } = require("../build/main/digiwise-update-policy.js");

function assertRejected(action, message) {
    assert.throws(action, error => {
        assert.match(error.message, message);
        return true;
    });
}

async function main() {
    const packaged = createDigiwiseDownloadUrlPolicy({ isPackaged: true });
    assertRejected(
        () => packaged.validate("http://127.0.0.1:18080/template.zip"),
        /HTTPS/
    );
    assertRejected(
        () => packaged.validate("https://user:pass@example.com/template.zip"),
        /credentials/
    );

    const defaultDevelopment = createDigiwiseDownloadUrlPolicy({
        isPackaged: false,
        apiBaseUrl: "https://api.example.com/api/ide/v1"
    });
    assertRejected(
        () => defaultDevelopment.validate("http://example.com/template.zip"),
        /HTTPS or an explicitly allowed local HTTP URL/
    );
    assertRejected(
        () => defaultDevelopment.validate("http://localhost.example.com/template.zip"),
        /HTTPS or an explicitly allowed local HTTP URL/
    );

    const envEnabled = createDigiwiseDownloadUrlPolicy({
        isPackaged: false,
        allowLocalHttp: true
    });
    assert.equal(
        envEnabled.validate("http://127.0.0.1:18080/template.zip").hostname,
        "127.0.0.1"
    );
    assert.equal(
        envEnabled.validate("http://localhost:13080/template.zip").hostname,
        "localhost"
    );
    assertRejected(
        () => envEnabled.validate("http://example.com/template.zip"),
        /HTTPS or an explicitly allowed local HTTP URL/
    );
    assertRejected(
        () => envEnabled.validate("http://[::1]:18080/template.zip"),
        /HTTPS or an explicitly allowed local HTTP URL/
    );
    assertRejected(
        () => envEnabled.validate("http://user:pass@localhost:18080/template.zip"),
        /credentials/
    );

    const apiLocal = createDigiwiseDownloadUrlPolicy({
        isPackaged: false,
        apiBaseUrl: "http://localhost:18080/api/ide/v1"
    });
    assert.equal(
        apiLocal.validate("http://localhost:13080/template.zip").protocol,
        "http:"
    );

    const release = {
        id: "123",
        channel: "stable",
        version: "1.3.0",
        asset: {
            fileName: "DigiwiseStudio-1.3.0.exe",
            fileSize: 4096,
            sha256: "a".repeat(64),
            sha512: Buffer.alloc(64).toString("base64")
        }
    };
    const releaseDownload = {
        releaseId: "123",
        channel: "stable",
        version: "1.3.0",
        platform: "win32",
        arch: "x64",
        assetType: "installer",
        ...release.asset,
        downloadUrl: "http://127.0.0.1:18080/update.exe",
        expiresAt: new Date(Date.now() + 900_000).toISOString()
    };
    assert.equal(
        validateReleaseDownload(
            releaseDownload,
            release,
            "win32",
            "x64",
            apiLocal
        ).downloadUrl,
        releaseDownload.downloadUrl
    );
    assertRejected(
        () => validateReleaseDownload(releaseDownload, release, "win32", "x64"),
        /HTTPS/
    );

    const localStart = "http://127.0.0.1:18080/template.zip";
    assertRejected(
        () => envEnabled.validateRedirect(localStart, "https://cdn.example.com/template.zip"),
        /redirect.*loopback|loopback.*redirect/i
    );
    assertRejected(
        () => envEnabled.validateRedirect(localStart, "http://example.com/template.zip"),
        /HTTPS or an explicitly allowed local HTTP URL|loopback.*redirect/i
    );
    assertRejected(
        () => envEnabled.validateFinal(
            "https://cdn.example.com/template.zip",
            "http://localhost:18080/template.zip"
        ),
        /redirect.*loopback|loopback.*redirect/i
    );
    assert.equal(
        envEnabled.validateRedirect(
            "https://cdn.example.com/template.zip",
            "https://cdn.example.com/final.zip"
        ).href,
        "https://cdn.example.com/final.zip"
    );

    let requests = [];
    const response = await fetchDigiwiseDownload(
        "http://127.0.0.1:18080/template.zip",
        envEnabled,
        async (url, init) => {
            requests.push({ url: String(url), init });
            if (requests.length === 1) {
                return new Response(null, {
                    status: 302,
                    headers: { location: "/final.zip" }
                });
            }
            return new Response("ok", { status: 200 });
        }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(requests.map(request => request.url), [
        "http://127.0.0.1:18080/template.zip",
        "http://127.0.0.1:18080/final.zip"
    ]);
    assert.equal(requests[0].init.redirect, "manual");

    requests = [];
    await assert.rejects(
        fetchDigiwiseDownload(
            localStart,
            envEnabled,
            async () => new Response(null, {
                status: 302,
                headers: { location: "/next.zip" }
            })
        ),
        /too many redirects/
    );
    assert.equal(requests.length, 0);

    await assert.rejects(
        fetchDigiwiseDownload(
            localStart,
            envEnabled,
            async (url, init) => {
                requests.push({ url: String(url), init });
                return {
                    status: 200,
                    ok: true,
                    url: "http://example.com/final.zip",
                    headers: new Headers()
                };
            }
        ),
        /final URL|HTTPS/
    );

    assert.equal(MAX_DIGIWISE_DOWNLOAD_REDIRECTS, 3);
    console.log("DIGIWISE_DOWNLOAD_URL_POLICY_TESTS_PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
