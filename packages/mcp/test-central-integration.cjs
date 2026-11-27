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
let allowed = false, online = true, loggedIn = true, generation = 1, userId = "321";
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
            accessMode: allowed ? "selected_users" : "disabled",
            localConfirmationRequired: false,
            globalPolicyRevision: 1, accountPolicyRevision: 4
        };
    },
    async connectMcp(token, input) {
        calls.push({name: "connect", token, input});
        if (!online) throw new Error("offline");
        if (!allowed) throw Object.assign(new Error("denied"), {status: 403, code: "ACCESS_DENIED"});
        assert.equal(input.registryVersion, "mcp-2026-11-27-implementation-edit");
        assert.match(input.clientSessionId, /^[A-Za-z0-9_-]{16,128}$/);
        return {
            connected: true, requestId: crypto.randomUUID(),
            clientSessionId: input.clientSessionId,
            registryVersion: input.registryVersion,
            accessMode: "selected_users",
            globalPolicyRevision: 1, accountPolicyRevision: 4,
            localConfirmationRequired: false, silentExecution: true
        };
    },
    async disconnectMcp(token, input) {
        calls.push({name: "disconnect", token, input});
        if (!online) throw new Error("offline");
        return {
            disconnected: true, requestId: crypto.randomUUID(),
            clientSessionId: input.clientSessionId, revokedDecisions: 1
        };
    },
    async authorizeSimpleMcp(token, input) {
        calls.push({name: "authorize", token, input});
        if (!online) throw new Error("offline");
        if (!allowed) throw Object.assign(new Error("denied"), {status: 403, code: "ACCESS_DENIED"});
        assert.equal(input.registryVersion, "mcp-2026-11-27-implementation-edit");
        assert.match(input.parameterDigest, /^[0-9a-f]{64}$/);
        const riskGroup = input.tool === "start_project_build" ? "build.run" :
            input.tool === "add_widget" ? "project.edit" : "project.view";
        return {
            authorized: true, requestId: crypto.randomUUID(),
            decisionId: crypto.randomUUID(), tool: input.tool,
            registryVersion: input.registryVersion,
            clientSessionId: input.clientSessionId, parameterDigest: input.parameterDigest,
            riskGroup, globalPolicyRevision: 1, accountPolicyRevision: 4,
            localConfirmationRequired: false, silentExecution: true,
            expiresAt: new Date(Date.now() + 4000).toISOString()
        };
    },
    async auditSimpleMcp(token, input) {
        calls.push({name: "audit", token, input});
        if (!online) throw new Error("offline");
        return {recorded: true, localConfirmation: input.localConfirmation || "not_required"};
    }
};
const original = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "electron") return electron;
    if (request === "./main-server") return {
        startMcpServer: async (_window, policy, sessionId) => {
            assert.ok(policy);
            assert.match(sessionId, /^[A-Za-z0-9_-]{16,128}$/);
            startCount++;
            starts.push({policy, sessionId});
            serverRunning = true;
            return true;
        },
        stopMcpServer: () => { stopCount++; serverRunning = false; },
        isMcpServerRunning: () => serverRunning
    };
    if (request === "./codex-import") return {addDigiStudioToCodex: () => ({installed: true})};
    if (request === "main/digiwise-auth") return {
        getDigiwiseAuthGuard: () => ({
            authenticated: loggedIn, userId: loggedIn ? userId : null, generation
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

    // Unauthorized account: hidden/disallowed and cannot connect.
    assert.deepEqual(await status(event), {enabled: false, allowed: false});
    await assert.rejects(toggle(event, true), /not been authorized/);
    assert.equal(startCount, 0);
    assert.equal(calls.some(x => x.name === "connect"), false);

    // Authorization grants eligibility only; never auto-connects.
    allowed = true;
    assert.deepEqual(await status(event), {enabled: false, allowed: true});
    assert.equal(startCount, 0);

    // Explicit user connect calls /connect and starts local bridge with same sessionId.
    assert.deepEqual(await toggle(event, true), {enabled: true, allowed: true});
    assert.equal(startCount, 1);
    assert.equal(calls.filter(x => x.name === "connect").length, 1);
    const {policy, sessionId} = starts[0];
    assert.equal(calls.find(x => x.name === "connect").input.clientSessionId, sessionId);
    assert.equal((await status(event)).enabled, true);

    // Online per-call authorization and silent-write audit upload.
    await policy.authorizeDiscovery();
    const projectPath = path.join(dir, "Demo.eez-project");
    const digest = "f".repeat(64);
    const grant = await policy.authorizeProjectTool(projectPath, "add_widget", digest, sessionId);
    assert.equal(grant.bindingId, "account:321");
    assert.equal(grant.modelId, 0);
    assert.equal(grant.riskGroup, "project.edit");
    assert.equal(grant.accountGeneration, generation);
    assert.equal(grant.localConfirmationRequired, false);
    assert.equal(grant.silentExecution, true);
    assert.equal(calls.filter(x => x.name === "authorize").length, 1);

    await policy.auditExecution({
        tool: "add_widget", decisionId: grant.decisionId, requestId: grant.requestId,
        bindingId: grant.bindingId, clientSessionId: sessionId,
        parameterDigest: digest, localConfirmation: "not_required",
        executionResult: "succeeded", durationMs: 12
    });
    const auditCall = calls.find(x => x.name === "audit");
    assert.ok(auditCall, "Execution audit must be uploaded to /audit-simple");
    assert.equal(auditCall.input.localConfirmation, "not_required");
    assert.equal(auditCall.input.decisionId, grant.decisionId);
    assert.equal(auditCall.input.executionResult, "succeeded");

    // Every tool call verifies online with Java (no cached positive decision).
    const authBefore = calls.filter(x => x.name === "authorize").length;
    await policy.authorizeProjectTool(projectPath, "add_widget", digest, sessionId);
    await policy.authorizeProjectTool(projectPath, "list_pages", digest, sessionId);
    assert.equal(calls.filter(x => x.name === "authorize").length, authBefore + 2,
        "Each tool call must call /authorize-simple online");

    // Offline fails closed immediately and never replays.
    online = false;
    await assert.rejects(
        policy.authorizeProjectTool(projectPath, "start_project_build", digest, sessionId),
        e => e.code === "MCP_POLICY_UNAVAILABLE"
    );
    await assert.rejects(policy.authorizeDiscovery(), e => e.code === "MCP_POLICY_UNAVAILABLE");

    // Server revocation immediately rejects new calls and stops local MCP server.
    online = true;
    allowed = false;
    await assert.rejects(
        policy.authorizeProjectTool(projectPath, "add_widget", digest, sessionId),
        e => e.code === "ACCESS_DENIED"
    );
    assert.equal(serverRunning, false);
    assert.deepEqual(await status(event), {enabled: false, allowed: false});

    // Offline cannot connect.
    online = false;
    await assert.rejects(toggle(event, true));

    // Re-connect and explicitly disconnect via toggle(false) -> calls /disconnect.
    online = true;
    allowed = true;
    await toggle(event, true);
    assert.equal(serverRunning, true);
    const disconnectBefore = calls.filter(x => x.name === "disconnect").length;
    assert.deepEqual(await toggle(event, false), {enabled: false, allowed: true});
    assert.equal(serverRunning, false);
    assert.equal(calls.filter(x => x.name === "disconnect").length, disconnectBefore + 1);

    // Account A -> Account B switch immediately disconnects and does not inherit A's session.
    await toggle(event, true);
    const sessionA = starts[starts.length - 1];
    assert.equal(serverRunning, true);
    userId = "999";
    generation++;
    authListener();
    assert.equal(serverRunning, false);
    assert.ok(notifications.some(x => x[0] === "digistudio:mcp:policy-changed"));
    await assert.rejects(
        sessionA.policy.authorizeProjectTool(projectPath, "add_widget", digest, sessionA.sessionId),
        e => e.code === "AUTH_REQUIRED"
    );
    // Even though Account B is authorized, it must start disconnected (no inherited connection).
    assert.deepEqual(await status(event), {enabled: false, allowed: true});

    // Logout disconnects immediately.
    await toggle(event, true);
    loggedIn = false; generation++;
    authListener();
    assert.equal(serverRunning, false);
    assert.deepEqual(await status(event), {enabled: false, allowed: false});
    assert.ok(calls.every(x => x.token === "ide_MAIN_ONLY"));

    window.webContents.emit("destroyed");
    assert.equal(ipcMain.handlers.size, 0);
    console.log("PASS: MCP-02/03 connect/disconnect, no auto-connect, per-call online authorize-simple, silent audit, offline fail-closed, revoke and account switch");
})().catch(e => {console.error(e.stack || e); process.exitCode = 1;}).finally(() => {
    Module._load = original;
    rmSync(dir, {recursive: true, force: true});
});
