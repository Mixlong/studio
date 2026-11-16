/**
 * Main-owned encrypted MCP project binding store.
 * Never trust modelId or binding IDs embedded in an editable .eez-project.
 * Copying/moving the file, changed file identity, different IDE user, or
 * missing/failed OS encryption all fail closed.
 */
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

export interface McpBindingCredential {
    bindingId: string;
    bindingSecret: string;
    modelId: number;
}
export interface McpProjectBinding extends McpBindingCredential {
    ownerUserId: string;
    projectKey: string;
    fileIdentity: string;
    /** Main-derived stable identity, confirmed by Java; not project JSON content. */
    projectFingerprint: string;
    projectRevision: number;
}
export interface McpBindingEncryption {
    isAvailable(): boolean;
    encrypt(value: string): Buffer;
    decrypt(value: Buffer): string;
}
interface RecordFile {
    version: 1;
    bindings: McpProjectBinding[];
}

const MAX_RECORDS = 128;
const MAX_BYTES = 256 * 1024;
const FILE_NAME = "mcp-project-bindings.v1";

function digest(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}
function identity(projectPath: string): { projectKey: string; fileIdentity: string } {
    const resolved = path.resolve(projectPath);
    const info = fs.lstatSync(resolved);
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("MCP binding requires a regular, non-symlink project file");
    }
    const real = fs.realpathSync.native(resolved);
    if (path.extname(real).toLowerCase() !== ".eez-project") {
        throw new Error("MCP binding requires an .eez-project file");
    }
    const canonical = process.platform === "win32" ? real.toLowerCase() : real;
    const stat = fs.statSync(real);
    // On Windows, Node may report ino=0 even for regular NTFS files.
    // Creation time is a fallback file identity; it must be finite and
    // positive, but is not a cryptographic guarantee against an OS-level
    // attacker who controls file metadata. Trust remains with Java model
    // grants, encrypted Main-owned credential and an explicit binding flow.
    if (!stat.isFile() || !Number.isFinite(stat.birthtimeMs) ||
        stat.birthtimeMs <= 0) {
        throw new Error("MCP project file identity is unavailable");
    }
    const fileId = Number.isSafeInteger(stat.ino) && stat.ino > 0
        ? `ino:${stat.ino}` : `birth:${stat.birthtimeMs}`;
    return {
        projectKey: digest(canonical),
        fileIdentity: digest([canonical, stat.dev, fileId, stat.birthtimeMs].join("|"))
    };
}
function validateCredential(record: McpBindingCredential) {
    if (!record || !Number.isSafeInteger(record.modelId) || record.modelId <= 0 ||
        typeof record.bindingId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(record.bindingId) ||
        typeof record.bindingSecret !== "string" ||
        !/^mcpb_[A-Za-z0-9_-]{43}$/.test(record.bindingSecret)) {
        throw new Error("MCP binding credential is invalid");
    }
}
function recordValid(record: McpProjectBinding): boolean {
    try {
        validateCredential(record);
        return typeof record.ownerUserId === "string" &&
            /^[0-9]{1,20}$/.test(record.ownerUserId) &&
            /^[0-9a-f]{64}$/.test(record.projectKey) &&
            /^[0-9a-f]{64}$/.test(record.fileIdentity) &&
            /^[0-9a-f]{64}$/.test(record.projectFingerprint) &&
            record.projectRevision === 1;
    } catch {
        return false;
    }
}

export class McpProjectBindingStore {
    private readonly file: string;
    constructor(userDataPath: string, private readonly codec: McpBindingEncryption) {
        this.file = path.join(userDataPath, FILE_NAME);
    }

