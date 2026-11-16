/** A bounded, per-ProjectStore asynchronous validation task for MCP.
 * This uses DigiwiseStudio's own "check" operation; it never builds files.
 */
import type { ProjectStore } from "project-editor/store";
import { ProjectEditor } from "project-editor/project-editor-interface";
import { Section } from "project-editor/store/output-sections";
import { mcpReadError } from "../protocol";
import * as fs from "fs";
import * as path from "path";

type TaskStatus = "running" | "succeeded" | "failed";
type CheckTask = {
    id: string;
    projectPath: string;
    status: TaskStatus;
    startedAt: string;
    finishedAt?: string;
    exception?: string;
    snapshot?: { errors: number; warnings: number; messages: { type: number; text: string }[] };
};
const checks = new WeakMap<ProjectStore, CheckTask>();
let sequence = 0;

function readOutput(store: ProjectStore) {
    const section = store.outputSectionsStore.getSection(Section.OUTPUT);
    const messages: { type: number; text: string }[] = [];
    // Keep the payload compact and do not emit arbitrary metadata from build objects.
    const visit = (items: any[], depth: number) => {
        if (depth > 8 || messages.length >= 60) return;
        for (const item of items || []) {
            if (messages.length >= 60) break;
            if (typeof item?.text === "string" && item.text.trim()) {
                messages.push({ type: Number(item.type) || 0, text: item.text.slice(0, 400) });
            }
            if (Array.isArray(item?.messages)) visit(item.messages, depth + 1);
        }
    };
    visit(section?.messages?.messages || [], 0);
    return { errors: section?.numErrors ?? 0, warnings: section?.numWarnings ?? 0, messages };
}

function summary(store: ProjectStore, task: CheckTask | undefined) {
    if (!task || task.projectPath !== store.filePath) return { status: "idle" };
    const output = task.snapshot || readOutput(store);
    return { status: task.status, taskId: task.id, startedAt: task.startedAt,
        finishedAt: task.finishedAt || null, ...output, exception: task.exception || null };
}

export function getProjectCheckStatus(store: ProjectStore) {
    return summary(store, checks.get(store));
}

export function startProjectCheck(store: ProjectStore) {
    if (builds.get(store)?.status === "running") {
        throw mcpReadError("INVALID_STATE", "A build is already running");
    }
    const prior = checks.get(store);
    if (prior?.status === "running" && prior.projectPath === store.filePath) {
        throw mcpReadError("INVALID_STATE", "A project check is already running");
    }
    if (!store.filePath) throw mcpReadError("UNSAVED_PROJECT", "Save the project before checking it");
    const task: CheckTask = {
        id: "check-" + Date.now().toString(36) + "-" + ++sequence,
        projectPath: store.filePath,
        status: "running",
        startedAt: new Date().toISOString()
    };
    checks.set(store, task);
    void Promise.resolve().then(async () => {
        try {
            await ProjectEditor.build.buildProject(store, "check");
            if (task.projectPath !== store.filePath) {
                task.status = "failed";
                task.exception = "Project changed while the check was running";
                return;
            }
            const section = store.outputSectionsStore.getSection(Section.OUTPUT);
            task.status = section?.numErrors ? "failed" : "succeeded";
        } catch (error) {
            task.status = "failed";
            task.exception = (error instanceof Error ? error.message : "Check failed").slice(0, 300);
        } finally {
            task.snapshot = readOutput(store);
            task.finishedAt = new Date().toISOString();
        }
    });
    return { started: true, taskId: task.id, status: task.status };
}

const builds = new WeakMap<ProjectStore, CheckTask>();

