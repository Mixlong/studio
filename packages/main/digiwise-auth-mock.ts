import { randomUUID } from "crypto";

import type {
    DigiwiseEntitlementSnapshot,
    DigiwiseLicense,
    DigiwiseRedeemResponse,
    DigiwiseRegisterResponse,
    DigiwiseSendCodeResponse,
    DigiwiseTrial
} from "eez-studio-shared/digiwise-auth";

export class MockDigiwiseApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly requestId: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = "MockDigiwiseApiError";
        this.status = status;
        this.code = code;
        this.requestId = randomUUID();
    }
}

export interface MockDigiwisePublicApiOptions {
    // These values represent server-side Mock policy only. They are not
    // product policy and are deliberately kept out of the renderer.
    trialDurationMs: number;
    verificationCodeLifetimeMs: number;
    verificationCode: string;
    licenseCode: string;
    trialCapabilities: string[];
    licensedCapabilities: string[];
}

interface MockVerificationRequest {
    email: string;
    code: string;
    createdAtMs: number;
}

interface MockUser {
    userId: string;
    email: string;
    password: string;
    trial: DigiwiseTrial;
    license: DigiwiseLicense;
    redemptions: Map<string, DigiwiseRedeemResponse>;
}

export interface MockLoginResponse {
    accessToken: string;
    tokenType: "Bearer";
    expiresIn: number;
    userId: string;
    email: string;
}

function normalizeEmail(value: string) {
    return value.trim().toLowerCase();
}

function ensureText(value: unknown, field: string) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new MockDigiwiseApiError(422, "VALIDATION_ERROR", `${field} is required`);
    }

    return value.trim();
}

function ensureEmail(value: string) {
    const email = normalizeEmail(value);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
        throw new MockDigiwiseApiError(422, "VALIDATION_ERROR", "A valid email is required");
    }

    return email;
}

export class MockDigiwisePublicApi {
    private readonly users = new Map<string, MockUser>();
    private readonly verificationRequests = new Map<
        string,
        MockVerificationRequest
    >();
    private readonly latestVerificationRequestByEmail = new Map<
        string,
        string
    >();
    private readonly sessions = new Map<string, string>();

    constructor(private readonly options: MockDigiwisePublicApiOptions) {}

    private serverTime() {
        return new Date().toISOString();
    }

    private getUserByToken(accessToken: string) {
        const userId = this.sessions.get(accessToken);
        const user = userId
            ? Array.from(this.users.values()).find(item => item.userId === userId)
            : undefined;

        if (!user) {
            throw new MockDigiwiseApiError(401, "AUTH_REQUIRED", "Authentication is required");
        }

        return user;
    }

    private getTrial(user: MockUser, serverTime: string): DigiwiseTrial {
        if (user.trial.status === "revoked") {
            return { ...user.trial };
        }

        const expiresAt = user.trial.expiresAt
            ? Date.parse(user.trial.expiresAt)
            : Number.POSITIVE_INFINITY;
        const status = Date.parse(serverTime) >= expiresAt ? "expired" : "active";

        return { ...user.trial, status };
    }

    private getEntitlementsForUser(
        user: MockUser,
        workspaceId?: string
    ): DigiwiseEntitlementSnapshot {
        const serverTime = this.serverTime();
        const trial = this.getTrial(user, serverTime);
        const license = { ...user.license };
        const hasTrial = trial.status === "active";
        const hasLicense = license.status === "active";

        return {
            serverTime,
            accountStatus: "active",
            ...(workspaceId ? { workspaceId } : {}),
            trial,
            license,
            capabilities: hasLicense
                ? [...this.options.licensedCapabilities]
                : hasTrial
                  ? [...this.options.trialCapabilities]
                  : []
        };
    }

    async sendCode(
        emailValue: string,
        purpose: "register" = "register"
    ): Promise<DigiwiseSendCodeResponse> {
        if (purpose !== "register") {
            throw new MockDigiwiseApiError(
                422,
                "VALIDATION_ERROR",
                "The email verification purpose is invalid"
            );
        }

        const email = ensureEmail(ensureText(emailValue, "email"));
        const requestId = randomUUID();

        this.verificationRequests.set(requestId, {
            email,
            code: this.options.verificationCode,
            createdAtMs: Date.now()
        });
        this.latestVerificationRequestByEmail.set(email, requestId);

        return { requestId, accepted: true };
    }

