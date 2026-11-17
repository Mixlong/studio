const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    validateReleaseCheck,
    validateReleaseDownload,
    makeAuthorizedUpdateManifest
} = require("../build/main/digiwise-update-policy.js");
const { serveAuthorizedUpdate } = require("../build/main/digiwise-update-feed.js");
const { DigiwisePublicApi } = require("../build/main/digiwise-auth-api.js");
const { parseUpdateInfo, resolveFiles } = require("electron-updater/out/providers/Provider");

const sha512 = Buffer.alloc(64, 11).toString("base64");
const sha256 = "a".repeat(64);
const release = {
    id: "123",
    channel: "stable",
    version: "1.3.0",
    asset: { fileName: "DigiwiseStudio-1.3.0.exe", fileSize: 4096, sha256, sha512 }
};
const candidate = {
    hasUpdate: true,
    forceUpdate: false,
    currentVersion: "1.2.0",
    channel: "stable",
    release
};
const download = {
    releaseId: release.id,
    channel: release.channel,
    version: release.version,
    platform: "win32",
    arch: "x64",
    assetType: "installer",
    ...release.asset,
    downloadUrl: "https://oss.example.com/protected.exe?Expires=9999999999&Signature=test",
    expiresAt: new Date(Date.now() + 900_000).toISOString()
};

