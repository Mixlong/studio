/**
 * Preliminary Java-side MCP model-role check, NOT a project execution grant.
 * It uses IDE Bearer authentication and existing IDE model/role permissions.
 * Never turn modelAccessGranted into permission to read/write a local project.
 */
export interface DigiwiseMcpModelAccessRequest {
    registryVersion: string;
    tool: string;
    modelId: number | null;
}

export type DigiwiseMcpModelAccessResult =
    | {
        scope: "DISCOVERY_ONLY";
        mcpUseGranted: true;
        projectBindingVerified: false;
        mcpExecutionAuthorized: false;
    }
    | {
        scope: "MODEL_ONLY";
        decisionId: string;
        modelId: number;
        tool: string;
        permission: "project.view" | "project.edit" | "build.run";
        modelAccessGranted: true;
        projectBindingVerified: false;
        mcpExecutionAuthorized: false;
        nextRequirement: "TRUSTED_PROJECT_BINDING";
    };