/** Refuse build configurations that can write or clean outside the saved project. */
function validateBuildDestination(store: ProjectStore) {
    if (!store.filePath) throw mcpReadError("UNSAVED_PROJECT", "Save the project before building");
    const root = fs.realpathSync(path.dirname(store.filePath));
    const buildSettings = store.project.settings.build;
    const configured = buildSettings?.destinationFolder || ".";
    if (typeof configured !== "string" || configured.length > 512 || configured.includes("\u0000")) {
        throw mcpReadError("INVALID_ARGUMENT", "Invalid build output directory");
    }
    const destination = path.resolve(store.getAbsoluteFilePath(configured));
    const contained = (base: string, candidate: string) => {
        const relative = path.relative(base, candidate);
        return !path.isAbsolute(relative) && relative !== ".." &&
            !relative.startsWith(".." + path.sep);
    };
    if (!contained(root, destination)) {
        throw mcpReadError("INVALID_ARGUMENT", "MCP build output must remain inside the saved project directory");
    }
    const checkExistingAncestor = (candidate: string, label: string) => {
        let existing = candidate;
        while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
            existing = path.dirname(existing);
        }
        if (!contained(root, fs.realpathSync(existing))) {
            throw mcpReadError("INVALID_ARGUMENT", label + " resolves through a symlink outside the project");
        }
    };
    checkExistingAncestor(destination, "Build output directory");
    const files = buildSettings?.files || [];
    if (files.length > 2000) throw mcpReadError("LIMIT_EXCEEDED", "Too many output templates");
    for (const file of files) {
        const name = file.fileName;
        if (typeof name !== "string" || !name || name.length > 256 ||
            path.isAbsolute(name) || name.includes(":") || name.includes("\u0000") ||
            name.replace(/\\/g, "/").split("/").includes("..")) {
            throw mcpReadError("INVALID_ARGUMENT", "Unsafe build output filename");
        }
        const target = path.resolve(destination, name);
        if (!contained(destination, target)) {
            throw mcpReadError("INVALID_ARGUMENT", "Build output filename escapes the destination");
        }
        // Existing destination files must not resolve outside the project through symlinks.
        checkExistingAncestor(target, "Build output file");
    }
    const manifest = path.join(destination, ".eez-project-build");
    if (fs.existsSync(manifest)) {
        if (!contained(root, fs.realpathSync(manifest))) {
            throw mcpReadError("INVALID_ARGUMENT", "Build manifest is an external symlink");
        }
        let parsed: { files?: unknown };
        try {
            if (fs.statSync(manifest).size > 1024 * 1024) throw Error("Manifest too large");
            parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
        } catch (_error) {
            throw mcpReadError("INVALID_ARGUMENT", "Invalid previous build manifest");
        }
        if (!parsed || !Array.isArray(parsed.files) || parsed.files.length > 2000) {
            throw mcpReadError("INVALID_ARGUMENT", "Invalid previous build manifest files");
        }
        for (const name of parsed.files) {
            if (typeof name !== "string" || !name || path.isAbsolute(name) ||
                name.includes(":") || name.includes("\u0000") ||
                name.replace(/\\/g, "/").split("/").includes("..") ||
                !contained(destination, path.resolve(destination, name))) {
                throw mcpReadError("INVALID_ARGUMENT", "Unsafe previous build manifest entry");
            }
            const generated = path.resolve(destination, name);
            checkExistingAncestor(generated, "Previous build output");
        }
    }
}

export function getProjectBuildStatus(store: ProjectStore) {
    return summary(store, builds.get(store));
}

export function startProjectBuild(store: ProjectStore) {
    if (checks.get(store)?.status === "running" || builds.get(store)?.status === "running") {
        throw mcpReadError("INVALID_STATE", "Another MCP validation/build task is already running");
    }
    validateBuildDestination(store);
    if (!store.filePath) throw mcpReadError("UNSAVED_PROJECT", "Save the project before building");
    const task: CheckTask = {
        id: "build-" + Date.now().toString(36) + "-" + ++sequence,
        projectPath: store.filePath,
        status: "running",
        startedAt: new Date().toISOString()
    };
    builds.set(store, task);
    void Promise.resolve().then(async () => {
        try {
            await store.build(); // reuse the IDE's existing build and output mechanisms
            if (task.projectPath !== store.filePath) {
                task.status = "failed";
                task.exception = "Project changed while the build was running";
                return;
            }
            const section = store.outputSectionsStore.getSection(Section.OUTPUT);
            task.status = section?.numErrors ? "failed" : "succeeded";
        } catch (error) {
            task.status = "failed";
            task.exception = (error instanceof Error ? error.message : "Build failed").slice(0, 300);
        } finally {
            task.snapshot = readOutput(store);
            task.finishedAt = new Date().toISOString();
        }
    });
    return { started: true, taskId: task.id, status: task.status };
}
