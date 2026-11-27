import type { ProjectStore } from "project-editor/store";
import * as path from "path";
import type { Page } from "project-editor/features/page/page";
import { LVGLWidget } from "project-editor/lvgl/widgets/Base";
import { getClassesDerivedFrom } from "project-editor/core/object";
import { getProjectCheckStatus, getProjectBuildStatus } from "./check-tasks";
import { getActionGraph } from "./action-graph";
import { MCP_READ_TOOLS, MCP_WRITE_TOOLS, type McpReadTool } from "../protocol";
import { mcpReadError } from "../protocol";
import { validateReadArguments, MCP_WIDGET_INITIAL_FIELDS } from "../validator";
import { runExtendedReadTool } from "./extended-tools";
import { resolveActivePageName } from "./active-page";

const MAX_PAGES = 500;
const MAX_WIDGETS = 3000;
const MAX_DEPTH = 32;

const WIDGET_AUTHORING_CAPABILITIES = {
    createTool: "add_widget",
    createProperties: [...MCP_WIDGET_INITIAL_FIELDS],
    schemaAfterCreate: "get_widget_schema",
    extendedPropertyTool: "set_widget_property",
    localStyleTool: "set_widget_local_style",
    globalStyleTool: "create_style",
    variableBindingTool: "bind_widget_variable",
    note: "Creation supports only createProperties. For widget-specific scalar, color and enum fields, create the widget then query its runtime ClassInfo schema before editing. Complex objects, expressions and scripts are not exposed."
};

// Machine-readable, intentionally limited Flow authoring contract. Never
// advertise the rest of the IDE's Flow expression/script surface as MCP-ready.
const FLOW_NODE_CAPABILITIES = {
    types: ["StartActionComponent", "NoopActionComponent", "EndActionComponent",
        "DelayActionComponent", "SetVariableActionComponent", "IsTrueActionComponent",
        "CallActionActionComponent", "LVGLActionComponent"],
    addTool: "add_action_node",
    connectTool: "connect_action_nodes",
    readTool: "get_action_graph",
    sequenceOutputs: ["@seqout", "True", "False"],
    parameters: {
        DelayActionComponent: "milliseconds: integer 0..60000",
        SetVariableActionComponent: "variableName: existing typed global; value: matching scalar literal",
        IsTrueActionComponent: "exactly one of conditionVariableName (existing boolean global) or conditionValue (boolean)",
        CallActionActionComponent: "targetActionName: distinct Flow Action with Start/End, no custom ports or recursive call",
        LVGLActionComponent: "screenName: existing LVGL user page; fixed fade/default timing"
    },
    limits: ["no arbitrary code or expressions", "sequence links only", "occupied ports refused",
        "sequence cycles and Action recursion refused", "editor write approval required"]
};

const IMPLEMENTATION_EDITING_CAPABILITIES = {
    variableTool: "set_variable_implementation",
    actionTool: "set_action_implementation",
    identity: "variableName + variableId from list_variables; actionName + actionId from list_actions",
    variableBehavior: "switches Native/Flow without changing type, default value or references",
    emptyNativeActionToFlow: "creates a Start -> End no-op graph",
    existingFlowGraph: "preserved when switching implementation; inactive while Native",
    nativeCode: "switching to Native does not generate or modify C/C++ implementation source",
    undoable: true
};

function creatableWidgetTypes(store: ProjectStore) {
    return getClassesDerivedFrom(store, LVGLWidget)
        .filter(entry => /^LVGL[A-Za-z0-9]+Widget$/.test(entry.name) &&
            !["LVGLScreenWidget", "LVGLUserWidgetWidget"].includes(entry.name))
        .filter(entry => {
            try {
                return !!entry.objectClass.classInfo.enabledInComponentPalette?.(
                    store.project.settings.general.projectType, store);
            } catch (_error) { return false; }
        })
        .map(entry => entry.name)
        .slice(0, 200);
}

// Export only explicitly allowed scalar properties, never internal MobX
// state, event handlers, scripts, runtime references or arbitrary object data.
const WIDGET_PROPERTIES = [
    "identifier", "left", "top", "width", "height",
    "leftUnit", "topUnit", "widthUnit", "heightUnit",
    "hiddenFlag", "clickableFlag", "scrollableFlag",
    "widgetFlags", "text", "value", "min", "max", "range"
] as const;

function readWidgetProperties(widget: LVGLWidget) {
    const properties: Record<string, string | number | boolean> = {};
    for (const name of WIDGET_PROPERTIES) {
        // User-defined and version-specific LVGL properties may be absent.
        const value: unknown = (widget as unknown as Record<string, unknown>)[name];
        if (
            (typeof value === "string" && value.length <= 512) ||
            (typeof value === "number" && Number.isFinite(value)) ||
            typeof value === "boolean"
        ) {
            properties[name] = value;
        }
    }
    return properties;
}

