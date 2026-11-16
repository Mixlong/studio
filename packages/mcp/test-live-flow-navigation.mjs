/* End-to-end MCP authoring + real WASM clickable Flow navigation acceptance.
 * Exclusively creates new artifacts/mcp-acceptance/flow-click-* demo; never edits
 * user projects. Requires native DigiwiseStudio local write consent.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { callBridge } from "./bridge-client.mjs";
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

const root = resolve("artifacts/mcp-acceptance");
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, "flow-click-"));
const projectPath = join(directory, "Flow_Click_MCP.eez-project");
const outputFile = join(directory, "acceptance.json");
const png = (filename, frame) => {
    const bytes = Buffer.from(frame.pngBase64, "base64");
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), frame.capturedWidth);
    assert.equal(bytes.readUInt32BE(20), frame.capturedHeight);
    writeFileSync(join(directory, filename), bytes);
    return createHash("sha256").update(bytes).digest("hex");
};
const delay = ms => new Promise(done => setTimeout(done, ms));
const pngBytes = frame => Buffer.from(frame.pngBase64, "base64");
function changedPixelsPercent(beforeBytes, afterBytes) {
    const before = PNG.sync.read(beforeBytes);
    const after = PNG.sync.read(afterBytes);
    assert.equal(before.width, after.width);
    assert.equal(before.height, after.height);
    let changed = 0;
    for (let i = 0; i < before.data.length; i += 4) {
        const rgbDelta = Math.abs(before.data[i] - after.data[i]) +
            Math.abs(before.data[i + 1] - after.data[i + 1]) +
            Math.abs(before.data[i + 2] - after.data[i + 2]);
        if (rgbDelta > 72) changed++;
    }
    return Number((100 * changed / (before.width * before.height)).toFixed(3));
}
async function awaitStableVisualPage(pageId, beforeBytes) {
    // Runtime.selectedPage switches before its WASM framebuffer transition has
    // finished. A different PNG hash alone can be only the button press shade.
    let priorHash = null;
    for (let i = 0; i < 24; i++) {
        await delay(250);
        const frame = await getFrame(pageId);
        const bytes = pngBytes(frame);
        const hash = createHash("sha256").update(bytes).digest("hex");
        const changedPercent = changedPixelsPercent(beforeBytes, bytes);
        if (changedPercent >= 3 && hash === priorHash) {
            return { frame, changedPercent, stableSamples: 2 };
        }
        priorHash = hash;
    }
    throw new Error("Runtime page changed, but no stable target-page pixels arrived (>=3% change)");
}
const report = { projectPath, result: "not_started", steps: [] };
const record = (name, detail) => report.steps.push({ name, detail });
const write = (tool, args = {}) => callBridge(tool, { expectedProjectPath: projectPath, ...args });
let started = false;
async function currentProject() {
    const item = await callBridge("get_current_project", {});
    assert.equal(resolve(item.path).toLowerCase(), resolve(projectPath).toLowerCase());
    return item;
}
async function awaitPage(name, maxMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxMs) {
        const status = await callBridge("get_preview_status", {});
        if (status.state === "error" || status.state === "stopped") {
            throw new Error("Runtime error or stopped: " + JSON.stringify(status));
        }
        if (status.state === "running" && status.selectedPage === name && status.selectedPageId) {
            return status;
        }
        await delay(250);
    }
    throw new Error("WASM Runtime did not reach page " + name + " within " + maxMs + "ms");
}
async function awaitTask(tool, taskId) {
    for (let attempt = 0; attempt < 45; attempt++) {
        const state = await callBridge(tool, {});
        if (state.taskId === taskId && state.status !== "running") return state;
        await delay(250);
    }
    throw new Error(tool + " did not complete within the acceptance window");
}
async function getFrame(pageId) {
    for (let attempt = 0; attempt < 20; attempt++) {
        try { return await callBridge("get_preview_snapshot", { pageId }); }
        catch (error) {
            if (error.code !== "INVALID_STATE" || attempt === 19) throw error;
            await delay(250);
        }
    }
}
try {
    assert.ok(!existsSync(projectPath), "Fresh project path must not exist");
    const created = await callBridge("create_project", {
        projectPath, lvglVersion: "8.4.0", flowSupport: true,
        displayWidth: 800, displayHeight: 480, openWhenDone: true
    });
    assert.ok(created.created, JSON.stringify(created));
    record("create_project", "created new independent LVGL 8.4 Flow project");
    let active;
    for (let i = 0; i < 35; i++) {
        try { active = await currentProject(); break; }
        catch (error) {
            if (i === 34) throw error;
            await delay(250);
        }
    }
    assert.equal(active.modified, false);
    const pagesBefore = await callBridge("list_pages");
    assert.ok(pagesBefore.pages.some(item => item.name === "Main"));
    const successPage = await write("create_page", {
        name: "Success", width: 800, height: 480
    });
    record("create_page", successPage.pageId);
    const successTree = await callBridge("list_widgets", { pageName: "Success" });
    assert.ok(successTree.widgets.some(item => item.type === "LVGLScreenWidget"));
    // Screen root is deliberately not addressable as an editable parent;
    // editor automatically nests new page widgets under it.
    const label = await write("add_widget", {
        pageName: "Success", widgetType: "LVGLLabelWidget",
        properties: { identifier: "McpSuccessLabel", text: "SUCCESS", left: 345, top: 224,
            width: 110, height: 32 }
    });
    assert.ok(label.created, JSON.stringify(label));
    const mainTree = await callBridge("list_widgets", { pageName: "Main" });
    assert.ok(mainTree.widgets.some(item => item.type === "LVGLScreenWidget"));
    const button = await write("add_widget", {
        pageName: "Main", widgetType: "LVGLButtonWidget",
        properties: { identifier: "McpNavigateButton", left: 300, top: 335,
            width: 200, height: 80 }
    });
    assert.ok(button.created, JSON.stringify(button));
    const afterTree = await callBridge("list_widgets", { pageName: "Main" });
    const buttonWidget = afterTree.widgets[0].children?.find(item =>
        item.identifier === "McpNavigateButton");
    assert.ok(buttonWidget, "New button not visible in widget tree");
    const buttonSchema = await callBridge("get_widget_schema", {
        pageName: "Main", widgetPath: buttonWidget.widgetPath
    });
    assert.ok(buttonSchema.availableEvents.includes("CLICKED"));

    const action = await write("create_action", { name: "McpGoSuccess" });
    assert.ok(action.created, JSON.stringify(action));
    const actionMeta = { actionName: "McpGoSuccess", actionId: action.actionId };
    const startNode = await write("add_action_node", {
        ...actionMeta, nodeType: "StartActionComponent", left: 20, top: 70
    });
    const changeNode = await write("add_action_node", {
        ...actionMeta, nodeType: "LVGLActionComponent", left: 210, top: 70,
        screenName: "Success"
    });
    const endNode = await write("add_action_node", {
        ...actionMeta, nodeType: "EndActionComponent", left: 420, top: 70
    });
    await write("connect_action_nodes", {
        ...actionMeta, sourceId: startNode.nodeId, targetId: changeNode.nodeId
    });
    await write("connect_action_nodes", {
        ...actionMeta, sourceId: changeNode.nodeId, targetId: endNode.nodeId
    });
    const event = await write("add_widget_event", {
        pageName: "Main", widgetPath: buttonWidget.widgetPath,
        widgetId: buttonWidget.widgetId, eventName: "CLICKED",
        actionName: "McpGoSuccess"
    });
    assert.ok(event.created);
    const graph = await callBridge("get_action_graph", actionMeta);
    const bindings = await callBridge("list_widget_events", { pageName: "Main" });
    assert.ok(graph.nodes.some(item => item.screenName === "Success"));
    assert.ok(JSON.stringify(bindings).includes("McpGoSuccess"));
    record("Flow", "Button CLICKED → Start → LVGL.changeScreen(Success) → End");

    const saved = await write("save_project");
    assert.ok(saved.saved, JSON.stringify(saved));
    assert.equal((await currentProject()).modified, false);
    record("save_project", "confirmed unmodified before WASM preview");
    const persisted = JSON.parse(readFileSync(projectPath, "utf8"));
    assert.ok(persisted.userPages?.some(item => item.name === "Main"));
    assert.ok(persisted.userPages?.some(item => item.name === "Success"));
    const savedMain = JSON.stringify(persisted.userPages.find(item => item.name === "Main"));
    const savedAction = JSON.stringify(persisted.actions?.find(item => item.name === "McpGoSuccess"));
    for (const marker of ["McpNavigateButton", "CLICKED", "McpGoSuccess"]) {
        assert.ok(savedMain.includes(marker), "Saved Main lost " + marker);
    }
    for (const marker of ["LVGLActionComponent", "changeScreen", "Success"]) {
        assert.ok(savedAction.includes(marker), "Saved Flow Action lost " + marker);
    }
    record("saved_file", "on-disk .eez-project retained pages, clickable button binding and Flow navigation");

    const opened = await write("start_preview");
    started = !!opened.requested;
    assert.ok(started);
    const running = await awaitPage("Main", 12000);
    const before = await getFrame(running.selectedPageId);
    const beforeHash = png("before.png", before);
    record("before_snapshot", { page: running.selectedPage, width: before.width,
        height: before.height, sha256: beforeHash });

    const tapped = await write("preview_tap", {
        pageId: running.selectedPageId, x: 400, y: 375
    });
    assert.ok(tapped.dispatched);
    record("tap", { x: 400, y: 375, runtimePage: tapped.currentPage });
    const success = await awaitPage("Success", 11000);
    const visual = await awaitStableVisualPage(success.selectedPageId, pngBytes(before));
    const afterHash = png("after.png", visual.frame);
    assert.notEqual(beforeHash, afterHash);
    record("after_snapshot", { page: success.selectedPage, sha256: afterHash,
        changedPixelsPercent: visual.changedPercent,
        stableSamples: visual.stableSamples });
    report.result = "passed-real-flow-event-navigation-and-preview";
} catch (error) {
    report.result = "failed";
    report.error = { code: error?.code || null, message: String(error?.message || error) };
    console.error("FLOW_REAL_E2E_FAILURE", report.error);
    process.exitCode = 1;
} finally {
    if (started) {
        try {
            const stopped = await write("stop_preview");
            assert.ok(stopped.stopped);
            const status = await callBridge("get_preview_status");
            assert.equal(status.state, "idle");
            record("stop_preview", "idle");
        } catch (error) {
            record("stop_preview_error", String(error?.message || error));
            process.exitCode = 1;
        }
    }
    if (report.result === "passed-real-flow-event-navigation-and-preview" &&
        process.exitCode !== 1) {
        try {
            assert.equal((await currentProject()).modified, false);
            const check = await write("start_project_check");
            assert.ok(check.started);
            const checkResult = await awaitTask("get_project_check_status", check.taskId);
            assert.equal(checkResult.status, "succeeded", JSON.stringify(checkResult));
            assert.equal(checkResult.errors, 0);
            record("project_check", { status: checkResult.status,
                errors: checkResult.errors, warnings: checkResult.warnings });

            const build = await write("start_project_build");
            assert.ok(build.started);
            const buildResult = await awaitTask("get_project_build_status", build.taskId);
            assert.equal(buildResult.status, "succeeded", JSON.stringify(buildResult));
            assert.equal(buildResult.errors, 0);
            const produced = ["screens.c", "screens.h", "actions.h", "ui.c", "ui.h"];
            for (const file of produced) {
                assert.ok(existsSync(join(directory, "src", "ui", file)),
                    "Missing built file " + file);
            }
            record("project_build", { status: buildResult.status,
                errors: buildResult.errors, warnings: buildResult.warnings,
                verifiedFiles: produced });
        } catch (error) {
            report.result = "failed-check-or-build";
            report.buildOrCheckError = String(error?.message || error);
            process.exitCode = 1;
        }
    }
    try {
        const final = await currentProject();
        report.finalModified = final.modified;
        record("project_state_after_preview", {
            modified: final.modified,
            runMode: final.runMode
        });
        if (final.modified) {
            report.result = report.result === "passed-real-flow-event-navigation-and-preview"
                ? "runtime-passed-but-project-dirtied" : report.result;
            process.exitCode = 1;
        }
    } catch (error) {
        report.finalStateError = String(error?.message || error);
        process.exitCode = 1;
    }
    writeFileSync(outputFile, JSON.stringify(report, null, 2));
    console.log("FLOW_REAL_E2E_RESULT", JSON.stringify(report));
}
