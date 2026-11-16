import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
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
import { McpProjectBindingStore } from "./project-binding-store";
import { McpCentralAuthorizationGate } from "./central-authorization";
import { addDigiStudioToCodex } from "./codex-import";

const STATUS_CHANNEL = "digistudio:mcp:status";
const TOGGLE_CHANNEL = "digistudio:mcp:toggle";
const CODEX_CHANNEL = "digistudio:mcp:install-codex";

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

/**
 * STAGING ONLY: Central P0 policy requires database migrations, a protected
 * binding provisioning workflow, and Java/IDE joined acceptance. The packaged
 * product must not advertise live central enforcement before those exist.
 * Explicitly opt in only in an isolated development/test IDE.
 */
function stagedCentralPolicy(): McpCentralExecutionPolicy | undefined {
    if (app.isPackaged || process.env.DIGISTUDIO_MCP_CENTRAL_STAGE !== "1") {
        return undefined;
    }
    const store = new McpProjectBindingStore(app.getPath("userData"), {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: text => safeStorage.encryptString(text),
        decrypt: bytes => safeStorage.decryptString(bytes)
    });
    const gate = new McpCentralAuthorizationGate(store, getDigiwiseAuthGuard,
        async ({tool,bindingId,bindingSecret}) => {
            const response = await callDigiwisePublicApiWithSession(
                (api, accessToken) => api.authorizeMcpTool(accessToken, {
                    registryVersion: MCP_TOOL_REGISTRY_VERSION,
                    tool, bindingId, bindingSecret
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
        authorizeProjectTool: (projectPath, tool) =>
            gate.authorizeProjectTool(projectPath, tool)
    };
}

export async function registerMcpIntegration(window: BrowserWindow) {
    if (initialized) return;
    initialized = true;

    const centralPolicy = stagedCentralPolicy();
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

    ipcMain.handle(CODEX_CHANNEL, event => {
        checkSender(event);
        return addDigiStudioToCodex();
    });

    const cleanup = () => {
        stopMcpServer();
        for (const channel of [STATUS_CHANNEL, TOGGLE_CHANNEL, CODEX_CHANNEL]) {
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
