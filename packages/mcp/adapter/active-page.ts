import type { ProjectStore } from "project-editor/store";
import { mcpReadError } from "../protocol";

/**
 * Resolve the page actually displayed in the editor canvas, not merely the
 * previously selected item in the navigation tree. Never fall back to the
 * first page: doing so could silently modify an unexpected screen.
 */
export function resolveActivePageName(store: ProjectStore): string {
    const active = store.editorModeEditorsStore?.activeEditor?.object;
    const page = store.project.pages.find(candidate => candidate === active);
    if (!page) {
        throw mcpReadError(
            "NO_ACTIVE_PAGE",
            "Open the target LVGL page in the canvas or explicitly supply pageName"
        );
    }
    return page.name;
}
