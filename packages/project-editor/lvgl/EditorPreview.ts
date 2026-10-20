import type { Page } from "project-editor/features/page/page";
import type { IWasmFlowRuntime } from "eez-studio-types";
import type { LVGLWidget } from "project-editor/lvgl/widgets/Base";
import { ProjectEditor } from "project-editor/project-editor-interface";

// A virtual editor-only viewport: the project itself retains its true screen
// size. Bound excessively large imported layouts to protect LVGL WASM memory.
const MAX_EDITOR_PREVIEW_HEIGHT = 8192;

function dimension(value: number, fallback = 0): number {
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function getLVGLEditorWidgetHeight(widget: LVGLWidget): number {
    let bottom = dimension(widget.height);
    for (const child of widget.children) {
        if (!(child instanceof ProjectEditor.LVGLWidgetClass)) {
            continue;
        }
        const childWidget = child as LVGLWidget;
        bottom = Math.max(
            bottom,
            (Number.isFinite(childWidget.top) ? childWidget.top : 0) +
                getLVGLEditorWidgetHeight(childWidget)
        );
    }
    return Math.min(MAX_EDITOR_PREVIEW_HEIGHT, Math.ceil(Math.max(1, bottom)));
}

export function getLVGLEditorPreviewHeight(page: Page): number {
    const originalHeight = Math.max(1, Math.ceil(dimension(page.height, 1)));
    let bottom = originalHeight;

    const screen = page.lvglScreenWidget;
    if (screen) {
        bottom = Math.max(bottom, getLVGLEditorWidgetHeight(screen));
    } else {
        for (const component of page.components) {
            if (component instanceof ProjectEditor.LVGLWidgetClass) {
                const widget = component as LVGLWidget;
                bottom = Math.max(
                    bottom,
                    (Number.isFinite(widget.top) ? widget.top : 0) +
                        getLVGLEditorWidgetHeight(widget)
                );
            }
        }
    }

    // Preserve room below the last menu entry as in the actual screen.
    return Math.min(
        MAX_EDITOR_PREVIEW_HEIGHT,
        Math.max(originalHeight, Math.ceil(bottom + (bottom > originalHeight ? 40 : 0)))
    );
}

export function getLVGLEditorPreviewGeometry(page: Page) {
    return {
        left: page.left,
        top: page.top,
        width: page.width,
        height: getLVGLEditorPreviewHeight(page)
    };
}

/** Only mutates LVGL WASM preview objects; never the project model. */
export function resizeLVGLEditorObject(
    wasm: IWasmFlowRuntime,
    object: number,
    height: number
) {
    const previewWasm = wasm as IWasmFlowRuntime & {
        _lv_obj_set_height(object: number, height: number): void;
        _lv_obj_update_layout(object: number): void;
    };
    previewWasm._lv_obj_set_height(object, height);
    previewWasm._lv_obj_update_layout(object);
}
