import { ipcRenderer } from "electron";
import * as path from "path";
import type { ProjectEditorTab } from "home/tabs-store";
import {
    MCP_REQUEST_CHANNEL,
    MCP_RESPONSE_CHANNEL,
    MCP_RENDERER_READY_CHANNEL,
    MCP_RENDERER_PROBE_CHANNEL,
    MCP_TOOL_REGISTRY_VERSION,
    McpRendererRequest,
    McpRendererResponse,
    mcpReadError
} from "./protocol";
import { isReadTool, isWriteTool, validateReadArguments, validateWriteArguments } from "./validator";
import { executeWriteTool } from "./adapter/write-tools";
import { runReadTool, getMcpCapabilitiesWithoutProject } from "./adapter/read-tools";
import { resolveActivePageName } from "./adapter/active-page";
import { captureActiveCanvas } from "./adapter/canvas-snapshot";
import { capturePreviewSnapshot } from "./adapter/preview-interaction";

let registered = false;

/** The getter must be called for every request: tabs can close or switch. */
export function registerMcpProjectProvider(
    getActiveProjectTab: () => ProjectEditorTab | undefined
) {
    if (registered) return;
    registered = true;
    // Explicit Main/Renderer handshake. Main must not treat an open window
    // as MCP-ready until the actual request handler is registered.
    const advertiseReady = () => ipcRenderer.send(
        MCP_RENDERER_READY_CHANNEL, MCP_TOOL_REGISTRY_VERSION
    );
    ipcRenderer.on(MCP_RENDERER_PROBE_CHANNEL, advertiseReady);

    ipcRenderer.on(MCP_REQUEST_CHANNEL, async (_event, request: McpRendererRequest) => {
        if (!request || typeof request.id !== "string") return;
        let response: McpRendererResponse;
        try {
            if (!isReadTool(request.tool) && !isWriteTool(request.tool)) {
                throw mcpReadError("INVALID_ARGUMENT", "Unknown MCP tool");
            }
            const args = isReadTool(request.tool)
                ? validateReadArguments(request.tool, request.args)
                : validateWriteArguments(request.tool, request.args);
            const tab = getActiveProjectTab();
            if (request.tool === "get_mcp_capabilities" &&
                (!tab || tab.closed || tab.error ||
                 !tab.projectStore?.project?._fullyLoaded ||
                 !tab.projectStore.projectTypeTraits.isLVGL)) {
                ipcRenderer.send(MCP_RESPONSE_CHANNEL, {
                    id: request.id, ok: true, result: getMcpCapabilitiesWithoutProject()
                } as McpRendererResponse);
                return;
            }
            if (!tab) {
                throw mcpReadError("NO_ACTIVE_PROJECT", "Select an LVGL project tab first");
            }
            if (tab.closed) {
                throw mcpReadError("PROJECT_CLOSED", "The project tab has closed");
            }
            if (tab.error) {
                throw mcpReadError("PROJECT_FAILED", "The project failed to load");
            }
            const store = tab.projectStore;
            if (!store || !store.project?._fullyLoaded) {
                throw mcpReadError("PROJECT_LOADING", "The project is still loading");
            }
            if (!store.projectTypeTraits.isLVGL) {
                throw mcpReadError("NOT_LVGL", "The active project is not an LVGL project");
            }
            if (request.authorizedProjectPath !== undefined) {
                const norm = (file: string) => {
                    const resolved = path.normalize(path.resolve(file));
                    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
                };
                if (!store.filePath ||
                    norm(store.filePath) !== norm(request.authorizedProjectPath)) {
                    throw mcpReadError("PROJECT_CHANGED",
                        "Active project changed after MCP online authorization");
                }
            }

            if (isWriteTool(request.tool) && tab.runMode) {
                throw mcpReadError("RUN_MODE", "Exit Run Mode before modifying the project");
            }
            // Resolve canvas context on every write, after permission checks.
            // Never silently modify the first project page.
            if (isWriteTool(request.tool) &&
                ["add_widget", "update_widget", "duplicate_widget", "reorder_widget", "delete_widget",
                 "set_widget_property", "set_widget_properties", "set_widget_local_style",
                 "add_widget_event", "remove_widget_event",
                 "bind_widget_variable", "unbind_widget_variable"].includes(request.tool) &&
                args.pageName === undefined) {
                args.pageName = resolveActivePageName(store);
            }
            response = {
                id: request.id,
                ok: true,
                result: isReadTool(request.tool)
                    ? request.tool === "get_canvas_snapshot"
                        ? captureActiveCanvas(store, args.pageId as string, !!tab.runMode)
                        : request.tool === "get_preview_snapshot"
                            ? capturePreviewSnapshot(store, args.pageId as string)
                            : runReadTool(store, request.tool, args, !!tab.runMode)
                    : await executeWriteTool(store, request.tool, args)
            };
        } catch (error) {
            const candidate = error as { code?: string; message?: string };
            const known = [
                "NO_ACTIVE_PROJECT", "NO_ACTIVE_PAGE", "PROJECT_LOADING", "PROJECT_CLOSED",
                "PROJECT_FAILED", "PROJECT_CHANGED", "NOT_LVGL", "PAGE_NOT_FOUND",
                "INVALID_ARGUMENT", "LIMIT_EXCEEDED",
                "WIDGET_NOT_FOUND", "STYLE_NOT_FOUND",
                "WRITE_DISABLED", "WRITE_REJECTED", "RUN_MODE",
                "UNSAVED_PROJECT", "UNSUPPORTED_WIDGET", "INVALID_STATE"
            ];
            const code = known.includes(candidate?.code || "")
                ? candidate.code as "NO_ACTIVE_PROJECT"
                : "INTERNAL_ERROR";
            response = {
                id: request.id,
                ok: false,
                error: mcpReadError(
                    code,
                    code === "INTERNAL_ERROR"
                        ? "Unable to read the active project"
                        : candidate.message || "Project request failed"
                )
            };
        }
        ipcRenderer.send(MCP_RESPONSE_CHANNEL, response);
    });
    advertiseReady();
}
