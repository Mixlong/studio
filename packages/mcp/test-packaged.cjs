/* Test the bundled Electron MCP entry, not the developer Electron. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { existsSync, readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");

if (process.platform !== "win32") {
    console.log("SKIP: Windows packaged MCP test requires Windows");
    process.exit(0);
}

const root = path.resolve(__dirname, "../..");
const base = path.join(root, "dist", "win-unpacked");
const exe = path.join(base, "DigiwiseStudio.exe");
const archive = path.join(base, "resources", "app.asar");
const script = path.join(archive, "build", "mcp", "stdio-cli.mjs");
assert.ok(existsSync(exe), "Run npm run pack to build DigiwiseStudio.exe first");
assert.ok(existsSync(archive), "Missing packaged Electron app.asar");
const contents = new Set(asar.listPackage(archive).map(
    value => value.split("\\").join("/").replace(/^\/+/, "")
));
for (const entry of [
    "build/mcp/stdio-cli.mjs",
    "build/mcp/bridge-client.mjs",
    "build/mcp/adapter/write-tools.js",
    "build/mcp/adapter/property-schema.js",
    "build/mcp/adapter/undo-ownership.js",
    "build/mcp/approval-dialog.js",
    "build/mcp/approval-view.js",
    "build/mcp/approval-preload.js",
    "build/mcp/project-binding-store.js",
    "build/mcp/central-authorization.js",
    "build/mcp/create-project.js",
    "node_modules/@modelcontextprotocol/server/package.json",
    "node_modules/zod/package.json"
]) {
    assert.ok(contents.has(entry), "Packaged resource missing " + entry);
}

// Fail closed on an ASAR that passes path-existence checks but contains
// shifted/corrupted bytes. An earlier Windows pack transiently mixed adjacent
// compiled modules into the stdio entry, making all MCP clients fail to start.
for (const relative of [
    "build/mcp/stdio-cli.mjs", "build/mcp/bridge-client.mjs",
    "build/mcp/protocol.js", "build/mcp/renderer-agent.js",
    "build/mcp/approval-dialog.js", "build/mcp/approval-view.js",
    "build/mcp/approval-preload.js",
    "build/mcp/project-binding-store.js",
    "build/mcp/central-authorization.js",
    "build/mcp/adapter/preview-interaction.js"
]) {
    const sourceFile = path.join(root, ...relative.split("/"));
    assert.ok(existsSync(sourceFile), "Missing compiled source for packaged byte check: " + relative);
    const expected = readFileSync(sourceFile);
    const actual = asar.extractFile(archive, relative.split("/").join(path.sep));
    assert.equal(Buffer.compare(actual, expected), 0,
        "ASAR content differs from compiled MCP file (possible pack race/corruption): " + relative);
}

assert.ok(existsSync(path.join(base, "resources", "project-templates",
    "templates", "v0.23.0", "LVGL-8.3.eez-project")),
    "Bundled LVGL template missing from release");

const result = spawnSync(process.execPath,
    [path.join(__dirname, "test-stdio.cjs")], {
        cwd: root,
        encoding: "utf8",
        timeout: 40000,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            DIGISTUDIO_MCP_TEST_EXECUTABLE: exe,
            DIGISTUDIO_MCP_TEST_SCRIPT: script
        }
    }
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert.equal(result.status, 0, "Packaged DigiwiseStudio.exe MCP protocol failed");
console.log("PASS: Windows ASAR dependencies + packaged executable MCP tools");
