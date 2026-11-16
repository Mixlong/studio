import * as fs from "fs";
import * as path from "path";
import { BrowserWindow } from "electron";
import { resolveProjectTemplateFile } from "eez-studio-shared/project-templates";
import { mcpReadError } from "./protocol";

export interface CreateProjectRequest {
    projectPath: string;
    lvglVersion?: string;
    flowSupport?: boolean;
    displayWidth?: number;
    displayHeight?: number;
    openWhenDone?: boolean;
}

const TEMPLATES: Record<string, [string, string]> = {
    "8.4.0": ["LVGL-8.3.eez-project", "LVGL with EEZ Flow-8.3.eez-project"],
    "9.2.2": ["LVGL-9.0.eez-project", "LVGL with EEZ Flow-9.0.eez-project"],
    "9.3.0": ["LVGL-9.0.eez-project", "LVGL with EEZ Flow-9.0.eez-project"],
    "9.4.0": ["LVGL-9.0.eez-project", "LVGL with EEZ Flow-9.0.eez-project"],
    "9.5.0": ["LVGL-9.0.eez-project", "LVGL with EEZ Flow-9.0.eez-project"]
};

/** Creates a fresh project using the same bundled LVGL templates as the UI Wizard. */
export async function createMcpProject(
    request: CreateProjectRequest,
    window: BrowserWindow
): Promise<unknown> {
    const projectPath = path.resolve(request.projectPath);
    const parentDir = path.dirname(projectPath);
    // Only write into an existing directory. Do not create arbitrary folders.
    const folder = await fs.promises.lstat(parentDir).catch(() => undefined);
    if (!folder?.isDirectory() || folder.isSymbolicLink()) {
        throw mcpReadError("INVALID_ARGUMENT",
            "Destination must be an existing local directory, not a symbolic link");
    }

    const version = request.lvglVersion || "8.4.0";
    const templates = TEMPLATES[version];
    if (!templates) throw mcpReadError("INVALID_ARGUMENT", "Unsupported LVGL version");
    const fileName = templates[request.flowSupport ? 1 : 0];
    const templatePath = resolveProjectTemplateFile(
        "templates/v0.23.0/" + fileName
    );
    const project = JSON.parse(await fs.promises.readFile(templatePath, "utf8"));
    if (project.settings?.general?.projectType !== "lvgl" ||
        !Array.isArray(project.userPages) || !project.userPages.length) {
        throw mcpReadError("INVALID_STATE", "Bundled LVGL template is invalid");
    }

    const general = project.settings.general;
    const width = request.displayWidth ?? 800;
    const height = request.displayHeight ?? 480;
    general.projectVersion = "v3";
    general.projectType = "lvgl";
    general.lvglVersion = version;
    general.flowSupport = !!request.flowSupport;
    general.displayWidth = width;
    general.displayHeight = height;

    for (const page of project.userPages) {
        const previousWidth = page.width || 800;
        const previousHeight = page.height || 480;
        page.left = 0;
        page.top = 0;
        page.width = width;
        page.height = height;
        for (const component of page.components || []) {
            if (component.type === "LVGLScreenWidget") {
                component.left = 0;
                component.top = 0;
                component.width = width;
                component.height = height;
                // Keep the sample label centered when the screen is resized.
                const dx = Math.round((width - previousWidth) / 2);
                const dy = Math.round((height - previousHeight) / 2);
                for (const child of component.children || []) {
                    if (Number.isFinite(child.left)) child.left += dx;
                    if (Number.isFinite(child.top)) child.top += dy;
                }
            }
        }
    }

    // Exclusive creation: neither an existing project nor another process's
    // concurrent creation can be overwritten. Never edit the active project.
    let handle: fs.promises.FileHandle | undefined;
    try {
        handle = await fs.promises.open(projectPath, "wx", 0o600);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw mcpReadError("INVALID_STATE", "Project file already exists; nothing was overwritten");
        }
        throw error;
    }
    try {
        await handle.writeFile(JSON.stringify(project, null, 2), "utf8");
    } catch (error) {
        await handle.close();
        handle = undefined;
        await fs.promises.unlink(projectPath).catch(() => {});
        throw error;
    } finally {
        if (handle) await handle.close();
    }

    let openRequested = false;
    if (request.openWhenDone !== false &&
        !window.isDestroyed() && !window.webContents.isDestroyed()) {
        try {
            window.webContents.send("open-project", projectPath, false);
            // This signals a request to open, not successful project loading.
            openRequested = true;
        } catch (error) {
            console.warn("[mcp] Project created; could not open editor tab:", error);
        }
    }
    return {
        created: true,
        projectPath,
        lvglVersion: version,
        flowSupport: !!request.flowSupport,
        displayWidth: width,
        displayHeight: height,
        openRequested
    };
}
