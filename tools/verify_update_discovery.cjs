const assert = require("node:assert/strict");
const { compareSemVer, discoverImmutableUpdateFeed } = require("../packages/main/update-discovery.ts");
async function main() {
    assert.equal(compareSemVer("0.1.0", "0.0.99"), 1);
    assert.equal(compareSemVer("1.0.0", "0.99.99"), 1);
    assert.equal(compareSemVer("1.0.0-beta.2", "1.0.0-beta.10"), -1);
    assert.equal(compareSemVer("1.0.0", "1.0.0-rc.9"), 1);

    const calls = [];
    const manifests = {
        102: {
            schemaVersion: 1, app: "DigiwiseStudio", channel: "stable",
            platform: "win32-x64", version: "0.1.0", buildNumber: 102,
            status: "published", feed: "versions/0.1.0/build-102/dist-win-x64/",
            artifactBase: "versions/0.1.0/build-102/", artifacts: [{ path: "dist-win-x64/latest.yml", size: 1, sha512: "hash" }]
        },
        105: {
            schemaVersion: 1, app: "DigiwiseStudio", channel: "stable",
            platform: "win32-x64", version: "1.0.0", buildNumber: 105,
            status: "published", feed: "versions/1.0.0/build-105/dist-win-x64/",
            artifactBase: "versions/1.0.0/build-105/", artifacts: [{ path: "dist-win-x64/latest.yml", size: 1, sha512: "hash" }]
        }
    };
    const fakeFetch = async (url, options) => {
        calls.push({ url: String(url), method: options.method });
        const marker = new URL(String(url)).pathname.match(/builds\/([0-9]+)\/win32-x64\/release[.]json$/);        if (options.method === "GET" && marker) {
            const manifest = manifests[Number(marker[1])];
            if (!manifest) return { status: 404, ok: false };
            return { status: 200, ok: true, json: async () => manifest };
        }
        if (options.method === "HEAD") return { status: 200, ok: true };
        return { status: 404, ok: false };
    };
    const result = await discoverImmutableUpdateFeed(
        "https://example.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio/stable/",
        { channel: "stable", buildNumber: 100, version: "0.0.13", probeWindow: 10 },
        "win32-x64",
        fakeFetch
    );
    assert.equal(
        result,
        "https://example.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio/stable/versions/1.0.0/build-105/dist-win-x64/"
    );
    assert.equal(calls.filter(call => call.method === "GET").length, 10);
    assert.equal(calls.filter(call => call.method === "HEAD").length, 2);

    await assert.rejects(
        discoverImmutableUpdateFeed(
            "https://example.com/stable",
            { channel: "stable", buildNumber: 1, version: "0.0.1", probeWindow: 5 },
            "win32-x64",
            async () => ({ status: 403, ok: false })
        ),
        /403/
    );

    console.log("update discovery checks passed");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
