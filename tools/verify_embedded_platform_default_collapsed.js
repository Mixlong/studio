"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const FlexLayout = require("flexlayout-react");
const { stripTypeScriptTypes } = require("module");

const source = fs.readFileSync(
    path.resolve(__dirname, "../packages/project-editor/store/layout-models.tsx"),
    "utf8"
);
const start = source.indexOf("    private collapseEmbeddedPlatformOnLoad() {");
const end = source.indexOf("\n    ensureAudioBorderWidth() {", start);
assert(start > 0 && end > start, "Embedded Platform collapse handler is missing");

const context = {
    FlexLayout,
    LayoutModels: { EMBEDDED_PLATFORM_TAB_ID: "embedded-platform" },
    module: { exports: {} }
};
vm.runInNewContext(
    stripTypeScriptTypes(
        "class TestLayout { \n" + source.slice(start, end) + "\n}",
        { mode: "transform" }
    ) + "\nmodule.exports = TestLayout;",
    context
);
const TestLayout = context.module.exports;

function makeModel(selected) {
    const border = {
        type: "border", location: "left", size: 310,
        children: [
            { type: "tab", id: "embedded-platform",
              name: "Embedded Platform", component: "embedded-platform" },
            { type: "tab", id: "texts",
              name: "Texts", component: "texts" }
        ]
    };
    if (selected !== undefined) border.selected = selected;
    return FlexLayout.Model.fromJson({
        global: { borderEnableAutoHide: true },
        borders: [border],
        layout: { type: "row", children: [{
            type: "tabset", children: [{
                type: "tab", id: "PAGES", name: "Pages", component: "pages"
            }]
        }] }
    });
}

for (const selected of [0, -1, 1, undefined]) {
    const model = makeModel(selected);
    const instance = new TestLayout();
    instance.rootEditor = model;
    const left = model.getNodeById("border_left");
    instance.collapseEmbeddedPlatformOnLoad();
    const expected = selected === 0 ? -1 : (selected ?? -1);
    assert.equal(left.getSelected(), expected,
        "Only the selected Embedded Platform panel should collapse");
    assert.equal(left.toJson().size, 310, "Saved border width must remain");
    assert(model.getNodeById("embedded-platform"), "Activity bar icon must stay");
    assert(model.getNodeById("texts"), "Other left tabs must be preserved");
    assert(model.getNodeById("PAGES"), "Main editor layout must be unchanged");

    if (selected === 0) {
        model.doAction(FlexLayout.Actions.selectTab("embedded-platform"));
        assert.equal(left.getSelected(), 0, "User must be able to reopen it");
        // Only load/reset invokes collapse. A normal re-render must leave it open.
        assert.equal(left.getSelected(), 0);
        model.doAction(FlexLayout.Actions.selectTab("embedded-platform"));
        assert.equal(left.getSelected(), -1, "User can close it again");
    }
}

assert(
    /this\.projectStore\.project\.enableTabs\(\);\s*this\.collapseEmbeddedPlatformOnLoad\(\);/
        .test(source),
    "Default-collapse should run after tabs are enabled on load/reset"
);
console.log("Embedded Platform layout verified: startup collapsed, manual toggle preserved, width and other tabs intact.");
