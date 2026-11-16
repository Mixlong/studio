/**
 * DigiwiseStudio MCP actual IDE E2E acceptance.
 * Requires an intentionally enabled local write switch + user approval dialog.
 * Only creates and modifies a NEW isolated project under artifacts/mcp-acceptance.
 * Usage: node packages/mcp/test-live-e2e.mjs --execute
 * Never auto-grants privileges, overwrites files, or edits the pre-existing project.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { callBridge } from "./bridge-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const destination = path.join(root, "artifacts", "mcp-acceptance");
fs.mkdirSync(destination, { recursive: true });
const now = new Date().toISOString().replace(/[.:-]/g, "").replace("T", "_").slice(0, 15);
const dir = fs.mkdtempSync(path.join(destination, "run-" + now + "-"));
const demoPath = path.join(dir, "MCP_Acceptance.eez-project");
const reportPath = path.join(dir, "acceptance-report.json");
const checks = [];
let currentStage = "preflight";
let demoCreated = false;
let demoLoaded = false;

const record = (name, detail = "") => {
    checks.push({ name, status: "pass", detail, at: new Date().toISOString() });
    console.log("PASS", name, detail);
};
const step = async (name, fn) => {
    currentStage = name;
    const result = await fn();
    record(name);
    return result;
};
const call = async (tool, args = {}) => await callBridge(tool, args);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (tool, limit = 80000) => {
    const start = Date.now();
    while (Date.now() - start < limit) {
        const result = await call(tool);
        if (result.status !== "running") return result;
        await sleep(1100);
    }
    throw new Error(tool + " did not finish before timeout");
};
const assertProject = async () => {
    const current = await call("get_current_project");
    assert.equal(path.resolve(current.path).toLowerCase(), demoPath.toLowerCase(),
        "Active project changed; refusing to edit a different project");
    return current;
};
const write = async (tool, args) => {
    await assertProject();
    return await call(tool, { expectedProjectPath: demoPath, ...args });
};
function png1x1() {
    // RGBA PNG, generated locally to exercise the real Bitmap loader.
    const crcTable = Array.from({ length: 256 }, (_, i) => {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    function crc(bytes) {
        let c = 0xffffffff;
        for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }
    function chunk(tag, body) {
        const type = Buffer.from(tag, "ascii");
        const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
        const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([type, body])));
        return Buffer.concat([length, type, body, tail]);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(Buffer.from([0, 48, 164, 219, 255]))),
        chunk("IEND", Buffer.alloc(0))
    ]);
}
try {
    const capabilities = await step("fresh IDE capabilities", async () => {
        const result = await call("get_mcp_capabilities");
        assert.ok(result.readTools.includes("get_action_graph"));
        assert.ok(result.writeTools.includes("move_widget"));
        assert.ok(result.writeTools.includes("start_project_build"));
        return result;
    });
    const before = await step("pre-existing project safety", async () => {
        let project;
        try {
            project = await call("get_current_project");
        } catch (error) {
            if (error.code === "NO_ACTIVE_PROJECT") {
                // A Home tab is safe: creating a NEW project does not close
                // or modify any existing tabs. Nothing here grants write access.
                return { noActiveProject: true };
            }
            throw error;
        }
        assert.equal(project.runMode, false, "Exit Run Mode first");
        assert.equal(project.modified, false, "Current project has unsaved edits; stop before switching tabs");
        assert.ok(project.path && path.resolve(project.path).toLowerCase() !== demoPath.toLowerCase());
        return project;
    });
    if (!process.argv.includes("--execute")) {
        console.log("READ_ONLY_PREFLIGHT_PASS: Use --execute only with MCP Server enabled, and approve the local write dialog.");
    } else {
        const created = await step("create standalone Flow LVGL project through MCP", async () => {
            const r = await call("create_project", {
                projectPath: demoPath, lvglVersion: "8.4.0", flowSupport: true,
                displayWidth: 800, displayHeight: 480, openWhenDone: true
            });
            assert.equal(r.created, true); assert.equal(r.openRequested, true);
            assert.ok(fs.existsSync(demoPath));
            return r;
        });
        demoCreated = true;
        await step("new project actually loads in IDE", async () => {
            for (let i = 0; i < 25; i++) {
                const cur = await call("get_current_project").catch(() => null);
                if (cur?.path && path.resolve(cur.path).toLowerCase() === demoPath.toLowerCase()) {
                    assert.equal(cur.modified, false);
                    demoLoaded = true;
                    return;
                }
                await sleep(900);
            }
            throw new Error("openRequested did not lead to an active project; do not edit prior tab");
        });
        const pagesBefore = await call("list_pages");
        assert.ok(pagesBefore.pages.length > 0);
        const a = await step("create Page A", () => write("create_page", { name: "AcceptanceA" }));
        const b = await step("create Page B", () => write("create_page", { name: "AcceptanceB" }));
        assert.ok(a.pageId && b.pageId && a.pageId !== b.pageId);
        const label = await step("add label to Page A", () => write("add_widget", {
            pageName: "AcceptanceA", widgetType: "LVGLLabelWidget",
            properties: { identifier: "mcp_caption", left: 26, top: 30,
                width: 280, height: 36, text: "MCP live acceptance" }
        }));
        assert.ok(label.widgetId && Array.isArray(label.widgetPath));
        const button = await step("add button to Page A", () => write("add_widget", {
            pageName: "AcceptanceA", widgetType: "LVGLButtonWidget",
            properties: { identifier: "mcp_trigger", left: 26, top: 90,
                width: 142, height: 45 }
        }));
        assert.ok(button.widgetId);
        await step("runtime schema for new label", async () => {
            const schema = await call("get_widget_schema", {
                pageName: "AcceptanceA", widgetPath: label.widgetPath
            });
            assert.ok(schema.bindableProperties.some(p => p.name === "text"));
        });
        const style = await step("create actual LVGL Style", () => write("create_style", {
            name: "AcceptanceCaption", widgetType: "LVGLLabelWidget"
        }));
        const styleList = await call("list_styles");
        const styleEntry = styleList.styles.find(item => item.name === "AcceptanceCaption");
        assert.ok(styleEntry?.styleId, "New Style missing in live IDE");
        await step("write global text color", () => write("set_style_property", {
            stylePath: styleEntry.stylePath, styleId: styleEntry.styleId,
            part: "MAIN", state: "DEFAULT", property: "text_color", value: "#3AB8FF"
        }));
        await step("attach Style to label", () => write("update_widget", {
            pageName: "AcceptanceA", widgetPath: label.widgetPath,
            widgetId: label.widgetId, properties: { useStyle: "AcceptanceCaption" }
        }));
        const variable = await step("create global typed variable", () => write("create_variable", {
            name: "AcceptanceStatus", type: "string", initialValue: "Ready"
        }));
        assert.ok(variable.variableId);
        await step("bind label to variable", () => write("bind_widget_variable", {
            pageName: "AcceptanceA", widgetPath: label.widgetPath,
            widgetId: label.widgetId, property: "text", variableName: "AcceptanceStatus"
        }));
        const action = await step("create real Flow Action", () => write("create_action", {
            name: "AcceptanceFlow"
        }));
        const actionRef = { actionName: "AcceptanceFlow", actionId: action.actionId };
        const n1 = await step("create Flow Start", () => write("add_action_node", {
            ...actionRef, nodeType: "StartActionComponent", left: 20, top: 50
        }));
        const n2 = await step("create Flow SetVariable", () => write("add_action_node", {
            ...actionRef, nodeType: "SetVariableActionComponent",
            left: 190, top: 50, variableName: "AcceptanceStatus", value: "Pressed"
        }));
        const n3 = await step("create Flow Delay", () => write("add_action_node", {
            ...actionRef, nodeType: "DelayActionComponent",
            left: 360, top: 50, milliseconds: 250
        }));
        const n4 = await step("create Flow End", () => write("add_action_node", {
            ...actionRef, nodeType: "EndActionComponent", left: 530, top: 50
        }));
        for (const [source, target] of [[n1, n2], [n2, n3], [n3, n4]]) {
            await step("connect Flow " + source.nodeType + " -> " + target.nodeType,
                () => write("connect_action_nodes", {
                    ...actionRef, sourceId: source.nodeId, targetId: target.nodeId
                }));
        }
        await step("read back actual Flow graph", async () => {
            const graph = await call("get_action_graph", actionRef);
            assert.equal(graph.nodes.length, 4); assert.equal(graph.lines.length, 3);
            const entry = graph.nodes.find(node => node.type === "SetVariableActionComponent");
            assert.equal(entry?.variableName, "AcceptanceStatus");
            assert.equal(entry?.value, "Pressed");
        });
        await step("bind button CLICKED event to Action", () => write("add_widget_event", {
            pageName: "AcceptanceA", widgetPath: button.widgetPath, widgetId: button.widgetId,
            eventName: "CLICKED", actionName: "AcceptanceFlow"
        }));
        const duplicated = await step("duplicate existing widget", () => write("duplicate_widget", {
            pageName: "AcceptanceA", widgetPath: label.widgetPath, widgetId: label.widgetId,
            newIdentifier: "mcp_caption_copy", left: 330, top: 30
        }));
        assert.ok(duplicated.widgetId && duplicated.widgetId !== label.widgetId);
        await step("verify Undo for duplication", async () => {
            await write("undo", {});
            const tree = await call("list_widgets", { pageName: "AcceptanceA" });
            assert.ok(!JSON.stringify(tree).includes("mcp_caption_copy"));
        });
        await step("verify Redo for duplication", async () => {
            await write("redo", {});
            const tree = await call("list_widgets", { pageName: "AcceptanceA" });
            assert.ok(JSON.stringify(tree).includes("mcp_caption_copy"));
        });
        const treeA = await call("list_widgets", { pageName: "AcceptanceA" });
        const locate = (items, id) => {
            for (const node of items) {
                if (node.widgetId === id) return node;
                const sub = locate(node.children || [], id);
                if (sub) return sub;
            }
        };
        const copied = locate(treeA.widgets, duplicated.widgetId);
        assert.ok(copied?.widgetPath, "Could not resolve copied widget after Redo");
        await step("move copy across pages", () => write("move_widget", {
            sourcePageName: "AcceptanceA", widgetPath: copied.widgetPath,
            widgetId: duplicated.widgetId, targetPageName: "AcceptanceB"
        }));
        await step("read back moved object", async () => {
            const tree = await call("list_widgets", { pageName: "AcceptanceB" });
            assert.ok(JSON.stringify(tree).includes("mcp_caption_copy"));
        });
        const pngPath = path.join(dir, "mcp-pixel.png");
        fs.writeFileSync(pngPath, png1x1());
        await step("import real PNG Bitmap", () => write("import_bitmap", {
            filePath: pngPath, name: "AcceptancePixel"
        }));
        await step("add actual image widget", () => write("add_widget", {
            pageName: "AcceptanceB", widgetType: "LVGLImageWidget",
            properties: { identifier: "mcp_pixel", left: 30, top: 90,
                width: 16, height: 16, image: "AcceptancePixel" }
        }));
        await step("save project in IDE", () => write("save_project", {}));
        await step("verify serialized project file", async () => {
            const o = JSON.parse(fs.readFileSync(demoPath, "utf8"));
            assert.ok(o.userPages.some(p => p.name === "AcceptanceA"));
            assert.ok(o.userPages.some(p => p.name === "AcceptanceB"));
            assert.ok(o.actions?.some(x => x.name === "AcceptanceFlow"));
            assert.ok(o.variables?.globalVariables?.some(x => x.name === "AcceptanceStatus"));
            assert.ok(o.bitmaps?.some(x => x.name === "AcceptancePixel"));
        });
        await step("read-only project check", async () => {
            const started = await write("start_project_check", {});
            assert.equal(started.started, true);
            const result = await waitFor("get_project_check_status", 100000);
            assert.equal(result.status, "succeeded", "IDE check failed: " + JSON.stringify(result));
        });
        await step("real local Build generation", async () => {
            const started = await write("start_project_build", {});
            assert.equal(started.started, true);
            const result = await waitFor("get_project_build_status", 120000);
            assert.equal(result.status, "succeeded", "IDE Build failed: " + JSON.stringify(result));
            const outputDir = path.join(dir, "src", "ui");
            assert.ok(fs.existsSync(outputDir), "Build output directory missing");
            const files = fs.readdirSync(outputDir);
            assert.ok(files.some(name => name.endsWith(".c")), "No generated C code");
            assert.ok(files.some(name => name.endsWith(".h")), "No generated H code");
        });
        await step("saved active project is unmodified", async () => {
            const project = await assertProject();
            assert.equal(project.modified, false);
        });
        console.log("SUCCESS: Demo project actual MCP E2E accepted at", demoPath);
        console.log("REOPEN_PENDING: GUI Canvas/Properties and reopen-after-restart are separate manual checks.");
    }
} catch (error) {
    const message = (error?.code ? error.code + " " : "") + (error?.stack || error);
    checks.push({ name: currentStage, status: "fail", detail: message, at: new Date().toISOString() });
    console.error("E2E_FAIL:", message);
    process.exitCode = 1;
} finally {
    const failed = checks.filter(x => x.status === "fail");
    const report = {
        version: 1, at: new Date().toISOString(),
        demoPath, demoCreated, demoLoaded,
        result: failed.length ? "failed" : process.argv.includes("--execute") ? "passed-with-manual-visual-reopen-pending" : "read-only-preflight-only",
        checks
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log("E2E_REPORT", reportPath);
}
