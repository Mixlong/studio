export type DigiwiseIdentityType = "internal" | "external";

export type DigiwiseAccountStatus = "active" | "disabled";

export interface DigiwiseIdeUser {
    id: string;
    username: string;
    displayName: string;
    identityType: DigiwiseIdentityType;
    accountStatus: DigiwiseAccountStatus;
    email: string | null;
}

export interface DigiwiseCaptcha {
    enabled: boolean;
    uuid?: string;
    imageBase64?: string;
    mimeType?: string;
}

export interface DigiwiseLoginResponse {
    accessToken: string;
    tokenType: "Bearer";
    expiresIn: number;
    user: DigiwiseIdeUser;
}

export interface DigiwiseCurrentUserResponse {
    user: DigiwiseIdeUser;
    expiresIn: number;
}

export interface DigiwiseAuthState {
    authenticated: boolean;
    user?: DigiwiseIdeUser;
    expiresIn?: number;
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
