/**
 * Capture/input the ONLY native WASM Run canvas bound to this active project.
 * No screen, BrowserWindow, arbitrary DOM selector, fake DOM events, user code,
 * URL, other tab or Docker preview is exposed by these MCP tools.
 */
import type { ProjectStore } from "project-editor/store";
import { RuntimeType } from "project-editor/project/project-type-traits";
import { mcpReadError } from "../protocol";

interface PreviewRuntime {
    isRunning: boolean;
    isStopped: boolean;
    isPaused: boolean;
    isDebuggerActive: boolean;
    error?: string;
    selectedPage?: { name: string; objID: string; width: number; height: number; left?: number; top?: number };
    displayWidth: number;
    displayHeight: number;
    ctx?: CanvasRenderingContext2D;
    lastScreen?: unknown;
    pointerEvents: { x: number; y: number; pressed: number }[];
}
const MAX_IMAGE_SIDE = 1024;
const MAX_B64_SIZE = 1_350_000;
const lastTapAt = new WeakMap<object, number>();

export function findActivePreviewCanvas(
    store: ProjectStore, expectedPageId: string, documentRoot: Document = document
) {
    if (store.projectTypeTraits.runtimeType !== RuntimeType.WASM) {
        throw mcpReadError("INVALID_STATE", "Only local WASM preview is supported");
    }
    const runtime = store.runtime as unknown as PreviewRuntime | undefined;
    if (!runtime || !runtime.isRunning || runtime.isPaused || runtime.isStopped ||
        runtime.isDebuggerActive || runtime.error) {
        throw mcpReadError("INVALID_STATE", "Local WASM preview must be running and not paused");
    }
    const page = runtime.selectedPage;
    if (!page || !page.objID || page.objID !== expectedPageId ||
        !store.project.pages.some(item => item === page)) {
        throw mcpReadError("INVALID_STATE", "Preview page changed; call get_preview_status for a fresh selectedPageId");
    }
    const projectId = store.project.objID;
    if (!projectId || !runtime.ctx?.canvas || !runtime.lastScreen) {
        throw mcpReadError("INVALID_STATE", "Preview frame is not ready");
    }
    const canvas = runtime.ctx.canvas;
    const visible = Array.from(documentRoot.querySelectorAll<HTMLCanvasElement>(
        "canvas[data-digi-mcp-preview-project-id]"
    )).filter(candidate => {
        const bounds = candidate.getBoundingClientRect();
        return candidate.isConnected &&
            candidate.getAttribute("data-digi-mcp-preview-project-id") === projectId &&
            candidate.getClientRects().length > 0 &&
            bounds.width > 1 && bounds.height > 1;
    });
    if (visible.length !== 1 || visible[0] !== canvas) {
        throw mcpReadError("INVALID_STATE", "Visible preview canvas is missing, ambiguous or not owned by the WASM runtime");
    }
    if (!Number.isSafeInteger(runtime.displayWidth) ||
        !Number.isSafeInteger(runtime.displayHeight) ||
        runtime.displayWidth <= 0 || runtime.displayWidth > 4096 ||
        runtime.displayHeight <= 0 || runtime.displayHeight > 4096 ||
        canvas.width !== runtime.displayWidth || canvas.height !== runtime.displayHeight ||
        !Number.isSafeInteger(page.width) || !Number.isSafeInteger(page.height) ||
        page.width < 1 || page.height < 1 ||
        page.width > canvas.width || page.height > canvas.height) {
        throw mcpReadError("INVALID_STATE", "Preview framebuffer dimensions are invalid");
    }
    // Matches WasmRuntime.updateCanvasContext() framebuffer placement.
    const sourceX = runtime.displayWidth === page.width ? 0
        : (runtime.displayWidth - page.width) / 2 + (page.left ?? 0);
    const sourceY = runtime.displayHeight === page.height ? 0
        : (runtime.displayHeight - page.height) / 2 + (page.top ?? 0);
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY) ||
        sourceX < 0 || sourceY < 0 || sourceX + page.width > canvas.width ||
        sourceY + page.height > canvas.height) {
        throw mcpReadError("INVALID_STATE", "Preview page framebuffer position is invalid");
    }
    return { runtime, page, canvas, sourceX, sourceY };
}

