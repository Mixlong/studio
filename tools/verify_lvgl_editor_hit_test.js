"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");

const source = fs.readFileSync(
    path.resolve(__dirname, "../packages/project-editor/flow/editor/bounding-rects.ts"),
    "utf8"
);
const start = source.indexOf("export function getObjectIdFromPoint(");
const end = source.indexOf("\nexport function getObjectIdsInsideRect(", start);
assert(start >= 0 && end > start, "Could not find canvas hit-test function");

const sourceFunction = source
    .slice(start, end)
    .replace("export function", "function");

class LVGLWidget {}
class LVGLTab extends LVGLWidget {}
const environment = {
    module: { exports: {} },
    ProjectEditor: {
        LVGLWidgetClass: LVGLWidget,
        LVGLTabWidgetClass: LVGLTab
    },
    DRAGGABLE_OVERLAY_ELEMENT_ID: "draggable-overlay",
    isLVGLWidgetOutsideOfItsPageBounds: () => false
};

environment.document = {
    querySelector: () => null,
    getElementById: () => null,
    elementsFromPoint: () => environment.hits
};

vm.runInNewContext(
    stripTypeScriptTypes(sourceFunction, { mode: "transform" }) +
        "\nmodule.exports = { getObjectIdFromPoint };",
    environment
);
const getObjectIdFromPoint = environment.module.exports.getObjectIdFromPoint;

function elementFor(id) {
    const node = {
        classList: { contains: () => false },
        getAttribute: () => id
    };
    return {
        closest: selector =>
            selector === "[data-eez-flow-object-id]" ? node : null
    };
}

const parent = { id: "container", object: new LVGLWidget(), selected: true };
const child = { id: "icon", object: new LVGLWidget(), selected: false };
const objects = new Map([
    [parent.id, parent],
    [child.id, child]
]);

const documentModel = { findObjectById: id => objects.get(id) };
const viewState = {
    containerId: "canvas",
    projectStore: { projectTypeTraits: { isLVGL: true } },
    transform: { pageToClientPoint: point => point }
};

function selectAt(ids) {
    environment.hits = ids.map(elementFor);
    return getObjectIdFromPoint(
        documentModel,
        viewState,
        { x: 10, y: 10 }
    )?.id;
}

assert.strictEqual(
    selectAt(["icon", "container"]),
    "icon",
    "A selected LVGL parent must not override a child under the pointer"
);
assert.strictEqual(
    selectAt(["container"]),
    "container",
    "An empty area within the LVGL container must select its parent"
);
child.selected = true;
assert.strictEqual(
    selectAt(["icon", "container"]),
    "icon",
    "Clicking an already selected LVGL child keeps the child"
);
child.selected = false;
viewState.projectStore.projectTypeTraits.isLVGL = false;
assert.strictEqual(
    selectAt(["icon", "container"]),
    "container",
    "Existing non-LVGL behavior must not change"
);

console.log("LVGL nested selection regression passed.");
