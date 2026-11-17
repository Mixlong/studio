/* Read-only live MCP Inspector / Codex Stdio protocol acceptance.
 * Uses the same initialize -> tools/list -> tools/call sequence as MCP clients.
 * No write tool is ever invoked, even when IDE is authenticated.
 *
 * npm run verify-mcp-client-live
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const projectRoot = join(__dirname, "../..");
const { MCP_READ_TOOLS, MCP_WRITE_TOOLS } = require("../../build/mcp/protocol.js");
const report = {
    type: "real-stdio-client-readonly",
    timestamp: new Date().toISOString(),
    status: "not-started",
    checks: []
};
const child = spawn(process.execPath, [join(__dirname, "stdio-cli.mjs")], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
});
let input = "";
let stderr = "";
let nextId = 0;
const pending = new Map();
function request(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("Stdio MCP client request timed out: " + method +
                " " + stderr.slice(-700)));
        }, 13000);
        pending.set(id, msg => {
            clearTimeout(timer);
            resolve(msg);
        });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
}
child.stdout.on("data", chunk => {
    input += chunk.toString("utf8");
    while (input.includes("\n")) {
        const index = input.indexOf("\n");
        const line = input.slice(0, index);
        input = input.slice(index + 1);
        if (!line.trim()) continue;
        try {
            const msg = JSON.parse(line);
            const finish = pending.get(msg.id);
            if (finish) {
                pending.delete(msg.id);
                finish(msg);
            }
        } catch (error) {
            stderr += "Unexpected non-JSON MCP stdout: " + String(error.message) + "\n";
        }
    }
});
child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-6000); });
child.once("error", error => { stderr += "Failed to spawn: " + error.message; });
const pass = (name, detail) => {
    report.checks.push({ name, status: "PASS", detail });
    console.log("PASS_CLIENT", name, detail ? JSON.stringify(detail) : "");
};
const messageErrorCode = message => {
    if (!message?.result?.isError) return null;
    try {
        return JSON.parse(message.result.content?.find(item => item.type === "text")?.text).code;
    } catch { return "UNKNOWN_TOOL_ERROR"; }
};

(async () => {
    try {
        const hello = await request("initialize", {
            protocolVersion: "2026-07-28",
            capabilities: {},
            clientInfo: { name: "DigiStudio MCP Inspector-compatible smoke", version: "1.0.0" }
        });
        assert.ok(hello.result?.serverInfo?.name, JSON.stringify(hello));
        child.stdin.write(JSON.stringify({
            jsonrpc: "2.0", method: "notifications/initialized"
        }) + "\n");
        pass("JSON-RPC initialize", { server: hello.result.serverInfo.name });

        const listed = await request("tools/list");
        const tools = listed.result?.tools;
        assert.ok(Array.isArray(tools), "tools/list must return MCP tool array");
        const names = tools.map(tool => tool.name);
        const expected = [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS];
        assert.equal(names.length, expected.length);
        assert.equal(new Set(names).size, expected.length, "No duplicate MCP tool names");
        assert.deepEqual([...names].sort(), [...expected].sort());
        for (const tool of tools) {
            assert.ok(tool.description && tool.description.trim(),
                "Tool has no description: " + tool.name);
            assert.ok(tool.inputSchema, "Tool has no input schema: " + tool.name);
        }
        pass("MCP Inspector tools/list and schema", {
            read: MCP_READ_TOOLS.length, write: MCP_WRITE_TOOLS.length, total: tools.length
        });

        const invalid = await request("tools/call", {
            name: "get_preview_snapshot", arguments: { pageId: "" }
        });
        assert.ok(invalid.error || invalid.result?.isError,
            "Invalid read-only tool input should be rejected");
        pass("invalid read-only arguments rejected");

        const capabilities = await request("tools/call", {
            name: "get_mcp_capabilities", arguments: {}
        });
        const errorCode = messageErrorCode(capabilities);
        if (errorCode === "AUTH_REQUIRED") {
            // An unsigned-in IDE must not disclose even project metadata.
            const project = await request("tools/call", {
                name: "get_current_project", arguments: {}
            });
            assert.equal(messageErrorCode(project), "AUTH_REQUIRED");
            report.status = "transport-ok-auth-required";
            pass("current IDE authentication boundary", { code: "AUTH_REQUIRED" });
        } else {
            assert.equal(errorCode, null,
                "MCP capabilities returned a tool error: " + JSON.stringify(capabilities));
            const data = capabilities.result?.structuredContent;
            assert.ok(data, "MCP capability structuredContent missing");
            assert.equal(data.readTools?.length, MCP_READ_TOOLS.length);
            assert.equal(data.writeTools?.length, MCP_WRITE_TOOLS.length);
            report.status = "authenticated-readonly-transport-ok";
            pass("authenticated capability bridge", {
                read: data.readTools.length, write: data.writeTools.length
            });
        }
    } catch (error) {
        report.status = "failed";
        report.error = String(error.stack || error);
        process.exitCode = 1;
        console.error("FAIL_CLIENT", report.error);
    } finally {
        child.stdin.end();
        if (child.exitCode === null) child.kill();
        report.finishedAt = new Date().toISOString();
        const out = join(projectRoot, "artifacts", "mcp-acceptance");
        mkdirSync(out, { recursive: true });
        const filename = join(out, "mcp-client-live-readonly.json");
        writeFileSync(filename, JSON.stringify(report, null, 2));
        console.log("MCP_CLIENT_REPORT", filename, report.status);
    }
})();
