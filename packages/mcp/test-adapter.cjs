/* Test the compiled read-only adapter without running Electron. */
const { join } = require("node:path");
const Module = require("node:module");

class LVGLWidget {
    constructor(type, identifier, children = []) {
        this.type = type;
        this.identifier = identifier;
        this.children = children;
        this.left = 12;
        this.top = 30;
        this.width = 120;
        this.height = 42;
        this.text = "Hello";
    }
}
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === "project-editor/project-editor-interface") return { ProjectEditor: { build: { buildProject: async () => undefined } } };
    if (request === "project-editor/store/output-sections") return { Section: { OUTPUT: 1 } };
    if (request === "project-editor/lvgl/widgets/Base") return { LVGLWidget };
    if (request === "project-editor/core/object") return { getClassesDerivedFrom: () => [], getClassInfo: widget => widget.classInfo || { properties: [], lvgl: { parts: ["MAIN"] } }, PropertyType: { Number:3,Boolean:2,String:5,Enum:4,Color:8,ThemedColor:9,ObjectReference:12 }, TYPE_NAMES: {} };
    if (request === "project-editor/lvgl/style-catalog") return { lvglPropertiesMap: new Map() };
    return originalLoad.apply(this, arguments);
};
let runReadTool;
try {
    ({ runReadTool } = require(join(__dirname, "..", "..", "build", "mcp", "adapter", "read-tools.js")));
} finally {
    Module._load = originalLoad;
}
const widget = new LVGLWidget("LVGLButtonWidget", "primary",
    [new LVGLWidget("LVGLLabelWidget", "caption")]);
const store = {
    filePath: "C:/DigiStudio/DigiRide.eez-project",
    isModified: false,
    project: {
        objID: "project-1",
        pages: [{ objID: "page-1", name: "Home", width: 800, height: 480, components: [widget] }],
        variables: { globalVariables: [
            { name: "speed", type: "integer", persistent: false, native: false }
        ] },
        actions: [{ name: "refreshDashboard", implementationType: "flow" }],
        settings: {
            general: { projectType: "lvgl", lvglVersion: "8.4.0", displayWidth: 800, displayHeight: 480 }
        }
    }
};
store.editorModeEditorsStore = { activeEditor: { object: store.project.pages[0] } };
const metadata = runReadTool(store, "get_current_project", {}, false);
if (metadata.pageCount !== 1 || metadata.lvglVersion !== "8.4.0" ||
    metadata.projectName !== "DigiRide") throw new Error("Project metadata mismatch");
const pages = runReadTool(store, "list_pages", {}, false);
if (pages.pages[0].width !== 800) throw new Error("Pages result mismatch");
const active = runReadTool(store, "get_active_page", {}, false);
if (active.pageName !== "Home" || active.pageId !== "page-1") {
    throw new Error("Active page does not match canvas");
}
const vars = runReadTool(store, "list_variables", {}, false);
if (vars.variableCount !== 1 || vars.variables[0].name !== "speed") {
    throw new Error("Variable metadata mismatch");
}
const actions = runReadTool(store, "list_actions", {}, false);
if (actions.actionCount !== 1 || actions.actions[0].name !== "refreshDashboard") {
    throw new Error("Action metadata mismatch");
}
const tree = runReadTool(store, "list_widgets", { pageName: "Home" }, false);
if (tree.widgetCount !== 2 ||
    tree.widgets[0].children[0].identifier !== "caption" ||
    tree.widgets[0].properties.text !== "Hello") {
    throw new Error("Widget hierarchy mismatch");
}
let denied = false;
try { runReadTool(store, "list_widgets", { pageName: "Missing" }, false); }
catch (error) { denied = error.code === "PAGE_NOT_FOUND"; }
if (!denied) throw new Error("Missing page must return PAGE_NOT_FOUND");
denied = false;
try { runReadTool(store, "list_widgets", { pageName: "" }, false); }
catch { denied = true; }
if (!denied) throw new Error("Empty pageName accepted");
const { captureActiveCanvas } = require(join(__dirname, "../../build/mcp/adapter/canvas-snapshot.js"));
let drawn = null;
let renderedImage = "data:image/png;base64," + "A".repeat(32);
const source = {
    isConnected: true, width: 800, height: 600,
    getAttribute: name => name === "data-digi-mcp-page-id" ? "page-1" :
        name === "data-digi-mcp-project-id" ? "project-1" : null,
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    getClientRects: () => [1]
};
const canvasDoc = {
    querySelectorAll: () => [source],
    createElement: name => {
        if (name !== "canvas") throw new Error("Unexpected capture target");
        return {
            width: 0, height: 0,
            getContext: type => type === "2d" ? {
                drawImage: (...args) => { drawn = args; }
            } : null,
            toDataURL: type => {
                if (type !== "image/png") throw new Error("Wrong format");
                return renderedImage;
            }
        };
    }
};
const capture = captureActiveCanvas(store, "page-1", false, canvasDoc);
if (capture.pageName !== "Home" || capture.source !== "active-lvgl-editor-canvas" ||
    capture.capturedWidth !== 800 || capture.capturedHeight !== 480 ||
    capture.pngBase64.length !== 32 || capture.simulationVerified !== false ||
    !drawn || drawn[0] !== source || drawn[4] !== 480) {
    throw new Error("Active LVGL canvas capture/crop mismatch");
}
const expectReject = (fn, code) => {
    let actual;
    try { fn(); } catch (err) { actual = err.code; }
    if (actual !== code) throw new Error("Expected " + code + " but received " + actual);
};
expectReject(() => captureActiveCanvas(store, "stale-page", false, canvasDoc), "INVALID_STATE");
expectReject(() => captureActiveCanvas(store, "page-1", true, canvasDoc), "INVALID_STATE");
store.runtime = { isRunning: true };
expectReject(() => captureActiveCanvas(store, "page-1", false, canvasDoc), "INVALID_STATE");
store.runtime = undefined;
expectReject(() => captureActiveCanvas(store, "page-1", false, {
    ...canvasDoc, querySelectorAll: () => [{ ...source, getAttribute: name =>
        name === "data-digi-mcp-project-id" ? "another-project" : "page-1" }]
}), "INVALID_STATE");
expectReject(() => captureActiveCanvas(store, "page-1", false, {
    ...canvasDoc, querySelectorAll: () => [source, source]
}), "INVALID_STATE");
renderedImage = "data:image/png;base64," + "A".repeat(1_350_004);
expectReject(() => captureActiveCanvas(store, "page-1", false, canvasDoc), "LIMIT_EXCEEDED");
renderedImage = "data:image/png;base64," + "A".repeat(32);
store.project.pages[0].width = 1600;
source.width = 1600;
const resized = captureActiveCanvas(store, "page-1", false, canvasDoc);
if (resized.capturedWidth !== 1024 || resized.capturedHeight !== 307) {
    throw new Error("Large LVGL canvas scaling mismatch");
}
process.stdout.write("PASS: metadata, active page, canvas PNG capture isolation/size guards, widget hierarchy and safe validation\n");
