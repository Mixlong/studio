/** Server-issued MCP project binding API. Never expose bindingSecret to renderer or MCP Stdio. */
export interface DigiwiseMcpBindingIssueRequest {
    registryVersion: string;
    modelId: number;
}
export interface DigiwiseMcpBindingIssue {
    bindingId: string;
    bindingSecret: string;
    modelId: number;
    mcpExecutionAuthorized: false;
    nextRequirement: "MAIN_LOCAL_FILE_BINDING";
}
export interface DigiwiseMcpToolAuthorizeRequest {
    registryVersion: string;
    tool: string;
    bindingId: string;
    bindingSecret: string;
}
export interface DigiwiseMcpToolAuthorization {
    scope: "PROJECT_BINDING";
    decisionId: string;
    bindingId: string;
    modelId: number;
    tool: string;
    permission: "project.view" | "project.edit" | "build.run";
    globalPolicyRevision: number;
    accountPolicyRevision: number;
    expiresAt: string;
    mcpExecutionAuthorized: true;
}
export interface DigiwiseMcpBindingRevokeRequest {
    bindingId: string;
    bindingSecret: string;
}
export interface DigiwiseMcpBindingRevoke {
    revoked: boolean;
}

/** Java v3: a decision is scoped to one Main request, client session and exact arguments. */
export interface DigiwiseMcpExecutionRequest extends DigiwiseMcpToolAuthorizeRequest {
    clientSessionId: string;
    projectFingerprint: string;
    projectRevision: number;
    riskGroup: "project.view" | "project.edit" | "build.run";
    parameterDigest: string;
}
export interface DigiwiseMcpExecutionAuthorization extends DigiwiseMcpToolAuthorization {
    requestId: string;
    clientSessionId: string;
    projectFingerprint: string;
    projectRevision: number;
    riskGroup: "project.view" | "project.edit" | "build.run";
    parameterDigest: string;
    registryVersion: string;
    serverDecision: "allow";
    localConfirmationRequired: boolean;
}
export interface DigiwiseMcpConfirmBindingRequest {
    bindingId: string;
    bindingSecret: string;
    projectFingerprint: string;
    projectRevision: number;
}
export interface DigiwiseMcpExecutionAudit {
    requestId: string;
    decisionId: string;
    bindingId: string;
    clientSessionId: string;
    parameterDigest: string;
    localConfirmation: "confirmed" | "cancelled" | "not_required" | "offline";
    executionResult: "succeeded" | "failed" | "cancelled" | "revoked" | "not_started";
    errorCode?: string;
    durationMs?: number;
}

