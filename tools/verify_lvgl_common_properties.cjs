"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
class LVGLWidget {}
class ActionComponent {}
class Page {}
const ProjectEditor = {
    LVGLWidgetClass: LVGLWidget,
    ActionComponentClass: ActionComponent,
    PageClass: Page
};

function loadTypeScript(file, injected) {
    // Run the actual emitted JavaScript rather than an imitated grouping
    // function, because TypeScript 7 exposes only a CLI package interface.
    const emitted = path.join(root, "build", file.replace(/^packages\//, "").replace(/\.ts$/, ".js"));
    const transpiled = fs.readFileSync(emitted, "utf8");
    const exports = {};
    const sandbox = {
        module: { exports },
        exports,
        require(name) {
            if (name === "project-editor/project-editor-interface") {
                return { ProjectEditor };
            }
            if (injected[name]) return injected[name];
            throw new Error("Unmocked dependency: " + name);
        },
        localStorage: injected.localStorage,
        console
    };
    vm.runInNewContext(transpiled, sandbox, { filename: file });
    return sandbox.module.exports;
}

const store = {};
const localStorage = {
    getItem(key) { return store[key] ?? null; },
    setItem(key, val) { store[key] = val; }
};
const groups = loadTypeScript(
    "packages/project-editor/ui-components/PropertyGrid/groups.ts",
    { localStorage }
);
const collapse = loadTypeScript(
    "packages/project-editor/ui-components/PropertyGrid/GroupCollapsedStore.ts",
    { mobx: require("mobx"), localStorage }
).groupCollapsedStore;

function property(name, group) {
    return { name, propertyGridGroup: group, readOnlyInPropertyGrid: false };
}
const properties = [
    property("identifier", groups.generalGroup),
    property("codeIdentifier", groups.generalGroup),
    property("text", groups.specificGroup),
    property("textType", groups.specificGroup),
    property("longMode", groups.specificGroup),
    property("recolor", groups.specificGroup),
    property("geometryProperties", groups.geometryGroup),
    property("absolutePosition", groups.geometryGroup),
    property("useStyle", groups.styleGroup),
    property("localStyles", groups.styleGroup),
    property("widgetFlags", { id: "flags", title: "Flags" }),
    property("hiddenFlag", { id: "flags", title: "Flags" }),
    property("checkedState", { id: "states", title: "States" }),
    property("eventHandlers", groups.flowGroup)
];

const beforeMetadata = properties.map(p => ({ ...p }));
const selected = groups.getPropertyGroups(new LVGLWidget(), properties);
assert.deepEqual(Array.from(selected, g => g.group.title), [
    "Common Properties", "Advanced Settings"
]);
const common = selected[0].properties.map(p => p.name);
const advanced = selected[1].properties.map(p => p.name);
for (const name of ["identifier", "geometryProperties", "text", "textType",
    "useStyle", "localStyles", "hiddenFlag"]) {
    assert(common.includes(name), name + " must stay visible by default");
}
for (const name of ["codeIdentifier", "absolutePosition", "widgetFlags",
    "checkedState", "eventHandlers", "longMode", "recolor"]) {
    assert(advanced.includes(name), name + " must be editable in Advanced Settings");
}
assert.equal(new Set(common.concat(advanced)).size, properties.length);
assert(
    properties.every(p => selected.some(g => g.properties.includes(p))),
    "All original PropertyInfo object references must survive regrouping"
);
assert.deepEqual(properties.map(p => ({...p})),beforeMetadata,
    "Regrouping must not mutate property schemas / read-only rules");
assert.equal(collapse.isCollapsed(selected[0].group), false);
assert.equal(collapse.isCollapsed(selected[1].group), true,
    "Advanced Settings should be collapsed on first use");
collapse.toggleColapsed(selected[1].group);
assert.equal(collapse.isCollapsed(selected[1].group), false);
assert.equal(JSON.parse(store.GroupCollapsedStore)["lvgl-widget-advanced"], false);
collapse.toggleColapsed(selected[1].group);
assert.equal(collapse.isCollapsed(selected[1].group), true);

const ordinary = groups.getPropertyGroups({}, properties);
assert(ordinary.some(group => group.group.title === "Specific"),
    "Non-LVGL objects retain the original grouped layout");
assert(ordinary.some(group => group.group.title === "Style"));
assert(ordinary.some(group => group.group.title === "Flags"));

const custom = groups.getPropertyGroups(new LVGLWidget(), [
    property("customWidgetMainValue", groups.specificGroup),
    property("someAdvancedOption", groups.specificGroup)
]);
assert(custom[0].properties.map(x=>x.name).includes("customWidgetMainValue"),
    "Unknown LVGL widget still surfaces its primary property");
assert(!custom.some(x=>x.group.id === "lvgl-widget-advanced"),
    "Do not render an empty advanced panel");
console.log("LVGL Widget Properties passed: common/advanced split, all metadata preserved, collapse persistence, non-LVGL unaffected.");