function widgetTree(page: Page) {
    let count = 0;
    const seen = new WeakSet<object>();
    const serialize = (widget: LVGLWidget, depth: number, widgetPath: number[]): unknown => {
        if (depth > MAX_DEPTH || ++count > MAX_WIDGETS) {
            throw mcpReadError(
                "LIMIT_EXCEEDED",
                "Widget tree exceeds the read-only response limit"
            );
        }
        if (seen.has(widget)) {
            throw mcpReadError("LIMIT_EXCEEDED", "Cyclic widget hierarchy");
        }
        seen.add(widget);
        const children = Array.isArray(widget.children)
            ? widget.children.filter(child => child instanceof LVGLWidget)
            : [];
        return {
            type: widget.type,
            identifier: widget.identifier || null,
            widgetPath,
            widgetId: widget.objID || null,
            useStyle: widget.useStyle || null,
            properties: readWidgetProperties(widget),
            children: children.map((child, index) =>
                serialize(child, depth + 1, [...widgetPath, index]))
        };
    };

    const widgets = page.components.filter(
        component => component instanceof LVGLWidget
    ) as LVGLWidget[];
    return {
        widgets: widgets.map((widget, index) => serialize(widget, 0, [index])),
        widgetCount: count
    };
}

/** Capability discovery must work even before the user opens an LVGL project. */
export function getMcpCapabilitiesWithoutProject() {
    return {
        apiVersion: 1,
        editor: "DigiwiseStudio LVGL",
        projectAvailable: false,
        readTools: [...MCP_READ_TOOLS],
        writeTools: [...MCP_WRITE_TOOLS],
        canvasSnapshot: {
            tool: "get_canvas_snapshot", pageIdFrom: "get_active_page",
            mode: "visible LVGL editor canvas only", maxDimension: 1024,
            includesEditorChrome: false, simulatorVerified: false
        },
        preview: { start: "start_preview", status: "get_preview_status", stop: "stop_preview",
            frameCapture: "get_preview_snapshot", tap: "preview_tap", runtime: "local WASM only",
            inputRequiresLocalApproval: true },
        creatableWidgetTypes: [],
        widgetAuthoring: WIDGET_AUTHORING_CAPABILITIES,
        flowNodes: FLOW_NODE_CAPABILITIES,
        implementationEditing: IMPLEMENTATION_EDITING_CAPABILITIES,
        workflow: ["get_mcp_capabilities", "create_project", "get_current_project",
            "list_pages", "get_widget_schema", "add_action_node", "get_action_graph", "save_project"],
        constraints: {
            projectRequiredForWidgetDiscovery: true,
            writesRequireLocalApproval: true,
            unsupported: ["preview drag/multitouch/keyboard and physical device download", "complex Flow expressions and custom node types", "font binary import"]
        }
    };
}

