import { app, BrowserWindow, ipcMain } from "electron";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getLocale, settings } from "main/settings";
import { getDigiwiseAuthGuard } from "main/digiwise-auth";
import { showMcpApproval } from "./approval-dialog";
import {
    MCP_MAX_REQUEST_BYTES,
    MCP_MAX_RESPONSE_BYTES,
    MCP_REQUEST_CHANNEL,
    MCP_RESPONSE_CHANNEL,
    MCP_RENDERER_READY_CHANNEL,
    MCP_RENDERER_PROBE_CHANNEL,
    MCP_SESSION_NAME,
    MCP_TOOL_REGISTRY_VERSION,
    MCP_TIMEOUT_MS,
    McpRendererRequest,
    McpRendererResponse,
    mcpReadError
} from "./protocol";
import { isReadTool, isWriteTool, validateReadArguments, validateWriteArguments } from "./validator";

interface BridgeRequest {
    id: string;
    token: string;
    tool: string;
    args: unknown;
}

/** Main-local tool access after the IDE checks Java account entitlement at startup. */
export interface McpCentralExecutionPolicy {
    authorizeDiscovery: () => Promise<void>;
    authorizeProjectTool: (
        projectPath: string, tool: string, parameterDigest: string,
        clientSessionId: string
    ) => Promise<{
        bindingId: string;
        modelId: number;
        globalPolicyRevision: number;
        accountPolicyRevision: number;
        accountGeneration: number;
        requestId: string;
        decisionId: string;
        clientSessionId: string;
        parameterDigest: string;
        projectFingerprint: string;
        projectRevision: number;
        riskGroup: "project.view" | "project.edit" | "build.run";
        expiresAt: string;
    }>;
    auditExecution: (input: {
        tool: string;
        requestId: string;
        decisionId: string;
        bindingId: string;
        clientSessionId: string;
        parameterDigest: string;
        localConfirmation: "confirmed" | "cancelled" | "not_required" | "offline";
        executionResult: "succeeded" | "failed" | "cancelled" | "revoked" | "not_started";
        errorCode?: string;
        durationMs?: number;
    }) => Promise<void>;
    afterAuthorizedSave: (projectPath: string, bindingId: string) => boolean;
}

const MAX_SOCKETS = 16;
const MAX_PENDING = 32;
let activeStop: (() => void) | undefined;
// MCP Server opt-in enables AI to REQUEST reads and writes. Every write
// still requires an explicit local confirmation unless the user specifically
// chose "Allow for this session". Grants never persist across restarts.
let sessionWriteApproved = false;
const WRITE_TIMEOUT_MS = 60_000;
const PROMPT_TIMEOUT_MS = 125_000;
export function isMcpWriteAllowed() {
    return !!activeStop;
}


/**
 * This process is a PRIVATE local bridge only. The external stdio process
 * owns the real MCP protocol using the official SDK.
 */
