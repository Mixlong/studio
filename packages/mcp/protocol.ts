/**
 * Private, one-request-per-socket IPC bridge. This is NOT an MCP transport:
 * the official MCP SDK runs in stdio-cli.mjs.
 */
export const MCP_REQUEST_CHANNEL = "digi:mcp:request";
export const MCP_RESPONSE_CHANNEL = "digi:mcp:response";
export const MCP_RENDERER_READY_CHANNEL = "digi:mcp:renderer-ready";
export const MCP_RENDERER_PROBE_CHANNEL = "digi:mcp:renderer-probe";
export const MCP_SESSION_NAME = "mcp-session.json";
// Main process and stand-alone Stdio client must advertise the exact same
// allowed tool set. Bump when MCP_READ_TOOLS / MCP_WRITE_TOOLS change.
export const MCP_TOOL_REGISTRY_VERSION = "mcp-2026-11-13-r19w37-central-stage";
export const MCP_TIMEOUT_MS = 8_000;
export const MCP_MAX_REQUEST_BYTES = 64 * 1024;
export const MCP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type McpReadTool =
    | "get_mcp_capabilities"
    | "get_project_check_status"
    | "get_project_build_status"
    | "get_current_project"
    | "get_active_page"
    | "get_canvas_snapshot"
    | "get_preview_status"
    | "get_preview_snapshot"
    | "list_variables"
    | "list_actions"
    | "get_action_graph"
    | "list_pages"
    | "list_widgets"
    | "list_styles"
    | "get_style"
    | "list_assets"
    | "get_widget_details"
    | "get_widget_schema"
    | "list_widget_events";

export const MCP_READ_TOOLS: McpReadTool[] = [
    "get_mcp_capabilities",
    "get_project_check_status",
    "get_project_build_status",
    "get_current_project",
    "get_active_page",
    "get_canvas_snapshot",
    "get_preview_status",
    "get_preview_snapshot",
    "list_variables",
    "list_actions",
    "get_action_graph",
    "list_pages",
    "list_widgets",
    "list_styles",
    "get_style",
    "list_assets",
    "get_widget_details",
    "get_widget_schema",
    "list_widget_events"
];

// All write capabilities are disabled unless explicitly approved by the
// local user for this process; approval may be once or per app session.
export const MCP_WRITE_TOOLS = [
    "create_project",
    "create_page",
    "rename_page",
    "delete_page",
    "create_style",
    "rename_style",
    "delete_style",
    "set_default_style",
    "import_bitmap",
    "create_variable",
    "create_action",
    "add_action_node",
    "connect_action_nodes",
    "disconnect_action_line",
    "delete_action_node",
    "bind_widget_variable",
    "unbind_widget_variable",
    "add_widget",
    "update_widget",
    "duplicate_widget",
    "move_widget",
    "reorder_widget",
    "start_project_check",
    "start_project_build",
    "start_preview",
    "stop_preview",
    "preview_tap",
    "delete_widget",
    "set_style_property",
    "set_widget_property",
    "set_widget_properties",
    "set_widget_local_style",
    "add_widget_event",
    "remove_widget_event",
    "save_project",
    "undo",
    "redo"
] as const;
export type McpWriteTool = (typeof MCP_WRITE_TOOLS)[number];
export type McpTool = McpReadTool | McpWriteTool;

export interface McpRendererRequest {
    id: string;
    tool: McpTool;
    args: Record<string, unknown>;
    /** Main-authorized project; never supplied by the external MCP client. */
    authorizedProjectPath?: string;
}

export interface McpReadError {
    code:
        | "AUTH_REQUIRED"
        | "WRITE_DISABLED"
        | "WRITE_REJECTED"
        | "RUN_MODE"
        | "UNSAVED_PROJECT"
        | "UNSUPPORTED_WIDGET"
        | "INVALID_STATE"
        | "NO_ACTIVE_PAGE"
        | "NO_ACTIVE_PROJECT"
        | "PROJECT_LOADING"
        | "PROJECT_CHANGED"
        | "PROJECT_UNBOUND"
        | "MCP_POLICY_UNAVAILABLE"
        | "ACCESS_DENIED"
        | "PROJECT_CLOSED"
        | "PROJECT_FAILED"
        | "NOT_LVGL"
        | "PAGE_NOT_FOUND"
        | "WIDGET_NOT_FOUND"
        | "STYLE_NOT_FOUND"
        | "INVALID_ARGUMENT"
        | "LIMIT_EXCEEDED"
        | "IPC_UNAVAILABLE"
        | "IPC_TIMEOUT"
        | "INTERNAL_ERROR";
    message: string;
}

export type McpRendererResponse =
    | { id: string; ok: true; result: unknown }
    | { id: string; ok: false; error: McpReadError };

export function mcpReadError(
    code: McpReadError["code"],
    message: string
): McpReadError {
    return { code, message };
}
