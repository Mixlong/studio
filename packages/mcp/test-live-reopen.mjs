/**
 * Phase 2 read-only persistence verification, run after safely closing and
 * reopening the independent E2E project in DigiwiseStudio.
 * Usage: node packages/mcp/test-live-reopen.mjs "<absolute-demo.eez-project>"
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { callBridge } from "./bridge-client.mjs";
const target = process.argv[2];
if (!target || !path.isAbsolute(target) || !fs.existsSync(target)) {
    console.error("Usage: test-live-reopen.mjs <existing absolute .eez-project>");
    process.exit(2);
}
const checks = [];
const check = (name, fn) => {
    const result = fn();
    checks.push(name);
    console.log("PASS REOPEN", name);
    return result;
};
try {
    let project;
    for (let i = 0; i < 35; i++) {
        project = await callBridge("get_current_project").catch(() => null);
        if (project?.path &&
            path.resolve(project.path).toLowerCase() === path.resolve(target).toLowerCase()) break;
        await new Promise(resolve => setTimeout(resolve, 800));
    }
    check("exact saved project reloaded, unmodified", () => {
        assert.equal(path.resolve(project?.path || "").toLowerCase(), path.resolve(target).toLowerCase());
        assert.equal(project.modified, false);
    });
    const pages = await callBridge("list_pages");
    check("both acceptance pages survived round-trip", () => {
        assert.ok(pages.pages.some(p => p.name === "AcceptanceA"));
        assert.ok(pages.pages.some(p => p.name === "AcceptanceB"));
    });
    const treeA = await callBridge("list_widgets", { pageName: "AcceptanceA" });
    const treeB = await callBridge("list_widgets", { pageName: "AcceptanceB" });
    check("source and moved widget persisted", () => {
        assert.ok(JSON.stringify(treeA).includes("mcp_caption"));
        assert.ok(JSON.stringify(treeB).includes("mcp_caption_copy"));
        assert.ok(JSON.stringify(treeB).includes("mcp_pixel"));
    });
    const variables = await callBridge("list_variables");
    check("global variable persisted", () =>
        assert.ok(variables.variables.some(v => v.name === "AcceptanceStatus" && v.type === "string")));
    const actions = await callBridge("list_actions");
    const action = actions.actions.find(a => a.name === "AcceptanceFlow");
    check("Flow Action persisted", () => assert.ok(action?.actionId));
    const graph = await callBridge("get_action_graph", {
        actionName: action.name, actionId: action.actionId
    });
    check("Flow graph nodes and links persisted", () => {
        assert.equal(graph.nodes.length, 4);
        assert.equal(graph.lines.length, 3);
        assert.ok(graph.nodes.some(node =>
            node.type === "SetVariableActionComponent" &&
            node.variableName === "AcceptanceStatus" && node.value === "Pressed"));
        assert.ok(graph.nodes.some(node => node.type === "DelayActionComponent" &&
            node.milliseconds === 250));
    });
    const styles = await callBridge("list_styles");
    check("Style persisted", () =>
        assert.ok(styles.styles.some(s => s.name === "AcceptanceCaption")));
    const assets = await callBridge("list_assets");
    check("Bitmap persisted", () =>
        assert.ok(assets.bitmaps.some(b => b.name === "AcceptancePixel")));
    const compiled = path.join(path.dirname(target), "src", "ui");
    check("generated files retained", () => {
        assert.ok(fs.existsSync(compiled));
        assert.ok(fs.readdirSync(compiled).some(name => name.endsWith(".c")));
        assert.ok(fs.readdirSync(compiled).some(name => name.endsWith(".h")));
    });
    const report = {
        at: new Date().toISOString(), target,
        result: "passed-read-model-and-persistence",
        visualCanvas: "not covered by MCP read-only API",
        checks
    };
    fs.writeFileSync(path.join(path.dirname(target), "reopen-report.json"),
        JSON.stringify(report, null, 2), "utf8");
    console.log("REOPEN_PERSISTENCE_ACCEPTANCE_PASS");
} catch (error) {
    console.error("REOPEN_PERSISTENCE_FAIL", error.stack || error);
    process.exitCode = 1;
}
