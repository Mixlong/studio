"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("module");


const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/page-runtime.ts"), "utf8"
);
const buildSrc = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/widgets/Base.tsx"), "utf8"
);
const constants = fs.readFileSync(
    path.join(root, "packages/project-editor/lvgl/lvgl-constants.ts"), "utf8"
);
assert(constants.includes('"SCREEN_LOADED"'));
assert(constants.includes('"SCREEN_LOAD_START"'));
assert(constants.includes('"SCREEN_UNLOAD_START"'));
assert(constants.includes('"SCREEN_UNLOADED"'));

const start = src.indexOf("export class LVGLPageViewerRuntime");
const begin = src.indexOf("    override addEventHandler(", start);
const end = src.indexOf("\n}\n\n////////////////////////////////////////////////////////////////////////////////", begin);
assert(start >= 0 && begin > start && end > begin);
const methods = src.slice(begin, end).replaceAll("override ", "");
const js = stripTypeScriptTypes(
    "class ViewerEventHarness {\n" + methods + "\n}\nmodule.exports = ViewerEventHarness;",
    { mode: "transform" }
);

const screenEvents = new Set([
    "SCREEN_UNLOAD_START", "SCREEN_LOAD_START",
    "SCREEN_LOADED", "SCREEN_UNLOADED"
]);
const codes = {
    SCREEN_UNLOAD_START: { code: 37 },
    SCREEN_LOAD_START: { code: 38 },
    SCREEN_LOADED: { code: 39 },
    SCREEN_UNLOADED: { code: 40 },
    CLICKED: { code: 7 }
};
const sandbox = {
    module: { exports: {} },
    getLvglEvents: () => codes,
    isLvglScreenLifecycleEvent: name => screenEvents.has(name)
};
vm.runInNewContext(js, sandbox);
const Harness = sandbox.module.exports;
const h = new Harness();
const registrations = [];
h.wasm = { _lvglAddEventHandler(obj) { registrations.push(obj); } };
const screen = { _lvglObj: 100 };
const page = { lvglScreenWidget: screen };
h.page = page;
h.lvglCreateContext = { page, flowState: 1 };
h.eventHandlers = [];
const invoked = [];
h.addEventHandler(200, "SCREEN_LOADED", event => invoked.push(["loaded", event]));
h.addEventHandler(200, "CLICKED", event => invoked.push(["click", event]));
h.addEventHandler(210, "SCREEN_LOAD_START", event => invoked.push(["started", event]));
assert.deepEqual(registrations, [100, 200],
    "The same screen should be registered only once; CLICKED remains on child");
assert.deepEqual(
    JSON.parse(JSON.stringify(h.eventHandlers.map(({ obj, eventCode }) => [obj, eventCode]))),
    [[100, 39], [200, 7], [100, 38]]
);
h.lvglOnEventHandler(200, 39, 1);
assert.equal(invoked.length, 0, "SCREEN_LOADED does not fire on the Container");
h.lvglOnEventHandler(100, 39, 2);
h.lvglOnEventHandler(200, 7, 3);
h.lvglOnEventHandler(100, 38, 4);
assert.deepEqual(invoked, [
    ["loaded", 2], ["click", 3], ["started", 4]
]);
h.lvglOnEventHandler(100, 7, 5);
assert.equal(invoked.length, 3, "Screen must not trigger widget CLICKED events");

assert(
    buildSrc.includes("isLvglScreenLifecycleEvent(eventHandler.eventName)") &&
    buildSrc.includes("code.lvglBuild.getLvglObjectAccessor(screen)") &&
    buildSrc.includes("if (screenEvents && screen && screen !== this)") &&
    buildSrc.includes("if (!screenEvents || widgetEvents || !screen || screen === this)"),
    "Generated LVGL C code must register screen lifecycle on screen and keep mixed widget callbacks"
);

// Run the actual C-code generation branch for three event configurations.

const generatorStart = buildSrc.indexOf("    eventHandlersToLVGLCode(code: LVGLCode) {");
const generatorEnd = buildSrc.indexOf("\n    flagsToCode(code: LVGLCode) {", generatorStart);
assert(generatorStart >= 0 && generatorEnd > generatorStart);
const generator = stripTypeScriptTypes(
    "class WidgetEventGenerator {\n" +
    buildSrc.slice(generatorStart, generatorEnd) +
    "\n}\nmodule.exports = WidgetEventGenerator;",
    { mode: "transform" }
);
const screenNode = { type: "LVGLScreenWidget" };
const generatorScope = {
    module: { exports: {} },
    ProjectEditor: { getPage() { return { lvglScreenWidget: screenNode }; } },
    isLvglScreenLifecycleEvent: name => screenEvents.has(name)
};
vm.runInNewContext(generator, generatorScope);
function generateCallbacks(names, isScreenWidget = false) {
    const widget = new generatorScope.module.exports();
    if (isScreenWidget) screenNode.eventHandlersToLVGLCode = widget;
    widget.eventHandlers = names.map(eventName => ({
        eventName, handlerType: "flow", action: "unused"
    }));
    widget.checkedStateType = "none";
    const lines = [];
    const lvglBuild = {
        eventHandlers: new Map(),
        line(value) { lines.push(value); },
        getEventHandlerCallbackName() { return "handler"; },
        getLvglObjectAccessor(screenWidget) {
            assert.equal(screenWidget, screenNode);
            return "objects.current_screen";
        }
    };
    const code = {
        lvglBuild, hasFlowSupport: true,
        addEventHandler(_name, _callback) {},
        project: {}
    };
    widget.eventHandlersToLVGLCode(code);
    return lines;
}
assert.deepEqual(generateCallbacks(["SCREEN_LOADED"]), [
    "lv_obj_add_event_cb(objects.current_screen, handler, LV_EVENT_ALL, flowState);"
]);
assert.deepEqual(generateCallbacks(["CLICKED"]), [
    "lv_obj_add_event_cb(obj, handler, LV_EVENT_ALL, flowState);"
]);
assert.deepEqual(generateCallbacks(["SCREEN_LOADED", "CLICKED"]), [
    "lv_obj_add_event_cb(obj, handler, LV_EVENT_ALL, flowState);",
    "lv_obj_add_event_cb(objects.current_screen, handler, LV_EVENT_ALL, flowState);"
]);

console.log("LVGL screen event test passed: screen lifecycle routing, mixed clicks, registration deduplication and C export target.");
