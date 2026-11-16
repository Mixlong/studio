import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import * as fs from "fs";
import * as path from "path";
import {
    startMcpServer,
    stopMcpServer,
    isMcpServerRunning,
    McpCentralExecutionPolicy
} from "./main-server";
import { getDigiwiseAuthGuard, callDigiwisePublicApiWithSession } from "main/digiwise-auth";
import { MCP_TOOL_REGISTRY_VERSION } from "./protocol";
import { createMcpProject } from "./create-project";
import { McpProjectBindingStore } from "./project-binding-store";
import { McpCentralAuthorizationGate } from "./central-authorization";
import { addDigiStudioToCodex } from "./codex-import";

const STATUS_CHANNEL = "digistudio:mcp:status";
const TOGGLE_CHANNEL = "digistudio:mcp:toggle";
const CODEX_CHANNEL = "digistudio:mcp:install-codex";
const BIND_CHANNEL = "digistudio:mcp:create-bound-project";

interface McpPreferences {
    enabled: boolean;
}

function preferencesPath() {
    return path.join(app.getPath("userData"), "mcp-preferences.json");
}

function readPreferences(): McpPreferences | undefined {
    try {
        const json = JSON.parse(fs.readFileSync(preferencesPath(), "utf8"));
        if (typeof json?.enabled === "boolean") {
            return { enabled: json.enabled };
        }
    } catch (_error) {}
    return undefined;
}

