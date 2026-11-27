import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function locateSessionFile() {
    if (process.env.DIGISTUDIO_MCP_SESSION_FILE) {
        return process.env.DIGISTUDIO_MCP_SESSION_FILE;
    }
    const appData = process.platform === "win32"
        ? process.env.APPDATA
        : process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support")
          : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    if (!appData) throw new Error("Cannot locate DigiStudio user data");
    return join(appData, "DigiwiseStudio", "mcp-session.json");
}

// Keep in sync with MCP_TOOL_REGISTRY_VERSION in protocol.ts and main-server.ts.
// A stale Main process may accept old tools while a hot-reloaded Renderer
// advertises newer ones; fail before sending any request in that case.
export const EXPECTED_REGISTRY_VERSION = "mcp-2026-11-27-implementation-edit";

// All mutations require local approval, which can take up to 125 seconds.
// Classifying by the bounded read-only list prevents newly added write tools
// from silently inheriting an 8.5-second timeout during user approval.
export const READ_ONLY_TOOLS = new Set([
    "get_mcp_capabilities", "get_project_check_status", "get_project_build_status",
    "get_current_project", "get_active_page", "get_canvas_snapshot", "get_preview_status", "get_preview_snapshot", "list_variables", "list_actions",
    "get_action_graph", "list_pages", "list_widgets", "list_styles", "get_style",
    "list_assets", "get_widget_details", "get_widget_schema", "list_widget_events"
]);
export function bridgeRequestTimeoutMs(tool) {
    return READ_ONLY_TOOLS.has(tool) ? 8500 : 195000;
}

export async function callBridge(tool, args = {}) {

    let metadata;
    const file = locateSessionFile();
    try {
        const stats = statSync(file);
        if (!stats.isFile()) throw new Error("Session path is not a file");
        if (process.platform !== "win32") {
            if ((stats.mode & 0o077) !== 0) throw new Error("Session file permissions are too broad");
            if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
                throw new Error("Session file owner mismatch");
            }
        }
        metadata = JSON.parse(readFileSync(file, "utf8"));
        if (
            metadata.version !== 1 ||
            !Number.isSafeInteger(metadata.pid) ||
            typeof metadata.token !== "string" ||
            !/^[a-f0-9]{64}$/.test(metadata.token) ||
            typeof metadata.socketPath !== "string" ||
            metadata.socketPath.length > 250
        ) throw new Error("Invalid bridge session metadata");
        if (metadata.registryVersion !== EXPECTED_REGISTRY_VERSION) {
            throw new Error("MCP tool registry differs between IDE Main and AI client. Save your work and fully restart DigiwiseStudio; do not use a hot-reloaded Renderer alone.");
        }
    } catch (error) {
        throw new Error("DigiwiseStudio MCP is disabled or unavailable (" + error.message + ")");
    }
    const id = randomUUID();
    return await new Promise((resolve, reject) => {
        const socket = connect(metadata.socketPath);
        let data = "";
        let completed = false;
        const done = (error, result) => {
            if (completed) return;
            completed = true;
            socket.destroy();
            if (error) reject(error);
            else resolve(result);
        };
        // Allow for user approval (125s) and editor execution (60s).
        socket.setTimeout(bridgeRequestTimeoutMs(tool),
            () => done(new Error("Bridge connection timed out")));
        socket.on("error", error => done(new Error("Cannot connect to DigiStudio: " + error.message)));
        socket.on("connect", () => {
            socket.write(JSON.stringify({ id, token: metadata.token, tool, args }) + "\n");
        });
        socket.on("data", chunk => {
            data += chunk.toString("utf8");
            if (Buffer.byteLength(data) > 2 * 1024 * 1024) {
                done(new Error("Bridge response too large"));
                return;
            }
            const newline = data.indexOf("\n");
            if (newline === -1) return;
            try {
                const reply = JSON.parse(data.slice(0, newline));
                if (!reply || typeof reply.ok !== "boolean") {
                    throw new Error("Malformed bridge response");
                }
                if (!reply.ok) {
                    const error = new Error(reply.error?.message || "Read request failed");
                    error.code = reply.error?.code || "INTERNAL_ERROR";
                    done(error);
                } else {
                    done(null, reply.result);
                }
            } catch (error) {
                done(error);
            }
        });
        socket.on("end", () => {
            if (!completed) done(new Error("Bridge closed before responding"));
        });
    });
}
