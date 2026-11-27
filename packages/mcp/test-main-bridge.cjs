
/* Full private bridge integration with real named-pipe/Unix socket,
 * mocked Electron main IPC and controlled user approval. No project writes.
 */
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const Module = require("node:module");
const net = require("node:net");
const { randomBytes, randomUUID } = require("node:crypto");

const dir = mkdtempSync(join(tmpdir(), "digi-mcp-ipc-"));
const boundProjectPath = "C:\\test\\safe.eez-project";
const ipcMain = new EventEmitter();
const app = new EventEmitter();
app.getPath = type => {
    if (type === "userData") return dir;
    throw new Error("Unknown app path " + type);
};
let approval = "deny";
let resolveApproval;
let prompts = 0;
let lastPrompt;
let locale = "en";
let projectCreates = 0;
let rendererWrites = 0;
let abortedApprovals = 0;
let authenticated = true;
let authGeneration = 1;
const showMcpApproval = async (_window, tool, args, isChinese, signal) => {
    prompts++;
    lastPrompt = {
        buttons: isChinese
            ? ["拒绝", "仅允许本次", "本次会话允许"]
            : ["Deny", "Allow once", "Allow for this session"],
        message: isChinese
            ? (tool === "create_project"
                ? "允许外部 AI 在指定路径创建独立工程吗？"
                : "允许外部 AI 修改当前工程吗？")
            : "External AI write approval",
        tool,
        args
    };
    if (signal.aborted) return 0;
    if (approval === "defer") {
        return new Promise(resolve => {
            resolveApproval = choice => resolve(choice);
            signal.addEventListener("abort", () => {
                abortedApprovals++;
                resolve(0);
            }, { once: true });
        });
    }
    return approval === "session" ? 2 : approval === "allow" ? 1 : 0;
};
const webContents = new EventEmitter();
webContents.mainFrame = { id: 1 };
webContents.isDestroyed = () => false;
webContents.isCrashed = () => false;
webContents.isLoadingMainFrame = () => false;
webContents.send = (channel, request) => {
    if (channel === "digi:mcp:renderer-probe") return;
    if (channel !== "digi:mcp:request") throw new Error("Unexpected channel");
    if (request.tool !== "get_current_project") rendererWrites++;
    setImmediate(() => ipcMain.emit("digi:mcp:response", {
        sender: webContents,
        senderFrame: webContents.mainFrame
    }, { id: request.id, ok: true, result: {
        tool: request.tool, accepted: true,
        ...(request.tool === "get_current_project" ? {path:boundProjectPath} : {})
    } }));
};
const win = new EventEmitter();
let visible = true;
win.webContents = webContents;
win.isDestroyed = () => false;
win.isVisible = () => visible;
const original = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "./create-project") return { createMcpProject: async args => {
        projectCreates++;
        return { created: true, projectPath: args.projectPath, openRequested: false };
    } };
    if (request === "main/digiwise-auth") return {
        getDigiwiseAuthGuard: () => ({authenticated, generation:authGeneration})
    };
    if (request === "main/settings") return {
        getLocale: () => locale,
        settings: { isDarkTheme: true }
    };
    if (request === "./approval-dialog") return { showMcpApproval };
    if (request === "electron") return { app, ipcMain };
    return original.apply(this, arguments);
};
let startMcpServer, stopMcpServer, isMcpWriteAllowed;
try {
    ({ startMcpServer, stopMcpServer, isMcpWriteAllowed } =
        require(join(__dirname, "../../build/mcp/main-server.js")));
} finally { Module._load = original; }

const policy = {
    authorizeDiscovery: async () => {},
    authorizeProjectTool: async (projectPath, tool, parameterDigest, clientSessionId) => {
        assert.equal(projectPath, boundProjectPath,
            "Main must derive path from actual renderer, not MCP args");
        assert.match(parameterDigest, /^[a-f0-9]{64}$/);
        return {
            bindingId: "trusted-binding", modelId: 350,
            accountGeneration: authGeneration,
            globalPolicyRevision: 1, accountPolicyRevision: 1,
            requestId: randomUUID(), decisionId: randomUUID(),
            clientSessionId, parameterDigest, projectFingerprint: "a".repeat(64),
            projectRevision: 1, riskGroup: tool === "start_project_build" ||
                tool === "start_project_check" ? "build.run" :
                tool === "create_page" ? "project.edit" : "project.view",
            expiresAt: new Date(Date.now() + 4000).toISOString()
        };
    },
    auditExecution: async () => {},
    afterAuthorizedSave: () => true
};