async function main() {
    const noUpdate = {
        hasUpdate: false, forceUpdate: false,
        currentVersion: "1.2.0", channel: "stable"
    };
    assert.equal(validateReleaseCheck(noUpdate, "stable", "1.2.0", "win32").hasUpdate, false);
    assert.equal(validateReleaseCheck(candidate, "stable", "1.2.0", "win32").release.id, "123");
    assert.throws(() =>
        validateReleaseCheck({ ...candidate, release: { ...release, asset: { ...release.asset, sha512: "bad" } } },
            "stable", "1.2.0", "win32"), /Invalid authorized/);
    assert.throws(() =>
        validateReleaseCheck({ ...candidate, channel: "dev" }, "stable", "1.2.0", "win32"),
        /Invalid Java rollout/);
    assert.throws(() =>
        validateReleaseCheck({ ...candidate, release: { ...release, asset: { ...release.asset, fileName: "../a.exe" } } },
            "stable", "1.2.0", "win32"), /Invalid authorized/);
    assert.throws(() =>
        validateReleaseCheck(candidate, "stable", "1.2.0", "darwin"),
        /Unsupported installer/);
    assert.throws(() =>
        validateReleaseCheck({ ...candidate, hasUpdate: false }, "stable", "1.2.0", "win32"),
        /Unexpected rollout release/);

    const valid = validateReleaseDownload(download, release, "win32", "x64");
    assert.equal(valid.downloadUrl, download.downloadUrl);
    assert.throws(() => validateReleaseDownload({ ...download, releaseId: "987" }, release, "win32", "x64"), /Untrusted/);
    assert.throws(() => validateReleaseDownload({ ...download, sha512: Buffer.alloc(64, 9).toString("base64") }, release, "win32", "x64"), /Untrusted/);
    assert.throws(() => validateReleaseDownload({ ...download, expiresAt: new Date(Date.now() + 10_000).toISOString() }, release, "win32", "x64"), /Untrusted/);
    assert.throws(() => validateReleaseDownload({ ...download, downloadUrl: "http://oss.example.com/update.exe" }, release, "win32", "x64"), /must be HTTPS/);
    assert.throws(() => validateReleaseDownload({ ...download, fileSize: 4095 }, release, "win32", "x64"), /Untrusted/);

    const manifest = makeAuthorizedUpdateManifest(release, "installer.exe");
    assert.match(manifest, /^version: 1.3.0\nfiles:/);
    assert.match(manifest, new RegExp("sha512: " + sha512));
    assert.ok(manifest.includes("size: 4096"));
    assert.throws(() => makeAuthorizedUpdateManifest(release, "../installer.exe"), /Invalid update/);
    // Test using electron-updater's actual YAML parser/resolver, not only string assertions.
    const base = new URL("http://127.0.0.1:51321/nonce/");
    const parsed = parseUpdateInfo(manifest, "latest.yml", new URL("latest.yml", base));
    assert.equal(parsed.version, release.version);
    assert.equal(parsed.files[0].sha512, sha512);
    assert.equal(resolveFiles(parsed, base)[0].url.href, base.href + "installer.exe");


    const feed = await serveAuthorizedUpdate(release, valid, "win32");
    try {
        assert.match(feed.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}\/$/);
        const metadata = await fetch(feed.url + "latest.yml");
        assert.equal(metadata.status, 200);
        assert.equal(metadata.headers.get("cache-control"), "no-store");
        assert.equal(await metadata.text(), manifest);
        const installer = await fetch(feed.url + "installer.exe", { redirect: "manual" });
        assert.equal(installer.status, 302);
        assert.equal(installer.headers.get("location"), download.downloadUrl);
        assert.equal((await fetch(feed.url + "latest-mac.yml")).status, 404);
        assert.equal((await fetch(feed.url + "latest.yml", { method: "POST" })).status, 405);
        const unknown = new URL(feed.url);
        unknown.pathname = unknown.pathname.replace(/[0-9a-f]{48}/, "0".repeat(48)) + "latest.yml";
        assert.equal((await fetch(unknown)).status, 404);
    } finally {
        await feed.close();
        await feed.close();
    }

    const macRelease = {
        ...release,
        asset: { ...release.asset, fileName: "DigiwiseStudio-1.3.0.zip" }
    };
    const macDownload = { ...download, ...macRelease.asset, platform: "darwin" };
    const macFeed = await serveAuthorizedUpdate(
        macRelease,
        validateReleaseDownload(macDownload, macRelease, "darwin", "x64"),
        "darwin"
    );
    try {
        assert.equal((await fetch(macFeed.url + "latest-mac.yml")).status, 200);
        assert.equal((await fetch(macFeed.url + "latest.yml")).status, 404);
    } finally { await macFeed.close(); }

    const requests = [];
    let reply = { code: "OK", message: "success", requestId: "t-1", data: candidate };
    const api = new DigiwisePublicApi("http://127.0.0.1:18080/api/ide/v1", async (url, options) => {
        requests.push({ url, options });
        return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
    });
    const check = await api.checkIdeRelease("secret", "1.2.0", "stable", "win32", "x64", "client-1");
    assert.equal(check.release.version, "1.3.0");
    assert.ok(requests[0].url.includes("/release/check?currentVersion=1.2.0"));
    assert.equal(requests[0].options.headers.Authorization, "Bearer secret");
    reply = { code: "OK", message: "success", requestId: "t-1", data: download };
    const signed = await api.prepareIdeReleaseDownload("secret", "123", "win32", "x64", "client-1");
    assert.equal(signed.releaseId, "123");
    assert.ok(requests[1].url.includes("/release/123/download?"));
    reply = { code: "OK", message: "success", requestId: "t-1", data: { recorded: true } };
    assert.deepEqual(await api.reportIdeReleaseEvent("secret", "123", {
        fromVersion: "1.2.0", platform: "win32", arch: "x64",
        clientId: "client-1", eventType: "install_success"
    }), { recorded: true });
    assert.deepEqual(JSON.parse(requests[2].options.body).eventType, "install_success");
    reply = { code: 401, msg: "denied", requestId: "t-1" };
    await assert.rejects(api.checkIdeRelease("secret", "1.2.0", "stable", "win32", "x64", "client-1"));
    
    const adapter = fs.readFileSync(
        path.join(__dirname, "../packages/main/digiwise-release-updater.ts"), "utf8"
    );
    assert.ok(adapter.includes("autoUpdater.autoInstallOnAppQuit = false"));
    assert.ok(adapter.includes("checkCurrentAuthorization()"));
    assert.ok(adapter.includes('eventType: "install_success"') ||
        adapter.includes('"install_success"'));
    const entry = fs.readFileSync(path.join(__dirname, "../packages/main/main.ts"), "utf8");
    assert.ok(entry.includes("setupDigiwiseReleaseUpdater("));
    assert.ok(!entry.includes("discoverImmutableUpdateFeed("));
    assert.ok(!entry.includes("checkForUpdatesAndNotify()"));
    assert.ok(!entry.includes("DEFAULT_UPDATE_BASE_URL"));
    console.log("JAVA_ROLLOUT_IDE_TESTS_PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
