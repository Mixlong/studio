
import type { ProjectStore } from "project-editor/store";
import { Page } from "project-editor/features/page/page";
import { LVGLWidget } from "project-editor/lvgl/widgets/Base";
import { EventHandler } from "project-editor/flow/component";
import { LVGLStyle } from "project-editor/lvgl/style";
import { createBitmap } from "project-editor/features/bitmap/bitmap";
import { Variable } from "project-editor/features/variable/variable";
import { Action } from "project-editor/features/action/action";
import { StartActionComponent, NoopActionComponent, EndActionComponent, DelayActionComponent, SetVariableActionComponent, IsTrueActionComponent, CallActionActionComponent } from "project-editor/flow/components/actions";
import { LVGLActionComponent } from "project-editor/lvgl/actions";
import { ConnectionLine } from "project-editor/flow/connection-line";
import { resolveFlowAction } from "./action-graph";
import { RuntimeType } from "project-editor/project/project-type-traits";
import { tapPreview } from "./preview-interaction";
import * as fs from "fs";
import {
    findClass,
    getClassInfo,
    getClass,
    getDefaultValue,
    isProperSubclassOf
} from "project-editor/core/object";
import { createObject } from "project-editor/store/serialization";
import { visitObjects } from "project-editor/core/search";
import { deleteObject as detachObject, insertObjectBefore, insertObjectAfter } from "project-editor/store/commands";
import { toJS } from "mobx";
import * as path from "path";
import { McpWriteTool, mcpReadError } from "../protocol";
import { validateWriteArguments } from "../validator";
import { lvglPropertiesMap } from "project-editor/lvgl/style-catalog";
import {
    validateRuntimeWidgetProperty,
    validateLocalStyleProperty,
    allowedWidgetEvents,
    validateWidgetVariableBinding
} from "./property-schema";
import { validateGlobalStyleProperty } from "./property-schema";
import { markMcpTransaction, executeMcpHistory } from "./undo-ownership";
import { startProjectCheck, startProjectBuild } from "./check-tasks";

function fail(code: "INVALID_ARGUMENT" | "INVALID_STATE" | "WIDGET_NOT_FOUND" |
    "STYLE_NOT_FOUND" | "PAGE_NOT_FOUND" | "UNSAVED_PROJECT", message: string): never {
    throw mcpReadError(code, message);
}

function resolvePage(store: ProjectStore, name: string) {
    const page = store.project.pages.find(p => p.name === name);
    if (!page) fail("PAGE_NOT_FOUND", "Page not found");
    return page;
}

/** Find ClassInfo-backed page references (e.g. LVGL screen navigation actions).
 * We refuse to delete referenced pages and update references on rename.
 */
function pageReferences(store: ProjectStore, page: Page) {
    const references: { object: any; field: string }[] = [];
    const collection = page.isUsedAsUserWidget ? "userWidgets" : "userPages";
    let visited = 0;
    for (const object of visitObjects(store.project)) {
        if (++visited > 30000) {
            fail("INVALID_STATE", "Project has too many objects for safe page reference validation");
        }
        if (object === page) continue;
        const info = getClassInfo(object);
        for (const property of info.properties || []) {
            if (property.referencedObjectCollectionPath === collection &&
                (object as any)[property.name] === page.name) {
                references.push({ object, field: property.name });
            }
        }
    }
    return references;
}

function roots(page: Page): LVGLWidget[] {
    return page.components.filter(item => item instanceof LVGLWidget) as LVGLWidget[];
}

function widgetAt(page: Page, path: number[], expectedId?: string) {
    let children = roots(page);
    let widget: LVGLWidget | undefined;
    for (const index of path) {
        widget = children[index];
        if (!widget) fail("WIDGET_NOT_FOUND", "Widget path no longer exists");
        children = (widget.children || []).filter(c => c instanceof LVGLWidget);
    }
    if (!widget) fail("WIDGET_NOT_FOUND", "Widget not found");
    if (expectedId !== undefined && widget.objID !== expectedId) {
        fail("INVALID_STATE", "Widget path is stale or points to a different widget; call list_widgets again");
    }
    if (widget.type === "LVGLScreenWidget") {
        fail("INVALID_STATE", "Screen root cannot be edited by MCP");
    }
    return widget;
}

// Resolve the actual post-insert hierarchy. ProjectStore.addObject() may
// automatically move root LVGL widgets under the page's Screen widget.
function findWidgetPath(page: Page, target: LVGLWidget): number[] {
    const seen = new Set<LVGLWidget>();
    const search = (items: LVGLWidget[], prefix: number[]): number[] | undefined => {
        for (let index = 0; index < items.length; index++) {
            const widget = items[index];
            if (widget === target) return [...prefix, index];
            if (seen.has(widget)) continue;
            seen.add(widget);
            const nested = search(
                (widget.children || []).filter(child => child instanceof LVGLWidget),
                [...prefix, index]
            );
            if (nested) return nested;
        }
        return undefined;
    };
    const path = search(roots(page), []);
    if (!path) fail("INVALID_STATE", "Created widget not present in the page tree");
    return path;
}

