import type {
    DigiwiseEntitlementSnapshot,
    DigiwiseLoginResponse,
    DigiwiseRedeemResponse,
    DigiwiseRegisterResponse,
    DigiwiseSendCodeResponse
} from "eez-studio-shared/digiwise-auth";

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

function normalizeBaseUrl(value: string) {
    let url: URL;
    try {
        url = new URL(value);
    } catch (_error) {
        throw new DigiwisePublicApiError(
            500,
            "PUBLIC_API_NOT_CONFIGURED",
            "The Digiwise Public API URL is invalid",
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
            "The Digiwise Public API URL is not allowed",
            "local-config"
        );
    }

    return value.replace(/\/+$/, "");
}

function errorFromPayload(
    status: number,
    payload: unknown,
    fallbackMessage: string
) {
    const root = isObject(payload) ? payload : {};
    const nested = isObject(root.error) ? root.error : root;
    return new DigiwisePublicApiError(
        status,
        readString(nested.code) || `HTTP_${status}`,
        readString(nested.message) || fallbackMessage,
        readString(nested.requestId) || `http-${Date.now().toString(36)}`
    );
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
                "The Digiwise Public API is unavailable",
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
                `The Digiwise Public API returned HTTP ${response.status}`
            );
        }

        if (!isObject(payload)) {
            throw new DigiwisePublicApiError(
                502,
                "PUBLIC_API_INVALID_RESPONSE",
                "The Digiwise Public API returned an invalid response",
                `response-${Date.now().toString(36)}`
            );
        }

        return payload as T;
    }

    sendCode(email: string) {
        return this.request<DigiwiseSendCodeResponse>(
            "auth/email/send-code",
            {
                method: "POST",
                body: JSON.stringify({ email, purpose: "register" })
            }
        );
    }

    register(email: string, code: string, password: string) {
        return this.request<DigiwiseRegisterResponse>("auth/register", {
            method: "POST",
            body: JSON.stringify({ email, code, password })
        });
    }

    login(email: string, password: string) {
        return this.request<DigiwiseLoginResponse>("auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });
    }

    getEntitlements(accessToken: string) {
        return this.request<DigiwiseEntitlementSnapshot>(
            "me/entitlements",
            { method: "GET" },
            accessToken
        );
    }

    redeem(accessToken: string, code: string, idempotencyKey: string) {
        return this.request<DigiwiseRedeemResponse>(
            "licenses/redeem",
            {
                method: "POST",
                headers: { "Idempotency-Key": idempotencyKey },
                body: JSON.stringify({ code })
            },
            accessToken
        );
    }
}