export async function startMcpServer(
    window: BrowserWindow,
    centralPolicy: McpCentralExecutionPolicy
): Promise<boolean> {
    // A Java account grant must first be obtained by the Settings integration.
    if (!centralPolicy) return false;
    // The Settings integration explicitly controls startup. No listener
    // exists until the user opts in or enables the developer environment flag.
    if (activeStop) return true;

    const token = randomBytes(32).toString("hex");
    const nonce = randomBytes(16).toString("hex");
    const clientSessionId = randomBytes(24).toString("base64url");
    const socketPath = process.platform === "win32"
        ? `\\\\.\\pipe\\digistudio-mcp-${nonce}`
        : path.join(os.tmpdir(), `digistudio-mcp-${nonce}.sock`);
    const metadataPath = path.join(app.getPath("userData"), MCP_SESSION_NAME);
    const server = net.createServer();
    const sockets = new Set<net.Socket>();
    const pending = new Map<string, {
        resolve: (response: McpRendererResponse) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    let stopped = false;
    let writeApprovalPending = false;
    let consecutiveRendererTimeouts = 0;
    let rendererReady = false;
    let approvedAuthGeneration = -1;
    let centralWriteGrantKey: string | null = null;
    let centralLastProjectPath: string | null = null;
    const approvalAbort = new AbortController();

    const send = (socket: net.Socket, response: unknown) => {
        if (socket.destroyed) return;
        const encoded = JSON.stringify(response);
        if (Buffer.byteLength(encoded) > MCP_MAX_RESPONSE_BYTES) {
            socket.end(JSON.stringify({
                ok: false,
                error: mcpReadError("LIMIT_EXCEEDED", "Response too large")
            }) + "\n");
        } else {
            socket.end(encoded + "\n");
        }
    };

    const onRendererResponse = (
        event: Electron.IpcMainEvent,
        response: McpRendererResponse
    ) => {
        if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            !response ||
            typeof response.id !== "string"
        ) return;
        const entry = pending.get(response.id);
        if (!entry) return;
        pending.delete(response.id);
        clearTimeout(entry.timer);
        consecutiveRendererTimeouts = 0;
        entry.resolve(response);
    };
    ipcMain.on(MCP_RESPONSE_CHANNEL, onRendererResponse);
    const onRendererReady = (event: Electron.IpcMainEvent, version: unknown) => {
        if (event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame) return;
        rendererReady = version === MCP_TOOL_REGISTRY_VERSION;
        if (rendererReady) consecutiveRendererTimeouts = 0;
    };
    ipcMain.on(MCP_RENDERER_READY_CHANNEL, onRendererReady);
    const onRendererLoading = () => { rendererReady = false; };
    window.webContents.on("did-start-loading", onRendererLoading);
    const probeRenderer = () => {
        if (!stopped && !window.webContents.isDestroyed()) {
            window.webContents.send(MCP_RENDERER_PROBE_CHANNEL);
        }
    };
    window.webContents.on("did-finish-load", probeRenderer);

    const stop = () => {
        if (stopped) return;
        stopped = true;
        activeStop = undefined;
        sessionWriteApproved = false;
        centralWriteGrantKey = null;
        centralLastProjectPath = null;
        writeApprovalPending = false;
        approvalAbort.abort();
        window.webContents.removeListener("destroyed", stop);
        window.webContents.removeListener("render-process-gone", stop);
        window.removeListener("closed", stop);
        app.removeListener("will-quit", stop);
        ipcMain.removeListener(MCP_RESPONSE_CHANNEL, onRendererResponse);
        ipcMain.removeListener(MCP_RENDERER_READY_CHANNEL, onRendererReady);
        window.webContents.removeListener("did-start-loading", onRendererLoading);
        window.webContents.removeListener("did-finish-load", probeRenderer);
        for (const [id, entry] of pending) {
            clearTimeout(entry.timer);
            entry.resolve({
                id,
                ok: false,
                error: mcpReadError("IPC_UNAVAILABLE", "DigiStudio window closed")
            });
        }
        pending.clear();
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        try { server.close(); } catch (_error) {}
        if (process.platform !== "win32") {
            try { fs.unlinkSync(socketPath); } catch (_error) {}
        }
        try {
            const data = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
            if (data.token === token) fs.unlinkSync(metadataPath);
        } catch (_error) {}
    };

    // Handle errors after listen too; an unhandled net.Server "error"
    // event would otherwise terminate the Electron main process.
    server.on("error", error => {
        console.error("[mcp] Local bridge error:", error);
        stop();
    });

    server.on("connection", socket => {
        if (stopped || sockets.size >= MAX_SOCKETS) {
            socket.destroy();
            return;
        }
        sockets.add(socket);
        socket.setTimeout(MCP_TIMEOUT_MS);
        socket.on("timeout", () => socket.destroy());
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        let buffer = "";
        socket.on("data", async chunk => {
            buffer += chunk.toString("utf8");
            if (Buffer.byteLength(buffer) > MCP_MAX_REQUEST_BYTES) {
                socket.destroy();
                return;
            }
            const newline = buffer.indexOf("\n");
            if (newline === -1) return;
            socket.removeAllListeners("data");
            let input: BridgeRequest;
            try {
                input = JSON.parse(buffer.slice(0, newline)) as BridgeRequest;
                if (
                    !input ||
                    typeof input.id !== "string" ||
                    !/^[a-f0-9-]{16,64}$/i.test(input.id) ||
                    typeof input.token !== "string" ||
                    input.token.length !== token.length ||
                    !timingSafeEqual(Buffer.from(input.token), Buffer.from(token)) ||
                    (!isReadTool(input.tool) && !isWriteTool(input.tool))
                ) {
                    throw new Error("Unauthorized or unsupported request");
                }
                if (isReadTool(input.tool)) validateReadArguments(input.tool, input.args);
                else if (isWriteTool(input.tool)) validateWriteArguments(input.tool, input.args);
            } catch (_error) {
                send(socket, {
                    ok: false,
                    error: mcpReadError("INVALID_ARGUMENT", "Invalid or unauthorized request")
                });
                return;
            }

            // A hidden/destroyed/crashed or still-loading main window cannot
            // handle renderer IPC; fail immediately, not after MCP_TIMEOUT_MS.
            // Do not silently redirect requests to another Electron window.
            if (window.isDestroyed() || window.webContents.isDestroyed() ||
                !window.isVisible() || window.webContents.isCrashed() ||
                window.webContents.isLoadingMainFrame()) {
                send(socket, { ok: false, error: mcpReadError(
                    "IPC_UNAVAILABLE", "DigiStudio editor window is not ready or not visible"
                ) });
                return;
            }
            const auth = getDigiwiseAuthGuard();
            if (!auth.authenticated) {
                sessionWriteApproved = false;
                approvedAuthGeneration = -1;
                send(socket, { ok: false, error: mcpReadError(
                    "AUTH_REQUIRED", "Sign in to DigiwiseStudio before using MCP tools"
                ) });
                return;
            }
            if (sessionWriteApproved && approvedAuthGeneration !== auth.generation) {
                sessionWriteApproved = false;
                centralWriteGrantKey = null;
                approvedAuthGeneration = -1;
            }
            if (!rendererReady) {
                // The GUI can be visible long before its MCP agent finishes
                // loading. Reject without consuming IPC timeout/retry budgets.
                probeRenderer();
                send(socket, { ok: false, error: mcpReadError(
                    "IPC_UNAVAILABLE", "MCP renderer is initializing or has an incompatible version"
                ) });
                return;
            }
            if (pending.has(input.id)) {
                send(socket, { ok: false, error: mcpReadError("INVALID_ARGUMENT", "Duplicate request identifier") });
                return;
            }
            if (pending.size >= MAX_PENDING) {
                send(socket, { ok: false, error: mcpReadError("LIMIT_EXCEEDED", "Too many pending requests") });
                return;
            }

            // Secure staged path: get the active project identity from the
            // actual editor (never the external AI argument). The probe stays
            // entirely in Main and never returns project data to MCP.
            let authorizedPath: string | undefined;
            let centralGrant: Awaited<ReturnType<NonNullable<
                McpCentralExecutionPolicy["authorizeProjectTool"]>>> | undefined;
            const centralKey = (grant: NonNullable<typeof centralGrant>) =>
                [auth.generation, grant.bindingId, grant.modelId,
                 input.tool, grant.globalPolicyRevision,
                 grant.accountPolicyRevision].join("|");
            const parameterDigest = createHash("sha256")
                .update(JSON.stringify(input.args ?? {})).digest("hex");
            const startedAt = Date.now();
            const audit = async (grant: NonNullable<typeof centralGrant>,
                localConfirmation: "confirmed" | "cancelled" | "not_required" | "offline",
                executionResult: "succeeded" | "failed" | "cancelled" | "revoked" | "not_started",
                errorCode?: string) => {
                try {
                    await centralPolicy.auditExecution({
                        tool: input.tool,
                        requestId: grant.requestId, decisionId: grant.decisionId,
                        bindingId: grant.bindingId, clientSessionId: grant.clientSessionId,
                        parameterDigest: grant.parameterDigest, localConfirmation,
                        executionResult, ...(errorCode ? {errorCode} : {}),
                        durationMs: Date.now() - startedAt
                    });
                } catch (error) {
                    console.warn("[mcp] Execution audit could not be uploaded", error);
                }
            };
            {
                try {
                    if (input.tool === "get_mcp_capabilities") {
                        await centralPolicy.authorizeDiscovery();
                    } else if (input.tool === "create_project") {
                        throw mcpReadError("PROJECT_UNBOUND",
                            "Central MCP project creation requires the controlled IDE Main binding wizard");
                    } else {
                        const probeId = randomBytes(16).toString("hex");
                        const probeReply = new Promise<McpRendererResponse>(resolve => {
                            const timer = setTimeout(() => {
                                pending.delete(probeId);
                                resolve({ id: probeId, ok: false, error: mcpReadError(
                                    "IPC_TIMEOUT", "Cannot resolve active project for MCP authorization"
                                ) });
                            }, 3500);
                            pending.set(probeId, { resolve, timer });
                        });
                        try {
                            window.webContents.send(MCP_REQUEST_CHANNEL, {
                                id: probeId, tool: "get_current_project", args: {}
                            } as McpRendererRequest);
                        } catch {
                            const probe = pending.get(probeId);
                            if (probe) {
                                pending.delete(probeId);
                                clearTimeout(probe.timer);
                                probe.resolve({id: probeId, ok: false, error: mcpReadError(
                                    "IPC_UNAVAILABLE", "Cannot read active project"
                                )});
                            }
                        }
                        const context = await probeReply;
                        if (!context.ok) throw context.error;
                        const project = context.result as {path?: unknown};
                        if (typeof project?.path !== "string" ||
                            !path.isAbsolute(project.path) ||
                            !/\.eez-project$/i.test(project.path)) {
                            throw mcpReadError("PROJECT_UNBOUND",
                                "Select a saved LVGL project in the editor");
                        }
                        authorizedPath = project.path;
                        if (centralLastProjectPath &&
                            path.normalize(centralLastProjectPath).toLowerCase() !==
                            path.normalize(authorizedPath).toLowerCase()) {
                            // No reuse after a detected project switch, even
                            // when the user later returns to the old project.
                            centralWriteGrantKey = null;
                        }
                        centralLastProjectPath = authorizedPath;
                        centralGrant = await centralPolicy.authorizeProjectTool(
                            authorizedPath, input.tool, parameterDigest, clientSessionId
                        );
                    }
                    if (stopped || socket.destroyed ||
                        !getDigiwiseAuthGuard().authenticated ||
                        getDigiwiseAuthGuard().generation !== auth.generation) {
                        throw mcpReadError("AUTH_REQUIRED",
                            "IDE login or MCP session changed during central authorization");
                    }
                } catch (error) {
                    const candidate = error as {code?: string};
                    const known = ["AUTH_REQUIRED","ACCESS_DENIED","PROJECT_UNBOUND",
                        "PROJECT_CHANGED","MCP_POLICY_UNAVAILABLE","IPC_UNAVAILABLE",
                        "IPC_TIMEOUT","NO_ACTIVE_PROJECT"];
                    send(socket,{ok:false,error:mcpReadError(
                        known.includes(candidate?.code || "") ?
                            candidate.code as "AUTH_REQUIRED" : "MCP_POLICY_UNAVAILABLE",
                        "MCP central authorization rejected or could not verify this request"
                    )});
                    return;
                }
            }

            const isWrite = isWriteTool(input.tool);
            if (isWrite) {
                if (!isMcpWriteAllowed()) {
                    send(socket, { ok: false, error: mcpReadError(
                        "WRITE_DISABLED", "Enable MCP Server in DigiwiseStudio Settings first"
                    ) });
                    return;
                }
                if (writeApprovalPending) {
                    send(socket, { ok: false, error: mcpReadError(
                        "INVALID_STATE", "Another write request is awaiting approval"
                    ) });
                    return;
                }
                writeApprovalPending = true;
                let approved = !!centralGrant &&
                    centralWriteGrantKey === centralKey(centralGrant);
                let grantSession = false;
                if (!approved) {
                    socket.setTimeout(PROMPT_TIMEOUT_MS);
                    const currentApproval = new AbortController();
                    const revoke = () => currentApproval.abort();
                    // Closing the MCP client socket must immediately dismiss
                    // the matching authorization UI. A dead client may never
                    // receive/consume a grant, so never persist it.
                    socket.once("close", revoke);
                    approvalAbort.signal.addEventListener("abort", revoke, { once: true });
                    const approvalDeadline = setTimeout(revoke, PROMPT_TIMEOUT_MS - 3_000);
                    try {
                        const isChinese = getLocale().toLowerCase().startsWith("zh");
                        const choice = await showMcpApproval(
                            window, input.tool, input.args, isChinese,
                            currentApproval.signal, settings.isDarkTheme
                        );
                        approved = choice === 1 || choice === 2;
                        grantSession = choice === 2;
                    } catch (error) {
                        console.error("[mcp] Write approval dialog error", error);
                    } finally {
                        clearTimeout(approvalDeadline);
                        socket.removeListener("close", revoke);
                        approvalAbort.signal.removeEventListener("abort", revoke);
                    }
                }
                const authAfterApproval = getDigiwiseAuthGuard();
                if (!approved || !authAfterApproval.authenticated ||
                    authAfterApproval.generation !== auth.generation ||
                    !isMcpWriteAllowed() || stopped || socket.destroyed) {
                    writeApprovalPending = false;
                    if (centralGrant) await audit(centralGrant, "cancelled", "not_started");
                    send(socket, { ok: false, error: mcpReadError(
                        "WRITE_REJECTED", "Write request was denied or cancelled"
                    ) });
                    return;
                }
                if (authorizedPath) {
                    try {
                        // Recheck Main's in-memory login grant after consent;
                        // this does not contact Java per operation.
                        const fresh = await centralPolicy.authorizeProjectTool(
                            authorizedPath, input.tool, parameterDigest, clientSessionId
                        );
                        if (!centralGrant || centralGrant.bindingId !== fresh.bindingId ||
                            centralGrant.modelId !== fresh.modelId ||
                            fresh.accountGeneration !== auth.generation) {
                            throw new Error("Central binding changed during local consent");
                        }
                        centralGrant = fresh;
                    } catch (_error) {
                        writeApprovalPending = false;
                        send(socket,{ok:false,error:mcpReadError("MCP_POLICY_UNAVAILABLE",
                            "IDE account changed or MCP server stopped after local approval")});
                        return;
                    }
                }
                if (grantSession) {
                    if (centralGrant) centralWriteGrantKey = centralKey(centralGrant);
                }
                socket.setTimeout(WRITE_TIMEOUT_MS + 3_000);
            }
            const request: McpRendererRequest = {
                id: input.id,
                tool: input.tool,
                args: input.args as Record<string, unknown>,
                ...(authorizedPath ? { authorizedProjectPath: authorizedPath } : {})
            };
            const rendererReply = new Promise<McpRendererResponse>(resolve => {
                const timer = setTimeout(() => {
                    pending.delete(request.id);
                    resolve({
                        id: request.id,
                        ok: false,
                        error: mcpReadError("IPC_TIMEOUT", "Editor did not respond")
                    });
                    // A still-open Main with no responding renderer must not
                    // keep advertising an indefinitely unusable MCP session.
                    // Allow one transient slow request; revoke only after two
                    // consecutive timeouts, after the last timeout reply.
                    consecutiveRendererTimeouts++;
                    if (consecutiveRendererTimeouts >= 2) {
                        console.error("[mcp] Renderer unresponsive twice; stopping the local MCP bridge");
                        setTimeout(() => {
                            if (consecutiveRendererTimeouts >= 2 && !stopped) stop();
                        }, 150);
                    }
                }, (isWrite ? WRITE_TIMEOUT_MS : MCP_TIMEOUT_MS) - 1000);
                pending.set(request.id, { resolve, timer });
            });
            try {
                window.webContents.send(MCP_REQUEST_CHANNEL, request);
            } catch (_error) {
                const entry = pending.get(request.id);
                if (entry) {
                    clearTimeout(entry.timer);
                    pending.delete(request.id);
                    entry.resolve({
                        id: request.id,
                        ok: false,
                        error: mcpReadError("IPC_UNAVAILABLE", "Editor unavailable")
                    });
                }
            }
            void rendererReply.then(async reply => {
                if (centralGrant) {
                    if (reply.ok && input.tool === "save_project" && authorizedPath) {
                        try {
                            if (!centralPolicy.afterAuthorizedSave(
                                authorizedPath, centralGrant.bindingId)) {
                                throw new Error("Trusted project identity could not be refreshed");
                            }
                        } catch {
                            reply = {id: input.id, ok: false, error: mcpReadError(
                                "PROJECT_CHANGED", "Project identity changed after saving")
                            };
                        }
                    }
                    await audit(centralGrant, isWrite ? "confirmed" : "not_required",
                        reply.ok ? "succeeded" : "failed",
                        reply.ok ? undefined : reply.error.code);
                }
                send(socket, reply);
            }).finally(() => {
                if (isWrite) writeApprovalPending = false;
            });
        });
    });

    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(socketPath, () => {
                server.removeListener("error", reject);
                resolve();
            });
        });
        fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
        const tempPath = `${metadataPath}.${nonce}.tmp`;
        fs.writeFileSync(
            tempPath,
            JSON.stringify({
                version: 1,
                registryVersion: MCP_TOOL_REGISTRY_VERSION,
                pid: process.pid,
                socketPath,
                token,
                createdAt: new Date().toISOString()
            }),
            { encoding: "utf8", mode: 0o600, flag: "wx" }
        );
        fs.renameSync(tempPath, metadataPath);
        activeStop = stop;
        window.webContents.once("destroyed", stop);
        window.webContents.once("render-process-gone", stop);
        window.once("closed", stop);
        app.once("will-quit", stop);
        probeRenderer();
        console.info("[mcp] Local bridge enabled; writes require confirmation unless explicitly approved for this session");
        return true;
    } catch (error) {
        stop();
        try { fs.unlinkSync(`${metadataPath}.${nonce}.tmp`); } catch (_error) {}
        console.error("[mcp] Unable to start local MCP bridge:", error);
        return false;
    }
}

export function stopMcpServer() {
    activeStop?.();
}

export function isMcpServerRunning() {
    return !!activeStop;
}
