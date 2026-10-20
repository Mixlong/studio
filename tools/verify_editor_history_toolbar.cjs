"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const toolbar = fs.readFileSync(
    path.join(root, "packages/project-editor/project/ui/Toolbar.tsx"),
    "utf8"
);
const styles = fs.readFileSync(
    path.join(root, "packages/eez-studio-ui/_stylesheets/project-editor.less"),
    "utf8"
);

const primaryStart = toolbar.indexOf("const PrimaryEditActions = observer(");
const secondaryStart = toolbar.indexOf("const EditorButtons = observer(");
assert(primaryStart > 0 && secondaryStart > primaryStart);
const primary = toolbar.slice(primaryStart, secondaryStart);
const secondary = toolbar.slice(secondaryStart);
for (const icon of ["material:save", "material:undo", "material:redo"]) {
    assert.equal(primary.split('icon="' + icon + '"').length - 1, 1,
        "Expected one primary history action: " + icon);
    assert(!secondary.includes('icon="' + icon + '"'),
        "No duplicated actions in clipped secondary toolbar: " + icon);
}
assert(toolbar.includes(
    "{showEditorButtons && !this.context.runtime && (\n                            <PrimaryEditActions />"),
    "Primary actions must be visible while editing and hidden in Run mode"
);
assert(primary.includes("enabled={history.canUndo}"));
assert(primary.includes("enabled={history.canRedo}"));
assert(primary.includes("enabled={store.isModified}"));
assert(styles.includes(
    ".EezStudio_ProjectEditor_ToolbarNav_PrimaryEditActions {"
));
assert(styles.includes("flex: 0 0 auto;"),
    "Primary actions must not shrink");
assert(styles.includes("@media (max-width: 1300px)"),
    "At narrower widths project title should yield space for commands");
console.log("History toolbar visibility regression passed: Save/Undo/Redo are unique, prioritized and state-controlled.");