function styleAt(store: ProjectStore, indices: number[]): LVGLStyle {
    let children = store.project.lvglStyles?.styles || [];
    let style: LVGLStyle | undefined;
    for (const index of indices) {
        style = children[index];
        if (!style) fail("STYLE_NOT_FOUND", "Style path no longer exists");
        children = style.childStyles || [];
    }
    if (!style) fail("STYLE_NOT_FOUND", "Style not found");
    return style;
}

function widgetsUsingStyle(store: ProjectStore, name: string) {
    const found: LVGLWidget[] = [];
    const seen = new WeakSet<object>();
    let visits = 0;
    const visit = (widget: LVGLWidget) => {
        if (++visits > 10000 || seen.has(widget)) {
            fail("INVALID_STATE", "Widget tree is too large or cyclic");
        }
        seen.add(widget);
        if (widget.useStyle === name) found.push(widget);
        for (const child of widget.children || []) {
            if (child instanceof LVGLWidget) visit(child);
        }
    };
    for (const page of store.project.pages) {
        for (const widget of roots(page)) visit(widget);
    }
    return found;
}

function styleNameAvailable(store: ProjectStore, name: string, except?: LVGLStyle) {
    if (store.project.allLvglStyles.some(style =>
        style !== except && style.name.toLowerCase() === name.toLowerCase())) {
        fail("INVALID_ARGUMENT", "Style name already exists");
    }
}

function validIdentifier(store: ProjectStore, identifier: string, self?: LVGLWidget) {
    const visit = (widget: LVGLWidget): boolean => {
        if (widget !== self && widget.identifier === identifier) return false;
        return (widget.children || []).every(child => visit(child));
    };
    if (!store.project.pages.every(page => roots(page).every(widget => visit(widget)))) {
        fail("INVALID_ARGUMENT", "Widget identifier already exists");
    }
}

function validateProperties(
    store: ProjectStore,
    type: string,
    props: Record<string, unknown>,
    target?: LVGLWidget
) {
    if (props.identifier) validIdentifier(store, props.identifier as string, target);
    if (Object.prototype.hasOwnProperty.call(props, "text") && type !== "LVGLLabelWidget" &&
        type !== "LVGLTextareaWidget") {
        fail("INVALID_ARGUMENT", "Text can only be set on Label or Textarea widgets");
    }
    if (Object.prototype.hasOwnProperty.call(props, "value") &&
        !["LVGLArcWidget", "LVGLBarWidget", "LVGLSliderWidget"].includes(type)) {
        fail("INVALID_ARGUMENT", "Value unsupported for widget type");
    }
    if (Object.prototype.hasOwnProperty.call(props, "image")) {
        const image = props.image;
        if (type !== "LVGLImageWidget" || typeof image !== "string" ||
            !store.project.bitmaps.some(bitmap => bitmap.name === image)) {
            fail("INVALID_ARGUMENT", "Image must reference an existing Bitmap on an LVGLImageWidget");
        }
    }
    if (target && Object.prototype.hasOwnProperty.call(props, "text") &&
        (target as unknown as { textType?: string }).textType !== "literal") {
        fail("INVALID_STATE", "Widget text is not in literal mode");
    }
    if (target && Object.prototype.hasOwnProperty.call(props, "value") &&
        (target as unknown as { valueType?: string }).valueType !== "literal") {
        fail("INVALID_STATE", "Widget value is not in literal mode");
    }
    for (const field of ["hiddenFlag", "clickableFlag"]) {
        if (target && Object.prototype.hasOwnProperty.call(props, field) &&
            (target as unknown as Record<string, unknown>)[field + "Type"] !== "literal") {
            fail("INVALID_STATE", "Widget flag is controlled by an expression");
        }
    }
    if (props.useStyle) {
        const name = props.useStyle as string;
        const existing = store.project.allLvglStyles.find(style =>
            style.name === name && style.forWidgetType === type);
        if (!existing) fail("INVALID_ARGUMENT", "No matching Style for widget type");
    }
}

function transaction<T>(store: ProjectStore, callback: () => T): T {
    const undo = store.undoManager;
    if (undo.combineCommands || undo.postponeSetCombineCommandsFalse) {
        fail("INVALID_STATE", "An editor transaction is already active");
    }
    // Flush any command already pending from user edits before grouping.
    undo.setCombineCommands(false);
    const before = undo.undoStack.length;
    undo.setCombineCommands(true);
    try {
        const result = callback();
        undo.setCombineCommands(false);
        if (undo.undoStack.length <= before) {
            fail("INVALID_STATE", "MCP edit did not create an undoable transaction");
        }
        markMcpTransaction(undo);
        return result;
    } catch (error) {
        undo.setCombineCommands(false);
        if (undo.undoStack.length > before) undo.undo();
        throw error;
    }
}

function readRuntimeAfterModeChange(store: ProjectStore) {
    return store.runtime;
}

