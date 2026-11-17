const assert = require("node:assert/strict");
const { DigiwisePublicApi, DigiwisePublicApiError } = require("../build/main/digiwise-auth-api.js");

// Java /api/ide/v1 adapter contract. Transport only is mocked; no real credentials.
const base = "https://public.example.test/api/ide/v1";
const user = {
    id: "23", username: "test-ide", displayName: "IDE Test",
    identityType: "external", accountStatus: "active", email: null
};
const calls = [];
let failure = null;
function ok(data) {
    return new Response(JSON.stringify({
        code: "OK", message: "success", requestId: "test-request", data
    }), { status: 200 });
}
const api = new DigiwisePublicApi(base, async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    if (failure === "network") throw new Error("unavailable");
    if (failure === "http401") return new Response(JSON.stringify({
        code: "AUTH_REQUIRED", message: "Session expired", requestId: "denied-1"
    }), { status: 401 });
    if (failure === "numeric401") return new Response(JSON.stringify({
        code: 401, msg: "Access denied"
    }), { status: 200 });
    if (failure === "missing-data") return new Response(JSON.stringify({
        code: "OK", message: "success", requestId: "missing-1"
    }), { status: 200 });
    const path = new URL(url).pathname;
    if (path === "/api/ide/v1/auth/captcha") return ok({
        enabled: true, uuid: "a".repeat(32), mimeType: "image/jpeg", imageBase64: "dGVzdA=="
    });
    if (path === "/api/ide/v1/auth/login") return ok({
        accessToken: "ide_fixture_only", tokenType: "Bearer", expiresIn: 900, user
    });
    if (path === "/api/ide/v1/auth/me") return ok({ user, expiresIn: 800 });
    if (path === "/api/ide/v1/auth/logout") return ok({ revoked: true });
    if (path === "/api/ide/v1/release/changelog") return ok({
        version: "0.0.13", channel: "stable", language: "zh-CN", groups: []
    });
    if (path === "/api/ide/v1/release/check") return ok({
        hasUpdate: false, forceUpdate: false, currentVersion: "0.0.13", channel: "stable"
    });
    if (path === "/api/ide/v1/release/123/download") return ok({
        releaseId: "123", channel: "stable", version: "0.0.14",
        platform: "win32", arch: "x64", assetType: "installer",
        fileName: "fixture.exe", fileSize: 1000, sha256: "a".repeat(64),
        sha512: Buffer.alloc(64).toString("base64"),
        downloadUrl: "https://oss.example.test/fixture.exe",
        expiresAt: new Date(Date.now() + 900000).toISOString()
    });
    if (path === "/api/ide/v1/release/123/events") return ok({ recorded: true });
    throw new Error("Unexpected endpoint: " + path);
});
(async () => {
    assert.equal((await api.getCaptcha()).enabled, true);
    assert.equal(calls[0].url, base + "/auth/captcha");
    assert.equal(calls[0].headers.Authorization, undefined);
    const login = await api.login("test-ide", "fixture-password", "1234", "a".repeat(32));
    assert.equal(login.user.id, user.id);
    assert.deepEqual(JSON.parse(calls[1].body), {
        username: "test-ide", password: "fixture-password",
        captchaCode: "1234", captchaUuid: "a".repeat(32)
    });
    assert.equal(calls[1].headers.Authorization, undefined);
    assert.equal((await api.getCurrentUser("ide_fixture_only")).user.username, "test-ide");
    assert.equal(calls[2].headers.Authorization, "Bearer ide_fixture_only");
    assert.deepEqual(await api.logout("ide_fixture_only"), { revoked: true });
    assert.equal(calls[3].method, "POST");
    assert.equal(calls[3].headers.Authorization, "Bearer ide_fixture_only");

    const changelog = await api.getReleaseChangelog("0.0.13", "stable", "zh-CN");
    assert.equal(changelog.groups.length, 0);
    assert.equal(calls[4].headers.Authorization, undefined);
    assert.match(calls[4].url, /release\/changelog\?version=0.0.13&channel=stable&lang=zh-CN/);
    const release = await api.checkIdeRelease(
        "ide_fixture_only", "0.0.13", "stable", "win32", "x64", "client-test"
    );
    assert.equal(release.hasUpdate, false);
    assert.equal(calls[5].headers.Authorization, "Bearer ide_fixture_only");
    assert.match(calls[5].url, /release\/check\?currentVersion=0.0.13&channel=stable&platform=win32&arch=x64&clientId=client-test/);
    const download = await api.prepareIdeReleaseDownload(
        "ide_fixture_only", "123", "win32", "x64", "client-test"
    );
    assert.equal(download.releaseId, "123");
    assert.match(calls[6].url, /release\/123\/download\?platform=win32&arch=x64&assetType=installer&clientId=client-test/);
    assert.equal(calls[6].headers.Authorization, "Bearer ide_fixture_only");
    assert.deepEqual(await api.reportIdeReleaseEvent("ide_fixture_only", "123", {
        fromVersion: "0.0.13", platform: "win32", arch: "x64",
        eventType: "install_success", clientId: "client-test"
    }), { recorded: true });
    assert.equal(calls[7].method, "POST");
    assert.equal(JSON.parse(calls[7].body).eventType, "install_success");
    assert.equal(calls[7].headers.Authorization, "Bearer ide_fixture_only");

    failure = "http401";
    await assert.rejects(api.getCurrentUser("invalid"), error =>
        error instanceof DigiwisePublicApiError && error.status === 401 &&
        error.code === "AUTH_REQUIRED" && error.requestId === "denied-1"
    );
    failure = "numeric401";
    await assert.rejects(api.getCurrentUser("invalid"), error =>
        error instanceof DigiwisePublicApiError && error.status === 401 &&
        error.code === "AUTH_REQUIRED"
    );
    failure = "missing-data";
    await assert.rejects(api.getCurrentUser("invalid"), error =>
        error instanceof DigiwisePublicApiError && error.status === 502 &&
        error.code === "PUBLIC_API_INVALID_RESPONSE"
    );
    failure = "network";
    await assert.rejects(api.getCurrentUser("invalid"), error =>
        error instanceof DigiwisePublicApiError && error.status === 503 &&
        error.code === "PUBLIC_API_UNAVAILABLE"
    );
    assert.throws(() => new DigiwisePublicApi("file:///etc/passwd"), DigiwisePublicApiError);
    assert.throws(() => new DigiwisePublicApi("https://name:pass@example.com"), DigiwisePublicApiError);
    console.log("DIGIWISE_IDE_PUBLIC_API_TESTS_PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
