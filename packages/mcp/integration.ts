import { app, BrowserWindow, ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import {
    startMcpServer, stopMcpServer, isMcpServerRunning,
    McpCentralExecutionPolicy
} from "./main-server";
import {
    getDigiwiseAuthGuard, callDigiwisePublicApiWithSession,
    onDigiwiseAuthSessionChanged
} from "main/digiwise-auth";
import { isReadTool } from "./validator";
import { addDigiStudioToCodex } from "./codex-import";

const STATUS_CHANNEL = "digistudio:mcp:status";
const TOGGLE_CHANNEL = "digistudio:mcp:toggle";
const CODEX_CHANNEL = "digistudio:mcp:install-codex";
const POLICY_CHANGED_CHANNEL = "digistudio:mcp:policy-changed";

interface McpPreferences {
    enabled: boolean;
}

function preferencesPath() {
    return path.join(app.getPath("userData"), "mcp-preferences.json");
}

function readPreferences(): McpPreferences | undefined {
    try {
        const json = JSON.parse(fs.readFileSync(preferencesPath(), "utf8"));
        if (typeof json?.enabled === "boolean") return { enabled: json.enabled };
    } catch (_error) {}
    return undefined;
}

function savePreferences(enabled: boolean) {
    const filePath = preferencesPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempFile = `${filePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tempFile, JSON.stringify({ enabled }), {
            encoding: "utf8", mode: 0o600
        });
        fs.renameSync(tempFile, filePath);
    } finally {
        try { fs.unlinkSync(tempFile); } catch (_error) {}
    }
}

let initialized = false;

// Java is checked when IDE Settings loads or the user enables MCP.
// Individual tool requests only use this Main-owned in-memory login grant.
let sessionGrant: {
    userId: string;
    generation: number;
    globalRevision: number;
    accountRevision: number;
} | null = null;
let policyCheckSequence = 0;

async function accountAuthorized(): Promise<boolean> {
    const guard = getDigiwiseAuthGuard();
    const seq = ++policyCheckSequence;
    if (!guard.authenticated || !guard.userId) {
        sessionGrant = null;
        return false;
    }
    const result = await callDigiwisePublicApiWithSession(
        (api, token) => api.getMcpPolicy(token)
    );
    const after = getDigiwiseAuthGuard();
    if (seq !== policyCheckSequence) return false;
    if (result.ok && result.data.authorized === true &&
        after.authenticated && after.userId === guard.userId &&
        after.generation === guard.generation) {
        sessionGrant = {
            userId: guard.userId, generation: guard.generation,
            globalRevision: result.data.globalPolicyRevision,
            accountRevision: result.data.accountPolicyRevision
        };
        return true;
    }
    sessionGrant = null;
    return false;
}

function currentGrant() {
    const guard = getDigiwiseAuthGuard();
    if (!sessionGrant || !guard.authenticated ||
        guard.userId !== sessionGrant.userId ||
        guard.generation !== sessionGrant.generation) {
        throw new Error("MCP is not authorized for the current IDE account");
    }
    return sessionGrant;
}

function centralExecutionPolicy(): McpCentralExecutionPolicy {
    return {
        // The Java policy is checked only when starting MCP or opening Settings.
        authorizeDiscovery: async () => {
            currentGrant();
        },
        authorizeProjectTool: async (projectPath, tool, parameterDigest, clientSessionId) => {
            const grant = currentGrant();
            if (!path.isAbsolute(projectPath) || !/\.eez-project$/i.test(projectPath) ||
                !/^[a-f0-9]{64}$/.test(parameterDigest) ||
                !/^[A-Za-z0-9_-]{16,128}$/.test(clientSessionId)) {
                throw new Error("Invalid IDE MCP request context");
            }
            const riskGroup = tool === "start_project_check" ||
                tool === "start_project_build" ? "build.run" :
                isReadTool(tool) ? "project.view" : "project.edit";
            const decisionId = randomUUID();
            return {
                bindingId: `account:${grant.userId}`, modelId: 0,
                accountGeneration: grant.generation,
                globalPolicyRevision: grant.globalRevision,
                accountPolicyRevision: grant.accountRevision,
                requestId: decisionId, decisionId,
                clientSessionId, parameterDigest,
                projectFingerprint: createHash("sha256").update(path.resolve(projectPath)).digest("hex"),
                projectRevision: 0, riskGroup,
                expiresAt: new Date(Date.now() + 5000).toISOString()
            };
        },
        auditExecution: async input => {
            // Local summary only: no Java call after tool execution.
            console.info("[mcp] Tool", input.tool, input.executionResult);
        },
        afterAuthorizedSave: () => true
    };
}

export async function registerMcpIntegration(window: BrowserWindow) {
    if (initialized) return;
    initialized = true;
    const centralPolicy = centralExecutionPolicy();
    const checkSender = (event: Electron.IpcMainInvokeEvent) => {
        if (window.isDestroyed() || window.webContents.isDestroyed() ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame) {
            throw new Error("Unauthorized MCP settings request");
        }
    };
    const status = async () => {
        const allowed = await accountAuthorized();
        if (!allowed) stopMcpServer();
        return { enabled: allowed && isMcpServerRunning(), allowed };
    };

    ipcMain.handle(STATUS_CHANNEL, async event => {
        checkSender(event);
        return status();
    });

    let transition = Promise.resolve();
    ipcMain.handle(TOGGLE_CHANNEL, (event, desired: unknown) => {
        checkSender(event);
        if (typeof desired !== "boolean") {
            throw new Error("MCP enabled must be a boolean");
        }
        const change = transition.then(async () => {
            if (desired) {
                if (!await accountAuthorized()) {
                    stopMcpServer();
                    throw new Error("This IDE account has not been authorized for MCP");
                }
                if (!await startMcpServer(window, centralPolicy)) {
                    throw new Error("Unable to start the MCP server");
                }
            } else {
                stopMcpServer();
            }
            savePreferences(desired);
            return desired ? { enabled: isMcpServerRunning(), allowed: true } :
                { enabled: false, allowed: await accountAuthorized() };
        });
        transition = change.then(() => {}, () => {});
        return change;
    });

    ipcMain.handle(CODEX_CHANNEL, async event => {
        checkSender(event);
        if (!await accountAuthorized()) {
            throw new Error("MCP is not authorized for this IDE account");
        }
        return addDigiStudioToCodex();
    });

    const unsubscribe = onDigiwiseAuthSessionChanged(() => {
        ++policyCheckSequence;
        sessionGrant = null;
        stopMcpServer();
        if (!window.webContents.isDestroyed()) {
            window.webContents.send(POLICY_CHANGED_CHANNEL);
        }
    });
    const cleanup = () => {
        unsubscribe();
        ++policyCheckSequence;
        sessionGrant = null;
        stopMcpServer();
        for (const channel of [STATUS_CHANNEL, TOGGLE_CHANNEL, CODEX_CHANNEL]) {
            ipcMain.removeHandler(channel);
        }
        initialized = false;
    };
    window.webContents.once("destroyed", cleanup);

    // Restore the local preference only after a one-time account check.
    if (readPreferences()?.enabled && await accountAuthorized()) {
        await startMcpServer(window, centralPolicy);
    }
}
