const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateDigiwiseChangelog } = require("../build/eez-studio-shared/digiwise-changelog");
const { DigiwisePublicApi } = require("../build/main/digiwise-auth-api");

const identity = { version: "0.0.13", channel: "stable" };
const zh = {
    ...identity,
    language: "zh-CN",
    groups: [
        { code: "lvgl", label: "LVGL 库", title: "LVGL 项目与编辑体验",
          items: ["优化编辑界面", "完善画布恢复"] },
        { code: "boards", label: "操作系统与目标板", title: "型号管理",
          items: ["增加 BSP 检查"] }
    ]
};
const en = { ...identity, language: "en-US",
    groups: [{ code: "lvgl", label: "LVGL Library", title: "LVGL Projects",
        items: ["Editor improvements"] }]
};

async function main() {
    assert.equal(validateDigiwiseChangelog(zh, identity, "zh-CN").groups[0].title,
        "LVGL 项目与编辑体验");
    assert.deepEqual(validateDigiwiseChangelog(
        { ...identity, language: "zh-CN", groups: [] }, identity, "zh-CN"
    ).groups, []);
    assert.equal(validateDigiwiseChangelog(en, identity, "en-US").groups[0].items[0],
        "Editor improvements");
    for (const invalid of [
        { ...zh, version: "0.0.14" },
        { ...zh, channel: "dev" },
        { ...zh, language: "en-US" },
        { ...zh, groups: [...zh.groups, zh.groups[0]] },
        { ...zh, groups: [{ ...zh.groups[0], items: [""] }] },
        { ...zh, groups: [{ ...zh.groups[0], title: "<".repeat(151) }] }
    ]) {
        assert.throws(() => validateDigiwiseChangelog(
            invalid, identity, "zh-CN"
        ));
    }

    const calls = [];
    const fakeFetch = async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200,
            text: async () => JSON.stringify({
                code: "OK", message: "success", requestId: "test", data: zh
            }) };
    };
    const api = new DigiwisePublicApi("https://example.test/api/ide/v1", fakeFetch);
    const result = await api.getReleaseChangelog("0.0.13", "stable", "zh-CN");
    assert.deepEqual(result, zh);
    assert.match(calls[0].url, /release\/changelog\?version=0.0.13&channel=stable&lang=zh-CN/);
    assert.equal(calls[0].init.headers.Authorization, undefined);

    const home = fs.readFileSync(
        path.resolve(__dirname, "../packages/home/home-tab.tsx"), "utf8"
    );
    assert.ok(home.includes("digistudio:release:identity"));
    assert.ok(home.includes("digistudio:release:changelog"));
    assert.ok(home.includes("digiwise-ide-changelog-v1"));
    assert.ok(!home.includes("优化 LVGL 8 / LVGL 9 项目入口与模板选择体验"));
    assert.ok(!home.includes("Improved LVGL 8 / LVGL 9 project entry points"));
    assert.ok(home.includes("validateDigiwiseChangelog"));
    console.log("IDE_CHANGELOG_CACHE_AND_API_CONTRACT_PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
