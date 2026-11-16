/* Private bridge transport test with a fake socket listener. */
const { createServer } = require("node:net");
const { randomBytes } = require("node:crypto");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { writeFileSync, mkdtempSync, rmSync } = require("node:fs");

(async () => {
    const dir = mkdtempSync(join(tmpdir(), "digistudio-mcp-test-"));
    const nonce = randomBytes(6).toString("hex");
    const socketPath = process.platform === "win32"
        ? `\\\\.\\pipe\\digistudio-mcp-test-${nonce}`
        : join(dir, "bridge.sock");
    const token = randomBytes(32).toString("hex");
    const session = join(dir, "mcp-session.json");
    const server = createServer(socket => {
        let request = "";
        socket.on("data", data => {
            request += data.toString();
            if (!request.includes("\n")) return;
            const received = JSON.parse(request.split("\n")[0]);
            if (received.token !== token || received.tool !== "list_pages") {
                socket.end(JSON.stringify({ ok: false, error: { code: "INVALID_ARGUMENT", message: "Denied" } }) + "\n");
                return;
            }
            socket.end(JSON.stringify({
                ok: true,
                result: { pages: [{ name: "Home", width: 800, height: 480 }] }
            }) + "\n");
        });
    });
    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(socketPath, resolve);
        });
        writeFileSync(session, JSON.stringify({
            version: 1,
            registryVersion: "mcp-2026-11-13-r19w37-central-stage",
            pid: process.pid,
            token,
            socketPath
        }), { mode: 0o600 });
        process.env.DIGISTUDIO_MCP_SESSION_FILE = session;
        const { callBridge, READ_ONLY_TOOLS, bridgeRequestTimeoutMs, EXPECTED_REGISTRY_VERSION } = await import("./bridge-client.mjs");
        const { MCP_READ_TOOLS, MCP_WRITE_TOOLS } = require("../../build/mcp/protocol.js");
        const assert = require("node:assert/strict");
        assert.equal(EXPECTED_REGISTRY_VERSION, "mcp-2026-11-13-r19w37-central-stage");
        assert.deepEqual([...READ_ONLY_TOOLS].sort(), [...MCP_READ_TOOLS].sort(),
            "Transport short-timeout set must match exact registered read tools");
        for (const tool of MCP_READ_TOOLS) assert.equal(bridgeRequestTimeoutMs(tool), 8500);
        for (const tool of MCP_WRITE_TOOLS) assert.equal(bridgeRequestTimeoutMs(tool), 195000,
            "Every gated write must allow the user's 125s approval prompt: " + tool);
        const result = await callBridge("list_pages", {});
        if (result.pages?.[0]?.name !== "Home") {
            throw new Error("Bridge response mismatch");
        }
        process.stdout.write("PASS: authenticated local socket transport and response parsing\n");
    } finally {
        server.close();
        rmSync(dir, { recursive: true, force: true });
    }
})().catch(error => {
    process.stderr.write("FAIL: " + error.stack + "\n");
    process.exitCode = 1;
});
