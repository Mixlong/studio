/* MCP v2 stdio smoke test. No DigiStudio instance required. */
const { spawn } = require("node:child_process");
const { join } = require("node:path");

const executable = process.env.DIGISTUDIO_MCP_TEST_EXECUTABLE || process.execPath;
const cli = process.env.DIGISTUDIO_MCP_TEST_SCRIPT || join(__dirname, "stdio-cli.mjs");
const child = spawn(executable, [cli], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
        ...process.env,
        DIGISTUDIO_MCP_SESSION_FILE: join(__dirname, "nonexistent-session.json")
    }
});
let output = "";
let errors = "";
let nextId = 0;
const responses = new Map();
const waiters = new Map();
const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
const request = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            waiters.delete(id);
            reject(new Error("MCP request timed out: " + method + "\n" + errors));
        }, 10000);
        waiters.set(id, response => {
            clearTimeout(timeout);
            resolve(response);
        });
        send({ jsonrpc: "2.0", id, method, params });
    });
};
child.stdout.on("data", chunk => {
    output += chunk.toString();
    while (output.includes("\n")) {
        const n = output.indexOf("\n");
        const line = output.slice(0, n);
        output = output.slice(n + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id && waiters.has(message.id)) {
            const complete = waiters.get(message.id);
            waiters.delete(message.id);
            complete(message);
        }
    }
});
child.stderr.on("data", chunk => { errors += chunk.toString(); });

(async () => {
    try {
        const hello = await request("initialize", {
            protocolVersion: "2026-07-28",
            capabilities: {},
            clientInfo: { name: "DigiStudio MCP smoke", version: "1.0.0" }
        });
        if (hello.error) throw new Error(JSON.stringify(hello.error));
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        const tools = await request("tools/list");
        const names = tools.result?.tools?.map(item => item.name);
        if (JSON.stringify(names) !== JSON.stringify([
            "get_mcp_capabilities", "get_project_check_status", "get_project_build_status", "get_current_project", "get_active_page", "get_canvas_snapshot", "get_preview_snapshot", "get_preview_status", "list_variables",
            "list_actions", "get_action_graph", "list_pages", "list_widgets",
            "list_styles", "get_style", "list_assets",
            "get_widget_details", "list_widget_events", "get_widget_schema",
            "create_project", "create_page", "rename_page", "delete_page", "create_style", "rename_style", "delete_style", "set_default_style", "import_bitmap", "create_variable", "create_action", "add_action_node", "connect_action_nodes", "disconnect_action_line", "delete_action_node", "bind_widget_variable", "unbind_widget_variable", "add_widget", "update_widget", "duplicate_widget", "move_widget", "reorder_widget", "start_project_check", "start_project_build", "start_preview", "stop_preview", "preview_tap", "delete_widget",
            "set_style_property", "set_widget_property", "set_widget_properties",
            "set_widget_local_style", "add_widget_event", "remove_widget_event",
            "save_project", "undo", "redo"
        ])) throw new Error("Unexpected tools: " + JSON.stringify(tools));

        const absent = await request("tools/call", {
            name: "get_current_project", arguments: {}
        });
        if (absent.result?.isError !== true ||
            !JSON.stringify(absent).includes("disabled or unavailable")) {
            throw new Error("Expected disabled MCP error: " + JSON.stringify(absent));
        }
        const invalid = await request("tools/call", {
            name: "list_widgets", arguments: { pageName: "" }
        });
        if (!invalid.error && invalid.result?.isError !== true) {
            throw new Error("Invalid widget input was accepted");
        }
        const invalidCanvas = await request("tools/call", {
            name: "get_canvas_snapshot", arguments: { pageId: "" }
        });
        if (!invalidCanvas.error && invalidCanvas.result?.isError !== true) {
            throw new Error("Invalid active canvas pageId was accepted");
        }
        const invalidPreview = await request("tools/call", {
            name: "get_preview_snapshot", arguments: { pageId: "" }
        });
        if (!invalidPreview.error && invalidPreview.result?.isError !== true) {
            throw new Error("Invalid preview pageId was accepted");
        }
        const invalidTap = await request("tools/call", {
            name: "preview_tap", arguments: { expectedProjectPath: "C:/demo.eez-project",
                pageId: "page-1", x: -1, y: 2 }
        });
        if (!invalidTap.error && invalidTap.result?.isError !== true) {
            throw new Error("Invalid preview tap coordinates were accepted");
        }
        const invalidStyle = await request("tools/call", {
            name: "get_style", arguments: { stylePath: [] }
        });
        if (!invalidStyle.error && invalidStyle.result?.isError !== true) {
            throw new Error("Invalid style path was accepted");
        }
        const invalidWrite = await request("tools/call", {
            name: "update_widget", arguments: {
                pageName: "Home", widgetPath: [0], properties: { width: -1 }
            }
        });
        if (!invalidWrite.error && invalidWrite.result?.isError !== true) {
            throw new Error("Invalid write payload was accepted");
        }
        process.stdout.write("PASS: MCP SDK initialize, 19 read and 37 approval-gated write tools, input validation\n");
    } catch (error) {
        process.stderr.write("FAIL: " + error.stack + "\n" + errors);
        process.exitCode = 1;
    } finally {
        child.kill();
    }
})().catch(error => {
    process.stderr.write(error.stack + "\n");
    child.kill();
    process.exitCode = 1;
});