(async () => {
    const { callBridge } = await import("./bridge-client.mjs");
    const session = join(dir, "mcp-session.json");
    process.env.DIGISTUDIO_MCP_SESSION_FILE = session;
    const request = () => callBridge("create_page", {
        expectedProjectPath: "C:\\test\\safe.eez-project", name: "TestPage"
    });
    try {
        assert.equal(await startMcpServer(win, policy), true);
        assert.equal(existsSync(session), true);
        assert.equal(isMcpWriteAllowed(), true, "MCP enabled must allow write requests to reach approval");
        // Main is not safe to use until renderer registered its actual agent.
        await assert.rejects(callBridge("get_current_project", {}),
            err => err.code === "IPC_UNAVAILABLE" && err.message.includes("initializing"));
        const advertiseReady = (sender=webContents, version="mcp-2026-11-27-implementation-edit") =>
            ipcMain.emit("digi:mcp:renderer-ready", {
                sender, senderFrame: sender.mainFrame
            }, version);
        advertiseReady({mainFrame:{id:99}}, "mcp-2026-11-27-implementation-edit");
        await assert.rejects(callBridge("get_current_project", {}),
            err => err.code === "IPC_UNAVAILABLE");
        advertiseReady(webContents, "mcp-incompatible-registry");
        await assert.rejects(callBridge("get_current_project", {}),
            err => err.code === "IPC_UNAVAILABLE");
        advertiseReady();
        const read = await callBridge("get_current_project", {});
        assert.equal(read.tool, "get_current_project");
        assert.equal(prompts, 0);
        // A hidden main window must refuse MCP reads quickly rather than
        // hanging until the renderer request timeout.
        visible = false;
        await assert.rejects(callBridge("get_current_project", {}),
            error => error.code === "IPC_UNAVAILABLE");
        visible = true;
        assert.equal((await callBridge("get_current_project", {})).accepted, true);
        webContents.emit("did-start-loading");
        await assert.rejects(callBridge("get_current_project", {}),
            err => err.code === "IPC_UNAVAILABLE");
        advertiseReady();
        assert.equal((await callBridge("get_current_project", {})).accepted, true);

        // Enabling the server is sufficient to OFFER writes for approval.
        // It never implicitly grants permission to modify the project.
        approval = "deny";
        await assert.rejects(request(), err => err.code === "WRITE_REJECTED");
        assert.equal(rendererWrites, 0);
        assert.equal(prompts, 1);
        assert.deepEqual(lastPrompt.buttons, ["Deny", "Allow once", "Allow for this session"]);

        locale = "zh-CN";
        await assert.rejects(request(), err => err.code === "WRITE_REJECTED");
        assert.deepEqual(lastPrompt.buttons, ["拒绝", "仅允许本次", "本次会话允许"]);
        assert.equal(lastPrompt.message, "允许外部 AI 修改当前工程吗？");
        locale = "en";

        const originalMetadata = readFileSync(session, "utf8");
        assert.equal(JSON.parse(originalMetadata).registryVersion, "mcp-2026-11-27-implementation-edit");
        const staleMainMetadata = JSON.parse(originalMetadata);
        delete staleMainMetadata.registryVersion;
        writeFileSync(session, JSON.stringify(staleMainMetadata));
        await assert.rejects(callBridge("get_current_project", {}),
            err => err.message.includes("fully restart DigiwiseStudio"));
        writeFileSync(session, originalMetadata);
        const tampered = JSON.parse(originalMetadata);
        tampered.token = "0".repeat(64);
        writeFileSync(session, JSON.stringify(tampered));
        await assert.rejects(callBridge("get_current_project", {}),
            err => err.code === "INVALID_ARGUMENT");
        writeFileSync(session, originalMetadata);

        approval = "allow";
        const accepted = await request();
        assert.equal(accepted.tool, "create_page");
        assert.equal(rendererWrites, 1);

        // One session grant covers subsequent requests without prompting.
        approval = "session";
        const beforeSessionPrompt = prompts;
        await request();
        assert.equal(prompts, beforeSessionPrompt + 1);
        approval = "deny";
        await request();
        assert.equal(prompts, beforeSessionPrompt + 1);
        await assert.rejects(callBridge("create_project", {
            projectPath: "C:\\test\\new-project.eez-project",
            lvglVersion: "8.4.0", displayWidth: 800, displayHeight: 480
        }), error => error.code === "PROJECT_UNBOUND");
        assert.equal(projectCreates, 0, "External MCP project creation must be denied");
        assert.equal(prompts, beforeSessionPrompt + 1);
        // Logout immediately gates reads AND writes and invalidates the
        // previous approval even if the same user logs in again.
        authenticated = false;
        authGeneration++;
        await assert.rejects(callBridge("get_current_project", {}),
            err => err.code === "AUTH_REQUIRED");
        await assert.rejects(request(), err => err.code === "AUTH_REQUIRED");
        assert.equal(prompts, beforeSessionPrompt + 1);
        authenticated = true;
        authGeneration++;
        approval = "deny";
        await assert.rejects(request(), err => err.code === "WRITE_REJECTED");
        assert.equal(prompts, beforeSessionPrompt + 2);
        // Switching MCP Server off revokes the session grant, and a later
        // restart must prompt again even for a previously approved operation.
        stopMcpServer();
        assert.equal(isMcpWriteAllowed(), false);
        assert.equal(existsSync(session), false);
        assert.equal(await startMcpServer(win, policy), true);
        assert.equal(isMcpWriteAllowed(), true);
        advertiseReady();
        await assert.rejects(request(), err => err.code === "WRITE_REJECTED");
        assert.equal(prompts, beforeSessionPrompt + 3);

        approval = "defer";
        const first = request();
        const deadline = Date.now() + 4000;
        while (!resolveApproval) {
            if (Date.now() > deadline) throw new Error("Confirmation dialog not shown");
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        await assert.rejects(request(), err => err.code === "INVALID_STATE");
        resolveApproval(1);
        await first;
        assert.equal(rendererWrites, 4);

        // A disconnected MCP client must cancel the still-visible native
        // approval prompt, drop pending ownership, and NOT grant its writes.
        approval = "defer";
        resolveApproval = undefined;
        const abandonedBefore = abortedApprovals;
        const promptCountBefore = prompts;
        const metadata = JSON.parse(readFileSync(session, "utf8"));
        const abandoned = net.connect(metadata.socketPath);
        await new Promise((resolve, reject) => {
            abandoned.once("connect", resolve);
            abandoned.once("error", reject);
        });
        abandoned.write(JSON.stringify({
            id: randomBytes(16).toString("hex"),
            token: metadata.token,
            tool: "create_page",
            args: { expectedProjectPath: "C:\\test\\safe.eez-project", name: "Abandoned" }
        }) + "\n");
        const abandonDeadline = Date.now() + 4000;
        while (prompts === promptCountBefore) {
            if (Date.now() > abandonDeadline) throw new Error("Abandoned prompt did not open");
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        abandoned.destroy();
        while (abortedApprovals === abandonedBefore) {
            if (Date.now() > abandonDeadline) throw new Error("Disconnected client did not revoke prompt");
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        approval = "deny";
        await assert.rejects(request(), err => err.code === "WRITE_REJECTED");
        assert.equal(prompts, promptCountBefore + 2,
            "Next request must not inherit an abandoned session grant");

        // Logout while a native consent dialog is open must fail CLOSED, even
        // if the user clicks Session Allow after authentication has changed.
        approval = "defer";
        resolveApproval = undefined;
        const writesBeforeLogout = rendererWrites;
        const waitingConsent = request();
        const logoutDeadline = Date.now() + 4000;
        while (!resolveApproval) {
            if (Date.now() > logoutDeadline) throw new Error("Logout test prompt missing");
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        authenticated = false;
        authGeneration++;
        resolveApproval(2);
        await assert.rejects(waitingConsent, error => error.code === "WRITE_REJECTED");
        assert.equal(rendererWrites, writesBeforeLogout,
            "MCP must not forward a write approved after logout");
        authenticated = true;
        authGeneration++;
        approval = "deny";
        await assert.rejects(request(), error => error.code === "WRITE_REJECTED");
        assert.equal(rendererWrites, writesBeforeLogout,
            "Old session grant must not survive logout/login");

        stopMcpServer();
        assert.equal(existsSync(session), false);
        await assert.rejects(callBridge("get_current_project", {}));
        // A renderer crash / main window destruction must revoke the pipe
        // and all session grants without waiting for Electron app.quit().
        assert.equal(await startMcpServer(win, policy), true);
        advertiseReady();
        webContents.emit("render-process-gone", {}, { reason: "crashed" });
        assert.equal(isMcpWriteAllowed(), false);
        assert.equal(existsSync(session), false);
        assert.equal(await startMcpServer(win, policy), true);
        advertiseReady();
        win.emit("closed");
        assert.equal(isMcpWriteAllowed(), false);
        assert.equal(existsSync(session), false);
        console.log("PASS: MCP Main v3 online policy + local approval, hidden window, disconnect, crash and cleanup");
    } finally {
        stopMcpServer();
        rmSync(dir, { recursive: true, force: true });
        delete process.env.DIGISTUDIO_MCP_SESSION_FILE;
    }
})().catch(error => {
    console.error("FAIL main bridge integration: " + error.stack);
    process.exitCode = 1;
});
