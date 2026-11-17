const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveActivePageName } = require(path.resolve(__dirname, "../../build/mcp/adapter/active-page.js"));
const pageA = { name: "Dashboard" };
const pageB = { name: "Settings" };
const store = {
    project: { pages: [pageA, pageB] },
    editorModeEditorsStore: { activeEditor: { object: pageB } }
};
assert.equal(resolveActivePageName(store), "Settings");
store.editorModeEditorsStore.activeEditor.object = { name: "Settings" };
assert.throws(() => resolveActivePageName(store), error => error.code === "NO_ACTIVE_PAGE");
store.editorModeEditorsStore.activeEditor = undefined;
assert.throws(() => resolveActivePageName(store), error => error.code === "NO_ACTIVE_PAGE");
store.editorModeEditorsStore.activeEditor = { object: pageA };
assert.equal(resolveActivePageName(store), "Dashboard");
console.log("PASS: active canvas page resolution, stale object rejection and no-first-page fallback");
