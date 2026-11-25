import type {
    DigiwiseMcpModelAccessRequest,
    DigiwiseMcpModelAccessResult
} from "eez-studio-shared/digiwise-mcp-model-access";
import type {
    DigiwiseMcpBindingIssueRequest,
    DigiwiseMcpBindingIssue,
    DigiwiseMcpToolAuthorizeRequest,
    DigiwiseMcpToolAuthorization,
    DigiwiseMcpBindingRevokeRequest,
    DigiwiseMcpBindingRevoke,
    DigiwiseMcpConfirmBindingRequest,
    DigiwiseMcpExecutionRequest,
    DigiwiseMcpExecutionAuthorization,
    DigiwiseMcpExecutionAudit
} from "eez-studio-shared/digiwise-mcp-project-binding";
import type {
    DigiwiseCaptcha,
    DigiwiseCurrentUserResponse,
    DigiwiseLoginResponse
} from "eez-studio-shared/digiwise-auth";
import type {
    DigiwiseTemplateDownload,
    DigiwiseTemplateOptions,
    DigiwiseTemplatePage
} from "eez-studio-shared/digiwise-templates";
import type {
    IdeReleaseCheck,
    IdeReleaseDownload
} from "./digiwise-update-policy";
import type {
    DigiwiseChangelog,
    DigiwiseChangelogLanguage
} from "eez-studio-shared/digiwise-changelog";
import type { DigiwiseCategory, DigiwiseBspVersion, DigiwiseBspDownloadMeta } from "eez-studio-shared/digiwise-bsp-catalog";

type JsonObject = Record<string, unknown>;

const MAX_CATEGORY_ITEMS = 200;
const MAX_BSP_ITEMS = 200;
const MAX_CATALOG_STRING_LENGTH = 256;
const MAX_BSP_FILE_NAME_LENGTH = 512;
const MAX_BSP_FILE_SIZE = 4 * 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PUBLISHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?$/;

function boundedString(value: unknown, maxLength: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function validPublishedAt(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && PUBLISHED_AT_PATTERN.test(value) && Number.isFinite(Date.parse(value)));
}

export class DigiwisePublicApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly requestId: string;

    constructor(status: number, code: string, message: string, requestId: string) {
        super(message);
        this.name = "DigiwisePublicApiError";
        this.status = status;
        this.code = code;
        this.requestId = requestId;
    }
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorCode(value: unknown, status: number) {
    if (typeof value === "string" && value.length > 0) {
        return value;
    }

    if (typeof value === "number") {
        const knownCodes: Record<number, string> = {
            400: "INVALID_REQUEST",
            401: "AUTH_REQUIRED",
            403: "ACCESS_DENIED",
            404: "NOT_FOUND",
            422: "INVALID_REQUEST",
            429: "RATE_LIMITED"
        };
        return knownCodes[value] || `HTTP_${value}`;
    }

    return `HTTP_${status}`;
}

function payloadStatus(status: number, payload: JsonObject) {
    if (status >= 400) {
        return status;
    }

    return typeof payload.code === "number" && payload.code >= 400
        ? payload.code
        : status;
}

function errorFromPayload(
    status: number,
    payload: unknown,
    fallbackMessage: string
) {
    const root = isObject(payload) ? payload : {};
    const nested = isObject(root.error) ? root.error : root;
    const effectiveStatus = payloadStatus(status, root);
    return new DigiwisePublicApiError(
        effectiveStatus,
        errorCode(nested.code, effectiveStatus),
        readString(nested.message) ||
            readString(nested.msg) ||
            fallbackMessage,
        readString(nested.requestId) || `http-${Date.now().toString(36)}`
    );
}

function normalizeBaseUrl(value: string) {
    let url: URL;
    try {
        url = new URL(value);
    } catch (_error) {
        throw new DigiwisePublicApiError(
            500,
            "PUBLIC_API_NOT_CONFIGURED",
            "The Digiwise IDE Public API URL is invalid",
            "local-config"
        );
    }

    if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username ||
        url.password
    ) {
        throw new DigiwisePublicApiError(
            500,
            "PUBLIC_API_NOT_CONFIGURED",
            "The Digiwise IDE Public API URL is not allowed",
            "local-config"
        );
    }

    return value.replace(/\/+$/, "");
}

interface SuccessEnvelope<T> {
    code: "OK";
    message: string;
    requestId: string;
    data: T;
}

export class DigiwisePublicApi {
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;

