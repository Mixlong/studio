/* Codex config importer must never overwrite unrelated MCP entries. */
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const assert = require("node:assert/strict");
const toml = require("@iarna/toml");

const dir = mkdtempSync(path.join(tmpdir(), "digistudio-codex-test-"));
const configDir = path.join(dir, "codex");
const dataDir = path.join(dir, "appdata");
mkdirSync(configDir);
mkdirSync(dataDir);
process.env.CODEX_HOME = configDir;

const oldLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === "electron") {
        return {
            app: {
                getAppPath: () => path.resolve(__dirname, "../.."),
                getPath: () => dataDir
            }
        };
    }
    return oldLoad.apply(this, arguments);
};
let addDigiStudioToCodex;
try {
    ({ addDigiStudioToCodex } = require(path.join(__dirname, "..", "..", "build", "mcp", "codex-import.js")));
} finally {
    Module._load = oldLoad;
}
const configPath = path.join(configDir, "config.toml");
try {
    const preexisting = '# IMPORTANT: keep existing config comments\n'
      + 'model = "gpt-6"\n\n'
      + '[mcp_servers.other_tool]\n'
      + 'command = "other-server"\n'
      + 'args = ["--read-only"]\n';
    writeFileSync(configPath, preexisting);
    const first = addDigiStudioToCodex();
    assert.equal(first.alreadyInstalled, false);
    const after = readFileSync(configPath, "utf8");
    assert.ok(after.startsWith(preexisting), "Other configurations must be byte-for-byte preserved");
    const parsed = toml.parse(after);
    assert.equal(parsed.mcp_servers.other_tool.command, "other-server");
    assert.equal(parsed.mcp_servers.digistudio.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(parsed.mcp_servers.digistudio.env.DIGISTUDIO_MCP_SESSION_FILE,
        path.join(dataDir, "mcp-session.json"));
    assert.equal(parsed.mcp_servers.digistudio.args.length, 1);
    assert.equal(parsed.mcp_servers.digistudio.tool_timeout_sec, 200);
    assert.ok(parsed.mcp_servers.digistudio.args[0].endsWith(
        path.join("build", "mcp", "stdio-cli.mjs")));

    const second = addDigiStudioToCodex();
    assert.equal(second.alreadyInstalled, true);
    assert.equal(readFileSync(configPath, "utf8"), after, "Repeat must not change config");
    assert.ok(readdirSync(configDir).some(name => name.includes("digistudio-backup")));

    const legacy = after.replace(/^tool_timeout_sec = 200\r?\n/m, "");
    if (legacy === after) throw new Error("Could not build old Codex fixture");
    writeFileSync(configPath, legacy);
    const upgrade = addDigiStudioToCodex();
    assert.equal(upgrade.alreadyInstalled, false);
    assert.ok(readFileSync(configPath, "utf8").startsWith(preexisting));
    assert.equal(toml.parse(readFileSync(configPath, "utf8"))
        .mcp_servers.digistudio.tool_timeout_sec, 200);

    // An owned registration with an outdated timeout must be upgraded.
    const outdated = readFileSync(configPath, "utf8")
        .replace(/^tool_timeout_sec = 200\r?\n/m, "tool_timeout_sec = 130\n");
    writeFileSync(configPath, outdated);
    const timeoutUpgrade = addDigiStudioToCodex();
    assert.equal(timeoutUpgrade.alreadyInstalled, false);
    assert.equal(toml.parse(readFileSync(configPath, "utf8"))
        .mcp_servers.digistudio.tool_timeout_sec, 200);

    // Users who previously imported the developer Electron path can upgrade
    // to the packaged application without replacing any other MCP entries.
    const previousEntry = {
        ...parsed.mcp_servers.digistudio,
        command: "C:\\OldDigiStudio\\DigiwiseStudio.exe",
        args: ["C:\\OldDigiStudio\\build\\mcp\\stdio-cli.mjs"]
    };
    const priorInstallConfig = preexisting + "\n" +
        toml.stringify({ mcp_servers: { digistudio: previousEntry } });
    writeFileSync(configPath, priorInstallConfig);
    const migrated = addDigiStudioToCodex();
    assert.equal(migrated.alreadyInstalled, false);
    const newInstall = toml.parse(readFileSync(configPath, "utf8"));
    assert.equal(newInstall.mcp_servers.digistudio.command, process.execPath);
    assert.equal(newInstall.mcp_servers.digistudio.args[0],
        parsed.mcp_servers.digistudio.args[0]);
    assert.equal(newInstall.mcp_servers.other_tool.command, "other-server");
    assert.ok(readFileSync(configPath, "utf8").startsWith(preexisting));

    const conflicting = after.replace('ELECTRON_RUN_AS_NODE = "1"', 'ELECTRON_RUN_AS_NODE = "0"');
    if (conflicting === after) throw new Error("Could not create conflicting fixture");
    writeFileSync(configPath, conflicting);
    assert.throws(() => addDigiStudioToCodex(), /different 'digistudio'/);
    assert.equal(readFileSync(configPath, "utf8"), conflicting, "Conflicting entry must be untouched");

    writeFileSync(configPath, "invalid ??? toml = [");
    assert.throws(() => addDigiStudioToCodex());
    assert.equal(readFileSync(configPath, "utf8"), "invalid ??? toml = [");
    process.stdout.write("PASS: one-click Codex import, preserves other config, idempotence, collision and invalid TOML\n");
} finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CODEX_HOME;
}
