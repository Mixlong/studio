"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");
const FlexLayout = require("flexlayout-react");

const root = path.resolve(__dirname, "..");
const projectText = fs.readFileSync(
    path.join(root, "packages/project-editor/project/project.tsx"),
    "utf8"
);
const start = projectText.indexOf(
    "    enableTabs(projectType?: ProjectType, flowSupport?: boolean) {"
);
const end = projectText.indexOf("\n    get missingExtensions()", start);
assert(start >= 0 && end > start, "Project.enableTabs not found");
const method = projectText.slice(start, end);
const context = {
    module: { exports: {} },
    FlexLayout,
    settingsController: { showComponentsPaletteInProjectEditor: false }
};
const ids = {
    CHANGES_TAB_ID: "changes",
    PROPERTIES_TAB_ID: "PROPERTIES",
    COMPONENTS_PALETTE_TAB_ID: "COMPONENTS_PALETTE"
};
context.LayoutModels = new Proxy(ids, {
    get(object, key) {
        if (key in object) return object[key];
        if (typeof key !== "string") return undefined;
        if (key.endsWith("_TAB_ID")) return key.slice(0, -7);
        if (key.endsWith("_TAB")) {
            return {
                type: "tab",
                name: key,
                component: key.toLowerCase(),
                id: context.LayoutModels[key + "_ID"]
            };
        }
    }
});

vm.runInNewContext(
    stripTypeScriptTypes(
        "class Harness {\n" + method + "\n}",
        { mode: "transform" }
    ) + "\nmodule.exports = Harness;",
    context
);
const Harness = context.module.exports;

function model(includeLegacyChanges) {
    return FlexLayout.Model.fromJson({
        global: { borderEnableAutoHide: true },
        borders: [
            {
                type: "border",
                location: "left",
                children: [
                    {
                        type: "tab",
                        id: "embedded-platform",
                        name: "Embedded Platform",
                        component: "embedded-platform"
                    },
                    ...(includeLegacyChanges ? [{
                        type: "tab",
                        id: "changes",
                        name: "Changes",
                        component: "changes"
                    }] : [])
                ]
            },
            { type: "border", location: "right", children: [] }
        ],
        layout: {
            type: "row",
            children: [{
                type: "tabset",
                children: [
                    {
                        type: "tab",
                        id: "PROPERTIES",
                        name: "Properties",
                        component: "properties"
                    },
                    {
                        type: "tab",
                        id: "COMPONENTS_PALETTE",
                        name: "Palette",
                        component: "palette"
                    }
                ]
            }]
        }
    });
}

for (const legacy of [true, false]) {
    const editor = model(legacy);
    const extensionEditor = model(legacy);
    const instance = new Harness();
    instance._store = {
        layoutModels: {
            rootEditor: editor,
            rootEditorForIEXT: extensionEditor
        }
    };
    instance.settings = { general: { projectType: 1 } };
    instance.projectTypeTraits = {
        hasFlowSupport: false,
        isIEXT: false,
        isLVGL: true,
        isFirmware: false,
        isFirmwareModule: false
    };
    // Test project initialization as well as later page/tab changes.
    for (let i = 0; i < 4; i++) instance.enableTabs();
    for (const candidate of [editor, extensionEditor]) {
        assert.strictEqual(
            candidate.getNodeById("changes"),
            undefined,
            "Legacy docked Changes tab must never be reintroduced"
        );
        assert(
            candidate.getNodeById("embedded-platform"),
            "Other saved layout tabs must be preserved"
        );
    }
}

const popoverText = fs.readFileSync(
    path.join(root, "packages/project-editor/features/changes/ChangesPopover.tsx"),
    "utf8"
);
assert(
    popoverText.includes("View full diff") &&
    popoverText.includes("store.editorsStore.openEditor(store.project.changes"),
    "Full diff editor must remain accessible from the new toolbar popover"
);

console.log(
    "Changes entry point verified: old dock removed on repeat enableTabs, " +
    "other layout tabs kept, full diff available on demand."
);
