
const assert = require("node:assert/strict");
const { join } = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const fixtureDir = fs.mkdtempSync(join(os.tmpdir(), "digistudio-mcp-test-"));
const fixturePng = join(fixtureDir, "asset.png");
fs.writeFileSync(fixturePng, Buffer.from("89504e470d0a1a0a00000000", "hex"));
const Module = require("node:module");

let nextObjId = 1;
class LVGLWidget {
    constructor() {
        this.children = [];
        this.objID = "mcp-widget-" + nextObjId++;
        this.eventHandlers = [];
        this.localStyles = { definition: {} };
        this.type = "LVGLLabelWidget";
        this.textType = "literal";
    }
}
LVGLWidget.classInfo = { name: "LVGLWidget" };
class Page {
    constructor() {
        this.objID = "mcp-page-" + nextObjId++;
        this.components = [];
        this.name = "";
    }
}
const classInfo = { name: "LVGLLabelWidget", enabledInComponentPalette: () => true, defaultValue: {
    left: 0, top: 0, width: 110, height: 25
} };
class Label extends LVGLWidget {}
Label.classInfo = classInfo;
class Tab extends LVGLWidget {}
Tab.classInfo = { name: "LVGLTabWidget", enabledInComponentPalette: () => true,
    defaultValue: { left: 0, top: 0, width: 120, height: 60 } };

const PT = { Boolean: 2, Number: 3, Enum: 4, String: 5, MultilineText: 6,
    Color: 8, ThemedColor: 9, ObjectReference: 12 };
const labelInfo = {
    name: "LVGLLabelWidget",
    properties: [
        { name: "text", type: PT.ObjectReference, expressionType: "string",
            referencedObjectCollectionPath: "variables/globalVariables" },
        { name: "left", type: PT.Number },
        { name: "width", type: PT.Number }
    ],
    lvgl: { parts: ["MAIN"] },
    widgetEvents: { CLICKED: {}, VALUE_CHANGED: {} }
};
const switchInfo = {
    name: "LVGLSwitchWidget",
    properties: [
        { name: "clickableFlag", type: PT.Boolean },
        { name: "scrollbarMode", type: PT.Enum,
            enumItems: [{ id: "off" }, { id: "on" }] }
    ],
    lvgl: { parts: ["MAIN", "INDICATOR", "KNOB"] },
    widgetEvents: { CLICKED: {}, VALUE_CHANGED: {} }
};
const imageInfo = {
    name: "LVGLImageWidget",
    properties: [{ name: "image", type: PT.ObjectReference,
        referencedObjectCollectionPath: "bitmaps" }],
    lvgl: { parts: ["MAIN"] }
};
const classForType = type => type === "LVGLSwitchWidget" ? switchInfo :
    type === "LVGLImageWidget" ? imageInfo : labelInfo;
const styleMap = new Map([
    ["bg_color", { name: "bg_color", type: PT.ThemedColor }],
    ["text_color", { name: "text_color", type: PT.ThemedColor }],
    ["radius", { name: "radius", type: PT.Number }],
    ["bg_opa", { name: "bg_opa", type: PT.Number }]
]);
class FlowNode {
    constructor() { this.objID = "mcp-node-" + nextObjId++; }
    getInputs() { return this.type === "StartActionComponent" ? [] : [{ name: "@seqin", isSequenceInput: true }]; }
    getOutputs() { return this.type === "EndActionComponent" ? [] : [
        { name: "@seqout", isSequenceOutput: true },
        ...(this.type === "IsTrueActionComponent" ?
            [{ name: "True", isSequenceOutput: true }, { name: "False", isSequenceOutput: true }] : [])
    ]; }
}
class StartActionComponent extends FlowNode {}
class NoopActionComponent extends FlowNode {}
class EndActionComponent extends FlowNode {}
class DelayActionComponent extends FlowNode {}
class SetVariableActionComponent extends FlowNode {}
class IsTrueActionComponent extends FlowNode {}
class CallActionActionComponent extends FlowNode {}
class LVGLActionComponent extends FlowNode {}
for (const klass of [StartActionComponent, NoopActionComponent, EndActionComponent, DelayActionComponent, SetVariableActionComponent, IsTrueActionComponent, CallActionActionComponent, LVGLActionComponent]) {
    klass.classInfo = { defaultValue: {} };
}
class ConnectionLine { constructor() { this.objID = "mcp-line-" + nextObjId++; } }
class Action {
    constructor() { this.objID = "mcp-action-" + nextObjId++; this.components = []; this.connectionLines = []; }
}
class Variable {
    constructor() { this.objID = "mcp-variable-" + nextObjId++; }
}
class LVGLStyle {
    constructor() {
        this.objID = "mcp-style-" + nextObjId++;
        this.name = "";
        this.forWidgetType = "LVGLLabelWidget";
        this.childStyles = [];
        this.definition = { definition: {} };
    }
}
class EventHandler {
    constructor() {
        this.objID = "mcp-event-" + nextObjId++;
        this.handlerType = "action";
        this.userData = 0;
    }
}
const checkOutput = { numErrors: 0, numWarnings: 0, messages: { messages: [] } };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "project-editor/project-editor-interface") return {
        ProjectEditor: { build: { buildProject: async (_store, mode) => {
            assert.equal(mode, "check");
            checkOutput.messages.messages = [{ type: 1, text: "Project check complete" }];
        } } }
    };
    if (request === "project-editor/store/output-sections") return { Section: { OUTPUT: 1 } };
    if (request === "project-editor/lvgl/widgets/Base") return { LVGLWidget };
    if (request === "project-editor/lvgl/style") return { LVGLStyle };
    if (request === "project-editor/features/variable/variable") return { Variable };
    if (request === "project-editor/features/action/action") return { Action };
    if (request === "project-editor/flow/components/actions") return {
        StartActionComponent, NoopActionComponent, EndActionComponent, DelayActionComponent, SetVariableActionComponent, IsTrueActionComponent, CallActionActionComponent
    };
    if (request === "project-editor/flow/connection-line") return { ConnectionLine };
    if (request === "project-editor/lvgl/actions") return { LVGLActionComponent };
    if (request === "project-editor/project/project-type-traits") return {
        RuntimeType: { NONE: 0, WASM: 1, REMOTE: 2 }
    };
    if (request === "project-editor/features/bitmap/bitmap") return {
        createBitmap: async (_store, filepath, _type, name) => ({
            objID: "bitmap-" + nextObjId++, name, image: filepath, bpp: 32
        })
    };
    if (request === "project-editor/store/commands") {
        const findContainer = (object) => {
            const candidates = [];
            for (const page of project.pages) {
                const append = (children) => {
                    candidates.push(children);
                    for (const child of children || []) if (child.children) append(child.children);
                };
                append(page.components);
            }
            const array = candidates.find(items => items?.includes(object));
            if (!array) throw new Error("Widget not present in any test collection");
            return array;
        };
        const insert = (anchor, widget, offset) => {
            const collection = findContainer(anchor);
            const index = collection.indexOf(anchor) + offset;
            undoManager.record(() => collection.splice(collection.indexOf(widget), 1),
                () => collection.splice(index, 0, widget));
            return widget;
        };
        return {
            deleteObject: (widget) => {
                const collection = findContainer(widget);
                const index = collection.indexOf(widget);
                undoManager.record(() => collection.splice(index, 0, widget),
                    () => collection.splice(collection.indexOf(widget), 1));
            },
            insertObjectBefore: (anchor, widget) => insert(anchor, widget, 0),
            insertObjectAfter: (anchor, widget) => insert(anchor, widget, 1)
        };
    }
    if (request === "project-editor/core/search") return {
        visitObjects: function* (project) {
            yield project;
            for (const action of project.actions || []) yield action;
            for (const page of project.pages || []) {
                yield page;
                const visitWidget = function* (widget) {
                    yield widget;
                    for (const child of widget.children || []) yield* visitWidget(child);
                };
                for (const widget of page.components || []) yield* visitWidget(widget);
            }
        }
    };
    if (request === "project-editor/flow/component") return { EventHandler };
    if (request === "project-editor/features/page/page") return { Page };
    if (request === "project-editor/core/object") {
        return {
            findClass: type => type === "LVGLLabelWidget" ? Label :
                type === "LVGLTabWidget" ? Tab : undefined,
            getClassesDerivedFrom: () => [
                { name: "LVGLLabelWidget", objectClass: Label },
                { name: "LVGLTabWidget", objectClass: Tab }
            ],
            isProperSubclassOf: () => true,
            getDefaultValue: (_store, info) => info.defaultValue,
            getClass: widget => widget.type === "LVGLTabWidget" ? Tab : Label,
            getClassInfo: widget => widget.classInfo ||
                (widget.type ? classForType(widget.type) : { properties: [] }),
            PropertyType: PT,
            TYPE_NAMES: Object.fromEntries(Object.entries(PT).map(([name, id]) => [id, name]))
        };
    }
    if (request === "project-editor/store/serialization") {
        return {
            createObject: (_store, props, Type, _key, newIds) => {
                if (Type === Page) {
                    assert.ok(Array.isArray(props.components), "Page must initialize components");
                }
                const obj = new Type();
                const values = { ...props };
                if (newIds) delete values.objID;
                return Object.assign(obj, values);
            }
        };
    }
    if (request === "project-editor/lvgl/style-catalog") return { lvglPropertiesMap: styleMap };
    if (request === "mobx") return { toJS: value => structuredClone(value) };
    return originalLoad.apply(this, arguments);
};
let executeWriteTool, validateWriteArguments, runReadTool;
try {
    ({ executeWriteTool } = require(join(__dirname, "../../build/mcp/adapter/write-tools.js")));
    ({ validateWriteArguments } = require(join(__dirname, "../../build/mcp/validator.js")));
    ({ runReadTool } = require(join(__dirname, "../../build/mcp/adapter/read-tools.js")));
} finally {
    Module._load = originalLoad;
}