    async register(
        emailValue: string,
        codeValue: string,
        passwordValue: string
    ): Promise<DigiwiseRegisterResponse> {
        const email = ensureEmail(ensureText(emailValue, "email"));
        const code = ensureText(codeValue, "code");
        const password = ensureText(passwordValue, "password");

        if (password.length < 8) {
            throw new MockDigiwiseApiError(
                422,
                "VALIDATION_ERROR",
                "Password must contain at least 8 characters"
            );
        }

        if (this.users.has(email)) {
            throw new MockDigiwiseApiError(
                409,
                "AUTH_EMAIL_EXISTS",
                "An account already exists for this email"
            );
        }

        const requestId = this.latestVerificationRequestByEmail.get(email);
        const request = requestId
            ? this.verificationRequests.get(requestId)
            : undefined;
        const requestExpired =
            !request ||
            Date.now() - request.createdAtMs >
                this.options.verificationCodeLifetimeMs;
        if (requestExpired || request.code !== code) {
            throw new MockDigiwiseApiError(
                422,
                "AUTH_CODE_INVALID",
                "The verification code is invalid or expired"
            );
        }

        this.verificationRequests.delete(requestId as string);
        this.latestVerificationRequestByEmail.delete(email);

        const serverTime = this.serverTime();
        const expiresAt = new Date(
            Date.parse(serverTime) + this.options.trialDurationMs
        ).toISOString();
        const user: MockUser = {
            userId: randomUUID(),
            email,
            password,
            trial: {
                status: "active",
                startedAt: serverTime,
                expiresAt
            },
            license: {
                source: "none",
                status: "inactive",
                expiresAt: null,
                organizationId: null
            },
            redemptions: new Map()
        };

        this.users.set(email, user);

        return {
            userId: user.userId,
            accountStatus: "active",
            trial: { ...user.trial },
            serverTime
        };
    }

    async login(emailValue: string, passwordValue: string): Promise<MockLoginResponse> {
        const email = ensureEmail(ensureText(emailValue, "email"));
        const password = ensureText(passwordValue, "password");
        const user = this.users.get(email);

        if (!user || user.password !== password) {
            throw new MockDigiwiseApiError(
                401,
                "AUTH_INVALID_CREDENTIALS",
                "Email or password is incorrect"
            );
        }

        const accessToken = `mock-${randomUUID()}`;
        this.sessions.set(accessToken, user.userId);

        return {
            accessToken,
            tokenType: "Bearer",
            expiresIn: 3600,
            userId: user.userId,
            email: user.email
        };
    }

    async getEntitlements(
        accessToken: string,
        workspaceId?: string
    ): Promise<DigiwiseEntitlementSnapshot> {
        const user = this.getUserByToken(accessToken);
        return this.getEntitlementsForUser(user, workspaceId);
    }

    async redeem(
        accessToken: string,
        codeValue: string,
        idempotencyKeyValue: string
    ): Promise<DigiwiseRedeemResponse> {
        const user = this.getUserByToken(accessToken);
        const code = ensureText(codeValue, "code");
        const idempotencyKey = ensureText(idempotencyKeyValue, "Idempotency-Key");

        if (idempotencyKey.length < 12 || idempotencyKey.length > 128) {
            throw new MockDigiwiseApiError(
                400,
                "VALIDATION_ERROR",
                "Idempotency-Key must contain 12 to 128 characters"
            );
        }

        const previous = user.redemptions.get(idempotencyKey);
        if (previous) {
            return previous;
        }

        if (code !== this.options.licenseCode) {
            throw new MockDigiwiseApiError(
                409,
                "LICENSE_INVALID",
                "The license code is invalid"
            );
        }

        user.license = {
            source: "code",
            status: "active",
            expiresAt: null,
            organizationId: null
        };

        const response: DigiwiseRedeemResponse = {
            redemptionId: randomUUID(),
            entitlements: this.getEntitlementsForUser(user)
        };
        user.redemptions.set(idempotencyKey, response);

        return response;
    }

    getUser(accessToken: string) {
        return this.getUserByToken(accessToken);
    }

    revokeSession(accessToken: string) {
        this.sessions.delete(accessToken);
    }
}
