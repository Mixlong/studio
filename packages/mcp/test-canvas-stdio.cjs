/* Verify the real MCP stdio image-content contract through an authenticated fake bridge.
 * No Electron, screen capture, user project, or network service is required.
 */
const assert = require("node:assert/strict");
const { createServer } = require("node:net");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

(async () => {
    const dir = mkdtempSync(join(tmpdir(), "digi-mcp-image-"));
    const nonce = randomBytes(5).toString("hex");
    const socketPath = process.platform === "win32"
        ? `\\\\.\\pipe\\digi-mcp-image-${nonce}` : join(dir, "bridge.sock");
    const token = randomBytes(32).toString("hex");
    const sessionFile = join(dir, "mcp-session.json");
    // Valid 1x1 PNG, not an image of any user's screen.
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jitkAAAAASUVORK5CYII=";
    const metadata = {
        source: "active-lvgl-editor-canvas", pageName: "Acceptance",
        pageId: "test-page", width: 1, height: 1,
        capturedWidth: 1, capturedHeight: 1,
        previewMode: "editor", simulationVerified: false, mimeType: "image/png"
    };
    const server = createServer(socket => {
        let request = "";
        socket.on("data", bytes => {
            request += bytes.toString("utf8");
            if (!request.includes("\n")) return;
            const input = JSON.parse(request.split("\n")[0]);
            const authorized = input.token === token &&
                ["get_canvas_snapshot", "get_preview_snapshot"].includes(input.tool) &&
                input.args?.pageId === "test-page";
            const isPreview = input.tool === "get_preview_snapshot";
            socket.end(JSON.stringify(authorized
                ? { ok: true, result: {
                    ...metadata,
                    ...(isPreview ? { source: "active-lvgl-wasm-preview-canvas",
                        previewMode: "wasm-running", simulationVerified: true, frameVerified: true } : {}),
                    pngBase64: png
                } }
                : { ok: false, error: { code: "INVALID_ARGUMENT", message: "Denied" } }
            ) + "\n");
        });
    });
    let child;
    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(socketPath, resolve);
        });
        writeFileSync(sessionFile, JSON.stringify({
            version: 1, registryVersion: "mcp-2026-11-27-implementation-edit",
            pid: process.pid, socketPath, token
        }), { mode: 0o600 });
        child = spawn(process.execPath, [join(__dirname, "stdio-cli.mjs")], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, DIGISTUDIO_MCP_SESSION_FILE: sessionFile }
        });
        let buffer = "";
        let stderr = "";
        let seq = 0;
        const pending = new Map();
        child.stdout.on("data", bytes => {
            buffer += bytes.toString("utf8");
            while (buffer.includes("\n")) {
                const end = buffer.indexOf("\n");
                const row = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                if (!row.trim()) continue;
                const msg = JSON.parse(row);
                if (pending.has(msg.id)) {
                    const done = pending.get(msg.id);
                    pending.delete(msg.id);
                    done(msg);
                }
            }
        });
        child.stderr.on("data", bytes => { stderr += bytes.toString("utf8"); });
        const request = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++seq;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error("Timeout waiting for " + method + ": " + stderr));
            }, 10000);
            pending.set(id, result => {
                clearTimeout(timer);
                resolve(result);
            });
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        });
        const initialized = await request("initialize", {
            protocolVersion: "2026-07-28",
            capabilities: {},
            clientInfo: { name: "Digi MCP image test", version: "1.0.0" }
        });
        assert.ok(!initialized.error, JSON.stringify(initialized.error));
        child.stdin.write(JSON.stringify({
            jsonrpc: "2.0", method: "notifications/initialized"
        }) + "\n");
        const result = await request("tools/call", {
            name: "get_canvas_snapshot",
            arguments: { pageId: "test-page" }
        });
        assert.equal(result.result?.isError, undefined, JSON.stringify(result));
        const content = result.result?.content;
        assert.ok(Array.isArray(content), JSON.stringify(result));
        assert.equal(content[0].type, "text");
        assert.equal(content[1].type, "image");
        assert.equal(content[1].mimeType, "image/png");
        assert.equal(content[1].data, png);
        assert.equal(JSON.parse(content[0].text).pageId, "test-page");
        assert.equal(result.result?.structuredContent?.pngBase64, undefined,
            "Structured metadata must not duplicate the full PNG payload");
        assert.equal(result.result?.structuredContent?.simulationVerified, false);
        const preview = await request("tools/call", {
            name: "get_preview_snapshot", arguments: { pageId: "test-page" }
        });
        assert.equal(preview.result?.isError, undefined, JSON.stringify(preview));
        assert.equal(preview.result?.content?.[1]?.type, "image");
        assert.equal(preview.result?.content?.[1]?.data, png);
        assert.equal(preview.result?.structuredContent?.simulationVerified, true);
        assert.equal(preview.result?.structuredContent?.frameVerified, true);
        assert.equal(preview.result?.structuredContent?.pngBase64, undefined);
        console.log("PASS: stdio MCP returns editor and WASM preview PNG image content with bounded metadata");
    } finally {
        child?.kill();
        server.close();
        rmSync(dir, { recursive: true, force: true });
    }
})().catch(error => {
    console.error("FAIL canvas MCP image transport", error.stack || error);
    process.exitCode = 1;
});