export async function executeWriteTool(
    store: ProjectStore,
    tool: McpWriteTool,
    args: unknown
): Promise<unknown> {
    const a = validateWriteArguments(tool, args);
    if (!store.filePath) {
        fail("UNSAVED_PROJECT", "Save the project in DigiwiseStudio before using MCP write tools");
    }
    const expected = path.resolve(a.expectedProjectPath as string);
    const current = path.resolve(store.filePath);
    if ((process.platform === "win32" ? expected.toLowerCase() : expected) !==
        (process.platform === "win32" ? current.toLowerCase() : current)) {
        fail("INVALID_STATE", "The active project changed; refresh the project context before writing");
    }

    if (store.project._isReadOnly || store.project._isDashboardBuild) {
        fail("INVALID_STATE", "Project is read-only");
    }
    if (store.runtime && tool !== "stop_preview" && tool !== "preview_tap") {
        throw mcpReadError("RUN_MODE", "Stop the running preview before changing the project");
    }

    if (tool === "start_project_check") {
        return startProjectCheck(store);
    }
    if (tool === "start_project_build") {
        return startProjectBuild(store);
    }
    if (tool === "start_preview") {
        if (store.projectTypeTraits.runtimeType !== RuntimeType.WASM) {
            fail("INVALID_STATE", "Only local WASM runtime preview is supported");
        }
        if (store.isModified) {
            fail("INVALID_STATE", "Save the project before starting an MCP preview");
        }
        if (store.runtime) {
            fail("INVALID_STATE", "A runtime is already open; query get_preview_status");
        }
        await store.onSetRuntimeMode();
        // The native mode switch mutates store.runtime asynchronously; use a
        // getter to read the new state after the await rather than a stale
        // TypeScript narrowing from the preflight guard.
        const runtimeAfterStart = readRuntimeAfterModeChange(store);
        if (!runtimeAfterStart) {
            fail("INVALID_STATE", "The editor could not initialize the local preview runtime");
        }
        return { requested: true, mode: "wasm", state: runtimeAfterStart.isRunning ? "running" : "starting" };
    }
    if (tool === "preview_tap") {
        return tapPreview(store, a.pageId as string, a.x as number, a.y as number);
    }
    if (tool === "stop_preview") {
        if (!store.runtime) fail("INVALID_STATE", "No active editor preview to stop");
        await store.setEditorMode(true);
        if (store.runtime) fail("INVALID_STATE", "Editor preview did not stop");
        return { stopped: true, mode: "editor" };
    }
    if (tool === "save_project") {
        if (!store.filePath) fail("UNSAVED_PROJECT", "Save the project in DigiwiseStudio first");
        if (!await store.save()) fail("INVALID_STATE", "Project was not saved");
        return { saved: true, path: store.filePath };
    }
    if (tool === "undo" || tool === "redo") {
        const manager = store.undoManager;
        if (manager.combineCommands) fail("INVALID_STATE", "Editor transaction in progress");
        if (tool === "undo" && !manager.canUndo) fail("INVALID_STATE", "Nothing to undo");
        if (tool === "redo" && !manager.canRedo) fail("INVALID_STATE", "Nothing to redo");
        executeMcpHistory(manager, tool);
        return { operation: tool, modified: store.isModified };
    }

    if (tool === "create_page") {
        const name = a.name as string;
        if (store.project.pages.some(p => p.name.toLowerCase() === name.toLowerCase())) {
            fail("INVALID_ARGUMENT", "Page name already exists");
        }
        const general = store.project.settings.general;
        const page = createObject<Page>(store, {
            name,
            left: 0,
            top: 0,
            width: (a.width ?? general.displayWidth) as number,
            height: (a.height ?? general.displayHeight) as number,
            // Page.beforeLoadHook migrates empty LVGL pages to their
            // required LVGLScreenWidget. Without components it throws.
            components: []
        }, Page);
        transaction(store, () => store.addObject(store.project.userPages, page));
        return { created: true, pageName: page.name, pageId: page.objID || null };
    }

    if (tool === "import_bitmap") {
        const name = a.name as string;
        if (store.project.bitmaps.some(bitmap => bitmap.name.toLowerCase() === name.toLowerCase())) {
            fail("INVALID_ARGUMENT", "Bitmap name already exists");
        }
        // Restrict AI imports to images already inside this saved project's directory.
        let projectDir: string;
        let source: string;
        try {
            projectDir = fs.realpathSync(path.dirname(store.filePath));
            source = fs.realpathSync(a.filePath as string);
        } catch (_error) {
            fail("INVALID_ARGUMENT", "Bitmap file does not exist or cannot be accessed");
        }
        const relative = path.relative(projectDir, source);
        if (!relative || relative === ".." || relative.startsWith(".." + path.sep) ||
            path.isAbsolute(relative)) {
            fail("INVALID_ARGUMENT", "Bitmap must be inside the project directory");
        }
        const info = fs.statSync(source);
        if (!info.isFile() || info.size < 8 || info.size > 10 * 1024 * 1024) {
            fail("INVALID_ARGUMENT", "Bitmap must be a regular image file <= 10 MiB");
        }
        const ext = path.extname(source).toLowerCase();
        if (![".png", ".jpg", ".jpeg"].includes(ext)) fail("INVALID_ARGUMENT", "Invalid image extension");
        const fd = fs.openSync(source, "r");
        let header: Buffer;
        try {
            header = Buffer.alloc(8);
            fs.readSync(fd, header, 0, 8, 0);
        } finally { fs.closeSync(fd); }
        const png = header.equals(Buffer.from("89504e470d0a1a0a", "hex"));
        const jpeg = header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
        if (!(ext === ".png" ? png : jpeg)) {
            fail("INVALID_ARGUMENT", "Image signature does not match PNG/JPEG extension");
        }
        const bitmap = await createBitmap(store, source, undefined, name);
        if (!bitmap) fail("INVALID_STATE", "Editor Bitmap import failed");
        transaction(store, () => store.addObject(store.project.bitmaps, bitmap));
        return { imported: true, name: bitmap.name, bitmapId: bitmap.objID || null,
            source: relative, embedded: !!store.project.settings.general.embedBitmaps };
    }

    if (["add_action_node", "connect_action_nodes", "disconnect_action_line", "delete_action_node"].includes(tool)) {
        const action = resolveFlowAction(store, a.actionName as string, a.actionId as string);
        if (tool === "add_action_node") {
            if (action.components.length >= 250) fail("INVALID_STATE", "Flow graph is at node limit");
            const nodeType = a.nodeType as string;
            if (nodeType === "StartActionComponent" && action.components.some(node =>
                node.type === "StartActionComponent")) {
                fail("INVALID_ARGUMENT", "Flow Action already has a Start node");
            }
            let variableEntry: { variable: string; value: string } | undefined;
            if (nodeType === "SetVariableActionComponent") {
                const variable = store.project.variables?.globalVariables.find(item => item.name === a.variableName);
                const val = a.value;
                const matched = !!variable && (variable.type === "string" ? typeof val === "string" :
                    variable.type === "boolean" ? typeof val === "boolean" :
                    ["integer", "float", "double"].includes(variable.type) &&
                    typeof val === "number" && Number.isFinite(val) &&
                    (variable.type !== "integer" || Number.isSafeInteger(val)));
                if (!matched) fail("INVALID_ARGUMENT", "SetVariable requires an existing global variable and a matching value type");
                variableEntry = { variable: a.variableName as string, value: JSON.stringify(val) };
            }
            const nodeValues: Record<string, unknown> = {};
            if (nodeType === "IsTrueActionComponent") {
                if (a.conditionVariableName !== undefined) {
                    const variable = store.project.variables?.globalVariables.find(item =>
                        item.name === a.conditionVariableName && item.type === "boolean");
                    if (!variable) fail("INVALID_ARGUMENT", "Condition must reference an existing boolean global variable");
                    nodeValues.value = a.conditionVariableName;
                } else {
                    nodeValues.value = String(a.conditionValue);
                }
            }
            if (nodeType === "CallActionActionComponent") {
                const calledName = a.targetActionName as string;
                const called = store.project.actions.find(item => item.name === calledName && item.implementationType === "flow");
                if (!called || called === action || !called.components.some(item => item.type === "StartActionComponent") ||
                    !called.components.some(item => item.type === "EndActionComponent") ||
                    called.components.some(item => item.type === "InputActionComponent" || item.type === "OutputActionComponent")) {
                    fail("INVALID_ARGUMENT", "Called Flow Action must be distinct, exist, contain Start and End, and have no custom ports");
                }
                const visited = new Set<string>();
                const reachesCaller = (name: string): boolean => {
                    if (name === action.name) return true;
                    if (visited.has(name)) return false;
                    visited.add(name);
                    const referenced = store.project.actions.find(item => item.name === name);
                    return !!referenced?.components.some(item => item.type === "CallActionActionComponent" &&
                        typeof (item as any).action === "string" && reachesCaller((item as any).action));
                };
                if (reachesCaller(calledName)) fail("INVALID_ARGUMENT", "CallAction would create a recursive Action call chain");
                nodeValues.action = calledName;
            }
            if (nodeType === "LVGLActionComponent") {
                const screenName = a.screenName as string;
                if (!store.project.userPages.some(page => page.name === screenName)) {
                    fail("INVALID_ARGUMENT", "Screen navigation target must be an existing LVGL user page");
                }
                nodeValues.actions = [{
                    action: "changeScreen", screen: screenName, screenType: "literal",
                    fadeMode: "FADE_IN", fadeModeType: "literal",
                    speed: 200, speedType: "literal", delay: 0, delayType: "literal",
                    useStack: true, useStackType: "literal"
                }];
            }
            const NodeClass = nodeType === "StartActionComponent" ? StartActionComponent :
                nodeType === "NoopActionComponent" ? NoopActionComponent :
                nodeType === "DelayActionComponent" ? DelayActionComponent :
                nodeType === "SetVariableActionComponent" ? SetVariableActionComponent :
                nodeType === "IsTrueActionComponent" ? IsTrueActionComponent :
                nodeType === "CallActionActionComponent" ? CallActionActionComponent :
                nodeType === "LVGLActionComponent" ? LVGLActionComponent : EndActionComponent;
            const node = createObject(store, {
                ...(getDefaultValue(store, NodeClass.classInfo) || {}),
                type: nodeType,
                left: a.left as number, top: a.top as number,
                ...(a.name === undefined ? {} : { name: a.name as string }),
                ...(a.milliseconds === undefined ? {} : { milliseconds: String(a.milliseconds) }),
                ...(variableEntry ? { entries: [variableEntry] } : {}),
                ...nodeValues
            }, NodeClass);
            transaction(store, () => store.addObject(action.components, node));
            return { created: true, actionId: action.objID, actionName: action.name,
                nodeId: node.objID, nodeType, left: a.left, top: a.top };
        }
        if (tool === "disconnect_action_line") {
            const line = action.connectionLines.find(item => item.objID === a.lineId);
            if (!line) fail("INVALID_STATE", "Connection line not found; refresh get_action_graph");
            transaction(store, () => store.deleteObject(line));
            return { deleted: true, actionId: action.objID, lineId: a.lineId };
        }
        if (tool === "delete_action_node") {
            const node = action.components.find(item => item.objID === a.nodeId);
            if (!node) fail("INVALID_STATE", "Flow node not found; refresh get_action_graph");
            const linked = action.connectionLines.filter(line =>
                line.source === node.objID || line.target === node.objID);
            transaction(store, () => {
                for (const line of linked) store.deleteObject(line);
                store.deleteObject(node);
            });
            return { deleted: true, actionId: action.objID, nodeId: node.objID,
                removedConnections: linked.length };
        }
        if (action.connectionLines.length >= 500) fail("INVALID_STATE", "Flow graph is at connection limit");
        const source = action.components.find(node => node.objID === a.sourceId);
        const target = action.components.find(node => node.objID === a.targetId);
        if (!source || !target || source === target) {
            fail("INVALID_ARGUMENT", "Flow connection endpoints must be distinct nodes of this Action");
        }
        const outputName = (a.output as string | undefined) || "@seqout";
        if (outputName !== "@seqout" && source.type !== "IsTrueActionComponent") {
            fail("INVALID_ARGUMENT", "Only IsTrue supports True/False branch outputs");
        }
        if (!source.getOutputs().some(output => output.name === outputName && output.isSequenceOutput) ||
            !target.getInputs().some(input => input.name === "@seqin" && input.isSequenceInput)) {
            fail("INVALID_ARGUMENT", "Flow nodes do not support the requested sequence ports");
        }
        if (action.connectionLines.some(line => line.source === source.objID && line.output === outputName)) {
            fail("INVALID_ARGUMENT", "Sequence output is already connected");
        }
        if (action.connectionLines.some(line => line.target === target.objID && line.input === "@seqin")) {
            fail("INVALID_ARGUMENT", "Sequence input is already connected");
        }
        const adjacency = new Map<string, string[]>();
        for (const line of action.connectionLines) {
            if (line.input !== "@seqin" || !["@seqout", "True", "False"].includes(line.output)) continue;
            adjacency.set(line.source, [...(adjacency.get(line.source) || []), line.target]);
        }
        const visited = new Set<string>();
        const reachesSource = (id: string): boolean => {
            if (id === source.objID) return true;
            if (visited.has(id)) return false;
            visited.add(id);
            return (adjacency.get(id) || []).some(next => reachesSource(next));
        };
        if (reachesSource(target.objID)) fail("INVALID_ARGUMENT", "Flow connection would create a sequence cycle");
        const line = createObject<ConnectionLine>(store, {
            source: source.objID, output: outputName, target: target.objID,
            input: "@seqin", disabled: false
        }, ConnectionLine);
        transaction(store, () => store.addObject(action.connectionLines, line));
        return { created: true, actionId: action.objID, lineId: line.objID,
            sourceId: source.objID, output: outputName, targetId: target.objID, input: "@seqin" };
    }

    if (tool === "move_widget") {
        const sourcePage = resolvePage(store, a.sourcePageName as string);
        const targetPage = resolvePage(store, a.targetPageName as string);
        const sourcePath = a.widgetPath as number[];
        const widget = widgetAt(sourcePage, sourcePath, a.widgetId as string);
        const targetPath = a.targetParentPath as number[] | undefined;
        if (sourcePage === targetPage && targetPath &&
            sourcePath.length <= targetPath.length &&
            sourcePath.every((index, i) => index === targetPath[i])) {
            fail("INVALID_ARGUMENT", "Cannot move a container inside itself or its own descendant");
        }
        const parent = targetPath ? widgetAt(targetPage, targetPath, a.targetParentId as string) : undefined;
        if (parent && !["LVGLPanelWidget", "LVGLButtonWidget"].includes(parent.type)) {
            fail("INVALID_ARGUMENT", "Target container does not accept child widgets");
        }
        const existingParent = sourcePath.slice(0, -1);
        if (sourcePage === targetPage &&
            existingParent.length === (targetPath || []).length &&
            existingParent.every((index, i) => index === (targetPath || [])[i])) {
            fail("INVALID_ARGUMENT", "Widget is already in this container; use reorder_widget instead");
        }
        const targetCollection = parent ? parent.children : targetPage.components;
        const movedPath = transaction(store, () => {
            detachObject(widget);
            store.addObject(targetCollection, widget);
            return findWidgetPath(targetPage, widget);
        });
        return { moved: true, widgetId: widget.objID, sourcePageName: sourcePage.name,
            targetPageName: targetPage.name, widgetPath: movedPath };
    }
    if (tool === "create_action") {
        if (!store.projectTypeTraits.hasFlowSupport) {
            fail("INVALID_STATE", "Flow support is required to create a Flow Action");
        }
        const name = a.name as string;
        if (store.project.actions.some(action => action.name.toLowerCase() === name.toLowerCase())) {
            fail("INVALID_ARGUMENT", "Action name already exists");
        }
        const action = createObject<Action>(store, {
            name, implementationType: "flow", components: [], connectionLines: []
        }, Action);
        transaction(store, () => store.addObject(store.project.actions, action));
        return { created: true, actionId: action.objID || null,
            name: action.name, implementationType: "flow", empty: true };
    }

    if (tool === "create_variable") {
        if (!store.projectTypeTraits.hasFlowSupport) {
            fail("INVALID_STATE", "Flow support must be enabled to create global variables");
        }
        const globals = store.project.variables?.globalVariables;
        if (!globals) fail("INVALID_STATE", "Project has no global variable collection");
        const name = a.name as string;
        if (globals.some(variable => variable.name.toLowerCase() === name.toLowerCase())) {
            fail("INVALID_ARGUMENT", "Variable name already exists");
        }
        const variableType = a.type as "integer" | "float" | "double" | "boolean" | "string";
        const initial = a.initialValue === undefined ?
            (variableType === "string" ? "" : variableType === "boolean" ? false : 0) : a.initialValue;
        const variable = createObject<Variable>(store, {
            name, type: variableType, defaultValue: JSON.stringify(initial),
            persistent: false, native: false
        }, Variable);
        transaction(store, () => store.addObject(globals, variable));
        return { created: true, name: variable.name, type: variable.type, variableId: variable.objID || null };
    }

    if (tool === "rename_page" || tool === "delete_page") {
        const page = resolvePage(store, a.pageName as string);
        if (page.objID !== a.pageId || !store.project.userPages.includes(page)) {
            fail("INVALID_STATE", "Page identity is stale or is not a normal user page");
        }
        const initial = store.project.settings.general.initialPage;
        const references = pageReferences(store, page);
        if (tool === "delete_page") {
            if (store.project.userPages.length <= 1) {
                fail("INVALID_STATE", "Cannot delete the last user page");
            }
            if (references.length || initial === page.name) {
                fail("INVALID_STATE", "Page is used by a navigation reference or initialPage; change those references before deleting");
            }
            transaction(store, () => store.deleteObject(page));
            return { deleted: true, pageName: page.name, pageId: a.pageId };
        }
        const name = a.name as string;
        if (name === page.name) return { changed: false, pageName: name, pageId: page.objID };
        if (store.project.pages.some(candidate => candidate !== page &&
            candidate.name.toLowerCase() === name.toLowerCase())) {
            fail("INVALID_ARGUMENT", "Page or user widget name already exists");
        }
        const oldName = page.name;
        transaction(store, () => {
            store.updateObject(page, { name });
            for (const ref of references) {
                store.updateObject(ref.object, { [ref.field]: name });
            }
            if (initial === oldName) {
                store.updateObject(store.project.settings.general, { initialPage: name });
            }
        });
        return { changed: true, pageId: page.objID, previousName: oldName, pageName: name,
            updatedReferences: references.length, updatedInitialPage: initial === oldName };
    }

    if (tool === "create_style") {
        const name = a.name as string;
        const widgetType = a.widgetType as string;
        const registered = findClass(widgetType);
        if (!registered || !isProperSubclassOf(registered.classInfo, LVGLWidget.classInfo)) {
            fail("INVALID_ARGUMENT", "Style widget type is not registered in this editor");
        }
        styleNameAvailable(store, name);
        const style = createObject<LVGLStyle>(store, {
            name,
            forWidgetType: widgetType,
            childStyles: [],
            definition: {} as any
        }, LVGLStyle);
        const stylePath = transaction(store, () => {
            store.addObject(store.project.lvglStyles.styles, style);
            return [store.project.lvglStyles.styles.indexOf(style)];
        });
        return { created: true, name: style.name, widgetType, stylePath, styleId: style.objID || null };
    }
    if (["rename_style", "delete_style", "set_default_style"].includes(tool)) {
        const style = styleAt(store, a.stylePath as number[]);
        if (style.objID !== a.styleId) {
            fail("INVALID_STATE", "Style path is stale; call list_styles again");
        }
        const defaults = store.project.lvglStyles.defaultStyles || {};
        const originalName = style.name;
        const originalType = style.forWidgetType;
        if (tool === "set_default_style") {
            const enabled = a.enabled as boolean;
            const current = defaults[originalType];
            if (!enabled && current !== originalName) {
                fail("INVALID_STATE", "This Style is not the current default");
            }
            if (enabled && current === originalName) {
                return { changed: false, styleId: style.objID, enabled };
            }
            const next = { ...toJS(defaults) };
            if (enabled) next[originalType] = originalName;
            else delete next[originalType];
            transaction(store, () => store.updateObject(store.project.lvglStyles, { defaultStyles: next }));
            return { changed: true, styleId: style.objID, widgetType: originalType, enabled };
        }
        const usedBy = widgetsUsingStyle(store, originalName);
        if (tool === "delete_style") {
            if (style.childStyles?.length || usedBy.length ||
                Object.values(defaults).includes(originalName)) {
                fail("INVALID_STATE", "Style is referenced, default, or has children; detach references before deleting");
            }
            transaction(store, () => store.deleteObject(style));
            return { deleted: true, stylePath: a.stylePath, styleId: a.styleId };
        }
        const name = a.name as string;
        if (name === originalName) return { changed: false, styleId: style.objID, name };
        styleNameAvailable(store, name, style);
        const next = { ...toJS(defaults) };
        for (const key of Object.keys(next)) {
            if (next[key] === originalName) next[key] = name;
        }
        transaction(store, () => {
            store.updateObject(style, { name });
            for (const widget of usedBy) store.updateObject(widget, { useStyle: name });
            if (Object.values(defaults).includes(originalName)) {
                store.updateObject(store.project.lvglStyles, { defaultStyles: next });
            }
        });
        return { changed: true, stylePath: a.stylePath, styleId: style.objID,
            previousName: originalName, name, updatedWidgetReferences: usedBy.length };
    }

    if (tool === "set_style_property") {
        const style = styleAt(store, a.stylePath as number[]);
        if (style.objID !== a.styleId) {
            fail("INVALID_STATE", "Style path is stale; call list_styles again");
        }
        const part = a.part as string;
        const state = a.state as string;
        const prop = a.property as string;
        const value = validateGlobalStyleProperty(
            store, style.forWidgetType, part, state, prop, a.value
        );
        const full = toJS(style.definition?.definition || {}) as Record<string, any>;
        const next: Record<string, any> = {
            ...full,
            [part]: {
                ...(full[part] || {}),
                [state]: {
                    ...(full[part]?.[state] || {}),
                    [prop]: value
                }
            }
        };
        transaction(store, () => store.updateObject(style.definition, { definition: next }));
        return { changed: true, stylePath: a.stylePath, styleId: style.objID, part, state, property: prop, value };
    }

    const page = resolvePage(store, a.pageName as string);
    if (tool === "add_widget") {
        const type = a.widgetType as string;
        const widgetClass = findClass(type);
        if (!widgetClass || !isProperSubclassOf(widgetClass.classInfo, LVGLWidget.classInfo) ||
            ["LVGLScreenWidget", "LVGLUserWidgetWidget"].includes(type)) {
            fail("INVALID_ARGUMENT", "Widget class is not a supported LVGL palette component");
        }
        let enabled = false;
        try {
            enabled = !!widgetClass.classInfo.enabledInComponentPalette?.(
                store.project.settings.general.projectType, store);
        } catch (_error) { /* fail closed on invalid version or class metadata */ }
        if (!enabled) {
            fail("INVALID_ARGUMENT", "Widget type is not available in the editor palette for this project");
        }
        const props = a.properties as Record<string, unknown>;
        validateProperties(store, type, props);
        const parent = a.parentPath
            ? widgetAt(page, a.parentPath as number[], a.parentId as string)
            : undefined;
        if (parent && !["LVGLPanelWidget", "LVGLButtonWidget"].includes(parent.type)) {
            fail("INVALID_ARGUMENT", "Parent widget does not accept children");
        }
        const defaults = getDefaultValue(store, widgetClass.classInfo) || {};
        const object = createObject<LVGLWidget>(store, {
            ...defaults,
            ...props,
            type
        }, widgetClass);
        const container = parent ? parent.children : page.components;
        const widgetPath = transaction(store, () => {
            store.addObject(container, object);
            // Resolve while inside the transaction: failure rolls back.
            return findWidgetPath(page, object);
        });
        return {
            created: true, pageName: page.name, type, identifier: object.identifier || null,
            widgetId: object.objID || null,
            widgetPath
        };
    }

    const widget = widgetAt(page, a.widgetPath as number[], a.widgetId as string);
    if (tool === "duplicate_widget") {
        if (widget.children?.length) {
            fail("INVALID_ARGUMENT", "Duplicate currently supports leaf widgets only; child hierarchy references need a separate clone operation");
        }
        const newIdentifier = a.newIdentifier as string;
        validIdentifier(store, newIdentifier);
        const data = { ...(toJS(widget) as unknown as Record<string, any>) };
        data.identifier = newIdentifier;
        if (a.left !== undefined) data.left = a.left;
        if (a.top !== undefined) data.top = a.top;
        const cloned = createObject<LVGLWidget>(store, data, getClass(widget), undefined, true);
        if (cloned.objID === widget.objID) {
            fail("INVALID_STATE", "Cloned widget did not receive a new object ID");
        }
        const widgetPath = transaction(store, () => {
            insertObjectAfter(widget, cloned);
            return findWidgetPath(page, cloned);
        });
        return { duplicated: true, pageName: page.name, sourceWidgetId: widget.objID,
            widgetPath, widgetId: cloned.objID || null, identifier: cloned.identifier };
    }
    if (tool === "reorder_widget") {
        const sourcePath = a.widgetPath as number[];
        const anchorPath = a.anchorPath as number[];
        const anchor = widgetAt(page, anchorPath, a.anchorId as string);
        if (widget === anchor) fail("INVALID_ARGUMENT", "Cannot reorder a widget relative to itself");
        if (sourcePath.length !== anchorPath.length ||
            sourcePath.slice(0, -1).some((index, i) => index !== anchorPath[i])) {
            fail("INVALID_ARGUMENT", "Only widgets in the same parent container can be reordered");
        }
        const position = a.position as "before" | "after";
        const widgetPath = transaction(store, () => {
            // Use exactly the same editor collection commands as the Tree DnD path.
            detachObject(widget);
            if (position === "before") insertObjectBefore(anchor, widget);
            else insertObjectAfter(anchor, widget);
            return findWidgetPath(page, widget);
        });
        return { reordered: true, pageName: page.name, widgetId: widget.objID,
            widgetPath, anchorId: anchor.objID, position };
    }
    if (tool === "update_widget") {
        const props = a.properties as Record<string, unknown>;
        validateProperties(store, widget.type, props, widget);
        transaction(store, () => store.updateObject(widget, props));
        return { changed: true, pageName: page.name, widgetPath: a.widgetPath, widgetId: widget.objID, properties: props };
    }
    if (tool === "bind_widget_variable" || tool === "unbind_widget_variable") {
        const property = a.property as string;
        const values = validateWidgetVariableBinding(store, widget, property,
            tool === "bind_widget_variable" ? a.variableName as string : null,
            tool === "unbind_widget_variable" ? a.value : undefined);
        const current = widget as unknown as Record<string, unknown>;
        if (Object.entries(values).every(([key, value]) => current[key] === value)) {
            return { changed: false, pageName: page.name, widgetId: widget.objID, property };
        }
        transaction(store, () => store.updateObject(widget, values));
        return { changed: true, pageName: page.name, widgetId: widget.objID,
            widgetPath: a.widgetPath, property, mode: values[property + "Type"] };
    }
    if (tool === "set_widget_properties") {
        const properties = a.properties as Record<string, unknown>;
        const values: Record<string, string | number | boolean> = {};
        // Validate every field against the live ClassInfo before creating any undo entry.
        for (const [property, value] of Object.entries(properties)) {
            Object.assign(values, validateRuntimeWidgetProperty(store, widget, property, value));
        }
        transaction(store, () => store.updateObject(widget, values));
        return { changed: true, pageName: page.name, widgetPath: a.widgetPath,
            widgetId: widget.objID, properties: values };
    }
    if (tool === "set_widget_property") {
        const property = a.property as string;
        const values = validateRuntimeWidgetProperty(store, widget, property, a.value);
        transaction(store, () => store.updateObject(widget, values));
        return { changed: true, pageName: page.name, widgetPath: a.widgetPath, widgetId: widget.objID,
            property, value: a.value };
    }
    if (tool === "set_widget_local_style") {
        const part = a.part as string;
        const state = a.state as string;
        const property = a.property as string;
        const value = validateLocalStyleProperty(
            store, widget, part, state, property, a.value
        );
        if (!widget.localStyles) fail("INVALID_STATE", "Widget has no editable local Style");
        const propertyInfo = lvglPropertiesMap.get(property)!;
        const next = widget.localStyles.addPropertyToDefinition(
            propertyInfo, part, state, value
        );
        transaction(store, () => store.updateObject(widget.localStyles, { definition: next }));
        return { changed: true, pageName: page.name, widgetPath: a.widgetPath, widgetId: widget.objID,
            part, state, property, value };
    }
    if (tool === "add_widget_event") {
        const eventName = a.eventName as string;
        const actionName = a.actionName as string;
        if (!allowedWidgetEvents(widget).includes(eventName)) {
            fail("INVALID_ARGUMENT", "Event is not supported by this LVGL widget");
        }
        if (!store.project.actions?.some(action => action.name === actionName)) {
            fail("INVALID_ARGUMENT", "Action does not exist in the active project");
        }
        if (widget.eventHandlers?.some(handler =>
            handler.eventName === eventName && handler.handlerType === "action")) {
            fail("INVALID_STATE", "Action handler for this event already exists");
        }
        const event = createObject<EventHandler>(store, {
            eventName,
            handlerType: "action",
            action: actionName,
            userData: (a.userData ?? 0) as number
        }, EventHandler);
        transaction(store, () => store.addObject(widget.eventHandlers, event));
        return {
            created: true, pageName: page.name,
            widgetId: widget.objID, widgetPath: a.widgetPath,
            eventId: event.objID || null, eventName, actionName
        };
    }
    if (tool === "remove_widget_event") {
        const event = widget.eventHandlers?.find(item => item.objID === a.eventId);
        if (!event) fail("INVALID_STATE", "Event binding changed; refresh list_widget_events");
        if (event.handlerType !== "action") {
            fail("INVALID_STATE", "MCP cannot remove Flow event connections");
        }
        transaction(store, () => store.deleteObject(event));
        return { removed: true, pageName: page.name, widgetId: widget.objID,
            eventId: a.eventId };
    }
    if (tool === "delete_widget") {
        transaction(store, () => store.deleteObject(widget));
        return { deleted: true, pageName: page.name, widgetPath: a.widgetPath, widgetId: widget.objID };
    }
    fail("INVALID_ARGUMENT", "Unknown write operation");
}
