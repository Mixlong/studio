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

type JsonObject = Record<string, unknown>;

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
