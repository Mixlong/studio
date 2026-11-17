/* Compiled Main + backend entitlement integration; no real project or account data. */
const assert = require("node:assert/strict");
const Module = require("node:module");
const {EventEmitter} = require("node:events");
const {mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const dir = mkdtempSync(path.join(tmpdir(), "mcp-simple-account-"));
const modulePath = path.resolve(__dirname, "../../build/mcp/integration.js");
const ipcMain = {
    handlers: new Map(),
    handle(name, listener) {this.handlers.set(name, listener);},
    removeHandler(name) {this.handlers.delete(name);}
};
let allowed = false, online = true, loggedIn = true, generation = 1;
let serverRunning = false, startCount = 0, stopCount = 0;
let authListener;
const calls = [], notifications = [], starts = [];
const electron = {
    app: {isPackaged: true, getPath: () => dir},
    ipcMain
};
const api = {
    async getMcpPolicy(token) {
        calls.push({name: "policy", token});
        if (!online) throw new Error("offline");
        return {
            authorized: allowed, globalEnabled: false, accountEnabled: allowed,
            globalPolicyRevision: 1, accountPolicyRevision: 4
        };
    },
    async authorizeSimpleMcp(token, input) {
        calls.push({name: "authorize", token, input});
        if (!allowed || !online) throw new Error("denied");
        assert.equal(input.registryVersion, "mcp-2026-11-13-r19w37-central-stage");
        assert.match(input.parameterDigest, /^[0-9a-f]{64}$/);
        const riskGroup = input.tool === "start_project_build" ? "build.run" :
            input.tool === "add_widget" ? "project.edit" : "project.view";
        return {
            authorized: true, tool: input.tool, registryVersion: input.registryVersion,
            clientSessionId: input.clientSessionId, parameterDigest: input.parameterDigest,
            decisionId: crypto.randomUUID(), riskGroup, globalPolicyRevision: 1,
            accountPolicyRevision: 4, expiresAt: new Date(Date.now() + 4000).toISOString()
        };
    },
    async auditSimpleMcp(token, input) {
        calls.push({name: "audit", token, input});
        return {recorded: true};
    }
};
const original = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "electron") return electron;
    if (request === "./main-server") return {
        startMcpServer: async (_window, policy) => {
            assert.ok(policy);
            startCount++;
            starts.push(policy);
            serverRunning = true;
            return true;
        },
        stopMcpServer: () => { stopCount++; serverRunning = false; },
        isMcpServerRunning: () => serverRunning
    };
    if (request === "./codex-import") return {addDigiStudioToCodex: () => ({installed: true})};
    if (request === "main/digiwise-auth") return {
        getDigiwiseAuthGuard: () => ({
            authenticated: loggedIn, userId: loggedIn ? "321" : null, generation
        }),
        callDigiwisePublicApiWithSession: async invoke => {
            if (!loggedIn) return {ok: false, error: new Error("signed out")};
            try {return {ok: true, data: await invoke(api, "ide_MAIN_ONLY")};}
            catch (error) {return {ok: false, error};}
        },
        onDigiwiseAuthSessionChanged: listener => {
            authListener = listener;
            return () => {authListener = undefined;};
        }
    };
    return original.apply(this, arguments);
};
(async () => {
    const {registerMcpIntegration} = require(modulePath);
    const window = new EventEmitter();
    window.isDestroyed = () => false;
    window.webContents = new EventEmitter();
    window.webContents.mainFrame = {id: 1};
    window.webContents.isDestroyed = () => false;
    window.webContents.send = (...args) => notifications.push(args);
    await registerMcpIntegration(window);
    const event = {sender: window.webContents, senderFrame: window.webContents.mainFrame};
    const status = ipcMain.handlers.get("digistudio:mcp:status");
    const toggle = ipcMain.handlers.get("digistudio:mcp:toggle");
    assert.ok(status && toggle);
    assert.equal(ipcMain.handlers.has("digistudio:mcp:create-bound-project"), false,
        "Simple mode must not require the model-bound provisioning wizard");
    assert.deepEqual(await status(event), {enabled: false, allowed: false});
    await assert.rejects(toggle(event, true), /not been authorized/);
    assert.equal(startCount, 0);
    allowed = true;
    assert.deepEqual(await status(event), {enabled: false, allowed: true});
    assert.deepEqual(await toggle(event, true), {enabled: true, allowed: true});
    assert.equal(startCount, 1);
    assert.equal((await status(event)).enabled, true);

    // The actual Main policy is captured via startMcpServer mock. Use a
    // second captured setter to verify online checks, not just status flags.
    const policy = starts[0];
    await policy.authorizeDiscovery();
    const projectPath = path.join(dir, "Demo.eez-project");
    const digest = "f".repeat(64);
    const sessionId = "abcDEF1234567890";
    const grant = await policy.authorizeProjectTool(projectPath, "add_widget", digest, sessionId);
    assert.equal(grant.bindingId, "account:321");
    assert.equal(grant.modelId, 0);
    assert.equal(grant.riskGroup, "project.edit");
    assert.equal(grant.accountGeneration, generation);
    await policy.auditExecution({
        tool: "add_widget", decisionId: grant.decisionId, requestId: grant.requestId,
        bindingId: grant.bindingId, clientSessionId: sessionId,
        parameterDigest: digest, localConfirmation: "confirmed",
        executionResult: "succeeded"
    });
    assert.equal(calls.some(x => x.name === "audit"), false,
        "Local MCP execution summaries must not upload to Java");
    const callCount = calls.length;
    await policy.authorizeProjectTool(projectPath, "add_widget", digest, sessionId);
    await policy.authorizeProjectTool(projectPath, "list_pages", digest, sessionId);
    await policy.authorizeDiscovery();
    assert.equal(calls.length, callCount,
        "Already authorized IDE operations must not call Java per tool");

    // The temporary in-memory grant survives a network outage; never persists to disk.
    online = false;
    await policy.authorizeProjectTool(projectPath, "start_project_build", digest, sessionId);
    await policy.authorizeDiscovery();
    online = true;
    allowed = false;
    await policy.authorizeProjectTool(projectPath, "add_widget", digest, sessionId);
    assert.deepEqual(await status(event), {enabled: false, allowed: false});
    assert.equal(serverRunning, false);
    await assert.rejects(policy.authorizeProjectTool(projectPath, "add_widget", digest, sessionId));
    online = false;
    await assert.rejects(toggle(event, true));
    online = true;
    allowed = true;
    await toggle(event, true);
    loggedIn = false; generation++;
    authListener();
    assert.equal(serverRunning, false);
    assert.ok(notifications.some(x => x[0] === "digistudio:mcp:policy-changed"));
    assert.deepEqual(await status(event), {enabled: false, allowed: false});
    assert.ok(calls.every(x => x.token === "ide_MAIN_ONLY"));
    window.webContents.emit("destroyed");
    assert.equal(ipcMain.handlers.size, 0);
    console.log("PASS: account/global MCP grants, start-time Java check, in-memory tool permission, revoke on refresh, logout");
})().catch(e => {console.error(e.stack || e); process.exitCode = 1;}).finally(() => {
    Module._load = original;
    rmSync(dir, {recursive: true, force: true});
});