function savePreferences(enabled: boolean) {
    const filePath = preferencesPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempFile = `${filePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(tempFile, JSON.stringify({ enabled }), {
            encoding: "utf8",
            mode: 0o600
        });
        fs.renameSync(tempFile, filePath);
    } finally {
        try { fs.unlinkSync(tempFile); } catch (_error) {}
    }
}

let initialized = false;

/** A local IDE preference never bypasses Java's live policy, even in packaged builds. */
function bindingStore() {
    return new McpProjectBindingStore(app.getPath("userData"), {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: text => safeStorage.encryptString(text),
        decrypt: bytes => safeStorage.decryptString(bytes)
    });
}

function centralExecutionPolicy(store: McpProjectBindingStore): McpCentralExecutionPolicy {
    const gate = new McpCentralAuthorizationGate(store, getDigiwiseAuthGuard,
        async input => {
            const response = await callDigiwisePublicApiWithSession(
                (api, accessToken) => api.authorizeMcpExecution(accessToken, {
                    registryVersion: MCP_TOOL_REGISTRY_VERSION, ...input
                })
            );
            if (!response.ok) throw new Error("Online MCP policy denied");
            return response.data;
        });
    return {
        authorizeDiscovery: async () => {
            const result = await callDigiwisePublicApiWithSession(
                (api, accessToken) => api.checkMcpModelAccess(accessToken, {
                    registryVersion: MCP_TOOL_REGISTRY_VERSION,
                    tool: "get_mcp_capabilities",
                    modelId: null
                })
            );
            if (!result.ok || result.data.scope !== "DISCOVERY_ONLY" ||
                !result.data.mcpUseGranted) {
                throw new Error("MCP discovery denied");
            }
        },
        authorizeProjectTool: (projectPath, tool, parameterDigest, clientSessionId) =>
            gate.authorizeProjectTool(projectPath, tool, parameterDigest, clientSessionId),
        auditExecution: async input => {
            const result = await callDigiwisePublicApiWithSession(
                (api, accessToken) => api.auditMcpExecution(accessToken, input)
            );
            if (!result.ok) throw new Error("MCP execution audit failed");
        },
        afterAuthorizedSave: (projectPath, bindingId) => {
            const account = getDigiwiseAuthGuard();
            return !!account.authenticated && !!account.userId &&
                store.refreshAfterAuthorizedSave(projectPath, account.userId, bindingId);
        }
    };
}

/** A human-operated IDE settings command creates only a NEW bound project. */
async function createBoundProject(window: BrowserWindow, store: McpProjectBindingStore,
                                  modelId: number) {
    const before = getDigiwiseAuthGuard();
    if (!before.authenticated || !before.userId ||
        !Number.isSafeInteger(modelId) || modelId <= 0) {
        throw new Error("Sign in and choose an authorized model ID");
    }
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("OS secure storage is unavailable");
    }
    const selection = await dialog.showSaveDialog(window, {
        title: "Create MCP-bound LVGL project",
        defaultPath: "New-LVGL.eez-project",
        filters: [{ name: "EEZ project", extensions: ["eez-project"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    const projectPath = path.resolve(selection.filePath);
    if (path.extname(projectPath).toLowerCase() !== ".eez-project") {
        throw new Error("Select an .eez-project destination");
    }
    const assertSameLogin = () => {
        const now = getDigiwiseAuthGuard();
        if (!now.authenticated || now.userId !== before.userId ||
            now.generation !== before.generation) {
            throw new Error("IDE account changed while creating MCP project");
        }
    };
    assertSameLogin();
    const issue = await callDigiwisePublicApiWithSession(
        (api, token) => api.issueMcpProjectBinding(token, {
            registryVersion: MCP_TOOL_REGISTRY_VERSION, modelId
        })
    );
    if (!issue.ok) throw new Error("Java refused the MCP project binding");
    const credential = issue.data;
    let created = false;
    try {
        assertSameLogin();
        await createMcpProject({ projectPath, openWhenDone: false }, window);
        created = true;
        const projectFingerprint =
            store.fingerprintForNewProject(projectPath, credential.bindingId);
        const confirm = await callDigiwisePublicApiWithSession(
            (api, token) => api.confirmMcpProjectBinding(token, {
                bindingId: credential.bindingId,
                bindingSecret: credential.bindingSecret,
                projectFingerprint, projectRevision: 1
            })
        );
        if (!confirm.ok) throw new Error("Java did not confirm the MCP project");
        assertSameLogin();
        store.bindNewProject(projectPath, before.userId, credential);
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send("open-project", projectPath, false);
        }
        return { created: true, modelId, projectPath };
    } catch (error) {
        try {
            await callDigiwisePublicApiWithSession(
                (api, token) => api.revokeMcpBinding(token, {
                    bindingId: credential.bindingId,
                    bindingSecret: credential.bindingSecret
                })
            );
        } catch (revokeError) {
            console.warn("[mcp] Could not revoke failed provisioning", revokeError);
        }
        if (created) {
            try { fs.unlinkSync(projectPath); } catch {}
        }
        throw error;
    }
}

export async function registerMcpIntegration(window: BrowserWindow) {
    if (initialized) return;
    initialized = true;

    const store = bindingStore();
    const centralPolicy = centralExecutionPolicy(store);
    const checkSender = (event: Electron.IpcMainInvokeEvent) => {
        if (
            window.isDestroyed() ||
            window.webContents.isDestroyed() ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame
        ) {
            throw new Error("Unauthorized MCP settings request");
        }
    };

    ipcMain.handle(STATUS_CHANNEL, event => {
        checkSender(event);
        return { enabled: isMcpServerRunning() };
    });

    let transition = Promise.resolve();
    ipcMain.handle(TOGGLE_CHANNEL, (event, desired: unknown) => {
        checkSender(event);
        if (typeof desired !== "boolean") {
            throw new Error("MCP enabled must be a boolean");
        }
        const change = transition.then(async () => {
            if (desired) {
                if (!(await startMcpServer(window, centralPolicy))) {
                    throw new Error("Could not start MCP. Check the application log.");
                }
            } else {
                stopMcpServer();
            }
            savePreferences(desired);
            return { enabled: isMcpServerRunning() };
        });
        transition = change.then(() => {}, () => {});
        return change;
    });

    ipcMain.handle(BIND_CHANNEL, async (event, modelId: unknown) => {
        checkSender(event);
        return createBoundProject(window, store, modelId as number);
    });

    ipcMain.handle(CODEX_CHANNEL, event => {
        checkSender(event);
        return addDigiStudioToCodex();
    });

    const cleanup = () => {
        stopMcpServer();
        for (const channel of [STATUS_CHANNEL, TOGGLE_CHANNEL, CODEX_CHANNEL, BIND_CHANNEL]) {
            ipcMain.removeHandler(channel);
        }
        initialized = false;
    };
    window.webContents.once("destroyed", cleanup);

    // A saved user choice takes precedence over the legacy developer flag.
    const enabled = readPreferences()?.enabled ??
        (process.env.DIGISTUDIO_ENABLE_MCP === "1");
    if (enabled) {
        await startMcpServer(window, centralPolicy);
    }
}
