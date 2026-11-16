import { MCP_READ_TOOLS, MCP_WRITE_TOOLS, McpReadTool, McpWriteTool, McpTool, mcpReadError } from "./protocol";

export function isReadTool(value: unknown): value is McpReadTool {
    return typeof value === "string" &&
        MCP_READ_TOOLS.includes(value as McpReadTool);
}

function isIndexPath(value: unknown): value is number[] {
    return Array.isArray(value) &&
        value.length > 0 &&
        value.length <= 32 &&
        value.every(index =>
            typeof index === "number" &&
            Number.isSafeInteger(index) &&
            index >= 0 &&
            index < 3000
        );
}

export function validateReadArguments(
    tool: McpReadTool,
    args: unknown
): Record<string, unknown> {
    if (args == null) args = {};
    if (typeof args !== "object" || Array.isArray(args)) {
        throw mcpReadError("INVALID_ARGUMENT", "Tool arguments must be an object");
    }
    const validated = args as Record<string, unknown>;
    const allowed = tool === "list_widgets" || tool === "list_widget_events"
        ? ["pageName"]
        : (tool === "get_widget_details" || tool === "get_widget_schema")
          ? ["pageName", "widgetPath"]
          : tool === "get_style"
            ? ["stylePath"]
          : tool === "get_action_graph"
            ? ["actionName", "actionId"]
          : tool === "get_canvas_snapshot" || tool === "get_preview_snapshot"
            ? ["pageId"]
            : [];
    if (Object.keys(validated).some(key => !allowed.includes(key))) {
        throw mcpReadError("INVALID_ARGUMENT", "Unexpected tool argument");
    }
    if (allowed.includes("pageName")) {
        if (
            typeof validated.pageName !== "string" ||
            validated.pageName.trim().length === 0 ||
            validated.pageName.length > 128
        ) {
            throw mcpReadError("INVALID_ARGUMENT", "pageName must be a non-empty string (max 128 characters)");
        }
    }
    if ((tool === "get_widget_details" || tool === "get_widget_schema") && !isIndexPath(validated.widgetPath)) {
        throw mcpReadError("INVALID_ARGUMENT", "widgetPath must contain 1 to 32 non-negative indices");
    }
    if ((tool === "get_canvas_snapshot" || tool === "get_preview_snapshot") && !validObjectId(validated.pageId)) {
        throw mcpReadError("INVALID_ARGUMENT", "pageId from get_active_page is required");
    }
    if (tool === "get_action_graph") {
        if (!safeLabel(validated.actionName) || !validObjectId(validated.actionId)) {
            throw mcpReadError("INVALID_ARGUMENT", "Action name and actionId from list_actions are required");
        }
    }
    if (tool === "get_style" && !isIndexPath(validated.stylePath)) {
        throw mcpReadError("INVALID_ARGUMENT", "stylePath must contain 1 to 32 non-negative indices");
    }
    return validated;
}

export function isWriteTool(value: unknown): value is McpWriteTool {
    return typeof value === "string" &&
        (MCP_WRITE_TOOLS as readonly string[]).includes(value);
}

export function isSupportedTool(value: unknown): value is McpTool {
    return isReadTool(value) || isWriteTool(value);
}

export const MCP_WIDGET_INITIAL_FIELDS = ["identifier", "left", "top", "width", "height",
    "text", "value", "useStyle", "hiddenFlag", "clickableFlag", "image"] as const;

function fail(message: string): never {
    throw mcpReadError("INVALID_ARGUMENT", message);
}

function positiveSize(value: unknown): value is number {
    return typeof value === "number" &&
        Number.isInteger(value) && value > 0 && value <= 4096;
}

function boundedCoordinate(value: unknown) {
    return typeof value === "number" && Number.isInteger(value) &&
        value >= -4096 && value <= 4096;
}

function safeLabel(value: unknown) {
    return typeof value === "string" &&
        /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(value);
}

