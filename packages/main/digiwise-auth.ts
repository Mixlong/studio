import fs from "fs";
import path from "path";
import { app, ipcMain, safeStorage } from "electron";

import type {
    DigiwiseAuthState,
    DigiwiseIpcError,
    DigiwiseIpcResult,
    DigiwiseRedeemIpcResponse,
    DigiwiseRegisterResponse,
    DigiwiseSendCodeResponse
} from "eez-studio-shared/digiwise-auth";
import { MockDigiwiseApiError, MockDigiwisePublicApi } from "main/digiwise-auth-mock";

interface StoredAuthSession {
    accessToken: string;
    userId: string;
    email: string;
}

interface EncryptedSessionFile {
    version: 1;
    encrypted: true;
    payload: string;
}

const MOCK_AUTH_POLICY = {
    // Mock-only server fixture. Product trial duration remains a backend
    // configuration value and is not used by the renderer.
    trialDurationMs: 14 * 24 * 60 * 60 * 1000,
    verificationCodeLifetimeMs: 10 * 60 * 1000,
    verificationCode: "000000",
    licenseCode: "MOCK-LICENSE-001",
    trialCapabilities: ["desktop.editor"],
    licensedCapabilities: ["desktop.editor", "cloud.storage.read"]
};

const mockApi = new MockDigiwisePublicApi(MOCK_AUTH_POLICY);
let currentSession: StoredAuthSession | null = null;
let ipcRegistered = false;

function sessionFilePath() {
    return path.join(app.getPath("userData"), "digiwise-auth-session.json");
}

async function loadSession() {
    try {
        const raw = await fs.promises.readFile(sessionFilePath(), "utf8");
        const file = JSON.parse(raw) as Partial<EncryptedSessionFile>;
        if (
            file.version !== 1 ||
            file.encrypted !== true ||
            typeof file.payload !== "string" ||
            !safeStorage.isEncryptionAvailable()
        ) {
            return;
        }

        const decrypted = safeStorage.decryptString(
            Buffer.from(file.payload, "base64")
        );
        const session = JSON.parse(decrypted) as StoredAuthSession;
        if (
            typeof session.accessToken === "string" &&
            typeof session.userId === "string" &&
            typeof session.email === "string"
        ) {
            currentSession = session;
        }
    } catch (_error) {
        // A missing, unreadable or stale local session is equivalent to a
        // signed-out client. Tokens are never written in plaintext.
        currentSession = null;
    }
}

async function saveSession(session: StoredAuthSession) {
    currentSession = session;

    if (!safeStorage.isEncryptionAvailable()) {
        // Keep the session in memory when the OS key store is unavailable.
        return;
    }

    const payload = safeStorage
        .encryptString(JSON.stringify(session))
        .toString("base64");
    const file: EncryptedSessionFile = {
        version: 1,
        encrypted: true,
        payload
    };

    await fs.promises.mkdir(path.dirname(sessionFilePath()), { recursive: true });
    await fs.promises.writeFile(
        sessionFilePath(),
        JSON.stringify(file),
        "utf8"
    );
}

async function clearSession() {
    const token = currentSession?.accessToken;
    if (token) {
        mockApi.revokeSession(token);
    }
    currentSession = null;

    try {
        await fs.promises.unlink(sessionFilePath());
    } catch (_error) {
        // The file may not exist when safeStorage was unavailable.
    }
}

function emptyState(): DigiwiseAuthState {
    return { authenticated: false, isMockApi: true };
}

function toIpcError(error: unknown): DigiwiseIpcError {
    if (error instanceof MockDigiwiseApiError) {
        return {
            status: error.status,
            code: error.code,
            message: error.message,
            requestId: error.requestId
        };
    }

    return {
        status: 500,
        code: "CLIENT_AUTH_ERROR",
        message: "The authentication operation could not be completed",
        requestId: "local-" + Date.now().toString(36)
    };
}

function ok<T>(data: T): DigiwiseIpcResult<T> {
    return { ok: true, data };
}

function fail<T>(error: unknown): DigiwiseIpcResult<T> {
    return { ok: false, error: toIpcError(error) };
}

async function call<T>(operation: () => Promise<T>): Promise<DigiwiseIpcResult<T>> {
    try {
        return ok(await operation());
    } catch (error) {
        return fail<T>(error);
    }
}

function readString(input: unknown, field: string) {
    if (!input || typeof input !== "object") {
        throw new MockDigiwiseApiError(422, "VALIDATION_ERROR", `${field} is required`);
    }

    const value = (input as Record<string, unknown>)[field];
    if (typeof value !== "string") {
        throw new MockDigiwiseApiError(422, "VALIDATION_ERROR", `${field} is required`);
    }

    return value;
}

async function getAuthState(): Promise<DigiwiseAuthState> {
    if (!currentSession) {
        return emptyState();
    }

    try {
        const entitlements = await mockApi.getEntitlements(
            currentSession.accessToken
        );
        return {
            authenticated: true,
            isMockApi: true,
            email: currentSession.email,
            userId: currentSession.userId,
            accountStatus: entitlements.accountStatus,
            entitlements
        };
    } catch (_error) {
        await clearSession();
        return emptyState();
    }
}

async function requireSession() {
    if (!currentSession) {
        throw new MockDigiwiseApiError(401, "AUTH_REQUIRED", "Authentication is required");
    }

    return currentSession;
}

export async function registerDigiwiseAuthIpc() {
    if (ipcRegistered) {
        return;
    }

    ipcRegistered = true;
    await loadSession();

    ipcMain.handle("digistudio:auth:state", () => getAuthState());

    ipcMain.handle(
        "digistudio:auth:send-code",
        (_event, input: unknown): Promise<DigiwiseIpcResult<DigiwiseSendCodeResponse>> =>
            call(() => mockApi.sendCode(readString(input, "email"), "register"))
    );

    ipcMain.handle(
        "digistudio:auth:register",
        async (
            _event,
            input: unknown
        ): Promise<DigiwiseIpcResult<DigiwiseRegisterResponse>> =>
            call(() =>
                mockApi.register(
                    readString(input, "email"),
                    readString(input, "code"),
                    readString(input, "password")
                )
            )
    );

    ipcMain.handle(
        "digistudio:auth:login",
        async (_event, input: unknown): Promise<DigiwiseIpcResult<DigiwiseAuthState>> =>
            call(async () => {
                const login = await mockApi.login(
                    readString(input, "email"),
                    readString(input, "password")
                );
                await saveSession({
                    accessToken: login.accessToken,
                    userId: login.userId,
                    email: login.email
                });
                return getAuthState();
            })
    );

    ipcMain.handle(
        "digistudio:auth:redeem",
        async (
            _event,
            input: unknown
        ): Promise<DigiwiseIpcResult<DigiwiseRedeemIpcResponse>> =>
            call(async () => {
                const session = await requireSession();
                const redemption = await mockApi.redeem(
                    session.accessToken,
                    readString(input, "code"),
                    readString(input, "idempotencyKey")
                );
                return {
                    redemptionId: redemption.redemptionId,
                    state: await getAuthState()
                };
            })
    );

    ipcMain.handle("digistudio:auth:logout", async () => {
        await clearSession();
        return ok(emptyState());
    });
}