    constructor(baseUrl: string, fetchImpl: typeof fetch = globalThis.fetch) {
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.fetchImpl = fetchImpl.bind(globalThis);
    }

    private async request<T>(
        path: string,
        init: RequestInit,
        accessToken?: string
    ): Promise<T> {
        let response: Response;
        try {
            response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
                ...init,
                headers: {
                    Accept: "application/json",
                    ...(init.body ? { "Content-Type": "application/json" } : {}),
                    ...(accessToken
                        ? { Authorization: `Bearer ${accessToken}` }
                        : {}),
                    ...init.headers
                }
            });
        } catch (_error) {
            throw new DigiwisePublicApiError(
                503,
                "PUBLIC_API_UNAVAILABLE",
                "The Digiwise IDE Public API is unavailable",
                `network-${Date.now().toString(36)}`
            );
        }

        const text = await response.text();
        let payload: unknown;
        try {
            payload = text ? JSON.parse(text) : undefined;
        } catch (_error) {
            payload = undefined;
        }

        if (!response.ok) {
            throw errorFromPayload(
                response.status,
                payload,
                `The Digiwise IDE Public API returned HTTP ${response.status}`
            );
        }

        if (!isObject(payload) || payload.code !== "OK") {
            // RuoYi may return HTTP 200 with a numeric code such as 401. The
            // IDE contract explicitly forbids treating that response as a
            // successful Public API call.
            throw errorFromPayload(
                response.status,
                payload,
                "The Digiwise IDE Public API returned a failure response"
            );
        }

        if (!("data" in payload)) {
            throw new DigiwisePublicApiError(
                502,
                "PUBLIC_API_INVALID_RESPONSE",
                "The Digiwise IDE Public API response is missing data",
                readString(payload.requestId) || `response-${Date.now().toString(36)}`
            );
        }

        return (payload as unknown as SuccessEnvelope<T>).data;
    }

    getCaptcha() {
        return this.request<DigiwiseCaptcha>("auth/captcha", { method: "GET" });
    }

    login(
        username: string,
        password: string,
        captchaCode?: string,
        captchaUuid?: string
    ) {
        return this.request<DigiwiseLoginResponse>("auth/login", {
            method: "POST",
            body: JSON.stringify({
                username,
                password,
                ...(captchaCode ? { captchaCode } : {}),
                ...(captchaUuid ? { captchaUuid } : {})
            })
        });
    }


    /** Account-only MCP capability, not a project/model permission. */
    async getMcpPolicy(accessToken: string) {
        const data = await this.request<unknown>(
            "mcp/policy", {method: "GET", signal: AbortSignal.timeout(4500)}, accessToken);
        if (!isObject(data) || typeof data.authorized !== "boolean" ||
            typeof data.globalEnabled !== "boolean" ||
            typeof data.accountEnabled !== "boolean" ||
            !Number.isSafeInteger(data.globalPolicyRevision) ||
            !Number.isSafeInteger(data.accountPolicyRevision)) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "Invalid MCP account authorization status", "mcp-status-contract");
        }
        return data as {
            authorized: boolean; globalEnabled: boolean; accountEnabled: boolean;
            accessMode?: "disabled" | "all_active_users" | "selected_users";
            authorizationMode?: string;
            authorizationReason?: string;
            localConfirmationRequired?: boolean;
            registryVersion?: string;
            globalPolicyRevision: number; accountPolicyRevision: number;
        };
    }

    /** Explicit user-initiated MCP connect; requires live backend authorization. */
    async connectMcp(accessToken: string, input: {
        registryVersion: string;
        clientSessionId: string;
    }) {
        const data = await this.request<unknown>("mcp/connect", {
            method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500)
        }, accessToken);
        if (!isObject(data) || data.connected !== true ||
            data.clientSessionId !== input.clientSessionId ||
            data.registryVersion !== input.registryVersion ||
            !Number.isSafeInteger(data.globalPolicyRevision) ||
            !Number.isSafeInteger(data.accountPolicyRevision)) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "Invalid MCP connect response", "mcp-connect-contract");
        }
        return data as {
            connected: true;
            requestId?: string;
            clientSessionId: string;
            registryVersion: string;
            accessMode?: string;
            globalPolicyRevision: number;
            accountPolicyRevision: number;
            localConfirmationRequired?: boolean;
            silentExecution?: boolean;
        };
    }

    /** Explicit user-initiated MCP disconnect or account-switch cleanup. */
    async disconnectMcp(accessToken: string, input: {
        registryVersion: string;
        clientSessionId: string;
    }) {
        const data = await this.request<unknown>("mcp/disconnect", {
            method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500)
        }, accessToken);
        if (!isObject(data) || data.disconnected !== true) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "Invalid MCP disconnect response", "mcp-disconnect-contract");
        }
        return data as {
            disconnected: true;
            requestId?: string;
            clientSessionId?: string;
            revokedDecisions?: number;
        };
    }

    /** Online MCP account authorization, scoped to one tool request. */
    async authorizeSimpleMcp(accessToken: string, input: {
        registryVersion: string; tool: string;
        clientSessionId: string; parameterDigest: string;
    }) {
        const data = await this.request<unknown>("mcp/authorize-simple", {
            method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500)
        }, accessToken);
        const expiry = isObject(data) && typeof data.expiresAt === "string"
            ? Date.parse(data.expiresAt) : NaN;
        if (!isObject(data) || data.authorized !== true ||
            data.tool !== input.tool || data.registryVersion !== input.registryVersion ||
            data.clientSessionId !== input.clientSessionId ||
            data.parameterDigest !== input.parameterDigest ||
            !["project.view", "project.edit", "build.run"].includes(String(data.riskGroup)) ||
            typeof data.decisionId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(data.decisionId) ||
            !Number.isSafeInteger(data.globalPolicyRevision) ||
            !Number.isSafeInteger(data.accountPolicyRevision) ||
            !Number.isFinite(expiry) || expiry <= Date.now() ||
            expiry > Date.now() + 10_000) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "Invalid MCP online execution decision", "mcp-simple-contract");
        }
        return data as {
            authorized: true; requestId?: string; decisionId: string; tool: string;
            registryVersion: string; clientSessionId: string; parameterDigest: string;
            riskGroup: "project.view" | "project.edit" | "build.run";
            accessMode?: string;
            globalPolicyRevision: number; accountPolicyRevision: number;
            expiresAt: string;
            localConfirmationRequired?: boolean;
            silentExecution?: boolean;
        };
    }

    async auditSimpleMcp(accessToken: string, input: {
        requestId?: string;
        decisionId: string;
        tool: string;
        clientSessionId?: string;
        parameterDigest?: string;
        localConfirmation?: "not_required" | "confirmed" | "cancelled" | "offline";
        executionResult: "succeeded" | "failed" | "cancelled" | "not_started" | "revoked";
        errorCode?: string;
        durationMs?: number;
    }) {
        return this.request<{recorded: boolean; requestId?: string; decisionId?: string;
            localConfirmation?: string; deduplicated?: boolean}>("mcp/audit-simple", {
            method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500)
        }, accessToken);
    }

    /** Checks only live IDE account/model/role grants, NOT local project authorization. */
    async checkMcpModelAccess(accessToken: string, input: DigiwiseMcpModelAccessRequest) {
        const result = await this.request<unknown>(
            "mcp/check-model-access",
            { method: "POST", body: JSON.stringify(input) },
            accessToken
        );
        if (!isObject(result) ||
            result.mcpExecutionAuthorized !== false ||
            result.projectBindingVerified !== false ||
            (result.scope !== "MODEL_ONLY" && result.scope !== "DISCOVERY_ONLY") ||
            (result.scope === "MODEL_ONLY" &&
                (result.modelId !== input.modelId ||
                 result.tool !== input.tool ||
                 result.modelAccessGranted !== true ||
                 result.nextRequirement !== "TRUSTED_PROJECT_BINDING"))) {
            throw new DigiwisePublicApiError(
                502, "PUBLIC_API_INVALID_RESPONSE",
                "MCP model access response is invalid or claims unverified project authority",
                "mcp-contract"
            );
        }
        return result as unknown as DigiwiseMcpModelAccessResult;
    }

    /** Server binding credential for Main-owned new-project creation only. */
    async issueMcpProjectBinding(accessToken: string, input: DigiwiseMcpBindingIssueRequest) {
        const result = await this.request<unknown>(
            "mcp/issue-project-binding",
            { method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500) },
            accessToken
        );
        if (!isObject(result) ||
            typeof result.bindingId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(result.bindingId) ||
            typeof result.bindingSecret !== "string" ||
            !/^mcpb_[A-Za-z0-9_-]{43}$/.test(result.bindingSecret) ||
            result.modelId !== input.modelId ||
            result.mcpExecutionAuthorized !== false ||
            result.nextRequirement !== "MAIN_LOCAL_FILE_BINDING") {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "MCP binding issue response is invalid", "mcp-binding-contract");
        }
        return result as unknown as DigiwiseMcpBindingIssue;
    }

    /** One-time online decision; never cache beyond the single MCP operation. */
    async authorizeMcpTool(accessToken: string, input: DigiwiseMcpToolAuthorizeRequest) {
        const result = await this.request<unknown>(
            "mcp/authorize-tool",
            { method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500) },
            accessToken
        );
        const validUntil = isObject(result) && typeof result.expiresAt === "string"
            ? Date.parse(result.expiresAt) : NaN;
        if (!isObject(result) ||
            result.scope !== "PROJECT_BINDING" ||
            result.mcpExecutionAuthorized !== true ||
            result.bindingId !== input.bindingId ||
            result.tool !== input.tool ||
            !Number.isSafeInteger(result.modelId) ||
            (result.modelId as number) <= 0 ||
            typeof result.decisionId !== "string" ||
            !Number.isFinite(validUntil) ||
            validUntil <= Date.now() ||
            validUntil > Date.now() + 10_000 ||
            !Number.isSafeInteger(result.globalPolicyRevision) ||
            !Number.isSafeInteger(result.accountPolicyRevision)) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "MCP tool authorization response is invalid", "mcp-authorize-contract");
        }
        return result as unknown as DigiwiseMcpToolAuthorization;
    }

    /** Confirm a Main-owned local file against the freshly issued server binding. */
    async confirmMcpProjectBinding(accessToken: string, input: DigiwiseMcpConfirmBindingRequest) {
        const data = await this.request<unknown>(
            "mcp/confirm-project-binding",
            { method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500) },
            accessToken
        );
        if (!isObject(data) || data.trusted !== true ||
            data.bindingId !== input.bindingId ||
            data.projectFingerprint !== input.projectFingerprint ||
            data.projectRevision !== input.projectRevision) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "MCP project binding confirmation is invalid", "mcp-confirm-contract");
        }
        return data;
    }

    /** Actual execution decision; Java verifies live policy and records the request. */
    async authorizeMcpExecution(accessToken: string, input: DigiwiseMcpExecutionRequest) {
        const data = await this.request<unknown>(
            "mcp/authorize",
            { method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500) },
            accessToken
        );
        const expiry = isObject(data) && typeof data.expiresAt === "string"
            ? Date.parse(data.expiresAt) : NaN;
        if (!isObject(data) ||
            data.scope !== "PROJECT_BINDING" ||
            data.serverDecision !== "allow" ||
            data.mcpExecutionAuthorized !== true ||
            data.bindingId !== input.bindingId ||
            data.tool !== input.tool ||
            data.clientSessionId !== input.clientSessionId ||
            data.projectFingerprint !== input.projectFingerprint ||
            data.projectRevision !== input.projectRevision ||
            data.riskGroup !== input.riskGroup ||
            data.parameterDigest !== input.parameterDigest ||
            data.registryVersion !== input.registryVersion ||
            typeof data.decisionId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(data.decisionId) ||
            typeof data.requestId !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(data.requestId) ||
            !Number.isSafeInteger(data.modelId) ||
            !Number.isSafeInteger(data.globalPolicyRevision) ||
            !Number.isSafeInteger(data.accountPolicyRevision) ||
            !Number.isFinite(expiry) || expiry <= Date.now() ||
            expiry > Date.now() + 10_000) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "MCP execution decision is invalid", "mcp-execution-contract");
        }
        return data as unknown as DigiwiseMcpExecutionAuthorization;
    }

    async auditMcpExecution(accessToken: string, input: DigiwiseMcpExecutionAudit) {
        const result = await this.request<unknown>(
            "mcp/audit",
            { method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500) },
            accessToken
        );
        if (!isObject(result)) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "MCP execution audit acknowledgement is invalid", "mcp-audit-contract");
        }
        return result;
    }

    async revokeMcpBinding(accessToken: string, input: DigiwiseMcpBindingRevokeRequest) {
        const result = await this.request<unknown>(
            "mcp/revoke-project-binding",
            { method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(4500) },
            accessToken
        );
        if (!isObject(result) || typeof result.revoked !== "boolean") {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE",
                "MCP revoke response is invalid", "mcp-revoke-contract");
        }
        return result as unknown as DigiwiseMcpBindingRevoke;
    }

    getCurrentUser(accessToken: string) {
        return this.request<DigiwiseCurrentUserResponse>(
            "auth/me",
            { method: "GET" },
            accessToken
        );
    }

    logout(accessToken: string) {
        return this.request<{ revoked: true }>(
            "auth/logout",
            { method: "POST" },
            accessToken
        );
    }

    /** Public release notes are pinned to the installed version, not latest rollout. */
    getReleaseChangelog(
        version: string,
        channel: "stable" | "dev",
        language: DigiwiseChangelogLanguage
    ) {
        const query = new URLSearchParams({ version, channel, lang: language });
        return this.request<DigiwiseChangelog>(
            `release/changelog?${query.toString()}`,
            { method: "GET" }
        );
    }

    checkIdeRelease(
        accessToken: string,
        currentVersion: string,
        channel: "stable" | "dev",
        platform: "win32" | "darwin",
        arch: "x64" | "arm64",
        clientId: string
    ) {
        const query = new URLSearchParams({
            currentVersion, channel, platform, arch, clientId
        });
        return this.request<IdeReleaseCheck>(
            `release/check?${query}`,
            { method: "GET" },
            accessToken
        );
    }

    prepareIdeReleaseDownload(
        accessToken: string,
        id: string,
        platform: "win32" | "darwin",
        arch: "x64" | "arm64",
        clientId: string
    ) {
        const query = new URLSearchParams({
            platform, arch, assetType: "installer", clientId
        });
        return this.request<IdeReleaseDownload>(
            `release/${encodeURIComponent(id)}/download?${query}`,
            { method: "GET" },
            accessToken
        );
    }

    reportIdeReleaseEvent(
        accessToken: string,
        id: string,
        input: {
            fromVersion: string;
            platform: "win32" | "darwin";
            arch: "x64" | "arm64";
            eventType: "install_success" | "install_error";
            clientId: string;
            errorMessage?: string;
        }
    ) {
        return this.request<{ recorded: true }>(
            `release/${encodeURIComponent(id)}/events`,
            { method: "POST", body: JSON.stringify(input) },
            accessToken
        );
    }

    async listCategories(accessToken: string): Promise<DigiwiseCategory[]> {
        const data = await this.request<unknown>("categories", { method: "GET" }, accessToken);
        if (!Array.isArray(data) || data.length > MAX_CATEGORY_ITEMS || !data.every(item =>
            isObject(item) && Number.isSafeInteger(item.id) && (item.id as number) > 0 &&
            [item.modelCode, item.categoryCode, item.modelName, item.categoryName].every(v => boundedString(v, MAX_CATALOG_STRING_LENGTH)) &&
            (item.chipFamily === null || boundedString(item.chipFamily, MAX_CATALOG_STRING_LENGTH)) &&
            (item.productType === null || (Number.isSafeInteger(item.productType) && (item.productType as number) > 0)) &&
            (item.externalId === null || boundedString(item.externalId, MAX_CATALOG_STRING_LENGTH))
        )) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE", "Invalid category catalog", "category-contract");
        }
        return data.map(({ id, modelCode, categoryCode, modelName, categoryName, chipFamily, externalId, productType }) =>
            ({ id, modelCode, categoryCode, modelName, categoryName, chipFamily, externalId, productType }));
    }

    async listBspVersions(accessToken: string, categoryCode?: string): Promise<DigiwiseBspVersion[]> {
        if (categoryCode !== undefined && (typeof categoryCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(categoryCode))) {
            throw new DigiwisePublicApiError(422, "INVALID_REQUEST", "Invalid category code", "local-validation");
        }
        const query = categoryCode === undefined ? "" : `?${new URLSearchParams({ categoryCode })}`;
        const data = await this.request<unknown>(`bsp${query}`, { method: "GET" }, accessToken);
        if (!Array.isArray(data) || data.length > MAX_BSP_ITEMS || !data.every(item =>
            isObject(item) && Number.isSafeInteger(item.id) && (item.id as number) > 0 &&
            Number.isSafeInteger(item.modelId) && (item.modelId as number) > 0 &&
            Number.isSafeInteger(item.fileSize) && (item.fileSize as number) >= 0 && (item.fileSize as number) <= MAX_BSP_FILE_SIZE &&
            boundedString(item.modelCode, MAX_CATALOG_STRING_LENGTH) &&
            boundedString(item.categoryCode, MAX_CATALOG_STRING_LENGTH) &&
            boundedString(item.modelName, MAX_CATALOG_STRING_LENGTH) &&
            boundedString(item.categoryName, MAX_CATALOG_STRING_LENGTH) &&
            boundedString(item.version, MAX_CATALOG_STRING_LENGTH) &&
            boundedString(item.fileName, MAX_BSP_FILE_NAME_LENGTH) &&
            typeof item.sha256 === "string" && SHA256_PATTERN.test(item.sha256) &&
            validPublishedAt(item.publishedAt)
        )) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE", "Invalid BSP catalog", "bsp-contract");
        }
        return data.map(({ id, modelId, modelCode, categoryCode, modelName, categoryName, version, fileName, fileSize, sha256, publishedAt }) =>
            ({ id, modelId, modelCode, categoryCode, modelName, categoryName, version, fileName, fileSize, sha256, publishedAt }));
    }

    async prepareBspDownload(accessToken: string, bspId: number): Promise<DigiwiseBspDownloadMeta> {
        if (!Number.isSafeInteger(bspId) || bspId <= 0) {
            throw new DigiwisePublicApiError(422, "INVALID_REQUEST", "Invalid BSP id", "local-validation");
        }
        const data = await this.request<unknown>(`bsp/${bspId}/download`, { method: "GET" }, accessToken);
        const expiresMs = isObject(data) && typeof data.expiresAt === "string"
            ? Date.parse(data.expiresAt)
            : NaN;
        if (
            !isObject(data) ||
            typeof data.downloadUrl !== "string" ||
            !data.downloadUrl.trim() ||
            !Number.isFinite(expiresMs) ||
            expiresMs <= Date.now() ||
            !boundedString(data.fileName, MAX_BSP_FILE_NAME_LENGTH) ||
            !Number.isSafeInteger(data.fileSize) ||
            (data.fileSize as number) <= 0 ||
            (data.fileSize as number) > MAX_BSP_FILE_SIZE ||
            typeof data.sha256 !== "string" ||
            !SHA256_PATTERN.test(data.sha256) ||
            !boundedString(data.version, MAX_CATALOG_STRING_LENGTH) ||
            !boundedString(data.modelCode, MAX_CATALOG_STRING_LENGTH) ||
            !boundedString(data.categoryCode, MAX_CATALOG_STRING_LENGTH) ||
            (data.bspId !== undefined && (!Number.isSafeInteger(data.bspId) || (data.bspId as number) !== bspId)) ||
            (data.modelId !== undefined && (!Number.isSafeInteger(data.modelId) || (data.modelId as number) <= 0))
        ) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE", "Invalid BSP download metadata", "bsp-download-contract");
        }
        return {
            ...(data.bspId !== undefined ? { bspId: data.bspId as number } : {}),
            ...(data.modelId !== undefined ? { modelId: data.modelId as number } : {}),
            downloadUrl: data.downloadUrl as string,
            expiresAt: data.expiresAt as string,
            fileName: data.fileName as string,
            fileSize: data.fileSize as number,
            sha256: (data.sha256 as string).toLowerCase(),
            version: data.version as string,
            modelCode: data.modelCode as string,
            categoryCode: data.categoryCode as string
        };
    }

    async getTemplateOptions(accessToken: string): Promise<DigiwiseTemplateOptions> {
        const data = await this.request<unknown>("templates/options", { method: "GET" }, accessToken);
        const parseList = (list: unknown) => {
            if (!Array.isArray(list)) return [];
            return list
                .filter(item => isObject(item) && boundedString(item.label, 128) && boundedString(item.value, 64))
                .map(item => ({ label: item.label as string, value: item.value as string }));
        };
        if (!isObject(data)) {
            throw new DigiwisePublicApiError(502, "PUBLIC_API_INVALID_RESPONSE", "Invalid template options", "template-options-contract");
        }
        return {
            lvglVersions: parseList(data.lvglVersions),
            categories: parseList(data.categories),
            projectTypes: parseList(data.projectTypes)
        };
    }

    listTemplates(accessToken: string, page: number, pageSize: number) {
        const query = new URLSearchParams({
            page: String(page),
            pageSize: String(pageSize)
        });
        return this.request<DigiwiseTemplatePage>(
            `templates?${query.toString()}`,
            { method: "GET" },
            accessToken
        );
    }

    prepareTemplateDownload(
        accessToken: string,
        templateId: string,
        version: string
    ) {
        const query = new URLSearchParams({ version });
        return this.request<DigiwiseTemplateDownload>(
            `templates/${encodeURIComponent(templateId)}/download?${query.toString()}`,
            { method: "GET" },
            accessToken
        );
    }
}
