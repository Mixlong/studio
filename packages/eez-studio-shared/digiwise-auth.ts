export type DigiwiseAccountStatus = "active" | "suspended" | "disabled";

export type DigiwiseTrialStatus =
    | "not_started"
    | "active"
    | "expired"
    | "revoked";

export type DigiwiseLicenseSource =
    | "none"
    | "trial"
    | "code"
    | "enterprise"
    | "admin";

export type DigiwiseLicenseStatus =
    | "inactive"
    | "active"
    | "expired"
    | "revoked"
    | "suspended";

export interface DigiwiseTrial {
    status: DigiwiseTrialStatus;
    startedAt: string | null;
    expiresAt: string | null;
}

export interface DigiwiseLicense {
    source: DigiwiseLicenseSource;
    status: DigiwiseLicenseStatus;
    expiresAt: string | null;
    organizationId: string | null;
}

export interface DigiwiseEntitlementSnapshot {
    serverTime: string;
    accountStatus: DigiwiseAccountStatus;
    workspaceId?: string;
    trial: DigiwiseTrial;
    license: DigiwiseLicense;
    capabilities: string[];
}

export interface DigiwiseRegisterResponse {
    userId: string;
    accountStatus: DigiwiseAccountStatus;
    trial: DigiwiseTrial;
    serverTime: string;
}

export interface DigiwiseSendCodeResponse {
    requestId: string;
    accepted: true;
}

export interface DigiwiseRedeemResponse {
    redemptionId: string;
    entitlements: DigiwiseEntitlementSnapshot;
}

export interface DigiwiseAuthState {
    authenticated: boolean;
    isMockApi: boolean;
    email?: string;
    userId?: string;
    accountStatus?: DigiwiseAccountStatus;
    entitlements?: DigiwiseEntitlementSnapshot;
}

export interface DigiwiseIpcError {
    status: number;
    code: string;
    message: string;
    requestId: string;
}

export type DigiwiseIpcResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: DigiwiseIpcError };

export interface DigiwiseRedeemIpcResponse {
    redemptionId: string;
    state: DigiwiseAuthState;
}
