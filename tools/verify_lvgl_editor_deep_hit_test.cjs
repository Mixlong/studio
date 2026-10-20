"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");

const source = fs.readFileSync(
    path.resolve(__dirname, "../packages/project-editor/flow/editor/bounding-rects.ts"), "utf8"
);
const begin = source.indexOf("export function getObjectIdFromPoint(");
const end = source.indexOf("\nexport function getObjectIdsInsideRect(", begin);
assert(begin >= 0 && end > begin);
class LVGLWidget {
    constructor(id, rect, children = []) {
        this.id = id;
        this.rect = rect;
        this.children = children;
        this.hiddenInEditor = false;
    }
}
class LVGLTab extends LVGLWidget {}

const widgets = {
    screen: new LVGLWidget("screen", { left: 0, top: 0, width: 400, height: 300 }),
    panel: new LVGLWidget("panel", { left: 20, top: 20, width: 240, height: 200 }),
    label: new LVGLWidget("label", { left: 45, top: 45, width: 130, height: 35 }),
    button: new LVGLWidget("button", { left: 40, top: 40, width: 160, height: 64 }),
    badge: new LVGLWidget("badge", { left: 55, top: 55, width: 55, height: 20 }),
    side: new LVGLWidget("side", { left: 310, top: 30, width: 50, height: 40 })
};
widgets.button.children.push(widgets.badge);
widgets.panel.children.push(widgets.label, widgets.button);
widgets.screen.children.push(widgets.panel, widgets.side);
const adapters = new Map(Object.values(widgets).map(w => [w.id, {
    id: w.id,
    rect: w.rect,
    object: w,
    isSelectable: true,
    selected: false
}]));
const page = { lvglScreenWidget: widgets.screen };
const fakeDocument = {
    flow: { object: page },
    findObjectById(id) { return adapters.get(id); }
};
const scope = {
    module: { exports: {} },
    getId: w => w.id,
    ProjectEditor: {
        LVGLWidgetClass: LVGLWidget,
        LVGLTabWidgetClass: LVGLTab,
        getPage: obj => obj === page ? page : null
    },
    getObjectBoundingRect: (_view, adapter) => adapter.rect,
    isLVGLWidgetOutsideOfItsPageBounds: adapter => !!adapter.object.outside,
    DRAGGABLE_OVERLAY_ELEMENT_ID: "drag-overlay"
};
scope.document = {
    querySelector: () => null,
    getElementById: () => null,
    elementsFromPoint: () => scope.hits
};
vm.runInNewContext(
    stripTypeScriptTypes(source.slice(begin,end).replace("export function","function"), {mode:"transform"}) +
    "\nmodule.exports = getObjectIdFromPoint;", scope
);
const getHit = scope.module.exports;
const state = {
    containerId: "canvas",
    projectStore: {
        projectTypeTraits: { isLVGL: true },
        runtime: undefined
    },
    transform: { pageToClientPoint: p => p }
};
function domHit(id) {
    const node = {
        classList: { contains: () => false },
        getAttribute: key => key === "data-eez-flow-object-id" ? id : null
    };
    return { closest: key => key === "[data-eez-flow-object-id]" ? node : null };
}
function click(x,y,ids) {
    scope.hits = ids.map(domHit);
    return getHit(fakeDocument,state,{x,y})?.id;
}
// Parent DOM is hit despite a visible deeply nested child.
assert.equal(click(64,60,["panel"]), "badge",
    "Three-level nested widget should be selected directly");
// If frontmost child misses the pointer, continue to the next child.
assert.equal(click(150,75,["panel"]), "button",
    "Topmost overlapping child wins over earlier siblings");
assert.equal(click(55,52,["panel"]), "button",
    "Button above Label should be selected when both overlap");
assert.equal(click(30,30,["panel"]), "panel",
    "Clicking empty space in container retains parent selection");
// Child hidden in editor should not steal clicks.
widgets.badge.hiddenInEditor = true;
assert.equal(click(64,60,["panel"]), "button",
    "Hidden child is not selectable geometrically");
widgets.badge.hiddenInEditor = false;
// Screen canvas covers the DOM: geometric fallback should still discover widgets.
assert.equal(click(325,42,[]), "side",
    "Geometry resolves a child even when canvas hides all widget DOM nodes");
// Explicit direct DOM hits should still work as before.
assert.equal(click(64,60,["label","panel"]), "label",
    "Explicit DOM hit wins over inferred sibling ordering");
// Off-page widgets keep edit-only bounds rules.
widgets.badge.outside = true;
assert.equal(click(64,60,["panel"]), "button",
    "Out-of-page child is excluded by existing selection constraints");
widgets.badge.outside = false;
// Neither Run mode nor non-LVGL editor behavior should be altered.
state.projectStore.runtime = {};
assert.equal(click(64,60,["panel"]), "panel", "Run mode unaffected");
state.projectStore.runtime = undefined;
state.projectStore.projectTypeTraits.isLVGL = false;
assert.equal(click(64,60,["panel"]), "panel", "Non-LVGL unaffected");
console.log("LVGL deep hit test passed: nesting, z-order, hidden nodes, fallback, bounds, Run isolation.");
