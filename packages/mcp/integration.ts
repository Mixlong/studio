import { BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { createHash, randomBytes } from "crypto";
import {
    startMcpServer, stopMcpServer, isMcpServerRunning,
    McpCentralExecutionPolicy
} from "./main-server";
import { MCP_TOOL_REGISTRY_VERSION } from "./protocol";
import {
    getDigiwiseAuthGuard, callDigiwisePublicApiWithSession,
    onDigiwiseAuthSessionChanged
} from "main/digiwise-auth";
import { addDigiStudioToCodex } from "./codex-import";

const STATUS_CHANNEL = "digistudio:mcp:status";
const TOGGLE_CHANNEL = "digistudio:mcp:toggle";
const CODEX_CHANNEL = "digistudio:mcp:install-codex";
const POLICY_CHANGED_CHANNEL = "digistudio:mcp:policy-changed";

let initialized = false;

let activeSession: {
    userId: string;
    generation: number;
    clientSessionId: string;
    globalRevision: number;
    accountRevision: number;
} | null = null;

let policyCheckSequence = 0;

function mcpError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}

function isAccessDeniedError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { status?: number; code?: string };
    if (candidate.status === 401 || candidate.status === 403) return true;
    return ["ACCESS_DENIED", "MCP_DISABLED", "MCP_NOT_AUTHORIZED",
        "MCP_REVOKED", "AUTH_REQUIRED"].includes(String(candidate.code || ""));
}

async function accountAuthorized(): Promise<boolean> {
    const guard = getDigiwiseAuthGuard();
    const seq = ++policyCheckSequence;
    if (!guard.authenticated || !guard.userId) {
        return false;
    }
    const result = await callDigiwisePublicApiWithSession(
        (api, token) => api.getMcpPolicy(token)
    );
    const after = getDigiwiseAuthGuard();
    if (seq !== policyCheckSequence) return false;
    return result.ok && result.data.authorized === true &&
        after.authenticated && after.userId === guard.userId &&
        after.generation === guard.generation;
}

function requireActiveSession(expectedSessionId?: string) {
    const guard = getDigiwiseAuthGuard();
    if (!activeSession || !isMcpServerRunning() ||
        !guard.authenticated || !guard.userId ||
        guard.userId !== activeSession.userId ||
        guard.generation !== activeSession.generation ||
        (expectedSessionId && activeSession.clientSessionId !== expectedSessionId)) {
        throw mcpError("AUTH_REQUIRED",
            "MCP is not connected or authorized for the current IDE account");
    }
    return { guard, session: activeSession };
}