const firstWidget = Object.assign(new LVGLWidget(), {
    type: "LVGLLabelWidget",
    identifier: "previous",
    text: "Original"
});
const homePage = Object.assign(new Page(), {
    name: "Home", width: 800, height: 480, components: [firstWidget]
});
const style = { objID: "mcp-style-title", name: "Title", forWidgetType: "LVGLLabelWidget",
    childStyles: [], definition: { definition: {
        MAIN: { DEFAULT: { bg_color: "#112233", radius: 4 } }
    } }
};
const project = {
    userPages: [homePage],
    userWidgets: [],
    get pages() { return [...this.userPages, ...this.userWidgets]; },
    lvglStyles: { styles: [style], defaultStyles: {} },
    get allLvglStyles() { return this.lvglStyles.styles; },
    bitmaps: [{ name: "IconArrow" }],
    actions: [{ name: "GoHome", implementationType: "native" }],
    variables: { globalVariables: [] },
    settings: { general: { displayWidth: 800, displayHeight: 480 },
        build: { destinationFolder: "generated", files: [{ fileName: "ui.c" }] } },
    _isReadOnly: false,
    _isDashboardBuild: false
};
const undoManager = {
    combineCommands: false, postponeSetCombineCommandsFalse: false,
    undoStack: [], redoStack: [], commands: [],
    setCombineCommands(value) {
        if (!value && this.commands.length) {
            const commands = this.commands;
            this.undoStack.push({
                undo: () => commands.slice().reverse().forEach(c => c.undo()),
                redo: () => commands.forEach(c => c.redo())
            });
            this.commands = [];
        }
        this.combineCommands = value;
    },
    record(undo, redo) {
        redo();
        this.commands.push({ undo, redo });
    },
    get canUndo() { return !!(this.commands.length || this.undoStack.length); },
    get canRedo() { return this.redoStack.length > 0; },
    undo() {
        this.setCombineCommands(false);
        const entry = this.undoStack.pop();
        if (entry) { entry.undo(); this.redoStack.push(entry); }
    },
    redo() {
        const entry = this.redoStack.pop();
        if (entry) { entry.redo(); this.undoStack.push(entry); }
    }
};
const store = {
    project, undoManager, filePath: join(fixtureDir, "safe.eez-project"),
    projectTypeTraits: { hasFlowSupport: true, runtimeType: 1 },
    isModified: false,
    runtime: undefined,
    onSetRuntimeMode: async function() {
        this.runtime = {
            isRunning: true, isStopped: false, isPaused: false,
            isDebuggerActive: false, selectedPage: homePage
        };
    },
    setEditorMode: async function(force) {
        assert.equal(force, true);
        this.runtime = undefined;
    },
    outputSectionsStore: { getSection: () => checkOutput },
    getAbsoluteFilePath: relative => join(fixtureDir, relative),
    build: async () => { checkOutput.messages.messages = [{ type: 1, text: "Build complete" }]; },
    save: async () => true,
    addObject(container, item) {
        // Mirrors ProjectStore.addObject() automatically reparenting new
        // root widgets into the single LVGLScreenWidget on a screen page.
        const screenPage = project.pages.find(p => p.components === container);
        if (screenPage && item instanceof LVGLWidget &&
            screenPage.components[0]?.type === "LVGLScreenWidget") {
            container = screenPage.components[0].children;
        }
        undoManager.record(() => container.splice(container.indexOf(item), 1),
            () => container.push(item));
        return item;
    },
    updateObject(obj, props) {
        const old = {};
        for (const key of Object.keys(props)) old[key] = structuredClone(obj[key]);
        undoManager.record(() => Object.assign(obj, old), () => Object.assign(obj, props));
    },
    deleteObject(item) {
        const containers = [
            ...project.pages.map(p => p.components), ...project.pages.flatMap(p => p.components.map(w => w.children)),
            ...project.pages.flatMap(p => p.components.flatMap(w =>
                [w.eventHandlers, ...(w.children || []).map(c => c.eventHandlers)])),
            project.userPages, project.lvglStyles.styles,
            ...project.actions.map(a => a.components || []),
            ...project.actions.map(a => a.connectionLines || [])
        ];
        const container = containers.find(c => c.includes(item));
        if (!container) throw new Error("Missing container");
        const index = container.indexOf(item);
        undoManager.record(() => container.splice(index, 0, item),
            () => container.splice(container.indexOf(item), 1));
    }
};