export function capturePreviewSnapshot(
    store: ProjectStore, expectedPageId: string, documentRoot: Document = document
) {
    const { runtime, page, canvas, sourceX, sourceY } = findActivePreviewCanvas(
        store, expectedPageId, documentRoot
    );
    const scale = Math.min(1, MAX_IMAGE_SIDE / page.width, MAX_IMAGE_SIDE / page.height);
    const capturedWidth = Math.max(1, Math.round(page.width * scale));
    const capturedHeight = Math.max(1, Math.round(page.height * scale));
    const output = documentRoot.createElement("canvas");
    output.width = capturedWidth;
    output.height = capturedHeight;
    const ctx = output.getContext("2d");
    if (!ctx) throw mcpReadError("INVALID_STATE", "Unable to create preview capture canvas");
    try {
        ctx.drawImage(canvas, sourceX, sourceY, page.width, page.height,
            0, 0, capturedWidth, capturedHeight);
        const uri = output.toDataURL("image/png");
        if (!uri.startsWith("data:image/png;base64,")) {
            throw mcpReadError("INVALID_STATE", "Preview frame PNG export failed");
        }
        const pngBase64 = uri.slice("data:image/png;base64,".length);
        if (pngBase64.length < 16 || pngBase64.length > MAX_B64_SIZE ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64)) {
            throw mcpReadError("LIMIT_EXCEEDED", "Preview PNG exceeded safe transfer limit");
        }
        return {
            source: "active-lvgl-wasm-preview-canvas", pageName: page.name,
            pageId: page.objID, width: page.width, height: page.height,
            capturedWidth, capturedHeight, capturedAt: new Date().toISOString(),
            previewMode: "wasm-running", simulationVerified: true,
            frameVerified: !!runtime.lastScreen, mimeType: "image/png", pngBase64
        };
    } catch (error) {
        if (error && typeof error === "object" && "code" in error) throw error;
        throw mcpReadError("INVALID_STATE", "Unable to read native WASM preview pixels");
    }
}

export async function tapPreview(
    store: ProjectStore, expectedPageId: string, x: number, y: number,
    documentRoot: Document = document
) {
    const { runtime, page } = findActivePreviewCanvas(store, expectedPageId, documentRoot);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
        x < 0 || y < 0 || x >= page.width || y >= page.height ||
        !Array.isArray(runtime.pointerEvents)) {
        throw mcpReadError("INVALID_ARGUMENT", "Tap coordinates must be within current preview page pixels");
    }
    const now = Date.now();
    if (now - (lastTapAt.get(runtime) || 0) < 300) {
        throw mcpReadError("INVALID_STATE", "Preview taps are rate limited");
    }
    lastTapAt.set(runtime, now);
    const original = runtime;
    original.pointerEvents.push({ x, y, pressed: 1 });
    try {
        // WASM animationFrameLoop flushes pointerEvents to its worker.
        await new Promise(resolve => setTimeout(resolve, 90));
    } finally {
        // Release even if the active page changes while the action executes.
        if (store.runtime === (original as unknown as typeof store.runtime) &&
            !original.isStopped && Array.isArray(original.pointerEvents)) {
            original.pointerEvents.push({ x, y, pressed: 0 });
        }
    }
    await new Promise(resolve => setTimeout(resolve, 95));
    const after = store.runtime as unknown as PreviewRuntime | undefined;
    if (after !== original || !after?.isRunning || after.error) {
        throw mcpReadError("INVALID_STATE", "Preview stopped or failed during tap");
    }
    return {
        dispatched: true, mode: "wasm", x, y, originalPageId: expectedPageId,
        currentPageId: after.selectedPage?.objID || null,
        currentPage: after.selectedPage?.name || null,
        // Native delivery is verified; UI event's business effect must be checked
        // with a fresh get_preview_snapshot / get_preview_status call.
        actionEffectVerified: false
    };
}
