/* True live stdio MCP → authenticated bridge → active LVGL renderer
 * screenshot acceptance. Read-only; writes ONLY a local test artifact.
 * Usage: node packages/mcp/test-live-canvas.cjs
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");

(async () => {
    const child = spawn(process.execPath, [join(__dirname, "stdio-cli.mjs")], {
        stdio: ["pipe", "pipe", "pipe"], env: process.env
    });
    let buffer = "";
    let errors = "";
    let id = 0;
    const pending = new Map();
    child.stdout.on("data", bytes => {
        buffer += bytes.toString("utf8");
        while (buffer.includes("\n")) {
            const cursor = buffer.indexOf("\n");
            const row = buffer.slice(0, cursor);
            buffer = buffer.slice(cursor + 1);
            if (!row.trim()) continue;
            const message = JSON.parse(row);
            if (pending.has(message.id)) {
                const fn = pending.get(message.id);
                pending.delete(message.id);
                fn(message);
            }
        }
    });
    child.stderr.on("data", bytes => { errors += bytes.toString("utf8"); });
    const request = (method, params = {}) => new Promise((resolve, reject) => {
        const requestId = ++id;
        const timeout = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error("MCP request timeout " + method + ": " + errors));
        }, 11000);
        pending.set(requestId, message => {
            clearTimeout(timeout);
            resolve(message);
        });
        child.stdin.write(JSON.stringify({
            jsonrpc: "2.0", id: requestId, method, params
        }) + "\n");
    });
    try {
        const initialized = await request("initialize", {
            protocolVersion: "2026-07-28", capabilities: {},
            clientInfo: { name: "Digiwise MCP live screenshot acceptance", version: "1.0" }
        });
        assert.ok(!initialized.error, JSON.stringify(initialized.error));
        child.stdin.write(JSON.stringify({
            jsonrpc: "2.0", method: "notifications/initialized"
        }) + "\n");
        const project = await request("tools/call", {
            name: "get_current_project", arguments: {}
        });
        assert.ok(!project.result?.isError, "Open the isolated LVGL editor project: " + JSON.stringify(project));
        const details = project.result.structuredContent;
        assert.ok(details?.path?.endsWith(".eez-project"));
        assert.equal(details.runMode, false);
        const active = await request("tools/call", {
            name: "get_active_page", arguments: {}
        });
        assert.ok(!active.result?.isError, "Open the desired LVGL canvas page: " + JSON.stringify(active));
        const page = active.result.structuredContent;
        assert.ok(page?.pageId);
        const snapshot = await request("tools/call", {
            name: "get_canvas_snapshot", arguments: { pageId: page.pageId }
        });
        assert.ok(!snapshot.result?.isError, JSON.stringify(snapshot).slice(0, 1200));
        const body = snapshot.result;
        const metadata = body.structuredContent;
        assert.equal(metadata?.pageId, page.pageId);
        assert.equal(metadata?.pageName, page.pageName);
        assert.equal(metadata?.simulationVerified, false);
        assert.equal(metadata?.mimeType, "image/png");
        const image = body.content?.find(item => item.type === "image");
        assert.equal(image?.mimeType, "image/png");
        const png = Buffer.from(image.data, "base64");
        assert.ok(png.length > 64 && png.length < 1_100_000);
        assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.equal(png.readUInt32BE(16), metadata.capturedWidth);
        assert.equal(png.readUInt32BE(20), metadata.capturedHeight);
        const out = join(__dirname, "../../artifacts/mcp-acceptance");
        mkdirSync(out, { recursive: true });
        const filename = join(out, "canvas-v2-stdio-live.png");
        writeFileSync(filename, png);
        const report = {
            result: "passed-live-stdio-editor-canvas", projectPath: details.path,
            pageName: page.pageName, pageId: page.pageId,
            width: metadata.width, height: metadata.height,
            capturedWidth: metadata.capturedWidth,
            capturedHeight: metadata.capturedHeight,
            pngBytes: png.length, simulationVerified: false,
            file: filename, checkedAt: new Date().toISOString()
        };
        writeFileSync(join(out, "canvas-v2-stdio-live-report.json"),
            JSON.stringify(report, null, 2));
        console.log("PASS live stdio MCP PNG:", JSON.stringify(report));
    } finally {
        child.kill();
    }
})().catch(error => {
    console.error("FAIL live stdio canvas", error.stack || error);
    process.exitCode = 1;
});