function widgetOnPage(pageName, indices) {
    const page = project.pages.find(p => p.name === pageName);
    if (!page || !indices) return undefined;
    let children = page.components;
    let widget;
    for (const index of indices) {
        widget = children[index];
        if (!widget) return undefined;
        children = widget.children || [];
    }
    return widget;
}
async function readWriteTool(name, args) {
    const normalized = { ...args };
    if (normalized.widgetPath && normalized.widgetId === undefined) {
        normalized.widgetId = widgetOnPage(normalized.pageName, normalized.widgetPath)?.objID;
    }
    if (normalized.parentPath && normalized.parentId === undefined) {
        normalized.parentId = widgetOnPage(normalized.pageName, normalized.parentPath)?.objID;
    }
    if (name === "set_style_property" && !normalized.styleId) {
        normalized.styleId = style.objID;
    }
    return await executeWriteTool(store, name, {
        expectedProjectPath: store.filePath, ...normalized
    });
}

(async () => {
    try {
        assert.equal(runReadTool(store, "get_preview_status", {}, false).state, "idle");
        const startedPreview = await readWriteTool("start_preview", {});
        assert.equal(startedPreview.requested, true);
        const runningPreview = runReadTool(store, "get_preview_status", {}, false);
        assert.equal(runningPreview.state, "running");
        assert.equal(runningPreview.selectedPage, "Home");
        assert.equal(runningPreview.imageCaptureAvailable, false);
        await assert.rejects(readWriteTool("start_preview", {}), error => error.code === "RUN_MODE");
        await assert.rejects(readWriteTool("create_page", { name: "NoEditsDuringPreview" }),
            error => error.code === "RUN_MODE");
        const stoppedPreview = await readWriteTool("stop_preview", {});
        assert.equal(stoppedPreview.stopped, true);
        assert.equal(runReadTool(store, "get_preview_status", {}, false).state, "idle");
        await assert.rejects(readWriteTool("stop_preview", {}), error => error.code === "INVALID_STATE");
        store.isModified = true;
        await assert.rejects(readWriteTool("start_preview", {}), error => error.code === "INVALID_STATE");
        store.isModified = false;
        store.projectTypeTraits.runtimeType = 0;
        await assert.rejects(readWriteTool("start_preview", {}), error => error.code === "INVALID_STATE");
        store.projectTypeTraits.runtimeType = 1;
        const page = await readWriteTool("create_page", { name: "Second", width: 640, height: 480 });
        assert.equal(page.created, true);
        assert.equal(project.userPages[1].name, "Second");
        const initiallyIdle = runReadTool(store, "get_project_check_status", {}, false);
        assert.equal(initiallyIdle.status, "idle");
        const startedCheck = await readWriteTool("start_project_check", {});
        assert.equal(startedCheck.started, true);
        await new Promise(resolve => setImmediate(resolve));
        const completedCheck = runReadTool(store, "get_project_check_status", {}, false);
        assert.equal(completedCheck.status, "succeeded");
        assert.equal(completedCheck.taskId, startedCheck.taskId);
        assert.equal(completedCheck.messages[0].text, "Project check complete");
        assert.equal(runReadTool(store, "get_project_build_status", {}, false).status, "idle");
        const startedBuild = await readWriteTool("start_project_build", {});
        assert.equal(startedBuild.started, true);
        await new Promise(resolve => setImmediate(resolve));
        const built = runReadTool(store, "get_project_build_status", {}, false);
        assert.equal(built.status, "succeeded");
        assert.equal(built.taskId, startedBuild.taskId);
        assert.equal(built.messages[0].text, "Build complete");
        // A completed check retains its own output after a later build overwrites the IDE panel.
        assert.equal(runReadTool(store, "get_project_check_status", {}, false).messages[0].text,
            "Project check complete");
        project.settings.build.destinationFolder = "../../outside-project";
        await assert.rejects(readWriteTool("start_project_build", {}),
            error => error.code === "INVALID_ARGUMENT");
        project.settings.build.destinationFolder = "generated";
        project.settings.build.files[0].fileName = "../escape.c";
        await assert.rejects(readWriteTool("start_project_build", {}),
            error => error.code === "INVALID_ARGUMENT");
        project.settings.build.files[0].fileName = "ui.c";
        const buildDir = join(fixtureDir, "generated");
        fs.mkdirSync(buildDir, { recursive: true });
        const previousManifest = join(buildDir, ".eez-project-build");
        fs.writeFileSync(previousManifest, JSON.stringify({ files: ["../../escape.c"] }));
        await assert.rejects(readWriteTool("start_project_build", {}),
            error => error.code === "INVALID_ARGUMENT");
        fs.unlinkSync(previousManifest);
        const temporary = await readWriteTool("create_page", { name: "Temporary" });
        const nav = { name: "OpenTemporary", implementationType: "native", screen: "Temporary",
            classInfo: { properties: [{ name: "screen", type: PT.ObjectReference,
                referencedObjectCollectionPath: "userPages" }] } };
        project.actions.push(nav);
        project.settings.general.initialPage = "Temporary";
        const renamedPage = await readWriteTool("rename_page", {
            pageName: "Temporary", pageId: temporary.pageId, name: "TemporaryRenamed"
        });
        assert.equal(renamedPage.updatedReferences, 1);
        assert.equal(nav.screen, "TemporaryRenamed");
        assert.equal(project.settings.general.initialPage, "TemporaryRenamed");
        await readWriteTool("undo", {});
        assert.equal(project.userPages.find(p => p.objID === temporary.pageId).name, "Temporary");
        assert.equal(nav.screen, "Temporary");
        await readWriteTool("redo", {});
        assert.equal(nav.screen, "TemporaryRenamed");
        await assert.rejects(readWriteTool("delete_page", {
            pageName: "TemporaryRenamed", pageId: temporary.pageId
        }), error => error.code === "INVALID_STATE");
        await assert.rejects(readWriteTool("rename_page", {
            pageName: "TemporaryRenamed", pageId: "invalid-id", name: "Wrong"
        }), error => error.code === "INVALID_STATE");
        nav.screen = "";
        project.settings.general.initialPage = "Home";
        const deletedPage = await readWriteTool("delete_page", {
            pageName: "TemporaryRenamed", pageId: temporary.pageId
        });
        assert.equal(deletedPage.deleted, true);
        assert.equal(project.userPages.some(p => p.objID === temporary.pageId), false);
        await readWriteTool("undo", {});
        assert.equal(project.userPages.some(p => p.objID === temporary.pageId), true);
        const createdStyle = await readWriteTool("create_style", {
            name: "CardSurface", widgetType: "LVGLLabelWidget"
        });
        assert.equal(createdStyle.created, true);
        assert.equal(createdStyle.stylePath.length, 1);
        const actualStyle = project.lvglStyles.styles.find(s => s.objID === createdStyle.styleId);
        assert.equal(actualStyle.name, "CardSurface");
        const defaultSet = await readWriteTool("set_default_style", {
            stylePath: createdStyle.stylePath, styleId: createdStyle.styleId, enabled: true
        });
        assert.equal(defaultSet.changed, true);
        assert.equal(project.lvglStyles.defaultStyles.LVGLLabelWidget, "CardSurface");
        await assert.rejects(readWriteTool("delete_style", {
            stylePath: createdStyle.stylePath, styleId: createdStyle.styleId
        }), error => error.code === "INVALID_STATE");
        const renamed = await readWriteTool("rename_style", {
            stylePath: createdStyle.stylePath, styleId: createdStyle.styleId, name: "CardSurfaceNew"
        });
        assert.equal(renamed.changed, true);
        assert.equal(project.lvglStyles.defaultStyles.LVGLLabelWidget, "CardSurfaceNew");
        await readWriteTool("undo", {});
        assert.equal(actualStyle.name, "CardSurface");
        assert.equal(project.lvglStyles.defaultStyles.LVGLLabelWidget, "CardSurface");
        await readWriteTool("redo", {});
        assert.equal(actualStyle.name, "CardSurfaceNew");
        await readWriteTool("set_default_style", {
            stylePath: createdStyle.stylePath, styleId: createdStyle.styleId, enabled: false
        });
        assert.equal(project.lvglStyles.defaultStyles.LVGLLabelWidget, undefined);
        const removedStyle = await readWriteTool("delete_style", {
            stylePath: createdStyle.stylePath, styleId: createdStyle.styleId
        });
        assert.equal(removedStyle.deleted, true);
        assert.equal(project.lvglStyles.styles.includes(actualStyle), false);
        await readWriteTool("undo", {});
        assert.equal(project.lvglStyles.styles.includes(actualStyle), true);
        const bitmapImported = await readWriteTool("import_bitmap", {
            name: "NewIcon", filePath: fixturePng
        });
        assert.equal(bitmapImported.imported, true);
        assert.equal(project.bitmaps.some(b => b.name === "NewIcon"), true);
        await assert.rejects(readWriteTool("import_bitmap", {
            name: "NewIcon", filePath: fixturePng
        }), error => error.code === "INVALID_ARGUMENT");
        const nonImage = join(fixtureDir, "bad.png");
        fs.writeFileSync(nonImage, "not an image");
        await assert.rejects(readWriteTool("import_bitmap", {
            name: "BadImage", filePath: nonImage
        }), error => error.code === "INVALID_ARGUMENT");
        await readWriteTool("undo", {});
        assert.equal(project.bitmaps.some(b => b.name === "NewIcon"), false);
        const createdVariable = await readWriteTool("create_variable", {
            name: "Greeting", type: "string", initialValue: "Welcome!"
        });
        assert.equal(createdVariable.created, true);
        assert.equal(project.variables.globalVariables[0].name, "Greeting");
        assert.equal(project.variables.globalVariables[0].defaultValue, '"Welcome!"');
        const actionCreated = await readWriteTool("create_action", { name: "OnPowerChanged" });
        assert.equal(actionCreated.created, true);
        assert.equal(actionCreated.empty, true);
        assert.equal(project.actions.some(x => x.name === "OnPowerChanged"), true);
        const actionMeta = { actionName: "OnPowerChanged", actionId: actionCreated.actionId };
        const startNode = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "StartActionComponent", left: 0, top: 0
        });
        const noopNode = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "NoopActionComponent", left: 180, top: 0, name: "StepA"
        });
        const endNode = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "EndActionComponent", left: 360, top: 0
        });
        assert.equal(startNode.created, true);
        assert.equal(noopNode.created, true);
        assert.equal(endNode.created, true);
        await assert.rejects(readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "StartActionComponent", left: 10, top: 10
        }), error => error.code === "INVALID_ARGUMENT");
        await assert.rejects(readWriteTool("add_action_node", {
            actionName: "OnPowerChanged", actionId: "stale-id",
            nodeType: "NoopActionComponent", left: 5, top: 5
        }), error => error.code === "INVALID_STATE");
        const firstLink = await readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: startNode.nodeId, targetId: noopNode.nodeId
        });
        const secondLink = await readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: noopNode.nodeId, targetId: endNode.nodeId
        });
        assert.equal(firstLink.created, true);
        assert.equal(secondLink.created, true);
        const actionGraph = runReadTool(store, "get_action_graph", actionMeta, false);
        assert.equal(actionGraph.nodes.length, 3);
        assert.equal(actionGraph.lines.length, 2);
        assert.ok(actionGraph.nodes[0].outputs.includes("@seqout"));
        await assert.rejects(readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: startNode.nodeId, targetId: endNode.nodeId
        }), error => error.code === "INVALID_ARGUMENT");
        await readWriteTool("undo", {});
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false).lines.length, 1);
        await readWriteTool("redo", {});
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false).lines.length, 2);
        const disconnected = await readWriteTool("disconnect_action_line", {
            ...actionMeta, lineId: secondLink.lineId
        });
        assert.equal(disconnected.deleted, true);
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false).lines.length, 1);
        await readWriteTool("undo", {});
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false).lines.length, 2);
        await readWriteTool("redo", {});
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false).lines.length, 1);
        const delayNode = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "DelayActionComponent", left: 350, top: 100,
            milliseconds: 750
        });
        assert.equal(delayNode.created, true);
        const delayDescriptor = runReadTool(store, "get_action_graph", actionMeta, false)
            .nodes.find(n => n.nodeId === delayNode.nodeId);
        assert.equal(delayDescriptor.milliseconds, 750);
        await assert.rejects(readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "DelayActionComponent", left: 10, top: 10,
            milliseconds: 100000
        }), error => error.code === "INVALID_ARGUMENT");
        const setVariableNode = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "SetVariableActionComponent", left: 270, top: 0,
            variableName: "Greeting", value: "Updated!"
        });
        assert.equal(setVariableNode.created, true);
        const setNodeDescriptor = runReadTool(store, "get_action_graph", actionMeta, false)
            .nodes.find(n => n.nodeId === setVariableNode.nodeId);
        assert.equal(setNodeDescriptor.variableName, "Greeting");
        assert.equal(setNodeDescriptor.value, "Updated!");
        await assert.rejects(readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "SetVariableActionComponent", left: 10, top: 10,
            variableName: "Greeting", value: 123
        }), error => error.code === "INVALID_ARGUMENT");
        await readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: noopNode.nodeId, targetId: setVariableNode.nodeId
        });
        await readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: setVariableNode.nodeId, targetId: delayNode.nodeId
        });
        await readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: delayNode.nodeId, targetId: endNode.nodeId
        });
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false).lines.length, 4);
        const removedNode = await readWriteTool("delete_action_node", {
            ...actionMeta, nodeId: delayNode.nodeId
        });
        assert.equal(removedNode.removedConnections, 2);
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false).lines.length, 2);
        await readWriteTool("undo", {});
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false).lines.length, 4);
        await assert.rejects(readWriteTool("disconnect_action_line", {
            ...actionMeta, lineId: "missing-line"
        }), error => error.code === "INVALID_STATE");
        const booleanCondition = await readWriteTool("create_variable", {
            name: "MachineReady", type: "boolean", initialValue: true
        });
        assert.equal(booleanCondition.created, true);
        const branch = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "IsTrueActionComponent", left: 90, top: 240,
            conditionVariableName: "MachineReady"
        });
        assert.equal(branch.created, true);
        const branchTrue = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "NoopActionComponent", left: 280, top: 220
        });
        const branchFalse = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "NoopActionComponent", left: 280, top: 320
        });
        await readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: branch.nodeId, targetId: branchTrue.nodeId, output: "True"
        });
        await readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: branch.nodeId, targetId: branchFalse.nodeId, output: "False"
        });
        const branchedGraph = runReadTool(store, "get_action_graph", actionMeta, false);
        assert.equal(branchedGraph.nodes.find(n => n.nodeId === branch.nodeId).condition, "MachineReady");
        assert.ok(branchedGraph.lines.some(line => line.sourceId === branch.nodeId && line.output === "True"));
        assert.ok(branchedGraph.lines.some(line => line.sourceId === branch.nodeId && line.output === "False"));
        await assert.rejects(readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: branch.nodeId, targetId: endNode.nodeId, output: "True"
        }), error => error.code === "INVALID_ARGUMENT");
        await assert.rejects(readWriteTool("connect_action_nodes", {
            ...actionMeta, sourceId: branchTrue.nodeId, targetId: branch.nodeId, output: "@seqout"
        }), error => error.code === "INVALID_ARGUMENT");
        await assert.rejects(readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "IsTrueActionComponent", left: 40, top: 350,
            conditionVariableName: "Greeting"
        }), error => error.code === "INVALID_ARGUMENT");
        const helper = await readWriteTool("create_action", { name: "HelperFlow" });
        const helperMeta = { actionName: "HelperFlow", actionId: helper.actionId };
        await readWriteTool("add_action_node", {
            ...helperMeta, nodeType: "StartActionComponent", left: 0, top: 0
        });
        await readWriteTool("add_action_node", {
            ...helperMeta, nodeType: "EndActionComponent", left: 220, top: 0
        });
        const called = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "CallActionActionComponent", left: 510, top: 290,
            targetActionName: "HelperFlow"
        });
        assert.equal(called.created, true);
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false)
            .nodes.find(n => n.nodeId === called.nodeId).targetActionName, "HelperFlow");
        await assert.rejects(readWriteTool("add_action_node", {
            ...helperMeta, nodeType: "CallActionActionComponent", left: 510, top: 290,
            targetActionName: "OnPowerChanged"
        }), error => error.code === "INVALID_ARGUMENT");
        const screenNav = await readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "LVGLActionComponent", left: 610, top: 360,
            screenName: "Second"
        });
        assert.equal(screenNav.created, true);
        assert.equal(runReadTool(store, "get_action_graph", actionMeta, false)
            .nodes.find(n => n.nodeId === screenNav.nodeId).screenName, "Second");
        await assert.rejects(readWriteTool("add_action_node", {
            ...actionMeta, nodeType: "LVGLActionComponent", left: 10, top: 10,
            screenName: "UnknownPage"
        }), error => error.code === "INVALID_ARGUMENT");
        await assert.rejects(readWriteTool("create_action", { name: "OnPowerChanged" }),
            error => error.code === "INVALID_ARGUMENT");
        const bindingSchema = runReadTool(store, "get_widget_schema", {
            pageName: "Home", widgetPath: [0]
        }, false);
        assert.ok(bindingSchema.bindableProperties.some(prop => prop.name === "text"));
        await readWriteTool("bind_widget_variable", {
            pageName: "Home", widgetPath: [0], property: "text", variableName: "Greeting"
        });
        assert.equal(firstWidget.textType, "expression");
        assert.equal(firstWidget.text, "Greeting");
        await readWriteTool("undo", {});
        assert.equal(firstWidget.textType, "literal");
        assert.equal(firstWidget.text, "Original");
        await readWriteTool("redo", {});
        assert.equal(firstWidget.textType, "expression");
        await assert.rejects(readWriteTool("bind_widget_variable", {
            pageName: "Home", widgetPath: [0], property: "text", variableName: "NotExisting"
        }), error => error.code === "INVALID_ARGUMENT");
        await readWriteTool("unbind_widget_variable", {
            pageName: "Home", widgetPath: [0], property: "text", value: "Unbound"
        });
        assert.equal(firstWidget.textType, "literal");
        assert.equal(firstWidget.text, "Unbound");

        const added = await readWriteTool("add_widget", {
            pageName: "Home", widgetType: "LVGLLabelWidget",
            properties: { identifier: "new_label", left: 25, top: 37, width: 150,
                height: 28, text: "Hello!" }
        });
        assert.deepEqual(added.widgetPath, [1]);
        assert.equal(homePage.components[1].text, "Hello!");
        const palette = runReadTool(store, "get_mcp_capabilities", {}, false);
        assert.ok(palette.creatableWidgetTypes.includes("LVGLTabWidget"));
        const tabWidget = await readWriteTool("add_widget", {
            pageName: "Second", widgetType: "LVGLTabWidget", properties: { left: 2 }
        });
        assert.equal(tabWidget.created, true);
        assert.equal(project.userPages[1].components[0].type, "LVGLTabWidget");
        const secondWidget = await readWriteTool("add_widget", {
            pageName: "Second", widgetType: "LVGLLabelWidget",
            properties: { identifier: "sibling_label", text: "Sibling" }
        });
        assert.equal(project.userPages[1].components[1].identifier, "sibling_label");
        const reordered = await readWriteTool("reorder_widget", {
            pageName: "Second", widgetPath: secondWidget.widgetPath,
            widgetId: secondWidget.widgetId,
            anchorPath: tabWidget.widgetPath, anchorId: tabWidget.widgetId,
            position: "before"
        });
        assert.deepEqual(reordered.widgetPath, [0]);
        assert.equal(project.userPages[1].components[0].identifier, "sibling_label");
        await readWriteTool("undo", {});
        assert.equal(project.userPages[1].components[1].identifier, "sibling_label");
        await readWriteTool("redo", {});
        assert.equal(project.userPages[1].components[0].identifier, "sibling_label");
        const duplicated = await readWriteTool("duplicate_widget", {
            pageName: "Second", widgetPath: [0], widgetId: secondWidget.widgetId,
            newIdentifier: "sibling_label_copy", left: 120, top: 30
        });
        assert.equal(duplicated.duplicated, true);
        assert.deepEqual(duplicated.widgetPath, [1]);
        assert.notEqual(duplicated.widgetId, secondWidget.widgetId);
        assert.equal(project.userPages[1].components[1].identifier, "sibling_label_copy");
        assert.equal(project.userPages[1].components[1].text, "Sibling");
        assert.equal(project.userPages[1].components[1].left, 120);
        await readWriteTool("undo", {});
        assert.equal(project.userPages[1].components.length, 2);
        await readWriteTool("redo", {});
        assert.equal(project.userPages[1].components[1].identifier, "sibling_label_copy");
        await assert.rejects(readWriteTool("duplicate_widget", {
            pageName: "Second", widgetPath: [0], widgetId: secondWidget.widgetId,
            newIdentifier: "sibling_label_copy"
        }), error => error.code === "INVALID_ARGUMENT");
        await readWriteTool("undo", {});
        await assert.rejects(readWriteTool("reorder_widget", {
            pageName: "Second", widgetPath: [0], widgetId: secondWidget.widgetId,
            anchorPath: [1], anchorId: "wrong-anchor-id", position: "after"
        }), error => error.code === "INVALID_STATE");
        await assert.rejects(readWriteTool("reorder_widget", {
            pageName: "Second", widgetPath: [0], widgetId: secondWidget.widgetId,
            anchorPath: [0], anchorId: secondWidget.widgetId, position: "before"
        }), error => error.code === "INVALID_ARGUMENT");

        // An LVGL screen contains one root Screen widget. Adding to a page
        // is relocated by ProjectStore and must return a nested widgetPath.
        const screen = Object.assign(new LVGLWidget(), {
            type: "LVGLScreenWidget", identifier: "screen", children: []
        });
        const screenPage = Object.assign(new Page(), {
            name: "ScreenPage", width: 800, height: 480, components: [screen]
        });
        project.userPages.push(screenPage);
        const addedToScreen = await readWriteTool("add_widget", {
            pageName: "ScreenPage", widgetType: "LVGLLabelWidget",
            properties: { identifier: "screen_caption", text: "Inside" }
        });
        assert.deepEqual(addedToScreen.widgetPath, [0, 0]);
        assert.equal(screen.children[0].identifier, "screen_caption");
        assert.equal(screenPage.components.length, 1);
        const moved = await readWriteTool("move_widget", {
            sourcePageName: "Second", widgetPath: [1], widgetId: tabWidget.widgetId,
            targetPageName: "ScreenPage"
        });
        assert.equal(moved.moved, true);
        assert.deepEqual(moved.widgetPath, [0, 1]);
        assert.equal(screen.children[1].objID, tabWidget.widgetId);
        assert.equal(project.userPages[1].components.length, 1);
        await readWriteTool("undo", {});
        assert.equal(project.userPages[1].components[1].objID, tabWidget.widgetId);
        assert.equal(screen.children.length, 1);
        await readWriteTool("redo", {});
        assert.equal(screen.children[1].objID, tabWidget.widgetId);
        await readWriteTool("undo", {});
        await assert.rejects(readWriteTool("move_widget", {
            sourcePageName: "Second", widgetPath: [1], widgetId: tabWidget.widgetId,
            targetPageName: "Second"
        }), error => error.code === "INVALID_ARGUMENT");
        const panel = Object.assign(new LVGLWidget(), {
            identifier: "mcp_panel", type: "LVGLPanelWidget", children: []
        });
        const nested = Object.assign(new LVGLWidget(), { identifier: "nested_leaf" });
        panel.children.push(nested);
        homePage.components.push(panel);
        await assert.rejects(readWriteTool("move_widget", {
            sourcePageName: "Home", widgetPath: [2], widgetId: panel.objID,
            targetPageName: "Home", targetParentPath: [2, 0], targetParentId: nested.objID
        }), error => error.code === "INVALID_ARGUMENT");
        homePage.components.pop();

        const updated = await readWriteTool("update_widget", {
            pageName:"Home", widgetPath:[1],
            properties: { text: "Updated", left: 80 }
        });
        assert.equal(updated.changed, true);
        assert.equal(homePage.components[1].left, 80);

        const changed = await readWriteTool("set_style_property", {
            stylePath:[0], part:"MAIN", state:"DEFAULT", property:"bg_color", value:"#abcdef"
        });
        assert.equal(changed.changed, true);
        assert.equal(style.definition.definition.MAIN.DEFAULT.bg_color, "#abcdef");
        const undone = await readWriteTool("undo",{});
        assert.equal(undone.operation, "undo");
        assert.equal(style.definition.definition.MAIN.DEFAULT.bg_color, "#112233");
        await readWriteTool("redo",{});
        assert.equal(style.definition.definition.MAIN.DEFAULT.bg_color, "#abcdef");

        const deleted = await readWriteTool("delete_widget", { pageName:"Home", widgetPath:[1] });
        assert.equal(deleted.deleted,true);
        assert.equal(homePage.components.length,1);
        await readWriteTool("undo",{});
        assert.equal(homePage.components.length,2);
        assert.equal(homePage.components[1].text,"Updated");

        const saved = await readWriteTool("save_project",{});
        assert.equal(saved.saved,true);
        // Generic ClassInfo-backed property/schema tests on different widget types.
        const powerSwitch = Object.assign(new LVGLWidget(), {
            type: "LVGLSwitchWidget", identifier: "power_switch",
            clickableFlag: true, scrollbarMode: "off"
        });
        powerSwitch.localStyles = {
            definition: {},
            addPropertyToDefinition(info, part, state, value) {
                const definition = structuredClone(this.definition || {});
                definition[part] ||= {};
                definition[part][state] ||= {};
                definition[part][state][info.name] = value;
                return definition;
            }
        };
        screen.children.push(powerSwitch);
        const switchPath = [0, screen.children.length - 1];
        const switchSchema = runReadTool(store, "get_widget_schema", {
            pageName: "ScreenPage", widgetPath: switchPath
        }, false);
        assert.deepEqual(switchSchema.supportedParts,
            ["MAIN", "INDICATOR", "KNOB"]);
        assert.ok(switchSchema.properties.some(p => p.name === "clickableFlag"));
        assert.deepEqual(switchSchema.properties.find(p =>
            p.name === "scrollbarMode").enumItems, ["off", "on"]);

        await readWriteTool("set_widget_local_style", {
            pageName: "ScreenPage", widgetPath: switchPath,
            part: "INDICATOR", state: "CHECKED",
            property: "bg_color", value: "#00cc44"
        });
        assert.equal(powerSwitch.localStyles.definition.INDICATOR.CHECKED.bg_color,
            "#00cc44");
        await readWriteTool("undo", {});
        assert.equal(powerSwitch.localStyles.definition.INDICATOR, undefined);
        await readWriteTool("redo", {});
        assert.equal(powerSwitch.localStyles.definition.INDICATOR.CHECKED.bg_color,
            "#00cc44");

        await readWriteTool("set_widget_property", {
            pageName: "ScreenPage", widgetPath: switchPath,
            property: "clickableFlag", value: false
        });
        assert.equal(powerSwitch.clickableFlag, false);
        await readWriteTool("undo", {});
        assert.equal(powerSwitch.clickableFlag, true);
        await readWriteTool("set_widget_property", {
            pageName: "ScreenPage", widgetPath: switchPath,
            property: "scrollbarMode", value: "on"
        });
        assert.equal(powerSwitch.scrollbarMode, "on");
        const beforeBatch = undoManager.undoStack.length;
        await readWriteTool("set_widget_properties", {
            pageName: "ScreenPage", widgetPath: switchPath,
            properties: { clickableFlag: false, scrollbarMode: "off" }
        });
        assert.equal(powerSwitch.clickableFlag, false);
        assert.equal(powerSwitch.scrollbarMode, "off");
        assert.equal(undoManager.undoStack.length, beforeBatch + 1);
        await readWriteTool("undo", {});
        assert.equal(powerSwitch.clickableFlag, true);
        assert.equal(powerSwitch.scrollbarMode, "on");
        const beforeInvalidBatch = undoManager.undoStack.length;
        await assert.rejects(readWriteTool("set_widget_properties", {
            pageName: "ScreenPage", widgetPath: switchPath,
            properties: { clickableFlag: false, scrollbarMode: "invalid" }
        }), error => error.code === "INVALID_ARGUMENT");
        assert.equal(powerSwitch.clickableFlag, true);
        assert.equal(undoManager.undoStack.length, beforeInvalidBatch);

        const bitmapWidget = Object.assign(new LVGLWidget(), {
            type: "LVGLImageWidget", identifier: "image1", image: ""
        });
        homePage.components.push(bitmapWidget);
        const bitmapPath = [homePage.components.length - 1];
        const bitmapSchema = runReadTool(store, "get_widget_schema", {
            pageName: "Home", widgetPath: bitmapPath
        }, false);
        assert.deepEqual(bitmapSchema.properties.find(p =>
            p.name === "image").bitmapNames, ["IconArrow"]);
        await readWriteTool("set_widget_property", {
            pageName: "Home", widgetPath: bitmapPath,
            property: "image", value: "IconArrow"
        });
        assert.equal(bitmapWidget.image, "IconArrow");
        await readWriteTool("undo", {});
        assert.equal(bitmapWidget.image, "");
        // Existing Action references are bound through the real
        // EventHandler model, never through generated script strings.
        assert.ok(switchSchema.availableEvents.includes("CLICKED"));
        const eventAdded = await readWriteTool("add_widget_event", {
            pageName: "ScreenPage", widgetPath: switchPath,
            eventName: "CLICKED", actionName: "GoHome", userData: 7
        });
        assert.equal(eventAdded.created, true);
        assert.equal(powerSwitch.eventHandlers.length, 1);
        assert.equal(powerSwitch.eventHandlers[0].action, "GoHome");
        assert.equal(powerSwitch.eventHandlers[0].userData, 7);
        const events = runReadTool(store, "list_widget_events", {
            pageName: "ScreenPage"
        }, false);
        assert.equal(events.bindings[0].eventHandlers[0].eventId, eventAdded.eventId);
        await assert.rejects(readWriteTool("add_widget_event", {
            pageName: "ScreenPage", widgetPath: switchPath,
            eventName: "CLICKED", actionName: "GoHome"
        }), error => error.code === "INVALID_STATE");
        await assert.rejects(readWriteTool("add_widget_event", {
            pageName: "ScreenPage", widgetPath: switchPath,
            eventName: "UNSUPPORTED", actionName: "GoHome"
        }), error => error.code === "INVALID_ARGUMENT");
        await assert.rejects(readWriteTool("add_widget_event", {
            pageName: "ScreenPage", widgetPath: switchPath,
            eventName: "VALUE_CHANGED", actionName: "NoSuchAction"
        }), error => error.code === "INVALID_ARGUMENT");
        await readWriteTool("undo", {});
        assert.equal(powerSwitch.eventHandlers.length, 0);
        await readWriteTool("redo", {});
        assert.equal(powerSwitch.eventHandlers.length, 1);
        const eventRemoved = await readWriteTool("remove_widget_event", {
            pageName: "ScreenPage", widgetPath: switchPath, eventId: eventAdded.eventId
        });
        assert.equal(eventRemoved.removed, true);
        assert.equal(powerSwitch.eventHandlers.length, 0);
        await readWriteTool("undo", {});
        assert.equal(powerSwitch.eventHandlers.length, 1);
        for (const [tool,args] of [
            ["set_widget_local_style", { pageName:"ScreenPage",
                widgetPath:switchPath, part:"NOT_A_PART",state:"DEFAULT",
                property:"bg_color",value:"#00cc44" }],
            ["set_widget_local_style", { pageName:"ScreenPage",
                widgetPath:switchPath, part:"KNOB",state:"DEFAULT",
                property:"bg_opa",value:999 }],
            ["set_widget_local_style", { pageName:"ScreenPage",
                widgetPath:switchPath, part:"KNOB",state:"INVALID",
                property:"bg_color",value:"#00cc44" }],
            ["set_widget_property", { pageName:"ScreenPage",
                widgetPath:switchPath, property:"icon",value:"fake" }],
            ["set_widget_property", { pageName:"Home",
                widgetPath:bitmapPath, property:"image",value:"UnknownBitmap" }],
            ["set_widget_property", { pageName:"ScreenPage",
                widgetPath:switchPath, property:"scrollbarMode",value:"invalid" }]
        ]) {
            await assert.rejects(readWriteTool(tool,args),
                error => error.code === "INVALID_ARGUMENT");
        }


        for (const [tool,args] of [
            ["create_page",{name:"Home"}],
            ["add_widget",{pageName:"Home",widgetType:"UnknownWidget",properties:{left:1}}],
            ["add_widget",{pageName:"Home",widgetType:"LVGLLabelWidget",properties:{identifier:"previous"}}],
            ["update_widget",{pageName:"Home",widgetPath:[40],properties:{width:100}}],
            ["update_widget",{pageName:"Home",widgetPath:[0],properties:{width:-5}}],
            ["set_style_property",{stylePath:[0],part:"MAIN",state:"DEFAULT",property:"script",value:"bad"}],
            ["delete_widget",{pageName:"Missing",widgetPath:[0]}]
        ]) {
            let rejected=false;
            try { await readWriteTool(tool,args); } catch (e) { rejected=true; }
            assert.equal(rejected,true,"Unsafe command accepted: "+tool);
        }

        // An old path must not mutate an unrelated widget.
        await assert.rejects(
            executeWriteTool(store, "update_widget", {
                expectedProjectPath: store.filePath, pageName: "Home",
                widgetPath: [0], widgetId: "mcp-widget-not-matching",
                properties: { width: 210 }
            }),
            error => error.code === "INVALID_STATE"
        );
        assert.notEqual(firstWidget.width, 210);

        // MCP undo must never consume a human edit above its own entry.
        store.updateObject(firstWidget, { text: "MANUAL_CHANGE" });
        undoManager.setCombineCommands(false);
        await assert.rejects(readWriteTool("undo", {}),
            error => error.code === "INVALID_STATE");
        assert.equal(firstWidget.text, "MANUAL_CHANGE");

        for (const bad of [
            { part: "NOT_A_PART", state: "DEFAULT" },
            { part: "MAIN", state: "INVALID" },
            { part: "MAIN", state: "DEFAULT", property: "script" }
        ]) {
            await assert.rejects(readWriteTool("set_style_property", {
                stylePath: [0], part: bad.part, state: bad.state,
                property: bad.property || "bg_color", value: "#00cc44"
            }), error => error.code === "INVALID_ARGUMENT");
        }
        assert.throws(() => validateWriteArguments("add_widget", {
            expectedProjectPath: store.filePath, pageName: "Home",
            widgetType: "LVGLLabelWidget",
            properties: { identifier: "a", constructor: "attack" }
        }));
        await assert.rejects(readWriteTool("set_style_property", {
            stylePath: [0], part: "MAIN", state: "DEFAULT",
            property: "bg_color", value: "javascript:bad"
        }), error => error.code === "INVALID_ARGUMENT");
        let switchedRejected = false;
        try {
            await executeWriteTool(store, "update_widget", {
                expectedProjectPath: "C:/other/another.eez-project",
                pageName: "Home", widgetPath: [0], widgetId: firstWidget.objID,
                properties: { left: 42 }
            });
        } catch (error) {
            if (error.code !== "INVALID_STATE") console.error("Unexpected project-switch error:", error);
            switchedRejected = error.code === "INVALID_STATE";
        }
        assert.ok(switchedRejected, "Project-switch guard must reject stale requests");

        for (const [property, value] of [
            ["radius", "LARGE"],
            ["bg_opa", 300],
            ["pad_all", -2],
            ["text_color", "not-a-color"]
        ]) {
            await assert.rejects(readWriteTool("set_style_property", {
                stylePath: [0], part: "MAIN", state: "DEFAULT", property, value
            }), error => error.code === "INVALID_ARGUMENT",
                "Invalid style literal was accepted: " + property);
        }
        const originValue = homePage.components[1].text;
        homePage.components[1].textType = "expression";
        await assert.rejects(readWriteTool("update_widget", {
            pageName: "Home", widgetPath: [1], properties: { text: "Forbidden" }
        }));
        assert.equal(homePage.components[1].text, originValue);
        homePage.components[1].textType = "literal";

        console.log("PASS: create page, create/update/delete widget, style, save, undo/redo, invalid and malicious inputs");
    } catch(e) {
        console.error("FAIL MCP write adapter: "+e.stack);
        process.exitCode = 1;
    }
})();
