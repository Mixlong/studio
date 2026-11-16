import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { app } from "electron";
import * as toml from "@iarna/toml";
import { MCP_SESSION_NAME } from "./protocol";

export const CODEX_MCP_SERVER_NAME = "digistudio";

export interface CodexImportResult {
    configPath: string;
    alreadyInstalled: boolean;
}

function codexConfigPath() {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    return path.join(codexHome, "config.toml");
}

function isSameRegistration(existing: any, entry: {
    command: string;
    args: string[];
    env: Record<string, string>;
}) {
    return (
        existing &&
        existing.command === entry.command &&
        Array.isArray(existing.args) &&
        JSON.stringify(existing.args) === JSON.stringify(entry.args) &&
        existing.env?.ELECTRON_RUN_AS_NODE === entry.env.ELECTRON_RUN_AS_NODE &&
        existing.env?.DIGISTUDIO_MCP_SESSION_FILE ===
            entry.env.DIGISTUDIO_MCP_SESSION_FILE
    );
}


function isOwnedDigiStudioEntry(existing: any, entry: {
    args: string[];
    env: Record<string, string>;
}) {
    if (!existing ||
        existing.env?.ELECTRON_RUN_AS_NODE !== "1" ||
        existing.env?.DIGISTUDIO_MCP_SESSION_FILE !==
            entry.env.DIGISTUDIO_MCP_SESSION_FILE ||
        !Array.isArray(existing.args) || existing.args.length !== 1 ||
        typeof existing.args[0] !== "string" ||
        typeof existing.command !== "string") {
        return false;
    }
    // Only migrate an entry that already launches our exact MCP script
    // basename. Other same-named MCP definitions remain protected.
    const normalized = existing.args[0].replace(/\\/g, "/").toLowerCase();
    return normalized.endsWith("/build/mcp/stdio-cli.mjs");
}

function findOwnTableRange(source: string) {
    const table = /^[ \t]*\[mcp_servers\.digistudio\][ \t]*$/gm;
    const headers = [...source.matchAll(table)];
    if (headers.length !== 1) {
        throw new Error("DigiStudio MCP entry uses an unsupported TOML layout");
    }
    const start = headers[0].index || 0;
    const headerEnd = start + headers[0][0].length;
    let end = source.length;
    const nextTable = /^[ \t]*\[([^\r\n\]]+)\][ \t]*$/gm;
    nextTable.lastIndex = headerEnd;
    let next: RegExpExecArray | null;
    while ((next = nextTable.exec(source)) !== null) {
        if (next[1] !== "mcp_servers.digistudio" &&
            !next[1].startsWith("mcp_servers.digistudio.")) {
            end = next.index;
            break;
        }
    }
    return { start, end, headerEnd };
}

/**
 * Register only our named entry, preserving every existing Codex setting.
 * Parse the existing TOML, and append a validated new table without
 * reserializing or removing its comments and other MCP definitions.
 */
export function addDigiStudioToCodex(): CodexImportResult {
    const configPath = codexConfigPath();
    const directory = path.dirname(configPath);
    const script = path.join(app.getAppPath(), "build", "mcp", "stdio-cli.mjs");
    if (!fs.existsSync(script)) {
        throw new Error("MCP stdio entry is missing. Rebuild DigiStudio first.");
    }

    const entry = {
        command: process.execPath,
        args: [script],
        tool_timeout_sec: 200,
        env: {
            ELECTRON_RUN_AS_NODE: "1",
            DIGISTUDIO_MCP_SESSION_FILE: path.join(
                app.getPath("userData"),
                MCP_SESSION_NAME
            )
        }
    };
    if (fs.existsSync(configPath) && fs.lstatSync(configPath).isSymbolicLink()) {
        throw new Error("Codex config is a symbolic link; refusing to replace it.");
    }
    const original = fs.existsSync(configPath)
        ? fs.readFileSync(configPath, "utf8")
        : "";
    if (Buffer.byteLength(original) > 4 * 1024 * 1024) {
        throw new Error("Codex configuration is too large for safe automatic editing.");
    }

    const parsed = original ? (toml.parse(original) as any) : {};
    const existingEntry = parsed.mcp_servers?.[CODEX_MCP_SERVER_NAME];
    let updated: string;
    if (existingEntry !== undefined) {
        if (!isOwnedDigiStudioEntry(existingEntry, entry)) {
            throw new Error(
                "Codex already has a different 'digistudio' MCP entry. No changes were made."
            );
        }
        const range = findOwnTableRange(original);
        if (isSameRegistration(existingEntry, entry)) {
            // Preserve custom timeouts that cover approval and execution.
            // Upgrade earlier DigiStudio registrations with a 130s timeout.
            if (typeof existingEntry.tool_timeout_sec === "number" &&
                existingEntry.tool_timeout_sec >= 200) {
                return { configPath, alreadyInstalled: true };
            }
            const following = /^[ \t]*\[[^\r\n]+\][ \t]*$/gm;
            following.lastIndex = range.headerEnd;
            const next = following.exec(original);
            const end = next ? next.index : original.length;
            const ownBody = original.slice(range.headerEnd, end);
            const timeoutLine = /^[ \t]*tool_timeout_sec[ \t]*=[^\r\n]*/m;
            const updatedBody = timeoutLine.test(ownBody)
                ? ownBody.replace(timeoutLine, "tool_timeout_sec = 200")
                : ownBody + (ownBody.endsWith("\n") ? "" : "\n") +
                    "tool_timeout_sec = 200\n";
            updated = original.slice(0, range.headerEnd) +
                updatedBody + original.slice(end);
        } else {
            // Migrating from npm start to an installed application changes
            // both the Electron executable and ASAR script paths. Replace
            // only our table, retaining all unrelated Codex MCP servers.
            const newTable = toml.stringify({
                mcp_servers: { [CODEX_MCP_SERVER_NAME]: entry }
            } as any);
            updated = original.slice(0, range.start) +
                newTable + "\n" + original.slice(range.end);
        }
    } else {
        const block = toml.stringify({
            mcp_servers: { [CODEX_MCP_SERVER_NAME]: entry }
        } as any);
        const separator = original.length === 0
            ? ""
            : original.endsWith("\n")
              ? "\n"
              : "\n\n";
        updated = original + separator + block;
    }

    // Refuse malformed or conflicting configuration before any writes.
    const verified = toml.parse(updated) as any;
    if (!isSameRegistration(verified.mcp_servers?.[CODEX_MCP_SERVER_NAME], entry) ||
        verified.mcp_servers?.[CODEX_MCP_SERVER_NAME]?.tool_timeout_sec !== 200) {
        throw new Error("Generated Codex configuration did not validate.");
    }

    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const tmpPath = path.join(
        directory,
        `.config.toml.digistudio-${process.pid}-${Date.now()}.tmp`
    );
    try {
        // Do not erase other clients' configuration and retain the original.
        if (fs.existsSync(configPath)) {
            if (fs.readFileSync(configPath, "utf8") !== original) {
                throw new Error("Codex configuration changed during import. Retry.");
            }
            fs.copyFileSync(
                configPath,
                `${configPath}.digistudio-backup-${Date.now()}`,
                fs.constants.COPYFILE_EXCL
            );
        }
        fs.writeFileSync(tmpPath, updated, { encoding: "utf8", flag: "wx", mode: 0o600 });
        fs.renameSync(tmpPath, configPath);
    } finally {
        try { fs.unlinkSync(tmpPath); } catch (_error) {}
    }
    return { configPath, alreadyInstalled: false };
}
