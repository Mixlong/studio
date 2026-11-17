/* Real native WASM preview-frame and tap E2E for an *isolated* MCP demo only.
 * Default: read-only inspect if preview already running.
 * --execute: requires local write approval for start/tap/stop; never bypasses it.
 */
import { callBridge } from "./bridge-client.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const execute = process.argv.includes("--execute");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve("artifacts/mcp-acceptance");
const normalize = input => path.resolve(input).toLowerCase();
const state = { startedByTest: false };
async function snapshot(pageId) {
    for (let i = 0; i < 15; ++i) {
        try {
            const frame = await callBridge("get_preview_snapshot", { pageId });
            const buffer = Buffer.from(frame.pngBase64, "base64");
            if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
                buffer.readUInt32BE(16) !== frame.capturedWidth ||
                buffer.readUInt32BE(20) !== frame.capturedHeight ||
                !frame.simulationVerified || !frame.frameVerified) {
                throw new Error("Preview PNG header/dimensions or verification flag invalid");
            }
            return { frame, buffer };
        } catch (error) {
            if (i === 14 || error.code !== "INVALID_STATE") throw error;
            await delay(350);
        }
    }
}
(async () => {
    const project = await callBridge("get_current_project");
    const projectPath = project.path;
    if (typeof projectPath !== "string" || !existsSync(projectPath) ||
        !normalize(projectPath).startsWith(normalize(root) + path.sep) ||
        !projectPath.endsWith(".eez-project") || project.modified || project.runMode) {
        throw new Error("Refusing to preview a non-isolated, unsaved, or Run Mode project");
    }
    let status = await callBridge("get_preview_status");
    if (status.state === "idle" && execute) {
        const started = await callBridge("start_preview", { expectedProjectPath: projectPath });
        if (!started.requested) throw new Error("Preview start was not acknowledged");
        state.startedByTest = true;
    } else if (status.state !== "running") {
        throw new Error(execute ? "Preview cannot start from status " + status.state :
            "Start WASM preview in the isolated IDE or rerun with --execute");
    }
    try {
        for (let i = 0; i < 30; i++) {
            status = await callBridge("get_preview_status");
            if (status.state === "running" && status.selectedPageId) break;
            if (status.state === "error" || status.state === "stopped") {
                throw new Error("Preview failed: " + JSON.stringify(status));
            }
            await delay(400);
        }
        if (status.state !== "running" || !status.selectedPageId) {
            throw new Error("No running WASM preview page reported");
        }
        const before = await snapshot(status.selectedPageId);
        const files = { before: "wasm-preview-before.png", after: "wasm-preview-after.png" };
        mkdirSync(root, { recursive: true });
        writeFileSync(path.join(root, files.before), before.buffer);
        let tap;
        let after = before;
        if (execute) {
            // On the original EmptyUI demo, this is a blank corner of Main.
            // Do not assume button handlers; this verifies native pointer delivery.
            tap = await callBridge("preview_tap", {
                expectedProjectPath: projectPath, pageId: status.selectedPageId, x: 20, y: 20
            });
            if (!tap.dispatched) throw new Error("Native pointer event not dispatched");
            const next = await callBridge("get_preview_status");
            after = await snapshot(next.selectedPageId);
            writeFileSync(path.join(root, files.after), after.buffer);
        }
        const sha256 = b => createHash("sha256").update(b).digest("hex");
        const report = {
            status: "runtime-preview-captured", source: "real MCP/stdio bridge",
            projectPath, pageIdBefore: before.frame.pageId,
            pageIdAfter: after.frame.pageId,
            dimensions: [before.frame.capturedWidth, before.frame.capturedHeight],
            beforeHash: sha256(before.buffer), afterHash: sha256(after.buffer),
            imageChanged: sha256(before.buffer) !== sha256(after.buffer),
            tapDispatched: !!tap?.dispatched,
            actionEffectVerified: false, // requires a known interactive demo behavior
            timestamp: new Date().toISOString()
        };
        writeFileSync(path.join(root, "wasm-preview-live-report.json"),
            JSON.stringify(report, null, 2));
        console.log("PASS real WASM preview image " + JSON.stringify(report));
    } finally {
        if (state.startedByTest) {
            try {
                await callBridge("stop_preview", { expectedProjectPath: projectPath });
                const final = await callBridge("get_preview_status");
                if (final.state !== "idle") {
                    console.error("WARNING preview did not return to idle", final);
                    process.exitCode = 1;
                }
                const projectAfter = await callBridge("get_current_project", {});
                if (!projectAfter.path ||
                    normalize(projectAfter.path) !== normalize(projectPath) ||
                    projectAfter.modified) {
                    console.error("FAIL: Preview changed project or left unexpected unsaved modifications", {
                        path: projectAfter.path, modified: projectAfter.modified
                    });
                    process.exitCode = 1;
                }
            } catch (error) {
                console.error("WARNING preview cleanup/check failed: " + error.message);
                process.exitCode = 1;
            }
        }
    }
})().catch(error => { console.error("FAIL native preview E2E", error.code, error.stack || error); process.exitCode = 1; });