export async function registerMcpIntegration(window: BrowserWindow) {
    if (initialized) return;
    initialized = true;

    const notifyPolicyChanged = () => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send(POLICY_CHANGED_CHANNEL);
        }
    };

    const disconnectSession = async (notifyServer: boolean) => {
        const previous = activeSession;
        activeSession = null;
        stopMcpServer();
        if (notifyServer && previous) {
            try {
                await callDigiwisePublicApiWithSession((api, token) =>
                    api.disconnectMcp(token, {
                        registryVersion: MCP_TOOL_REGISTRY_VERSION,
                        clientSessionId: previous.clientSessionId
                    })
                );
            } catch (_error) {
                // Best-effort server disconnect; local bridge is already closed.
            }
        }
    };

    const centralPolicy: McpCentralExecutionPolicy = {
        authorizeDiscovery: async () => {
            const { guard, session } = requireActiveSession();
            const result = await callDigiwisePublicApiWithSession(
                (api, token) => api.getMcpPolicy(token)
            );
            const after = getDigiwiseAuthGuard();
            if (!after.authenticated || after.userId !== guard.userId ||
                after.generation !== guard.generation ||
                activeSession?.clientSessionId !== session.clientSessionId) {
                throw mcpError("AUTH_REQUIRED",
                    "IDE login or MCP session changed during discovery check");
            }
            if (!result.ok) {
                if (isAccessDeniedError(result.error)) {
                    await disconnectSession(false);
                    notifyPolicyChanged();
                    throw mcpError("ACCESS_DENIED",
                        "MCP authorization was revoked or denied");
                }
                throw mcpError("MCP_POLICY_UNAVAILABLE",
                    "Unable to verify MCP authorization online");
            }
            if (result.data.authorized !== true) {
                await disconnectSession(true);
                notifyPolicyChanged();
                throw mcpError("ACCESS_DENIED",
                    "MCP is not authorized for the current IDE account");
            }
        },
        authorizeProjectTool: async (projectPath, tool, parameterDigest, clientSessionId) => {
            const { guard, session } = requireActiveSession(clientSessionId);
            if (!path.isAbsolute(projectPath) || !/\.eez-project$/i.test(projectPath) ||
                !/^[a-f0-9]{64}$/i.test(parameterDigest) ||
                !/^[A-Za-z0-9_-]{16,128}$/.test(clientSessionId)) {
                throw mcpError("ACCESS_DENIED", "Invalid IDE MCP request context");
            }
            const result = await callDigiwisePublicApiWithSession((api, token) =>
                api.authorizeSimpleMcp(token, {
                    registryVersion: MCP_TOOL_REGISTRY_VERSION,
                    tool,
                    clientSessionId,
                    parameterDigest
                })
            );
            const after = getDigiwiseAuthGuard();
            if (!after.authenticated || after.userId !== guard.userId ||
                after.generation !== guard.generation ||
                activeSession?.clientSessionId !== session.clientSessionId) {
                throw mcpError("AUTH_REQUIRED",
                    "IDE login or MCP session changed during authorization");
            }
            if (!result.ok) {
                if (isAccessDeniedError(result.error)) {
                    await disconnectSession(false);
                    notifyPolicyChanged();
                    throw mcpError("ACCESS_DENIED",
                        "MCP authorization was revoked or denied");
                }
                throw mcpError("MCP_POLICY_UNAVAILABLE",
                    "Unable to verify MCP authorization online");
            }
            const decision = result.data;
            const expiry = Date.parse(decision.expiresAt);
            if (decision.authorized !== true ||
                decision.tool !== tool ||
                decision.clientSessionId !== clientSessionId ||
                decision.parameterDigest !== parameterDigest ||
                !Number.isFinite(expiry) || expiry <= Date.now()) {
                throw mcpError("ACCESS_DENIED",
                    "Backend MCP authorization decision is invalid or expired");
            }
            return {
                bindingId: `account:${guard.userId}`,
                modelId: 0,
                accountGeneration: guard.generation,
                globalPolicyRevision: decision.globalPolicyRevision,
                accountPolicyRevision: decision.accountPolicyRevision,
                requestId: decision.requestId || decision.decisionId,
                decisionId: decision.decisionId,
                clientSessionId: decision.clientSessionId,
                parameterDigest: decision.parameterDigest,
                projectFingerprint: createHash("sha256").update(path.resolve(projectPath)).digest("hex"),
                projectRevision: 0,
                riskGroup: decision.riskGroup,
                expiresAt: decision.expiresAt,
                localConfirmationRequired: decision.localConfirmationRequired === false ? false : true,
                silentExecution: decision.silentExecution === true
            };
        },
        auditExecution: async input => {
            console.info("[mcp] Tool", input.tool, input.executionResult);
            const result = await callDigiwisePublicApiWithSession((api, token) =>
                api.auditSimpleMcp(token, {
                    requestId: input.requestId,
                    decisionId: input.decisionId,
                    tool: input.tool,
                    clientSessionId: input.clientSessionId,
                    parameterDigest: input.parameterDigest,
                    localConfirmation: input.localConfirmation,
                    executionResult: input.executionResult,
                    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
                    ...(typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {})
                })
            );
            if (!result.ok) {
                console.warn("[mcp] Execution audit upload failed");
            }
        },
        afterAuthorizedSave: () => true
    };

    const checkSender = (event: Electron.IpcMainInvokeEvent) => {
        if (window.isDestroyed() || window.webContents.isDestroyed() ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame) {
            throw new Error("Unauthorized MCP settings request");
        }
    };

    const status = async () => {
        const allowed = await accountAuthorized();
        if (!allowed) {
            await disconnectSession(true);
        }
        return { enabled: allowed && !!activeSession && isMcpServerRunning(), allowed };
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
                const guard = getDigiwiseAuthGuard();
                if (!guard.authenticated || !guard.userId || !await accountAuthorized()) {
                    await disconnectSession(true);
                    throw new Error("This IDE account has not been authorized for MCP");
                }
                if (activeSession && isMcpServerRunning() &&
                    activeSession.userId === guard.userId &&
                    activeSession.generation === guard.generation) {
                    return { enabled: true, allowed: true };
                }
                await disconnectSession(true);
                const clientSessionId = randomBytes(24).toString("base64url");
                const connectResult = await callDigiwisePublicApiWithSession((api, token) =>
                    api.connectMcp(token, {
                        registryVersion: MCP_TOOL_REGISTRY_VERSION,
                        clientSessionId
                    })
                );
                const after = getDigiwiseAuthGuard();
                if (!connectResult.ok || !connectResult.data.connected ||
                    !after.authenticated || after.userId !== guard.userId ||
                    after.generation !== guard.generation) {
                    await disconnectSession(false);
                    throw new Error("This IDE account has not been authorized for MCP");
                }
                activeSession = {
                    userId: guard.userId,
                    generation: guard.generation,
                    clientSessionId,
                    globalRevision: connectResult.data.globalPolicyRevision,
                    accountRevision: connectResult.data.accountPolicyRevision
                };
                if (!await startMcpServer(window, centralPolicy, clientSessionId)) {
                    await disconnectSession(true);
                    throw new Error("Unable to start the MCP server");
                }
                return { enabled: isMcpServerRunning(), allowed: true };
            } else {
                await disconnectSession(true);
                return { enabled: false, allowed: await accountAuthorized() };
            }
        });
        transition = change.then(() => {}, () => {});
        return change;
    });

    ipcMain.handle(CODEX_CHANNEL, async event => {
        checkSender(event);
        if (!await accountAuthorized()) {
            await disconnectSession(true);
            throw new Error("MCP is not authorized for this IDE account");
        }
        return addDigiStudioToCodex();
    });

    const unsubscribe = onDigiwiseAuthSessionChanged(() => {
        ++policyCheckSequence;
        void disconnectSession(true);
        notifyPolicyChanged();
    });
    const cleanup = () => {
        unsubscribe();
        ++policyCheckSequence;
        void disconnectSession(true);
        for (const channel of [STATUS_CHANNEL, TOGGLE_CHANNEL, CODEX_CHANNEL]) {
            ipcMain.removeHandler(channel);
        }
        initialized = false;
    };
    window.webContents.once("destroyed", cleanup);

    // Authorization grants eligibility only; never auto-connect on startup.
}
