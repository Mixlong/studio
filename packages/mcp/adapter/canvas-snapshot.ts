/**
 * Only exports pixels of the currently active LVGL *editor* page.
 * It cannot capture Electron windows, other apps, arbitrary DOM nodes,
 * inactive project tabs or hidden canvas previews.
 */
import type { ProjectStore } from "project-editor/store";
import { mcpReadError } from "../protocol";
import { resolveActivePageName } from "./active-page";

const MAX_DIMENSION = 1024;
const MAX_BASE64_LENGTH = 1_350_000;

export function captureActiveCanvas(
    store: ProjectStore,
    expectedPageId: string,
    runMode: boolean,
    documentRoot: Document = document
) {
    if (runMode || !!store.runtime) {
        throw mcpReadError("INVALID_STATE", "Switch to LVGL editor mode before capturing the edit canvas");
    }
    const activeName = resolveActivePageName(store);
    const page = store.project.pages.find(candidate => candidate.name === activeName);
    if (!page || !page.objID || page.objID !== expectedPageId) {
        throw mcpReadError("INVALID_STATE", "Active page changed; call get_active_page again");
    }
    const projectId = store.project.objID;
    if (!projectId) {
        throw mcpReadError("INVALID_STATE", "Project has no stable identity");
    }
    const visible = Array.from(
        documentRoot.querySelectorAll<HTMLCanvasElement>("canvas[data-digi-mcp-page-id][data-digi-mcp-project-id]")
    ).filter(canvas => {
        if (!canvas.isConnected ||
            canvas.getAttribute("data-digi-mcp-page-id") !== expectedPageId ||
            canvas.getAttribute("data-digi-mcp-project-id") !== projectId) {
            return false;
        }
        const rect = canvas.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && canvas.getClientRects().length > 0;
    });
    if (visible.length !== 1) {
        throw mcpReadError("INVALID_STATE", visible.length === 0
            ? "The active LVGL canvas is not visible or its renderer has not mounted"
            : "Multiple visible LVGL canvases match this page; capture refused");
    }
    const source = visible[0];
    const width = page.width;
    const height = page.height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 1 || height < 1 || width > 4096 || height > 4096 ||
        source.width !== width || source.height < height) {
        throw mcpReadError("INVALID_STATE", "LVGL canvas size does not match the active page");
    }
    // Crops expanded editing previews to the actual hardware display size;
    // resizes large displays, never includes editor toolbar, accounts or OS UI.
    const scale = Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height);
    const capturedWidth = Math.max(1, Math.round(width * scale));
    const capturedHeight = Math.max(1, Math.round(height * scale));
    const result = documentRoot.createElement("canvas");
    result.width = capturedWidth;
    result.height = capturedHeight;
    const context = result.getContext("2d");
    if (!context) {
        throw mcpReadError("INVALID_STATE", "Unable to create the isolated LVGL canvas buffer");
    }
    try {
        context.drawImage(source, 0, 0, width, height,
            0, 0, capturedWidth, capturedHeight);
        const dataUrl = result.toDataURL("image/png");
        const prefix = "data:image/png;base64,";
        if (!dataUrl.startsWith(prefix)) {
            throw mcpReadError("INVALID_STATE", "LVGL canvas did not export PNG data");
        }
        const pngBase64 = dataUrl.slice(prefix.length);
        if (pngBase64.length < 16 || pngBase64.length > MAX_BASE64_LENGTH ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64)) {
            throw mcpReadError("LIMIT_EXCEEDED", "LVGL canvas PNG exceeded the safe transfer limit");
        }
        return {
            source: "active-lvgl-editor-canvas",
            pageName: page.name,
            pageId: page.objID,
            width,
            height,
            capturedWidth,
            capturedHeight,
            capturedAt: new Date().toISOString(),
            previewMode: "editor",
            // An editor canvas frame is not evidence of successful simulator execution.
            simulationVerified: false,
            mimeType: "image/png",
            pngBase64
        };
    } catch (error) {
        if (error && typeof error === "object" && "code" in error) throw error;
        // A tainted/failed canvas is not a reason to fall back to whole-window capture.
        throw mcpReadError("INVALID_STATE", "Unable to read LVGL canvas pixels");
    }
}
