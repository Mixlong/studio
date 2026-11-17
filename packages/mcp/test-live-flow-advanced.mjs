/**
 * DigiwiseStudio MCP advanced Flow acceptance, isolated LVGL 8.4 WASM only.
 *
 * Run explicitly with: node packages/mcp/test-live-flow-advanced.mjs --execute
 * Creates a NEW isolated artifacts/mcp-acceptance/advanced-flow-[id] project, never
 * edits EmptyUI or other pre-existing user projects.
 *
 * Expected runtime path:
 *   Main.Check(false) -> Blocked -> Back -> Main
 *   Main.EnableReady -> Main.Check(true) -> CallAction -> Approved
 *
 * All writes pass through the authenticated bridge and IDE local approval.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callBridge } from "./bridge-client.mjs";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const run = process.argv.includes("--execute");
if (!run) {
    console.error("Refusing live E2E without --execute; this test requires local IDE authorization");
    process.exit(2);
}
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(projectRoot, "artifacts", "mcp-acceptance");
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(path.join(root, "advanced-flow-"));
const projectPath = path.join(dir, "Advanced_Flow_MCP.eez-project");
const checks = [];
const report = {
    scenario: "IsTrue false + SetVariable true + CallAction + LVGL screen change",
    projectPath, result: "not_started", checks,
    createdAt: new Date().toISOString()
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const pass = (name, detail = null) => {
    checks.push({ name, status: "PASS", detail });
    console.log("PASS", name, detail ? JSON.stringify(detail) : "");
};
const requireProject = async () => {
    const p = await callBridge("get_current_project");
    assert.equal(path.resolve(p.path).toLowerCase(), projectPath.toLowerCase(),
        "Active IDE project changed — stopping to protect other projects");
    return p;
};
const write = async (tool, args = {}) => {
    if (tool !== "create_project") await requireProject();
    return callBridge(tool, {
        ...(tool === "create_project" ? {} : { expectedProjectPath: projectPath }),
        ...args
    });
};
async function waitCurrentProject() {
    for (let i = 0; i < 55; i++) {
        try {
            const current = await requireProject();
            if (current.path) return current;
        } catch (error) {
            if (i === 54) throw error;
        }
        await delay(350);
    }
    throw new Error("IDE did not select isolated project");
}
async function createPage(name, text) {
    const newPage = await write("create_page", { name, width: 800, height: 480 });
    assert.ok(newPage.created);
    const label = await write("add_widget", {
        pageName: name, widgetType: "LVGLLabelWidget",
        properties: {
            identifier: "Mcp" + name + "Label", text, left: 300, top: 205,
            width: 250, height: 45
        }
    });
    assert.ok(label.created);
    return newPage;
}
async function widget(pageName, identifier, type, properties) {
    const result = await write("add_widget", {
        pageName, widgetType: type, properties: { identifier, ...properties }
    });
    assert.ok(result.created && result.widgetId && result.widgetPath);
    return result;
}
async function action(name, nodes, edges) {
    const result = await write("create_action", { name });
    assert.ok(result.created && result.actionId);
    const identity = { actionName: name, actionId: result.actionId };
    const ids = {};
    for (const node of nodes) {
        const { key, type, ...parameters } = node;
        const added = await write("add_action_node", {
            ...identity, nodeType: type, ...parameters
        });
        assert.ok(added.created && added.nodeId);
        ids[key] = added.nodeId;
    }
    for (const [from, to, output] of edges) {
        const linked = await write("connect_action_nodes", {
            ...identity, sourceId: ids[from], targetId: ids[to],
            ...(output ? { output } : {})
        });
        assert.ok(linked.created || linked.connected,
            "Flow connection not acknowledged: " + JSON.stringify(linked));
    }
    const graph = await callBridge("get_action_graph", identity);
    assert.equal(graph.nodes.length, nodes.length);
    assert.equal(graph.lines.length, edges.length);
    return { ...identity, graph };
}
async function bindClick(pageName, button, actionName) {
    const added = await write("add_widget_event", {
        pageName, widgetPath: button.widgetPath, widgetId: button.widgetId,
        eventName: "CLICKED", actionName
    });
    assert.ok(added.created);
}
async function awaitState(pageName, maxMs = 12000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxMs) {
        const current = await callBridge("get_preview_status");
        if (current.state === "error" || current.state === "stopped") {
            throw new Error("WASM preview stopped/failed: " + JSON.stringify(current));
        }
        if (current.state === "running" && current.selectedPage === pageName &&
            current.selectedPageId) return current;
        await delay(250);
    }
    throw new Error("WASM did not navigate to " + pageName);
}
async function takeFrame(pageId) {
    for (let i = 0; i < 18; i++) {
        try {
            const frame = await callBridge("get_preview_snapshot", { pageId });
            const bytes = Buffer.from(frame.pngBase64, "base64");
            assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
            assert.equal(bytes.readUInt32BE(16), frame.capturedWidth);
            assert.equal(bytes.readUInt32BE(20), frame.capturedHeight);
            return { frame, bytes, pixels: PNG.sync.read(bytes) };
        } catch (error) {
            if (i === 17 || error.code !== "INVALID_STATE") throw error;
            await delay(300);
        }
    }
}
function changedPercent(a, b) {
    assert.equal(a.width, b.width);
    assert.equal(a.height, b.height);
    let different = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        const rgb = Math.abs(a.data[i] - b.data[i]) +
            Math.abs(a.data[i + 1] - b.data[i + 1]) +
            Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (rgb > 72) different++;
    }
    return Number((different * 100 / (a.width * a.height)).toFixed(3));
}
async function stablePage(expectedName, before, outputName) {
    const state = await awaitState(expectedName);
    let previousHash;
    for (let i = 0; i < 30; i++) {
        await delay(250);
        const candidate = await takeFrame(state.selectedPageId);
        const hash = sha(candidate.bytes);
        const percent = changedPercent(before.pixels, candidate.pixels);
        // In this controlled demo, page layouts are deliberately different.
        // State alone / a transient button-press hash does not prove navigation.
        if (percent >= 2 && hash === previousHash) {
            writeFileSync(path.join(dir, outputName), candidate.bytes);
            pass("stable render " + expectedName, {
                percentChanged: percent, sameHashFrames: 2, png: outputName
            });
            return candidate;
        }
        previousHash = hash;
    }
    throw new Error("Runtime changed page but " + expectedName + " never settled visually");
}
async function tap(page, x, y) {
    const status = await awaitState(page);
    // Real IDE rate limits touches to 300 ms; allow a full pause between taps.
    await delay(380);
    const event = await write("preview_tap", {
        pageId: status.selectedPageId, x, y
    });
    assert.equal(event.dispatched, true);
}
async function pollTask(name, taskId) {
    for (let i = 0; i < 50; i++) {
        const result = await callBridge(name);
        if (result.taskId === taskId && result.status !== "running") return result;
        await delay(300);
    }
    throw new Error(name + " timeout");
}
let runtimeStarted = false;
try {
    if (!run) throw new Error("Refusing writes without explicit --execute");
    if (existsSync(projectPath)) throw new Error("Project must not exist");

    // Do not switch away from a dirty user project. On the IDE Home tab a
    // NO_ACTIVE_PROJECT reply is normal.
    try {
        const original = await callBridge("get_current_project");
        assert.equal(original.modified, false,
            "Save current user project before starting isolated acceptance");
        assert.equal(original.runMode, false,
            "Stop current user's runtime before starting acceptance");
    } catch (error) {
        if (error.code !== "NO_ACTIVE_PROJECT") throw error;
    }
    const created = await write("create_project", {
        projectPath, lvglVersion: "8.4.0", flowSupport: true,
        displayWidth: 800, displayHeight: 480, openWhenDone: true
    });
    assert.equal(created.created, true);
    const active = await waitCurrentProject();
    assert.equal(active.modified, false);
    pass("isolated LVGL Flow project", { projectPath });

    const initialPages = await callBridge("list_pages");
    assert.ok(initialPages.pages.some(p => p.name === "Main"));
    await createPage("Approved", "ALLOWED");
    await createPage("Blocked", "BLOCKED");
    const btnEnable = await widget("Main", "McpEnable", "LVGLButtonWidget", {
        left: 130, top: 300, width: 200, height: 85
    });
    const btnCheck = await widget("Main", "McpCheck", "LVGLButtonWidget", {
        left: 460, top: 300, width: 200, height: 85
    });
    await widget("Main", "McpEnableLabel", "LVGLLabelWidget", {
        text: "ENABLE", left: 188, top: 260, width: 100, height: 32
    });
    await widget("Main", "McpCheckLabel", "LVGLLabelWidget", {
        text: "CHECK", left: 522, top: 260, width: 100, height: 32
    });
    const btnBack = await widget("Blocked", "McpBack", "LVGLButtonWidget", {
        left: 300, top: 330, width: 200, height: 85
    });
    pass("UI pages and test buttons");

    const ready = await write("create_variable", {
        name: "DeviceReady", type: "boolean", initialValue: false
    });
    const resultVar = await write("create_variable", {
        name: "DeviceResult", type: "string", initialValue: "INIT"
    });
    assert.equal(ready.created, true);
    assert.equal(resultVar.created, true);
    pass("typed global variables", { DeviceReady: false, DeviceResult: "INIT" });

    // Build called Action FIRST so CallAction identity validation sees it.
    const approve = await action("McpApprove", [
        { key: "start", type: "StartActionComponent", left: 20, top: 90 },
        { key: "result", type: "SetVariableActionComponent", left: 180, top: 90,
            variableName: "DeviceResult", value: "ALLOWED" },
        { key: "nav", type: "LVGLActionComponent", left: 390, top: 90,
            screenName: "Approved" },
        { key: "end", type: "EndActionComponent", left: 600, top: 90 }
    ], [["start", "result"], ["result", "nav"], ["nav", "end"]]);
    const enable = await action("McpEnableReady", [
        { key: "start", type: "StartActionComponent", left: 20, top: 50 },
        { key: "set", type: "SetVariableActionComponent", left: 205, top: 50,
            variableName: "DeviceReady", value: true },
        { key: "end", type: "EndActionComponent", left: 400, top: 50 }
    ], [["start", "set"], ["set", "end"]]);
    const goBack = await action("McpReturnMain", [
        { key: "start", type: "StartActionComponent", left: 20, top: 50 },
        { key: "nav", type: "LVGLActionComponent", left: 205, top: 50,
            screenName: "Main" },
        { key: "end", type: "EndActionComponent", left: 400, top: 50 }
    ], [["start", "nav"], ["nav", "end"]]);
    const check = await action("McpCheckReady", [
        { key: "start", type: "StartActionComponent", left: 20, top: 70 },
        { key: "if", type: "IsTrueActionComponent", left: 205, top: 70,
            conditionVariableName: "DeviceReady" },
        { key: "call", type: "CallActionActionComponent", left: 425, top: 30,
            targetActionName: "McpApprove" },
        { key: "trueEnd", type: "EndActionComponent", left: 640, top: 30 },
        { key: "blocked", type: "LVGLActionComponent", left: 425, top: 235,
            screenName: "Blocked" },
        { key: "falseEnd", type: "EndActionComponent", left: 640, top: 235 }
    ], [
        ["start", "if"], ["if", "call", "True"], ["call", "trueEnd"],
        ["if", "blocked", "False"], ["blocked", "falseEnd"]
    ]);
    assert.ok(check.graph.lines.some(e => e.output === "True"));
    assert.ok(check.graph.lines.some(e => e.output === "False"));
    assert.ok(check.graph.nodes.some(n => n.targetActionName === "McpApprove"));
    pass("IsTrue branches and CallAction graphs", {
        graphs: [approve.actionName, enable.actionName, goBack.actionName, check.actionName]
    });

    await bindClick("Main", btnEnable, "McpEnableReady");
    await bindClick("Main", btnCheck, "McpCheckReady");
    await bindClick("Blocked", btnBack, "McpReturnMain");
    const boundEvents = JSON.stringify(await callBridge("list_widget_events", { pageName: "Main" }));
    assert.ok(boundEvents.includes("McpEnableReady") && boundEvents.includes("McpCheckReady"));
    pass("CLICKED event bindings");

    const saved = await write("save_project");
    assert.ok(saved.saved);
    assert.equal((await requireProject()).modified, false);
    const projectData = JSON.parse(readFileSync(projectPath, "utf8"));
    assert.ok(projectData.userPages.some(p => p.name === "Approved"));
    assert.ok(projectData.userPages.some(p => p.name === "Blocked"));
    assert.ok(projectData.actions.some(a => a.name === "McpCheckReady"));
    assert.ok(projectData.actions.some(a => a.name === "McpApprove"));
    assert.ok(JSON.stringify(projectData).includes("DeviceReady"));
    pass("saved project JSON model");

    const started = await write("start_preview");
    runtimeStarted = !!started.requested;
    assert.ok(runtimeStarted);
    const initial = await awaitState("Main");
    const initialFrame = await takeFrame(initial.selectedPageId);
    writeFileSync(path.join(dir, "main-before.png"), initialFrame.bytes);
    pass("initial WASM frame", { page: "Main" });

    await tap("Main", 560, 345);
    const blockedFrame = await stablePage("Blocked", initialFrame, "blocked.png");
    pass("IsTrue FALSE branch", { destination: "Blocked" });

    await tap("Blocked", 400, 375);
    const mainAgain = await stablePage("Main", blockedFrame, "main-return.png");
    pass("return to Main");

    await tap("Main", 230, 345); // EnableReady -> SetVariable(DeviceReady,true)
    await delay(500);
    assert.equal((await callBridge("get_preview_status")).selectedPage, "Main");
    await tap("Main", 560, 345); // IsTrue TRUE -> CallAction -> SetVariable + Approved
    await stablePage("Approved", mainAgain, "approved.png");
    pass("IsTrue TRUE / CallAction / SetVariable / navigation", {
        destination: "Approved"
    });
    report.result = "passed-advanced-flow-wasm";
} catch (error) {
    report.result = "failed";
    report.error = { code: error?.code || null, message: String(error?.message || error) };
    console.error("ADVANCED_FLOW_E2E_FAILED", report.error);
    process.exitCode = 1;
} finally {
    if (runtimeStarted) {
        try {
            const stopped = await write("stop_preview");
            assert.equal(stopped.stopped, true);
            assert.equal((await callBridge("get_preview_status")).state, "idle");
            pass("preview stopped");
        } catch (error) {
            report.stopError = String(error?.message || error);
            process.exitCode = 1;
        }
    }
    if (report.result === "passed-advanced-flow-wasm" && process.exitCode !== 1) {
        try {
            const check = await write("start_project_check");
            assert.equal(check.started, true);
            const checked = await pollTask("get_project_check_status", check.taskId);
            assert.equal(checked.status, "succeeded", JSON.stringify(checked));
            assert.equal(checked.errors, 0);
            pass("editor Check", { errors: checked.errors, warnings: checked.warnings });
            const build = await write("start_project_build");
            assert.equal(build.started, true);
            const built = await pollTask("get_project_build_status", build.taskId);
            assert.equal(built.status, "succeeded", JSON.stringify(built));
            assert.equal(built.errors, 0);
            for (const name of ["screens.c", "screens.h", "actions.h", "ui.c", "ui.h"]) {
                assert.ok(existsSync(path.join(dir, "src", "ui", name)),
                    "Missing built " + name);
            }
            pass("native C/H Build", { errors: built.errors, warnings: built.warnings });
        } catch (error) {
            report.result = "failed-check-build";
            report.checkBuildError = String(error?.message || error);
            process.exitCode = 1;
        }
    }
    try {
        const project = await requireProject();
        report.finalModified = project.modified;
        if (project.modified) {
            report.result = "failed-unexpected-unsaved-modifications";
            process.exitCode = 1;
        }
        pass("isolated project remains unmodified");
    } catch (error) {
        report.finalStateError = String(error?.message || error);
        process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString();
    writeFileSync(path.join(dir, "advanced-flow-acceptance.json"),
        JSON.stringify(report, null, 2));
    console.log("ADVANCED_FLOW_E2E_REPORT", path.join(dir, "advanced-flow-acceptance.json"));
}
