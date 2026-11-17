/**
 * Security-sensitive MCP approval window owned by Electron Main.
 * Never delegate approval to the project editor's renderer, because it has
 * nodeIntegration enabled and must not be able to spoof a local user grant.
 */
import { BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { buildMcpApprovalHtml } from "./approval-view";

const CHANNEL = "digistudio:mcp:approval-choice";
export type McpApprovalChoice = 0 | 1 | 2;

/** Close/Esc/parent destruction/loading errors all mean DENY (0). */
export function showMcpApproval(
    parent: BrowserWindow,
    tool: string,
    args: unknown,
    isChinese: boolean,
    signal?: AbortSignal,
    isDarkTheme = true
): Promise<McpApprovalChoice> {
    if (signal?.aborted || parent.isDestroyed() || parent.webContents.isDestroyed()) {
        return Promise.resolve(0);
    }
    return new Promise(resolve => {
        const modal = new BrowserWindow({
            parent,
            modal: true,
            width: 620,
            height: 530,
            minWidth: 520,
            minHeight: 470,
            frame: false,
            backgroundColor: isDarkTheme ? "#242424" : "#ffffff",
            show: false,
            resizable: false,
            maximizable: false,
            minimizable: false,
            fullscreenable: false,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                preload: path.join(__dirname, "approval-preload.js")
            }
        });
        let settled = false;
        let destructionCheck: ReturnType<typeof setInterval> | undefined;
        const cleanup = () => {
            if (destructionCheck) clearInterval(destructionCheck);
            ipcMain.removeListener(CHANNEL, onChoice);
            parent.removeListener("closed", deny);
            parent.webContents.removeListener("destroyed", deny);
            signal?.removeEventListener("abort", deny);
            modal.webContents.removeListener("render-process-gone", deny);
            modal.webContents.removeListener("destroyed", denyOnClosed);
            modal.webContents.removeListener("will-navigate", blockNavigation);
            modal.removeListener("close", denyOnClosed);
            modal.removeListener("closed", denyOnClosed);
        };
        const finish = (choice: McpApprovalChoice, destroyWindow = true) => {
            if (settled) return;
            settled = true;
            cleanup();
            // This dialog has no unsaved content or beforeunload flow.
            // Destroy synchronously so repeated authorizations cannot leave a
            // still-modal old window blocking the next request.
            if (destroyWindow && !modal.isDestroyed()) modal.destroy();
            resolve(choice);
        };
        const deny = () => finish(0);
        // On Electron's own 'closed' event, destruction is already underway.
        // A second destroy() here would re-enter the native close lifecycle.
        const denyOnClosed = () => finish(0, false);
        const onChoice = (event: Electron.IpcMainEvent, choice: unknown) => {
            if (event.sender !== modal.webContents ||
                event.senderFrame !== modal.webContents.mainFrame ||
                (choice !== 0 && choice !== 1 && choice !== 2)) {
                return;
            }
            finish(choice);
        };
        const blockNavigation = (event: Electron.Event) => event.preventDefault();
        ipcMain.on(CHANNEL, onChoice);
        parent.once("closed", deny);
        parent.webContents.once("destroyed", deny);
        signal?.addEventListener("abort", deny, { once: true });
        modal.webContents.once("render-process-gone", deny);
        modal.webContents.on("will-navigate", blockNavigation);
        modal.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        // Native close, force-destroy and webContents destruction must DENY.
        // Never recursively destroy from an ongoing close/destroy event.
        // The custom X button sends an explicit choice 0 from preload.
        modal.on("close", denyOnClosed);
        modal.on("closed", denyOnClosed);
        modal.webContents.once("destroyed", denyOnClosed);
        modal.webContents.once("did-finish-load", () => {
            if (!settled && !parent.isDestroyed()) modal.show();
        });
        // On some Windows/Electron builds, externally destroying a modal
        // makes isDestroyed() true without dispatching close/closed to JS.
        // Fail closed and release the pending bridge even in that case.
        destructionCheck = setInterval(() => {
            if (settled) return;
            if (modal.isDestroyed() || modal.webContents.isDestroyed()) {
                finish(0, false);
            } else if (parent.isDestroyed() || parent.webContents.isDestroyed()) {
                deny();
            }
        }, 150);
        destructionCheck.unref?.();

        const html = buildMcpApprovalHtml(tool, args, isChinese, isDarkTheme);
        void modal.loadURL("data:text/html;charset=utf-8," +
            encodeURIComponent(html)).catch(deny);
    });
}