function validateWidgetProperties(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail("properties must be a nonempty plain object");
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (!keys.length || keys.length > MCP_WIDGET_INITIAL_FIELDS.length) {
        fail("Unexpected widget property count");
    }
    for (const key of keys) {
        if (!(MCP_WIDGET_INITIAL_FIELDS as readonly string[]).includes(key)) {
            fail("Unsupported widget property: " + key);
        }
        const val = record[key];
        if (key === "identifier" && !safeLabel(val)) fail("Invalid widget identifier");
        if (key === "left" || key === "top") {
            if (!boundedCoordinate(val)) fail("Invalid widget position");
        } else if (key === "width" || key === "height") {
            if (!positiveSize(val)) fail("Invalid widget size");
        } else if (key === "text") {
            if (typeof val !== "string" || val.length > 512) fail("Invalid widget text");
        } else if (key === "image") {
            if (typeof val !== "string" || !val || val.length > 128) fail("Invalid Bitmap reference");
        } else if (key === "value") {
            if (typeof val !== "number" || !Number.isFinite(val) ||
                Math.abs(val) > 1_000_000) fail("Invalid widget value");
        } else if (key === "useStyle") {
            if (typeof val !== "string" || val.length > 128) fail("Invalid style name");
        } else if (key === "hiddenFlag" || key === "clickableFlag") {
            if (typeof val !== "boolean") fail("Invalid flag value");
        }
    }
    return record;
}

function validObjectId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 128 &&
        /^[A-Za-z0-9_-]+$/.test(value);
}

