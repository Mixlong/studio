/**
 * Main-only MCP online authorization preflight. Deliberately kept separate
 * from the transport so it can be tested without user projects or Electron.
 *
 * Main invokes this for every actual tool operation, never caches positive decisions.
 */
import { McpProjectBindingStore } from "./project-binding-store";
import type { DigiwiseMcpExecutionAuthorization } from
    "eez-studio-shared/digiwise-mcp-project-binding";
import { isReadTool } from "./validator";

export interface McpAuthIdentity {
    authenticated: boolean;
    userId: string | null;
    generation: number;
}
export interface McpBindingDecision {
    decisionId: string;
    bindingId: string;
    modelId: number;
    tool: string;
    accountGeneration: number;
    globalPolicyRevision: number;
    accountPolicyRevision: number;
    expiresAt: string;
    requestId: string;
    clientSessionId: string;
    parameterDigest: string;
    projectFingerprint: string;
    projectRevision: number;
    riskGroup: "project.view" | "project.edit" | "build.run";
}
export type BackendToolAuthorization = (input: {
    tool: string;
    bindingId: string;
    bindingSecret: string;
    clientSessionId: string;
    projectFingerprint: string;
    projectRevision: number;
    riskGroup: "project.view" | "project.edit" | "build.run";
    parameterDigest: string;
}) => Promise<DigiwiseMcpExecutionAuthorization>;

export class CentralMcpAccessError extends Error {
    constructor(public readonly code: "AUTH_REQUIRED" | "ACCESS_DENIED" |
                "PROJECT_UNBOUND" | "PROJECT_CHANGED" | "MCP_POLICY_UNAVAILABLE",
                message: string) {
        super(message);
        this.name = "CentralMcpAccessError";
    }
}

export class McpCentralAuthorizationGate {
    constructor(
        private readonly store: McpProjectBindingStore,
        private readonly getAccount: () => McpAuthIdentity,
        private readonly authorizeOnline: BackendToolAuthorization
    ) {}

    /** Recheck online for EACH tool; no positive decision is cached. */
    async authorizeProjectTool(projectPath: string, tool: string,
                               parameterDigest: string, clientSessionId: string): Promise<McpBindingDecision> {
        if (!/^[0-9a-f]{64}$/i.test(parameterDigest) ||
            !/^[A-Za-z0-9_-]{16,128}$/.test(clientSessionId)) {
            throw new CentralMcpAccessError("ACCESS_DENIED", "Invalid MCP request identity");
        }
        const riskGroup = tool === "start_project_check" || tool === "start_project_build"
            ? "build.run" : isReadTool(tool) ? "project.view" : "project.edit";
        const before = this.getAccount();
        if (!before.authenticated || !before.userId) {
            throw new CentralMcpAccessError("AUTH_REQUIRED",
                "Sign in to an active DigiwiseStudio IDE account");
        }
        let local;
        try {
            local = this.store.find(projectPath, before.userId);
        } catch {
            throw new CentralMcpAccessError("PROJECT_UNBOUND",
                "This local project has no valid trusted MCP binding");
        }
        if (!local) {
            throw new CentralMcpAccessError("PROJECT_UNBOUND",
                "This local project has no valid trusted MCP binding");
        }
        let remote: DigiwiseMcpExecutionAuthorization;
        try {
            remote = await this.authorizeOnline({
                tool, bindingId: local.bindingId, bindingSecret: local.bindingSecret,
                clientSessionId, projectFingerprint: local.projectFingerprint,
                projectRevision: local.projectRevision, riskGroup, parameterDigest
            });
        } catch {
            throw new CentralMcpAccessError("MCP_POLICY_UNAVAILABLE",
                "Backend denied or could not verify the MCP project/tool permission");
        }
        const after = this.getAccount();
        if (!after.authenticated || after.userId !== before.userId ||
            after.generation !== before.generation) {
            throw new CentralMcpAccessError("AUTH_REQUIRED",
                "IDE authentication changed during MCP authorization");
        }
        let current;
        try {
            current = this.store.find(projectPath, after.userId!);
        } catch {
            throw new CentralMcpAccessError("PROJECT_CHANGED",
                "Project binding changed during authorization");
        }
        if (!current || current.bindingId !== local.bindingId ||
            current.fileIdentity !== local.fileIdentity) {
            throw new CentralMcpAccessError("PROJECT_CHANGED",
                "Project binding changed during authorization");
        }
        const remaining = Date.parse(remote.expiresAt) - Date.now();
        if (remote.scope !== "PROJECT_BINDING" ||
            remote.mcpExecutionAuthorized !== true ||
            remote.bindingId !== local.bindingId ||
            remote.modelId !== local.modelId ||
            remote.tool !== tool ||
            remote.serverDecision !== "allow" ||
            !/^[0-9a-f-]{36}$/i.test(remote.requestId) ||
            !/^[0-9a-f-]{36}$/i.test(remote.decisionId) ||
            remote.clientSessionId !== clientSessionId ||
            remote.parameterDigest !== parameterDigest ||
            remote.riskGroup !== riskGroup ||
            remote.projectFingerprint !== local.projectFingerprint ||
            remote.projectRevision !== local.projectRevision ||
            !Number.isSafeInteger(remote.globalPolicyRevision) ||
            !Number.isSafeInteger(remote.accountPolicyRevision) ||
            !(remaining > 0 && remaining <= 10_000)) {
            throw new CentralMcpAccessError("ACCESS_DENIED",
                "Backend MCP authorization is invalid, expired or mismatched");
        }
        return {
            decisionId: remote.decisionId, bindingId: remote.bindingId,
            modelId: remote.modelId, tool,
            accountGeneration: before.generation,
            globalPolicyRevision: remote.globalPolicyRevision,
            accountPolicyRevision: remote.accountPolicyRevision,
            expiresAt: remote.expiresAt,
            requestId: remote.requestId, clientSessionId, parameterDigest,
            projectFingerprint: local.projectFingerprint,
            projectRevision: local.projectRevision, riskGroup
        };
    }
}
