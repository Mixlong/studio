// Unified Renderer IPC client for the controlled local BSP -> Toolchain -> Build -> Download pipeline.
// All sensitive auth tokens, signed URLs, and child processes remain strictly inside Electron Main.

import { ipcRenderer } from "electron";
import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import type {
    DigiwiseBspBuildGateResult,
    DigiwiseBspDownloadProgress,
    DigiwiseBspVersion,
    DigiwiseCategory,
    DigiwiseInstalledBspRecord,
    DigiwiseProjectBspBinding
} from "eez-studio-shared/digiwise-bsp-catalog";
import type {
    LocalBuildLogEvent,
    LocalBuildRecord,
    LocalBuildRequest
} from "eez-studio-shared/digiwise-build";
import type {
    LocalDownloadLogEvent,
    LocalDownloadRecord,
    LocalDownloadRequest,
    LocalProbeDetectResult
} from "eez-studio-shared/digiwise-download";
import type {
    InstalledToolchainRecord,
    ToolchainEnvironmentReport,
    ToolchainManagerConfig,
    ToolchainPackageSpec,
    ToolchainPrepareProgress,
    ToolchainToolId
} from "eez-studio-shared/digiwise-toolchain";
import type { DigiwiseBspManifest } from "eez-studio-shared/digiwise-bsp-catalog";

export const digiwiseLocalPipeline = {
    // --- LB02: Controlled BSP Catalog, Download, Install & Build Gate ---
    listCategories(): Promise<DigiwiseIpcResult<DigiwiseCategory[]>> {
        return ipcRenderer.invoke("digistudio:bsp:categories");
    },
    listBspVersions(categoryCode?: string): Promise<DigiwiseIpcResult<DigiwiseBspVersion[]>> {
        return ipcRenderer.invoke("digistudio:bsp:versions", categoryCode);
    },
    listInstalledBsps(): Promise<DigiwiseIpcResult<DigiwiseInstalledBspRecord[]>> {
        return ipcRenderer.invoke("digistudio:bsp:installed");
    },
    downloadAndInstallBsp(bspId: number): Promise<DigiwiseIpcResult<DigiwiseInstalledBspRecord>> {
        return ipcRenderer.invoke("digistudio:bsp:download", bspId);
    },
    cancelBspDownload(bspId: number): Promise<DigiwiseIpcResult<{ cancelled: boolean }>> {
        return ipcRenderer.invoke("digistudio:bsp:cancel", bspId);
    },
    removeInstalledBsp(categoryCode: string, version: string): Promise<DigiwiseIpcResult<{ removed: true }>> {
        return ipcRenderer.invoke("digistudio:bsp:remove", categoryCode, version);
    },
    verifyBspBuildAccess(binding: DigiwiseProjectBspBinding): Promise<DigiwiseIpcResult<DigiwiseBspBuildGateResult>> {
        return ipcRenderer.invoke("digistudio:bsp:verify-build-access", binding);
    },
    onBspDownloadProgress(listener: (progress: DigiwiseBspDownloadProgress) => void): () => void {
        const handler = (_event: Electron.IpcRendererEvent, progress: DigiwiseBspDownloadProgress) => listener(progress);
        ipcRenderer.on("digistudio:bsp:download-progress", handler);
        return () => ipcRenderer.removeListener("digistudio:bsp:download-progress", handler);
    },

    // --- LB03: Toolchain Manager ---
    getToolchainConfig(): Promise<DigiwiseIpcResult<ToolchainManagerConfig>> {
        return ipcRenderer.invoke("digistudio:toolchain:get-config");
    },
    setToolchainCustomRoots(roots: string[]): Promise<DigiwiseIpcResult<ToolchainManagerConfig>> {
        return ipcRenderer.invoke("digistudio:toolchain:set-custom-roots", roots);
    },
    inspectToolchain(manifest: DigiwiseBspManifest): Promise<DigiwiseIpcResult<ToolchainEnvironmentReport>> {
        return ipcRenderer.invoke("digistudio:toolchain:inspect", manifest);
    },
    installToolchain(spec: ToolchainPackageSpec): Promise<DigiwiseIpcResult<InstalledToolchainRecord>> {
        return ipcRenderer.invoke("digistudio:toolchain:install", spec);
    },
    cancelToolchainInstall(id: ToolchainToolId, version: string): Promise<DigiwiseIpcResult<{ cancelled: boolean }>> {
        return ipcRenderer.invoke("digistudio:toolchain:cancel", id, version);
    },
    removeToolchain(id: ToolchainToolId, version: string): Promise<DigiwiseIpcResult<{ removed: true }>> {
        return ipcRenderer.invoke("digistudio:toolchain:remove", id, version);
    },
    onToolchainProgress(listener: (progress: ToolchainPrepareProgress) => void): () => void {
        const handler = (_event: Electron.IpcRendererEvent, progress: ToolchainPrepareProgress) => listener(progress);
        ipcRenderer.on("digistudio:toolchain:progress", handler);
        return () => ipcRenderer.removeListener("digistudio:toolchain:progress", handler);
    },

    // --- LB04: Local Build Engine ---
    runLocalBuild(request: LocalBuildRequest): Promise<DigiwiseIpcResult<LocalBuildRecord>> {
        return ipcRenderer.invoke("digistudio:build:run", request);
    },
    cancelLocalBuild(buildId: string): Promise<DigiwiseIpcResult<{ cancelled: boolean }>> {
        return ipcRenderer.invoke("digistudio:build:cancel", buildId);
    },
    onLocalBuildLog(listener: (event: LocalBuildLogEvent) => void): () => void {
        const handler = (_event: Electron.IpcRendererEvent, payload: LocalBuildLogEvent) => listener(payload);
        ipcRenderer.on("digistudio:build:log", handler);
        return () => ipcRenderer.removeListener("digistudio:build:log", handler);
    },

    // --- LB05: Local Download Manager ---
    detectLocalProbe(probe: string): Promise<DigiwiseIpcResult<LocalProbeDetectResult>> {
        return ipcRenderer.invoke("digistudio:download:detect", probe);
    },
    runLocalDownload(request: LocalDownloadRequest): Promise<DigiwiseIpcResult<LocalDownloadRecord>> {
        return ipcRenderer.invoke("digistudio:download:run", request);
    },
    cancelLocalDownload(downloadId: string): Promise<DigiwiseIpcResult<{ cancelled: boolean }>> {
        return ipcRenderer.invoke("digistudio:download:cancel", downloadId);
    },
    onLocalDownloadLog(listener: (event: LocalDownloadLogEvent) => void): () => void {
        const handler = (_event: Electron.IpcRendererEvent, payload: LocalDownloadLogEvent) => listener(payload);
        ipcRenderer.on("digistudio:download:log", handler);
        return () => ipcRenderer.removeListener("digistudio:download:log", handler);
    }
};
