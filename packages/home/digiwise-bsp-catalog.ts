import { ipcRenderer } from "electron";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import type { DigiwiseCategory, DigiwiseBspVersion } from "eez-studio-shared/digiwise-bsp-catalog";

export function listDigiwiseCategories() {
    return ipcRenderer.invoke("digistudio:bsp:categories") as Promise<DigiwiseIpcResult<DigiwiseCategory[]>>;
}

export function listDigiwiseBspVersions(categoryCode?: string) {
    return ipcRenderer.invoke("digistudio:bsp:versions", categoryCode) as Promise<DigiwiseIpcResult<DigiwiseBspVersion[]>>;
}
