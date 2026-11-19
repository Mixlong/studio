import { ipcMain, BrowserWindow } from "electron";
import { callDigiwisePublicApiWithSession, getDigiwiseAuthGuard } from "main/digiwise-auth";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";

let registered = false;

export function registerDigiwiseBspCatalogIpc(
    windowOrResolver: BrowserWindow | (() => BrowserWindow)
) {
    if (registered) return;
    registered = true;
    const checkSender = (event: Electron.IpcMainInvokeEvent) => {
        const window = typeof windowOrResolver === "function"
            ? windowOrResolver()
            : windowOrResolver;
        if (window.isDestroyed() || window.webContents.isDestroyed() ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame) {
            throw new Error("Unauthorized BSP catalog request");
        }
    };
    const current = async <T>(operation: () => Promise<DigiwiseIpcResult<T>>): Promise<DigiwiseIpcResult<T>> => {
        const initialGuard = getDigiwiseAuthGuard();
        const generation = initialGuard.generation;
        const result = await operation();
        const finalGuard = getDigiwiseAuthGuard();
        if (!initialGuard.authenticated || !finalGuard.authenticated || finalGuard.generation !== generation) {
            return { ok: false, error: { status: 401, code: "AUTH_REQUIRED", message: "Session changed", requestId: "session-changed" } };
        }
        return result;
    };
    ipcMain.handle("digistudio:bsp:categories", event => {
        checkSender(event);
        return current(() => callDigiwisePublicApiWithSession((api, token) => api.listCategories(token)));
    });
    ipcMain.handle("digistudio:bsp:versions", (event, categoryCode: unknown) => {
        checkSender(event);
        return current(() => callDigiwisePublicApiWithSession((api, token) => api.listBspVersions(token, categoryCode as string | undefined)));
    });
}