    private ensureEncryption(): void {
        if (!this.codec.isAvailable()) {
            throw new Error("OS encryption unavailable; refusing MCP project binding");
        }
    }
    private read(): RecordFile {
        this.ensureEncryption();
        if (!fs.existsSync(this.file)) return { version: 1, bindings: [] };
        const fileStat = fs.lstatSync(this.file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_BYTES) {
            throw new Error("Invalid MCP project binding store");
        }
        let data: unknown;
        try {
            const raw = fs.readFileSync(this.file);
            data = JSON.parse(this.codec.decrypt(raw));
        } catch {
            throw new Error("Cannot decrypt MCP project bindings; refusing access");
        }
        const decoded = data as RecordFile;
        if (!decoded || decoded.version !== 1 ||
            !Array.isArray(decoded.bindings) ||
            decoded.bindings.length > MAX_RECORDS ||
            !decoded.bindings.every(recordValid)) {
            throw new Error("Invalid MCP project binding records");
        }
        return decoded;
    }
    private write(records: RecordFile): void {
        this.ensureEncryption();
        if (records.bindings.length > MAX_RECORDS) {
            throw new Error("Too many MCP project bindings");
        }
        const data = this.codec.encrypt(JSON.stringify(records));
        if (data.length > MAX_BYTES) throw new Error("MCP binding store exceeds limit");
        const temp = this.file + "." + process.pid + ".tmp";
        fs.writeFileSync(temp, data, { flag: "wx", mode: 0o600 });
        try {
            fs.renameSync(temp, this.file);
        } catch (error) {
            fs.rmSync(temp, { force: true });
            throw error;
        }
    }
    /** Fingerprint is pinned on first binding; authorized saves only refresh file identity. */
    fingerprintForNewProject(projectPath: string, bindingId: string): string {
        if (typeof bindingId !== "string" || !/^[0-9a-f-]{36}$/i.test(bindingId)) {
            throw new Error("Invalid MCP binding ID");
        }
        const file = identity(projectPath);
        return digest([file.projectKey, file.fileIdentity, bindingId].join("|"));
    }

    /** Call only after successful Main-owned controlled new-project creation. */
    bindNewProject(projectPath: string, ownerUserId: string,
                   credential: McpBindingCredential): void {
        validateCredential(credential);
        if (!/^[0-9]{1,20}$/.test(ownerUserId)) {
            throw new Error("IDE account identity is missing");
        }
        const file = identity(projectPath);
        const data = this.read();
        if (data.bindings.some(item =>
            item.projectKey === file.projectKey && item.ownerUserId !== ownerUserId)) {
            throw new Error("Project binding belongs to another IDE account");
        }
        data.bindings = data.bindings.filter(item =>
            item.projectKey !== file.projectKey);
        data.bindings.push({
            ...credential,
            ownerUserId,
            projectKey: file.projectKey,
            fileIdentity: file.fileIdentity,
            projectFingerprint: this.fingerprintForNewProject(projectPath, credential.bindingId),
            projectRevision: 1
        });
        this.write(data);
    }

    /** Fail closed on copy, file replacement, account switch, or unreadable store. */
    find(projectPath: string, ownerUserId: string): McpProjectBinding | null {
        if (!/^[0-9]{1,20}$/.test(ownerUserId)) return null;
        const file = identity(projectPath);
        const record = this.read().bindings.find(item =>
            item.projectKey === file.projectKey &&
            item.ownerUserId === ownerUserId &&
            item.fileIdentity === file.fileIdentity);
        return record || null;
    }

    /**
     * The editor may atomically replace the same file on Save, changing its
     * birthtime/inode. Main may call this ONLY following a successfully
     * authorized save_project operation for the SAME binding ID and path.
     * This does not issue or change server credentials or model ownership.
     */
    refreshAfterAuthorizedSave(projectPath: string, ownerUserId: string,
                               bindingId: string): boolean {
        const file = identity(projectPath);
        const data = this.read();
        const existing = data.bindings.find(item =>
            item.projectKey === file.projectKey &&
            item.ownerUserId === ownerUserId &&
            item.bindingId === bindingId);
        if (!existing) return false;
        existing.fileIdentity = file.fileIdentity;
        this.write(data);
        return true;
    }

    revokeLocal(projectPath: string, ownerUserId: string): boolean {
        const file = identity(projectPath);
        const data = this.read();
        const next = data.bindings.filter(item =>
            !(item.projectKey === file.projectKey &&
              item.ownerUserId === ownerUserId));
        if (next.length === data.bindings.length) return false;
        data.bindings = next;
        this.write(data);
        return true;
    }
}
