import { ipcRenderer } from "electron";

import type { DigiwiseIpcResult } from "eez-studio-shared/digiwise-auth";
import type {
    DigiwiseTemplateCreateRequest,
    DigiwiseTemplateCreateProgress,
    DigiwiseTemplateCreateResult,
    DigiwiseTemplateItem,
    DigiwiseTemplateOptions
} from "eez-studio-shared/digiwise-templates";

export function listDigiwiseTemplates() {
    return ipcRenderer.invoke("digistudio:templates:list") as Promise<
        DigiwiseIpcResult<DigiwiseTemplateItem[]>
    >;
}

export function getDigiwiseTemplateOptions() {
    return ipcRenderer.invoke("digistudio:templates:options") as Promise<
        DigiwiseIpcResult<DigiwiseTemplateOptions>
    >;
}

export function createDigiwiseTemplate(
    input: DigiwiseTemplateCreateRequest,
    onProgress: (progress: DigiwiseTemplateCreateProgress) => void
) {
    const listener = (
        _event: Electron.IpcRendererEvent,
        progress: DigiwiseTemplateCreateProgress
    ) => onProgress(progress);
    ipcRenderer.on("digistudio:templates:create-progress", listener);
    return (ipcRenderer.invoke(
        "digistudio:templates:create",
        input
    ) as Promise<DigiwiseIpcResult<DigiwiseTemplateCreateResult>>).finally(
        () => {
            ipcRenderer.removeListener(
                "digistudio:templates:create-progress",
                listener
            );
        }
    );
}
