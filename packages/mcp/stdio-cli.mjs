// Standalone MCP stdio entry point. In a packaged build it can run using
// ELECTRON_RUN_AS_NODE=1 without creating an Electron UI window.
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { callBridge } from "./bridge-client.mjs";

function createServer() {
    const server = new McpServer({ name: "digistudio", version: "0.1.0" });
    const handle = tool => async args => {
        try {
            const data = await callBridge(tool, args || {});
            if (tool === "get_canvas_snapshot" || tool === "get_preview_snapshot") {
                if (!data || data.mimeType !== "image/png" ||
                    typeof data.pngBase64 !== "string" ||
                    data.pngBase64.length < 16 || data.pngBase64.length > 1_350_000) {
                    throw new Error("Invalid or oversized LVGL canvas image response");
                }
                const { pngBase64, ...metadata } = data;
                return {
                    content: [
                        { type: "text", text: JSON.stringify(metadata) },
                        { type: "image", data: pngBase64, mimeType: "image/png" }
                    ],
                    structuredContent: metadata
                };
            }
            return {
                content: [{ type: "text", text: JSON.stringify(data) }],
                structuredContent: data
            };
        } catch (error) {
            return {
                isError: true,
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        code: error.code || "IPC_UNAVAILABLE",
                        message: error.message
                    })
                }]
            };
        }
    };

    server.registerTool(
        "get_mcp_capabilities",
        {
            description: "Discover supported DigiwiseStudio MCP operations, required AI workflow, safety rules and known gaps. Start here before planning an edit; no project mutation.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true }
        },
        handle("get_mcp_capabilities")
    );
    server.registerTool(
        "get_project_check_status",
        {
            description: "Poll a previously requested asynchronous DigiwiseStudio project check. Returns success/error counts and bounded editor output messages without modifying the project.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true }
        },
        handle("get_project_check_status")
    );
    server.registerTool(
        "get_project_build_status",
        {
            description: "Poll a previously requested asynchronous local DigiwiseStudio build. Returns build status, errors, warnings and bounded editor output messages.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true }
        },
        handle("get_project_build_status")
    );
    server.registerTool(
        "get_current_project",
        {
            description: "Read the currently active DigiwiseStudio LVGL project's metadata. Never modifies the project.",
            inputSchema: z.object({})
        },
        handle("get_current_project")
    );
    server.registerTool(
        "get_active_page",
        {
            description: "Read the page currently visible in the LVGL canvas, including its pageId. Fails safely when no canvas page is selected.",
            inputSchema: z.object({})
        },
        handle("get_active_page")
    );
    server.registerTool(
        "get_canvas_snapshot",
        {
            description: "Capture ONLY pixels of the currently visible active LVGL editor canvas. Requires pageId freshly returned by get_active_page. Returns PNG image and dimensions; not the desktop, account UI, simulator or interactive preview. Read-only, max 1024px per side.",
            inputSchema: z.object({ pageId: z.string().min(1).max(128) }),
            annotations: { readOnlyHint: true }
        },
        handle("get_canvas_snapshot")
    );
    server.registerTool(
        "get_preview_snapshot",
        {
            description: "Capture ONLY the current native running WASM preview framebuffer for selectedPageId returned by get_preview_status. Returns bounded PNG image. Never captures desktop/editor chrome or a Docker simulator. Read-only.",
            inputSchema: z.object({ pageId: z.string().min(1).max(128) }),
            annotations: { readOnlyHint: true }
        },
        handle("get_preview_snapshot")
    );
    server.registerTool(
        "get_preview_status",
        {
            description: "Read current local WASM preview state (idle/starting/running/paused/stopped/error), selected page and bounded error. Does not capture a runtime frame. Read-only.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true }
        },
        handle("get_preview_status")
    );
    server.registerTool(
        "list_variables",
        {
            description: "List names and types of existing global project variables, without exposing potentially sensitive default values or scripts. Read-only.",
            inputSchema: z.object({})
        },
        handle("list_variables")
    );
    server.registerTool(
        "list_actions",
        {
            description: "List existing LVGL project Action names and implementation types, without source code. Read-only.",
            inputSchema: z.object({})
        },
        handle("list_actions")
    );
    server.registerTool(
        "get_action_graph",
        {
            description: "Read an existing Flow Action's nodes, sequence ports and connections with actionName + actionId from list_actions; no expression/source contents.",
            inputSchema: z.object({
                actionName: z.string().min(1).max(64),
                actionId: z.string().min(1).max(128)
            }),
            annotations: { readOnlyHint: true }
        },
        handle("get_action_graph")
    );
    server.registerTool(
        "list_pages",
        {
            description: "List all pages and resolutions in the active LVGL project. Read-only.",
            inputSchema: z.object({})
        },
        handle("list_pages")
    );
    server.registerTool(
        "list_widgets",
        {
            description: "Read an LVGL page's hierarchical widgets and a bounded set of safe scalar properties. Read-only.",
            inputSchema: z.object({ pageName: z.string().min(1).max(128) })
        },
        handle("list_widgets")
    );

    server.registerTool(
        "list_styles",
        {
            description: "List LVGL style hierarchy with stable stylePath index arrays and default style mappings. Read-only.",
            inputSchema: z.object({})
        },
        handle("list_styles")
    );
    server.registerTool(
        "get_style",
        {
            description: "Read an LVGL Style using stylePath from list_styles; exposes literal style properties only.",
            inputSchema: z.object({
                stylePath: z.array(z.number().int().min(0).max(2999)).min(1).max(32)
            })
        },
        handle("get_style")
    );
    server.registerTool(
        "list_assets",
        {
            description: "List LVGL font and bitmap metadata without exporting font files or embedded images. Read-only.",
            inputSchema: z.object({})
        },
        handle("list_assets")
    );
    server.registerTool(
        "get_widget_details",
        {
            description: "Read one LVGL widget's geometry, style references, safe local style values and event bindings. Use widgetPath returned by list_widgets.",
            inputSchema: z.object({
                pageName: z.string().min(1).max(128),
                widgetPath: z.array(z.number().int().min(0).max(2999)).min(1).max(32)
            })
        },
        handle("get_widget_details")
    );
    server.registerTool(
        "list_widget_events",
        {
            description: "List LVGL widget event names, handler types and action references on a page, without exposing event scripts.",
            inputSchema: z.object({
                pageName: z.string().min(1).max(128)
            })
        },
        handle("list_widget_events")
    );
    server.registerTool(
        "get_widget_schema",
        {
            description: "Discover this widget's supported editable properties, current values, enum options, valid LVGL parts, style properties and Bitmap references. Use before changing widgets of any type.",
            inputSchema: z.object({
                pageName: z.string().min(1).max(128),
                widgetPath: z.array(z.number().int().min(0).max(2999)).min(1).max(32)
            }),
            annotations: { readOnlyHint: true }
        },
        handle("get_widget_schema")
    );
    // Enabling MCP Server allows write REQUESTS to reach the local user approval
    // dialog. Actual edits are denied until approved once or for this session.
    const widgetProps = z.record(z.string(), z.union([
        z.string(), z.number().finite(), z.boolean()
    ]));
    const indexPath = z.array(z.number().int().min(0).max(2999)).min(1).max(32);
    const writeTools = [
        {
            name: "create_project",
            description: "Create an independent LVGL .eez-project from DigiStudio's bundled EmptyUI template, without overwriting existing files. Requires a local directory chosen in advance and AI write permission. Opens the new project in the IDE unless openWhenDone=false.",
            schema: z.object({
                projectPath: z.string().min(1).max(1024),
                lvglVersion: z.enum([
                    "8.4.0", "9.2.2", "9.3.0", "9.4.0", "9.5.0"
                ]).optional(),
                flowSupport: z.boolean().optional(),
                displayWidth: z.number().int().min(1).max(4096).optional(),
                displayHeight: z.number().int().min(1).max(4096).optional(),
                openWhenDone: z.boolean().optional()
            }),
            destructive: false
        },
        {
            name: "create_page",
            description: "Create an LVGL page using DigiStudio editor history. Requires local write approval.",
            schema: z.object({
                name: z.string().min(1).max(64),
                width: z.number().int().min(1).max(4096).optional(),
                height: z.number().int().min(1).max(4096).optional()
            }),
            destructive: false
        },
        {
            name: "rename_page",
            description: "Rename an LVGL user page using pageName + pageId from list_pages; update ClassInfo-backed navigation references and initialPage in one Undo transaction.",
            schema: z.object({
                pageName: z.string().min(1).max(128),
                pageId: z.string().min(1).max(128),
                name: z.string().min(1).max(64)
            }),
            destructive: true
        },
        {
            name: "delete_page",
            description: "Delete an unused LVGL user page through ProjectStore with Undo; refuses deletion of the last page or a page used as initialPage or referenced by another editor object. Requires pageName + pageId.",
            schema: z.object({
                pageName: z.string().min(1).max(128),
                pageId: z.string().min(1).max(128)
            }),
            destructive: true
        },
        {
            name: "create_style",
            description: "Create a named LVGL Style for a registered widget type using the editor Style model. Returns stable styleId and stylePath for property writes.",
            schema: z.object({
                name: z.string().min(1).max(64),
                widgetType: z.string().min(1).max(64)
            }),
            destructive: false
        },
        {
            name: "rename_style",
            description: "Rename an LVGL Style and update widget useStyle references and default mapping in one undo transaction. Requires styleId and stylePath.",
            schema: z.object({
                stylePath: indexPath,
                styleId: z.string().min(1).max(128),
                name: z.string().min(1).max(64)
            }),
            destructive: true
        },
        {
            name: "delete_style",
            description: "Delete an unused LVGL Style. Rejects styles still referenced by widgets, default mappings, or child Styles. Undoable.",
            schema: z.object({
                stylePath: indexPath,
                styleId: z.string().min(1).max(128)
            }),
            destructive: true
        },
        {
            name: "set_default_style",
            description: "Set or clear a widget type's default Style with identity check and Undo. Disabled requires the Style to be the current default.",
            schema: z.object({
                stylePath: indexPath,
                styleId: z.string().min(1).max(128),
                enabled: z.boolean()
            }),
            destructive: true
        },
        {
            name: "import_bitmap",
            description: "Import a PNG/JPEG (up to 10 MiB) from within the current saved project directory, using the native Bitmap importer. Name must be a unique identifier. Requires local user write approval.",
            schema: z.object({
                filePath: z.string().min(1).max(1024),
                name: z.string().min(1).max(64)
            }),
            destructive: false
        },
        {
            name: "create_variable",
            description: "Create a typed Flow global variable (integer, float, double, boolean or string) with a safe scalar initial value. No script execution; requires an LVGL project with Flow support.",
            schema: z.object({
                name: z.string().min(1).max(64),
                type: z.enum(["integer", "float", "double", "boolean", "string"]),
                initialValue: z.union([z.string().max(256), z.number().finite(), z.boolean()]).optional()
            }),
            destructive: false
        },
        {
            name: "set_variable_implementation",
            description: "Switch an existing global variable between Native and Flow using variableName + variableId from list_variables. Preserves the variable value and references; editor Undoable.",
            schema: z.object({
                variableName: z.string().min(1).max(64),
                variableId: z.string().min(1).max(128),
                native: z.boolean()
            }),
            destructive: true
        },
        {
            name: "create_action",
            description: "Create a named Flow Action container in a Flow-enabled LVGL project. Use add_action_node and connect_action_nodes to define a basic sequence graph.",
            schema: z.object({ name: z.string().min(1).max(64) }),
            destructive: false
        },
        {
            name: "set_action_implementation",
            description: "Switch an existing Action between Flow and Native using actionName + actionId from list_actions. An empty Native Action converted to Flow receives a Start-to-End no-op graph; existing Flow nodes are preserved but are inactive while Native. This does not generate Native C/C++ source. Undoable.",
            schema: z.object({
                actionName: z.string().min(1).max(64),
                actionId: z.string().min(1).max(128),
                implementationType: z.enum(["flow", "native"])
            }),
            destructive: true
        },
        {
            name: "add_action_node",
            description: "Add Start/NoOp/End/Delay/SetVariable/IsTrue/CallAction/LVGL screen-change Flow nodes. IsTrue accepts only boolean literal or existing boolean variable; CallAction targets existing Flow Action without call cycles; navigation targets existing user page. All edits require local approval and Undo.",
            schema: z.object({
                actionName: z.string().min(1).max(64),
                actionId: z.string().min(1).max(128),
                nodeType: z.enum(["StartActionComponent", "NoopActionComponent", "EndActionComponent", "DelayActionComponent", "SetVariableActionComponent", "IsTrueActionComponent", "CallActionActionComponent", "LVGLActionComponent"]),
                left: z.number().int().min(-4096).max(4096),
                top: z.number().int().min(-4096).max(4096),
                name: z.string().min(1).max(64).optional(),
                milliseconds: z.number().int().min(0).max(60000).optional(),
                variableName: z.string().min(1).max(64).optional(),
                value: z.union([z.string().max(128), z.number().finite(), z.boolean()]).optional(),
                conditionVariableName: z.string().min(1).max(64).optional(),
                conditionValue: z.boolean().optional(),
                targetActionName: z.string().min(1).max(64).optional(),
                screenName: z.string().min(1).max(64).optional()
            }),
            destructive: false
        },
        {
            name: "connect_action_nodes",
            description: "Connect a Flow sequence output (@seqout or IsTrue True/False) to a target @seqin. Validates identity, port types, occupancy, and sequence cycles; Undoable.",
            schema: z.object({
                actionName: z.string().min(1).max(64),
                actionId: z.string().min(1).max(128),
                sourceId: z.string().min(1).max(128),
                targetId: z.string().min(1).max(128),
                output: z.enum(["@seqout", "True", "False"]).optional()
            }),
            destructive: true
        },
        {
            name: "disconnect_action_line",
            description: "Remove one sequence connection from a Flow Action by lineId from get_action_graph. Undoable.",
            schema: z.object({
                actionName: z.string().min(1).max(64),
                actionId: z.string().min(1).max(128),
                lineId: z.string().min(1).max(128)
            }),
            destructive: true
        },
        {
            name: "delete_action_node",
            description: "Delete a Flow Action node and its incident lines in one Undo transaction. Requires nodeId from get_action_graph.",
            schema: z.object({
                actionName: z.string().min(1).max(64),
                actionId: z.string().min(1).max(128),
                nodeId: z.string().min(1).max(128)
            }),
            destructive: true
        },
        {
            name: "bind_widget_variable",
            description: "Bind a widget expression-capable property to an existing compatible global variable by name. Performs strict type checks and uses one Undo transaction. No arbitrary expression text.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                property: z.string().min(1).max(64),
                variableName: z.string().min(1).max(64)
            }),
            destructive: true
        },
        {
            name: "unbind_widget_variable",
            description: "Switch a widget property from a global variable expression back to a validated literal value, with Undo.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                property: z.string().min(1).max(64),
                value: z.union([z.string().max(512), z.number().finite(), z.boolean()])
            }),
            destructive: true
        },
        {
            name: "add_widget",
            description: "Add a registered LVGL palette widget supported by the current project/version (discover via get_mcp_capabilities). Optional pageName targets a named page; Undo supported. Initial fields are restricted; configure additional properties with get_widget_schema and set_widget_properties.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetType: z.string().min(1).max(64),
                parentPath: indexPath.optional(),
                parentId: z.string().min(1).max(128).optional(),
                properties: widgetProps
            }),
            destructive: false
        },
        {
            name: "update_widget",
            description: "Update widget fields using widgetPath AND widgetId from list_widgets. Rejects stale paths and supports editor Undo; defaults to active canvas page.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                properties: widgetProps
            }),
            destructive: true
        },
        {
            name: "duplicate_widget",
            description: "Clone a leaf LVGL widget, including its styles and event config, with a fresh object ID and a unique caller-provided identifier. Inserts after the source in one Undo transaction. Rejects widgets with children.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                newIdentifier: z.string().min(1).max(64),
                left: z.number().int().min(-4096).max(4096).optional(),
                top: z.number().int().min(-4096).max(4096).optional()
            }),
            destructive: false
        },
        {
            name: "move_widget",
            description: "Move an existing LVGL widget into a different page or container, using native editor delete/add and one Undo transaction. Guards source and target identities, forbids cycles and invalid container types. For same-parent ordering use reorder_widget.",
            schema: z.object({
                sourcePageName: z.string().min(1).max(128),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                targetPageName: z.string().min(1).max(128),
                targetParentPath: indexPath.optional(),
                targetParentId: z.string().min(1).max(128).optional()
            }),
            destructive: true
        },
        {
            name: "reorder_widget",
            description: "Move an LVGL widget before/after a sibling in the same parent collection using native editor commands with Undo. Requires fresh widgetPath/widgetId and anchorPath/anchorId; rejects cross-container moves.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                anchorPath: indexPath,
                anchorId: z.string().min(1).max(128),
                position: z.enum(["before", "after"])
            }),
            destructive: true
        },
        {
            name: "start_project_check",
            description: "Start asynchronous read-only source validation using DigiwiseStudio's existing editor check pipeline, with local approval. Poll get_project_check_status for results; no build files are generated.",
            schema: z.object({}),
            destructive: false
        },
        {
            name: "start_project_build",
            description: "Start asynchronous DigiwiseStudio local Build, only when output destination, generated filenames and previous build manifest are confined to the saved project directory. Requires local user approval; poll get_project_build_status.",
            schema: z.object({}),
            destructive: true
        },
        {
            name: "start_preview",
            description: "Start the editor's native local WASM Run preview for a saved and unmodified LVGL project, after explicit local approval. Poll get_preview_status for runtime state. No scripts or external devices.",
            schema: z.object({}),
            destructive: false
        },
        {
            name: "stop_preview",
            description: "Stop the active local editor WASM preview and return to edit mode, after explicit local approval. Does not touch build artifacts or firmware.",
            schema: z.object({}),
            destructive: false
        },
        {
            name: "preview_tap",
            description: "Tap one integer (x,y) point inside the current native WASM preview page, identified by fresh selectedPageId. Delivered to the existing WASM pointer queue; no desktop mouse, scripts or device access. Requires local write approval. Verify effects by reading a fresh preview frame.",
            schema: z.object({
                pageId: z.string().min(1).max(128),
                x: z.number().int().min(0).max(4095),
                y: z.number().int().min(0).max(4095)
            }),
            destructive: false
        },
        {
            name: "delete_widget",
            description: "Delete a widget using both widgetPath and widgetId returned by list_widgets. Rejects stale paths. Defaults to active canvas page.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128)
            }),
            destructive: true
        },
        {
            name: "set_style_property",
            description: "Modify a literal LVGL Style property validated against the actual widget type, Part, State and Style Catalog; provide stylePath and styleId from list_styles.",
            schema: z.object({
                stylePath: indexPath,
                styleId: z.string().min(1).max(128),
                part: z.string().min(1).max(40),
                state: z.string().min(1).max(40),
                property: z.string().min(1).max(60),
                value: z.union([z.string().max(40), z.number().finite()])
            }),
            destructive: true
        },
        {
            name: "set_widget_property",
            description: "Set one editor-supported scalar/enum property or existing Bitmap reference. Requires widgetPath and widgetId from list_widgets/get_widget_schema; rejects stale target.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                property: z.string().min(1).max(64),
                value: z.union([z.string().max(512), z.number().finite(), z.boolean()])
            }),
            destructive: true
        },
        {
            name: "set_widget_properties",
            description: "Atomically update 1-32 properties validated against this widget's get_widget_schema. All values are validated before a single editor Undo transaction. Requires current widgetPath and widgetId.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                properties: widgetProps
            }),
            destructive: true
        },
        {
            name: "set_widget_local_style",
            description: "Change widget local Style on a supported Part and State (e.g. Switch INDICATOR/CHECKED); requires widgetPath and widgetId to prevent stale target writes.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                part: z.string().min(1).max(40),
                state: z.string().min(1).max(100),
                property: z.string().min(1).max(60),
                value: z.union([z.string().max(40), z.number().finite()])
            }),
            destructive: true
        },
        {
            name: "add_widget_event",
            description: "Bind an existing Action to a valid LVGL widget event, with object identity checks and editor Undo. Does not execute or generate arbitrary code.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                eventName: z.string().min(1).max(64),
                actionName: z.string().min(1).max(64),
                userData: z.number().int().min(0).max(65535).optional()
            }),
            destructive: false
        },
        {
            name: "remove_widget_event",
            description: "Remove an Action-type event binding using eventId from list_widget_events; refuses Flow connections and stale targets. Supports Undo.",
            schema: z.object({
                pageName: z.string().min(1).max(128).optional(),
                widgetPath: indexPath,
                widgetId: z.string().min(1).max(128),
                eventId: z.string().min(1).max(128)
            }),
            destructive: true
        },
        {
            name: "save_project",
            description: "Save the active LVGL project to its existing file, only after local user confirmation.",
            schema: z.object({}),
            destructive: true
        },
        {
            name: "undo",
            description: "Undo the latest editor change via ProjectStore. Requires local user confirmation.",
            schema: z.object({}),
            destructive: true
        },
        {
            name: "redo",
            description: "Redo the latest editor change via ProjectStore. Requires local user confirmation.",
            schema: z.object({}),
            destructive: true
        }
    ];
    for (const tool of writeTools) {
        server.registerTool(tool.name, {
            description: tool.description,
            inputSchema: tool.name === "create_project"
                ? tool.schema
                : tool.schema.extend({
                    expectedProjectPath: z.string().min(1).max(1024)
                }),
            annotations: {
                readOnlyHint: false,
                destructiveHint: tool.destructive
            }
        }, handle(tool.name));
    }
    return server;
}

// Never write to stdout: it is reserved for the MCP protocol.
serveStdio(createServer);