export function runReadTool(
    projectStore: ProjectStore,
    tool: McpReadTool,
    args: unknown,
    runMode: boolean
): unknown {
    const validated = validateReadArguments(tool, args);
    if (tool === "get_mcp_capabilities") {
        return {
            apiVersion: 1,
            editor: "DigiwiseStudio LVGL",
            workflow: [
                "get_current_project", "get_active_page", "list_pages",
                "list_widgets", "get_widget_schema", "edit_with_expectedProjectPath_and_object_identity",
                "read_back", "save_project", "start_project_check", "get_project_check_status",
                "start_project_build", "get_project_build_status"
            ],
            readTools: [...MCP_READ_TOOLS],
            writeTools: [...MCP_WRITE_TOOLS],
            canvasSnapshot: {
                tool: "get_canvas_snapshot", pageIdFrom: "get_active_page",
                mode: "visible LVGL editor canvas only", maxDimension: 1024,
                includesEditorChrome: false, simulatorVerified: false
            },
            preview: { start: "start_preview", status: "get_preview_status", stop: "stop_preview",
                frameCapture: "get_preview_snapshot", tap: "preview_tap", runtime: "local WASM only",
                inputRequiresLocalApproval: true },
            creatableWidgetTypes: creatableWidgetTypes(projectStore),
            widgetAuthoring: WIDGET_AUTHORING_CAPABILITIES,
            flowNodes: FLOW_NODE_CAPABILITIES,
            implementationEditing: IMPLEMENTATION_EDITING_CAPABILITIES,
            constraints: {
                writesRequireLocalApproval: true,
                objectIdentity: "widgetPath + widgetId (Style: stylePath + styleId)",
                projectIdentity: "expectedProjectPath from get_current_project",
                schemaBeforePropertyWrite: "get_widget_schema",
                bitmapReferences: "existing project Bitmap or import_bitmap from project directory",
                supportedEventBindings: "existing Action only",
                unsupported: ["arbitrary script/code execution", "font binary import", "bitmap import outside project directory",
                    "Flow node types beyond Start/NoOp/End/Delay/SetVariable/IsTrue/CallAction/LVGL screen-change or native Action source", "arbitrary variable expressions", "preview drag/multitouch/keyboard", "device download", "build cancellation", "unrestricted output paths",
                    "non-palette/internal or version-incompatible LVGL widgets", "page duplicate/reorder", "page reference expressions that are not ClassInfo metadata"]
            }
        };
    }
    if (tool === "get_preview_status") {
        const runtime = projectStore.runtime;
        const state = !runtime ? "idle" : runtime.error ? "error" : runtime.isStopped ? "stopped" :
            runtime.isPaused ? "paused" : runtime.isRunning ? "running" : "starting";
        return {
            state,
            active: !!runtime && !runtime.isStopped,
            mode: runtime ? runtime.isDebuggerActive ? "debugger" : "wasm-preview" : "editor",
            selectedPage: runtime?.selectedPage?.name || null,
            selectedPageId: runtime?.selectedPage?.objID || null,
            error: runtime?.error ? String(runtime.error).slice(0, 256) : null,
            imageCaptureAvailable: !runtime,
            previewFrameAvailable: !!runtime && runtime.isRunning &&
                !!(runtime as unknown as { lastScreen?: unknown }).lastScreen,
            // Only get_preview_snapshot can verify/export actual frame pixels.
            frameVerified: false
        };
    }
    if (tool === "get_project_check_status") {
        return getProjectCheckStatus(projectStore);
    }
    if (tool === "get_project_build_status") {
        return getProjectBuildStatus(projectStore);
    }
    if (tool === "get_action_graph") {
        return getActionGraph(projectStore, validated.actionName as string, validated.actionId as string);
    }
    if (tool === "get_canvas_snapshot" || tool === "get_preview_snapshot") {
        // Requires the active Electron renderer's DOM; renderer-agent handles it.
        throw mcpReadError("INVALID_STATE", "Canvas snapshots are only available in the active IDE renderer");
    }
    const project = projectStore.project;
    const general = project.settings.general;
    const pages = project.pages;
    if (pages.length > MAX_PAGES) {
        throw mcpReadError("LIMIT_EXCEEDED", "Project has too many pages");
    }

    if (tool === "get_current_project") {
        return {
            path: projectStore.filePath ?? null,
            projectName: projectStore.filePath
                ? path.basename(projectStore.filePath, path.extname(projectStore.filePath))
                : "Untitled",
            projectType: general.projectType,
            lvglVersion: general.lvglVersion,
            displayWidth: general.displayWidth,
            displayHeight: general.displayHeight,
            pageCount: pages.length,
            loaded: true,
            runMode,
            modified: projectStore.isModified
        };
    }
    if (tool === "get_active_page") {
        const pageName = resolveActivePageName(projectStore);
        const page = pages.find(candidate => candidate.name === pageName)!;
        return {
            pageName,
            pageId: page.objID || null,
            width: page.width || general.displayWidth,
            height: page.height || general.displayHeight
        };
    }
    if (tool === "list_variables") {
        const variables = project.variables?.globalVariables || [];
        if (variables.length > 1000) {
            throw mcpReadError("LIMIT_EXCEEDED", "Too many global variables");
        }
        return {
            variableCount: variables.length,
            variables: variables.map(variable => ({
                name: variable.name,
                variableId: variable.objID || null,
                type: variable.type,
                persistent: !!variable.persistent,
                native: !!variable.native
            }))
        };
    }
    if (tool === "list_actions") {
        const actions = project.actions || [];
        if (actions.length > 1000) {
            throw mcpReadError("LIMIT_EXCEEDED", "Too many actions");
        }
        return {
            actionCount: actions.length,
            actions: actions.map(action => ({
                name: action.name,
                actionId: action.objID || null,
                implementationType: action.implementationType || "flow"
            }))
        };
    }
    if (tool === "list_pages") {
        return {
            pages: pages.map(page => ({
                name: page.name,
                pageId: page.objID || null,
                width: page.width || general.displayWidth,
                height: page.height || general.displayHeight,
                componentCount: page.components.length
            }))
        };
    }
    if (tool !== "list_widgets") {
        return runExtendedReadTool(projectStore, tool, validated);
    }
    const name = validated.pageName as string;
    const page = pages.find(entry => entry.name === name);
    if (!page) {
        throw mcpReadError("PAGE_NOT_FOUND", `Page "${name}" was not found`);
    }
    return { pageName: page.name, ...widgetTree(page) };
}
