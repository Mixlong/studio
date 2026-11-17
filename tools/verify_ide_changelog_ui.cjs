"use strict";

/**
 * DOM integration test of the REAL HomeLatestChangesPanel source.
 * Uses a simulated Electron IPC responder without login bypass, real Java
 * credentials, user profile mutation, or a fabricated published release.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const React = require("react");
const { JSDOM } = require("jsdom");
const { observable, runInAction } = require("mobx");
const { observer } = require("mobx-react-lite");
const { act } = React;
const { validateDigiwiseChangelog } =
    require("../build/eez-studio-shared/digiwise-changelog");

const page = new JSDOM("<!DOCTYPE html><html><body><div id='app'></div></body></html>", {
    url: "http://127.0.0.1:13080/",
    pretendToBeVisual: true
});
for (const key of ["window", "document", "HTMLElement", "Node", "Event", "MouseEvent", "navigator"]) {
    Object.defineProperty(global, key, { configurable: true, value: page.window[key] });
}
global.requestAnimationFrame = callback => setTimeout(callback, 0);
global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require("react-dom/client");

const source = fs.readFileSync(
    path.resolve(__dirname, "../packages/home/home-tab.tsx"), "utf8"
);
const start = source.indexOf("const HomeLatestChangesPanel = observer(() => {");
const end = source.indexOf("export const Home = observer(", start);
assert.ok(start >= 0 && end > start, "Real Home component not found");
const code = source.slice(start, end) + "\nmodule.exports = HomeLatestChangesPanel;";
const cp = require("node:child_process");
const os = require("node:os");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "digiwise-home-changelog-dom-qa-"));
let compiledJavaScript;
try {
    const temporarySource = path.join(tempDir, "home-changelog-panel.tsx");
    fs.writeFileSync(temporarySource, code, "utf8");
    cp.execFileSync(
        process.execPath,
        [
            path.resolve(__dirname, "../node_modules/typescript/bin/tsc"),
            "--ignoreConfig", "--noCheck", "--target", "ES2020", "--module", "commonjs",
            "--jsx", "react", "--outDir", tempDir, temporarySource
        ],
        { cwd: path.resolve(__dirname, ".."), stdio: "pipe", timeout: 45000 }
    );
    compiledJavaScript = fs.readFileSync(
        path.join(tempDir, "home-changelog-panel.js"), "utf8"
    );
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
const identity = { version: "0.0.13", channel: "stable" };
let selectedIdentity = { ...identity };
let apiOffline = false;
let invoked = [];
const notes = {
    "zh-CN": {
        ...identity, language: "zh-CN",
        groups: [
            { code: "lvgl", label: "LVGL 库", title: "LVGL 项目体验",
              items: ["中文第一条", "中文第二条"] },
            { code: "performance", label: "性能", title: "运行速度",
              items: ["中文性能说明"] }
        ]
    },
    "en-US": {
        ...identity, language: "en-US",
        groups: [
            { code: "lvgl", label: "LVGL Library", title: "LVGL Project Experience",
              items: ["English first item", "English second item"] },
            { code: "performance", label: "Performance", title: "Speed",
              items: ["English performance update"] }
        ]
    }
};
const ipcRenderer = {
    async invoke(name, language) {
        invoked.push({ name, language });
        if (name === "digistudio:release:identity") {
            return { ...selectedIdentity };
        }
        if (name === "digistudio:release:changelog") {
            return apiOffline
                ? { ok: false, error: { code: "API_UNAVAILABLE" } }
                : { ok: true, data: notes[language] };
        }
        throw new Error("Unexpected IPC endpoint " + name);
    }
};
const settingsController = observable({ locale: "zh-CN" });
const context = {
    module: { exports: {} },
    exports: {},
    React,
    observer,
    settingsController,
    ipcRenderer,
    studioVersion: identity.version,
    validateDigiwiseChangelog,
    classNames: argument => Object.keys(argument)
        .filter(key => Boolean(argument[key])).join(" "),
    window: page.window
};
vm.runInNewContext(compiledJavaScript, context, {
    filename: "real-home-latest-changes-transpiled.js"
});
const HomeLatestChangesPanel = context.module.exports;
assert.ok(typeof HomeLatestChangesPanel === "function" || typeof HomeLatestChangesPanel === "object", "Expected a React component or memoized observer");

let root;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function mount() {
    const host = page.window.document.getElementById("app");
    root = createRoot(host);
    await act(async () => {
        root.render(React.createElement(HomeLatestChangesPanel));
        await sleep(25);
    });
}
async function unmount() {
    if (root) {
        await act(async () => { root.unmount(); });
        root = undefined;
    }
    page.window.document.getElementById("app").replaceChildren();
}
async function update(ms = 25) {
    await act(async () => { await sleep(ms); });
}
async function until(text) {
    for (let i = 0; i < 12; i++) {
        await update(10);
        if (page.window.document.querySelector(".EezStudio_HomeTab_Updates")?.textContent?.includes(text)) {
            return;
        }
    }
    throw new Error("Expected DOM text not shown: " + text +
        "; actual: " + page.window.document.querySelector(".EezStudio_HomeTab_Updates")?.textContent);
}

async function main() {
    try {
        await mount();
        await until("中文第一条");
        const tabs = page.window.document.querySelectorAll(
            ".EezStudio_HomeTab_UpdatesTabs button"
        );
        assert.equal(tabs.length, 2);
        assert.equal(tabs[0].getAttribute("aria-selected"), "true");
        assert.ok(page.window.document.body.textContent.includes("LVGL 项目体验"));
        assert.ok(page.window.document.body.textContent.includes("当前版本 0.0.13"));

        await act(async () => { tabs[1].click(); });
        await until("中文性能说明");
        assert.equal(tabs[1].getAttribute("aria-selected"), "true");
        assert.ok(!page.window.document.body.textContent.includes("中文第一条"));
        console.log("ACTUAL_REACT_DOM_CATEGORY_SWITCH_PASS");

        await act(async () => {
            runInAction(() => { settingsController.locale = "en-US"; });
            await sleep(25);
        });
        await until("English first item");
        assert.ok(page.window.document.body.textContent.includes("Latest Changes"));
        assert.ok(page.window.document.body.textContent.includes("LVGL Project Experience"));
        assert.equal(page.window.document.querySelectorAll(
            ".EezStudio_HomeTab_UpdatesTabs button"
        ).length, 2);
        console.log("ACTUAL_REACT_DOM_LANGUAGE_SWITCH_PASS");

        const cache = page.window.localStorage.getItem(
            "digiwise-ide-changelog-v1:stable:0.0.13:en-US"
        );
        assert.ok(cache, "Successful response not cached");
        assert.equal(JSON.parse(cache).groups[0].items[0], "English first item");

        await unmount();
        apiOffline = true;
        await mount();
        await until("English first item");
        assert.ok(page.window.document.body.textContent.includes("English first item"));
        console.log("ACTUAL_REACT_DOM_EXACT_VERSION_CACHE_PASS");

        await unmount();
        selectedIdentity = { version: "0.0.14", channel: "stable" };
        await mount();
        await until("No published release notes for this version");
        assert.ok(!page.window.document.body.textContent.includes("English first item"));
        console.log("ACTUAL_REACT_DOM_CROSS_VERSION_CACHE_REJECTION_PASS");

        await unmount();
        selectedIdentity = { version: "0.0.13", channel: "dev" };
        await mount();
        await until("No published release notes for this version");
        assert.ok(!page.window.document.body.textContent.includes("English first item"));
        console.log("ACTUAL_REACT_DOM_CROSS_CHANNEL_CACHE_REJECTION_PASS");

        assert.ok(invoked.some(i => i.name === "digistudio:release:changelog" &&
            i.language === "zh-CN"));
        assert.ok(invoked.some(i => i.name === "digistudio:release:changelog" &&
            i.language === "en-US"));
        console.log("IDE_CHANGELOG_REACT_DOM_INTERACTION_PASS");
    } finally {
        await unmount();
        page.window.close();
    }
}
main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