export function validateWriteArguments(
    tool: McpWriteTool,
    input: unknown
): Record<string, unknown> {
    if (input == null) input = {};
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        fail("Tool arguments must be an object");
    }
    const args = input as Record<string, unknown>;
    if (tool === "create_project") {
        if (Object.keys(args).some(key =>
            !["projectPath", "lvglVersion", "flowSupport",
              "displayWidth", "displayHeight", "openWhenDone"].includes(key))) {
            fail("Unexpected project creation argument");
        }
        if (typeof args.projectPath !== "string" ||
            args.projectPath.length > 1024 ||
            !args.projectPath.toLowerCase().endsWith(".eez-project") ||
            args.projectPath.includes("\u0000") ||
            !require("path").isAbsolute(args.projectPath)) {
            fail("projectPath must be an absolute .eez-project path");
        }
        if (typeof args.lvglVersion !== "undefined" &&
            !["8.4.0", "9.2.2", "9.3.0", "9.4.0", "9.5.0"].includes(args.lvglVersion as string)) {
            fail("Unsupported LVGL version");
        }
        for (const key of ["displayWidth", "displayHeight"]) {
            if (args[key] !== undefined && !positiveSize(args[key])) {
                fail("Invalid display resolution");
            }
        }
        for (const key of ["flowSupport", "openWhenDone"]) {
            if (args[key] !== undefined && typeof args[key] !== "boolean") {
                fail("Invalid boolean option: " + key);
            }
        }
        return args;
    }
    if (typeof args.expectedProjectPath !== "string" ||
        !args.expectedProjectPath.trim() ||
        args.expectedProjectPath.length > 1024 ||
        !/\.eez-project$/i.test(args.expectedProjectPath)) {
        fail("expectedProjectPath must be the saved .eez-project path returned by get_current_project");
    }

    const allowed: Record<McpWriteTool, string[]> = {
        create_project: ["projectPath", "lvglVersion", "flowSupport",
            "displayWidth", "displayHeight", "openWhenDone"],
        create_page: ["expectedProjectPath", "name", "width", "height"],
        rename_page: ["expectedProjectPath", "pageName", "pageId", "name"],
        delete_page: ["expectedProjectPath", "pageName", "pageId"],
        create_style: ["expectedProjectPath", "name", "widgetType"],
        rename_style: ["expectedProjectPath", "stylePath", "styleId", "name"],
        delete_style: ["expectedProjectPath", "stylePath", "styleId"],
        set_default_style: ["expectedProjectPath", "stylePath", "styleId", "enabled"],
        import_bitmap: ["expectedProjectPath", "filePath", "name"],
        create_variable: ["expectedProjectPath", "name", "type", "initialValue"],
        create_action: ["expectedProjectPath", "name"],
        add_action_node: ["expectedProjectPath", "actionName", "actionId", "nodeType", "left", "top", "name", "milliseconds", "variableName", "value", "conditionVariableName", "conditionValue", "targetActionName", "screenName"],
        connect_action_nodes: ["expectedProjectPath", "actionName", "actionId", "sourceId", "targetId", "output"],
        disconnect_action_line: ["expectedProjectPath", "actionName", "actionId", "lineId"],
        delete_action_node: ["expectedProjectPath", "actionName", "actionId", "nodeId"],
        bind_widget_variable: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "property", "variableName"],
        unbind_widget_variable: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "property", "value"],
        add_widget: ["expectedProjectPath", "pageName", "widgetType", "parentPath", "parentId", "properties"],
        update_widget: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "properties"],
        duplicate_widget: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "newIdentifier", "left", "top"],
        move_widget: ["expectedProjectPath", "sourcePageName", "widgetPath", "widgetId", "targetPageName", "targetParentPath", "targetParentId"],
        reorder_widget: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "anchorPath", "anchorId", "position"],
        start_project_check: ["expectedProjectPath"],
        start_project_build: ["expectedProjectPath"],
        start_preview: ["expectedProjectPath"],
        stop_preview: ["expectedProjectPath"],
        preview_tap: ["expectedProjectPath", "pageId", "x", "y"],
        delete_widget: ["expectedProjectPath", "pageName", "widgetPath", "widgetId"],
        set_style_property: ["expectedProjectPath", "stylePath", "styleId", "part", "state", "property", "value"],
        set_widget_property: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "property", "value"],
        set_widget_properties: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "properties"],
        set_widget_local_style: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "part", "state", "property", "value"],
        add_widget_event: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "eventName", "actionName", "userData"],
        remove_widget_event: ["expectedProjectPath", "pageName", "widgetPath", "widgetId", "eventId"],
        save_project: ["expectedProjectPath"],
        undo: ["expectedProjectPath"],
        redo: ["expectedProjectPath"]
    };
    if (Object.keys(args).some(key => !allowed[tool].includes(key))) {
        fail("Unexpected tool argument");
    }
    if (tool === "preview_tap") {
        if (!validObjectId(args.pageId) ||
            !Number.isSafeInteger(args.x) || !Number.isSafeInteger(args.y) ||
            (args.x as number) < 0 || (args.y as number) < 0 ||
            (args.x as number) >= 4096 || (args.y as number) >= 4096) {
            fail("preview_tap requires a fresh pageId and integer pixel coordinates within 0..4095");
        }
    }
    if (["update_widget", "duplicate_widget", "move_widget", "reorder_widget", "delete_widget", "set_widget_property", "set_widget_properties",
         "bind_widget_variable", "unbind_widget_variable",
         "set_widget_local_style", "add_widget_event", "remove_widget_event"].includes(tool) && !validObjectId(args.widgetId)) {
        fail("widgetId from list_widgets is required to prevent stale path writes");
    }
    if (["set_style_property", "rename_style", "delete_style", "set_default_style"].includes(tool) && !validObjectId(args.styleId)) {
        fail("styleId from list_styles is required to prevent stale style writes");
    }
    const pageTool = ["add_widget","update_widget","duplicate_widget","reorder_widget","delete_widget",
        "set_widget_property","set_widget_properties","set_widget_local_style",
        "bind_widget_variable", "unbind_widget_variable",
        "add_widget_event","remove_widget_event"].includes(tool);
    // Page writes default to the currently open canvas when omitted.
    if (pageTool && args.pageName !== undefined &&
        (typeof args.pageName !== "string" ||
         args.pageName.length > 128 || !args.pageName.trim())) fail("Invalid pageName");
    if (["rename_page", "delete_page"].includes(tool) && !validObjectId(args.pageId)) {
        fail("pageId from list_pages is required to prevent stale page writes");
    }
    if (["add_action_node", "connect_action_nodes", "disconnect_action_line", "delete_action_node"].includes(tool)) {
        if (!safeLabel(args.actionName) || !validObjectId(args.actionId)) {
            fail("actionName and actionId from list_actions are required");
        }
        if (tool === "add_action_node") {
            if (!["StartActionComponent", "NoopActionComponent", "EndActionComponent", "DelayActionComponent", "SetVariableActionComponent", "IsTrueActionComponent", "CallActionActionComponent", "LVGLActionComponent"].includes(args.nodeType as string)) {
                fail("Unsupported Flow node type");
            }
            for (const field of ["left", "top"]) {
                if (!boundedCoordinate(args[field])) fail("Invalid Flow node geometry: " + field);
            }
            if (args.name !== undefined && (!safeLabel(args.name) || args.nodeType !== "NoopActionComponent")) {
                fail("Only Noop nodes accept a name identifier");
            }
            if (args.nodeType === "DelayActionComponent") {
                if (!Number.isSafeInteger(args.milliseconds) || (args.milliseconds as number) < 0 ||
                    (args.milliseconds as number) > 60000) fail("Delay must be 0-60000 ms");
            } else if (args.milliseconds !== undefined) fail("milliseconds is only valid for Delay nodes");
            if (args.nodeType === "SetVariableActionComponent") {
                if (!safeLabel(args.variableName)) fail("variableName must be a safe identifier");
                const val = args.value;
                if (typeof val !== "boolean" && typeof val !== "number" && typeof val !== "string") {
                    fail("SetVariable requires a scalar value");
                }
                if (typeof val === "string" && val.length > 128 ||
                    typeof val === "number" && (!Number.isFinite(val) || Math.abs(val) > 1000000)) {
                    fail("SetVariable value exceeds limits");
                }
            } else if (args.variableName !== undefined || args.value !== undefined) {
                fail("variableName and value are only valid for SetVariable nodes");
            }
            if (args.nodeType === "IsTrueActionComponent") {
                const hasVar = args.conditionVariableName !== undefined;
                const hasLiteral = args.conditionValue !== undefined;
                if (hasVar === hasLiteral || hasVar && !safeLabel(args.conditionVariableName) ||
                    hasLiteral && typeof args.conditionValue !== "boolean") {
                    fail("IsTrue needs exactly one boolean literal or existing boolean global variable");
                }
            } else if (args.conditionVariableName !== undefined || args.conditionValue !== undefined) {
                fail("Condition arguments are only valid for IsTrue nodes");
            }
            if (args.nodeType === "CallActionActionComponent") {
                if (!safeLabel(args.targetActionName)) fail("CallAction needs an existing targetActionName");
            } else if (args.targetActionName !== undefined) fail("targetActionName is only valid for CallAction");
            if (args.nodeType === "LVGLActionComponent") {
                if (!safeLabel(args.screenName)) fail("LVGL screen navigation needs an existing screenName");
            } else if (args.screenName !== undefined) fail("screenName is only valid for LVGLActionComponent");
        } else if (tool === "connect_action_nodes") {
            if (args.output !== undefined && !["@seqout", "True", "False"].includes(args.output as string)) {
                fail("Only @seqout and IsTrue True/False sequence outputs are supported");
            }
            if (!validObjectId(args.sourceId) || !validObjectId(args.targetId)) {
                fail("Flow sourceId and targetId must come from get_action_graph");
            }
        } else if (!validObjectId(args[tool === "delete_action_node" ? "nodeId" : "lineId"])) {
            fail("Flow nodeId/lineId must come from get_action_graph");
        }
    } else if (tool === "create_action") {
        if (!safeLabel(args.name)) fail("Invalid action name");
    } else if (tool === "create_variable") {
        if (!safeLabel(args.name)) fail("Invalid variable name");
        if (!["integer", "float", "double", "boolean", "string"].includes(args.type as string)) {
            fail("Unsupported variable type");
        }
        const val = args.initialValue;
        if (val !== undefined) {
            const isValid = args.type === "boolean" ? typeof val === "boolean" :
                args.type === "string" ? typeof val === "string" && val.length <= 256 :
                typeof val === "number" && Number.isFinite(val) && Math.abs(val) <= 1_000_000 &&
                (args.type !== "integer" || Number.isSafeInteger(val));
            if (!isValid) fail("initialValue does not match variable type");
        }
    } else if (["bind_widget_variable", "unbind_widget_variable"].includes(tool)) {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        if (typeof args.property !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(args.property)) {
            fail("Invalid binding property");
        }
        if (tool === "bind_widget_variable" && !safeLabel(args.variableName)) {
            fail("Invalid variable name");
        }
        if (tool === "unbind_widget_variable" &&
            (typeof args.value !== "string" && typeof args.value !== "number" && typeof args.value !== "boolean" ||
             (typeof args.value === "string" && args.value.length > 512) ||
             (typeof args.value === "number" && !Number.isFinite(args.value)))) {
            fail("Invalid literal value");
        }
    } else if (tool === "import_bitmap") {
        if (typeof args.filePath !== "string" || args.filePath.length > 1024 ||
            args.filePath.includes("\u0000") || !require("path").isAbsolute(args.filePath)) {
            fail("filePath must be an absolute file path");
        }
        if (!/\.(png|jpg|jpeg)$/i.test(args.filePath)) fail("Only PNG/JPEG images are supported");
        if (!safeLabel(args.name)) fail("Invalid Bitmap name");
    } else if (tool === "create_style") {
        if (!safeLabel(args.name)) fail("Invalid Style name");
        if (typeof args.widgetType !== "string" ||
            !/^LVGL[A-Za-z0-9]+Widget$/.test(args.widgetType) ||
            args.widgetType.length > 64) fail("Invalid Style widget type");
    } else if (["rename_style", "delete_style", "set_default_style"].includes(tool)) {
        if (!isIndexPath(args.stylePath)) fail("Invalid stylePath");
        if (tool === "rename_style" && !safeLabel(args.name)) fail("Invalid Style name");
        if (tool === "set_default_style" && typeof args.enabled !== "boolean") {
            fail("enabled must be boolean");
        }
    } else if (["rename_page", "delete_page"].includes(tool)) {
        if (typeof args.pageName !== "string" || !safeLabel(args.pageName)) fail("Invalid pageName");
        if (tool === "rename_page" && !safeLabel(args.name)) fail("Invalid new page name");
    } else if (tool === "create_page") {
        if (!safeLabel(args.name)) fail("Page name must be a valid identifier");
        if (args.width !== undefined && !positiveSize(args.width)) fail("Invalid page width");
        if (args.height !== undefined && !positiveSize(args.height)) fail("Invalid page height");
    } else if (tool === "add_widget") {
        if (typeof args.widgetType !== "string" ||
            !/^LVGL[A-Za-z0-9]+Widget$/.test(args.widgetType) ||
            args.widgetType.length > 64) fail("Invalid widgetType");
        if (args.parentPath !== undefined && !isIndexPath(args.parentPath)) {
            fail("Invalid parentPath");
        }
        if (args.parentPath !== undefined && !validObjectId(args.parentId)) {
            fail("parentId is required when parentPath is used");
        }
        if (args.parentId !== undefined && !validObjectId(args.parentId)) {
            fail("Invalid parentId");
        }
        validateWidgetProperties(args.properties);
    } else if (tool === "move_widget") {
        if (!safeLabel(args.sourcePageName) || !safeLabel(args.targetPageName)) fail("Both source and target page names are required");
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        if (args.targetParentPath !== undefined &&
            (!isIndexPath(args.targetParentPath) || !validObjectId(args.targetParentId))) {
            fail("targetParentPath and targetParentId must identify a fresh target container");
        }
        if (args.targetParentPath === undefined && args.targetParentId !== undefined) {
            fail("targetParentId requires targetParentPath");
        }
    } else if (tool === "duplicate_widget") {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        if (!safeLabel(args.newIdentifier)) fail("Invalid newIdentifier");
        if (args.left !== undefined && !boundedCoordinate(args.left)) fail("Invalid left");
        if (args.top !== undefined && !boundedCoordinate(args.top)) fail("Invalid top");
    } else if (tool === "reorder_widget") {
        if (!isIndexPath(args.widgetPath) || !isIndexPath(args.anchorPath)) fail("Invalid widget paths");
        if (!validObjectId(args.anchorId)) fail("anchorId from list_widgets is required");
        if (!["before", "after"].includes(args.position as string)) fail("position must be before or after");
    } else if (tool === "update_widget") {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        validateWidgetProperties(args.properties);
    } else if (tool === "delete_widget") {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
    } else if (tool === "set_widget_properties") {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        const props = args.properties;
        if (!props || typeof props !== "object" || Array.isArray(props) ||
            Object.getPrototypeOf(props) !== Object.prototype) fail("Invalid properties object");
        const entries = Object.entries(props as Record<string, unknown>);
        if (entries.length < 1 || entries.length > 32) fail("Expected 1 to 32 properties");
        for (const [key, val] of entries) {
            if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) ||
                !(["string", "number", "boolean"].includes(typeof val)) ||
                (typeof val === "string" && val.length > 512) ||
                (typeof val === "number" && !Number.isFinite(val))) {
                fail("Invalid widget property: " + key);
            }
        }
    } else if (tool === "set_widget_property") {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        if (typeof args.property !== "string" ||
            !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(args.property)) fail("Invalid property name");
        if (typeof args.value !== "string" && typeof args.value !== "number" &&
            typeof args.value !== "boolean") fail("Property must be scalar");
    } else if (tool === "add_widget_event") {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        if (typeof args.eventName !== "string" ||
            !/^[A-Z][A-Z0-9_]{0,63}$/.test(args.eventName)) {
            fail("Invalid LVGL event name");
        }
        if (!safeLabel(args.actionName)) fail("Action name must be an identifier");
        if (args.userData !== undefined &&
            (typeof args.userData !== "number" ||
             !Number.isSafeInteger(args.userData) || args.userData < 0 ||
             args.userData > 65535)) fail("Invalid event userData");
    } else if (tool === "remove_widget_event") {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        if (!validObjectId(args.eventId)) fail("Invalid eventId");
    } else if (tool === "set_widget_local_style") {
        if (!isIndexPath(args.widgetPath)) fail("Invalid widgetPath");
        if (typeof args.part !== "string" || !/^[A-Z_]{1,40}$/.test(args.part)) fail("Invalid part");
        if (typeof args.state !== "string" || !/^[A-Z_|]{1,100}$/.test(args.state)) fail("Invalid state");
        if (typeof args.property !== "string" || !/^[a-z_]{1,60}$/.test(args.property)) fail("Invalid property");
        if (typeof args.value !== "string" && typeof args.value !== "number") fail("Invalid style value");
    } else if (tool === "set_style_property") {
        if (!isIndexPath(args.stylePath)) fail("Invalid stylePath");
        if (typeof args.part !== "string" || !/^[A-Z_]{1,40}$/.test(args.part)) fail("Invalid part");
        if (typeof args.state !== "string" || !/^[A-Z_]{1,40}$/.test(args.state)) fail("Invalid state");
        if (typeof args.property !== "string" ||
            !/^[a-z][a-z_0-9]{0,59}$/.test(args.property)) {
            fail("Invalid style property");
        }
        if (typeof args.value !== "string" && typeof args.value !== "number") {
            fail("Style value must be a scalar");
        }
        // The renderer validates actual widget Part, LVGL State, catalog
        // property type and value bounds against the active project.
    }
    return args;
}

