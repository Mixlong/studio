import fs from "fs";
import path from "path";

export const BUILT_IN_TEMPLATE_DIRECTORY = "project-templates";

/**
 * Keep bundled resources accessible in development and packaged Electron.
 * Custom templates are an explicit opt-in, never a network fallback.
 */
export function getBuiltInTemplatesDirectory(
    resourcesPath: string = process.resourcesPath,
    sourceRoot: string = path.resolve(__dirname, "../..")
): string {
    const packaged = path.join(resourcesPath || "", BUILT_IN_TEMPLATE_DIRECTORY);
    if (resourcesPath && fs.existsSync(path.join(packaged, "templates"))) {
        return packaged;
    }

    const development = path.join(
        sourceRoot,
        "resources",
        BUILT_IN_TEMPLATE_DIRECTORY
    );
    if (fs.existsSync(path.join(development, "templates"))) {
        return development;
    }

    return resourcesPath ? packaged : development;
}

export function resolveProjectTemplateFile(
    relativePath: string,
    customDirectory?: string,
    resourcesPath?: string,
    sourceRoot?: string
): string {
    const normalized = relativePath.replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (
        !normalized ||
        path.isAbsolute(normalized) ||
        segments.some(part => !part || part === "." || part === ".." || part.includes(":"))
    ) {
        throw new Error("Invalid project template resource path.");
    }

    const root = customDirectory
        ? path.resolve(customDirectory)
        : getBuiltInTemplatesDirectory(resourcesPath, sourceRoot);
    return path.join(root, ...segments);
}
