"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
    path.join(root, "packages/project-editor/features/embedded-platform/workspace-navigation.ts"),
    "utf8"
);
const transpiled = stripTypeScriptTypes(source, { mode: "transform" })
    .replace(/^export (function|const) /gm, "$1 ");
const context = { module: { exports: {} } };
vm.runInNewContext(
    transpiled + "\nmodule.exports = { getEmbeddedWorkspaceItems, getActiveEmbeddedWorkspace };",
    context
);
const { getEmbeddedWorkspaceItems, getActiveEmbeddedWorkspace } =
    context.module.exports;
const ids = (remote, advanced) =>
    Array.from(getEmbeddedWorkspaceItems(remote, advanced), item => item.id);

assert.deepStrictEqual(
    ids(true, false),
    ["connection", "components"],
    "Remote mode initially shows only Connection and Components"
);
assert.deepStrictEqual(
    ids(true, true),
    ["connection", "components", "target", "protocols", "resources"],
    "Advanced Settings reveals the original local tools"
);
assert.deepStrictEqual(
    ids(false, false),
    ["target", "protocols", "resources", "connection", "components"],
    "Local mode preserves all original navigation entries"
);
assert.deepStrictEqual(ids(false, true), ids(false, false));
assert.equal(getActiveEmbeddedWorkspace("", true, false), "connection");
assert.equal(getActiveEmbeddedWorkspace("", false, false), "target");
assert.equal(getActiveEmbeddedWorkspace("protocols", false, false), "protocols");
assert.equal(getActiveEmbeddedWorkspace("protocols", true, false), "connection");
assert.equal(getActiveEmbeddedWorkspace("protocols", true, true), "protocols");
assert.equal(getActiveEmbeddedWorkspace("components", true, false), "components");
assert.equal(getActiveEmbeddedWorkspace("invalid", true, false), "connection");

// Verify render follows the same *effective* selection rather than rendering
// an advanced workspace which has become hidden after switching to remote.
const view = fs.readFileSync(
    path.join(root, "packages/project-editor/features/embedded-platform/EmbeddedPlatformTab.tsx"),
    "utf8"
);
assert(view.includes("this.renderConfiguration(platform, selectedWorkspace)"));
assert(view.includes("aria-expanded={this.advancedWorkspacesExpanded}"));
assert(view.includes("advancedWorkspacesExpanded: observable"));
assert(view.includes("const remoteMode = platform.websocket?.enabled === true"));
assert(view.includes("this.renderWorkspaceButton("));

console.log("Embedded Platform navigation verified: remote default, advanced disclosure, local fallback, live mode switching.");
