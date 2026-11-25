import { ipcRenderer } from "electron";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import type {
    DigiwiseCategory,
    DigiwiseBspVersion,
    DigiwiseInstalledBspRecord,
    DigiwiseBspDownloadProgress
} from "eez-studio-shared/digiwise-bsp-catalog";

export function listDigiwiseCategories() {
    return ipcRenderer.invoke("digistudio:bsp:categories") as Promise<DigiwiseIpcResult<DigiwiseCategory[]>>;
}

export function listDigiwiseBspVersions(categoryCode?: string) {
    return ipcRenderer.invoke("digistudio:bsp:versions", categoryCode) as Promise<DigiwiseIpcResult<DigiwiseBspVersion[]>>;
}

export function listInstalledDigiwiseBsps() {
    return ipcRenderer.invoke("digistudio:bsp:installed") as Promise<DigiwiseIpcResult<DigiwiseInstalledBspRecord[]>>;
}

export function downloadDigiwiseBsp(bspId: number) {
    return ipcRenderer.invoke("digistudio:bsp:download", bspId) as Promise<DigiwiseIpcResult<DigiwiseInstalledBspRecord>>;
}

export function removeInstalledDigiwiseBsp(categoryCode: string, version: string) {
    return ipcRenderer.invoke("digistudio:bsp:remove", categoryCode, version) as Promise<DigiwiseIpcResult<{ removed: true }>>;
}

export function onDigiwiseBspDownloadProgress(
    listener: (progress: DigiwiseBspDownloadProgress) => void
) {
    const handler = (_event: Electron.IpcRendererEvent, progress: DigiwiseBspDownloadProgress) => {
        listener(progress);
    };
    ipcRenderer.on("digistudio:bsp:download-progress", handler);
    return () => {
        ipcRenderer.removeListener("digistudio:bsp:download-progress", handler);
    };
}
