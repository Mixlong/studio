import fs from "fs";
import path from "path";
import { app, ipcMain, safeStorage } from "electron";

import type {
    DigiwiseAuthState,
    DigiwiseIpcError,
    DigiwiseIpcResult,
    DigiwiseRegisterResponse,
    DigiwiseSendCodeResponse
} from "eez-studio-shared/digiwise-auth";
import {
    DigiwisePublicApi,
    DigiwisePublicApiError
} from "main/digiwise-auth-api";

interface StoredAuthSession {
    accessToken: string;
    userId?: string;
    email: string;
}

interface EncryptedSessionFile {
    version: 1;
    encrypted: true;
    payload: string;
}

// Local development uses the locally running studio-admin Public API. Packaged
// builds must provide the deployed gateway through the environment instead of
// silently falling back to a local or simulated service.
const publicApiBaseUrl =
    process.env.DIGIWISE_PUBLIC_API_BASE_URL?.trim() ||
    (!app.isPackaged
        ? "http://127.0.0.1:13000/main/api/v1"
        : undefined);
let publicApi: DigiwisePublicApi | null = null;
let publicApiConfigError: DigiwisePublicApiError | null = null;
let currentSession: StoredAuthSession | null = null;
let ipcRegistered = false;

function getPublicApi() {
    if (publicApiConfigError) {
        throw publicApiConfigError;
    }

    if (!publicApiBaseUrl) {
        publicApiConfigError = new DigiwisePublicApiError(
            500,
            "PUBLIC_API_NOT_CONFIGURED",
            "The Digiwise Public API URL is not configured",
            "local-config"
        );
        throw publicApiConfigError;
    }

    try {
        publicApi ||= new DigiwisePublicApi(publicApiBaseUrl);
        return publicApi;
    } catch (error) {
        publicApiConfigError =
            error instanceof DigiwisePublicApiError
                ? error
                : new DigiwisePublicApiError(
                      500,
                      "PUBLIC_API_NOT_CONFIGURED",
                      "The Digiwise Public API URL is invalid",
                      "local-config"
                  );
        throw publicApiConfigError;
    }
}

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
            (typeof session.userId === "string" ||
                typeof session.userId === "undefined") &&
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
    currentSession = null;

    try {
        await fs.promises.unlink(sessionFilePath());
    } catch (_error) {
        // The file may not exist when safeStorage was unavailable.
    }
}

function emptyState(): DigiwiseAuthState {
    return { authenticated: false };
}

function toIpcError(error: unknown): DigiwiseIpcError {
    if (error instanceof DigiwisePublicApiError) {
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
        throw new DigiwisePublicApiError(
            422,
            "VALIDATION_ERROR",
            `${field} is required`,
            "local-validation"
        );
    }

    const value = (input as Record<string, unknown>)[field];
    if (typeof value !== "string") {
        throw new DigiwisePublicApiError(
            422,
            "VALIDATION_ERROR",
            `${field} is required`,
            "local-validation"
        );
    }

    return value;
}

async function getAuthState(): Promise<DigiwiseAuthState> {
    if (!currentSession) {
        return emptyState();
    }

    try {
        const entitlements = await getPublicApi().getEntitlements(
            currentSession.accessToken
        );
        return {
            authenticated: true,
            email: currentSession.email,
            ...(currentSession.userId
                ? { userId: currentSession.userId }
                : {}),
            accountStatus: entitlements.accountStatus,
            entitlements
        };
    } catch (error) {
        if (
            error instanceof DigiwisePublicApiError &&
            error.status === 401
        ) {
            await clearSession();
            return emptyState();
        }
        throw error;
    }
}

export async function registerDigiwiseAuthIpc() {
    if (ipcRegistered) {
        return;
    }

    ipcRegistered = true;
    await loadSession();

    ipcMain.handle("digistudio:auth:state", () => call(() => getAuthState()));

    ipcMain.handle(
        "digistudio:auth:send-code",
        (_event, input: unknown): Promise<DigiwiseIpcResult<DigiwiseSendCodeResponse>> =>
            call(() => {
                const email = readString(input, "email");
                return getPublicApi().sendCode(email);
            })
    );

    ipcMain.handle(
        "digistudio:auth:register",
        async (
            _event,
            input: unknown
        ): Promise<DigiwiseIpcResult<DigiwiseRegisterResponse>> =>
            call(() => {
                const email = readString(input, "email");
                const code = readString(input, "code");
                const password = readString(input, "password");
                return getPublicApi().register(email, code, password);
            })
    );

    ipcMain.handle(
        "digistudio:auth:login",
        async (_event, input: unknown): Promise<DigiwiseIpcResult<DigiwiseAuthState>> =>
            call(async () => {
                const email = readString(input, "email");
                const password = readString(input, "password");
                const login = await getPublicApi().login(email, password);
                await saveSession({
                    accessToken: login.accessToken,
                    ...(login.userId ? { userId: login.userId } : {}),
                    email: login.email || email
                });
                return getAuthState();
            })
    );

    ipcMain.handle("digistudio:auth:logout", async () => {
        await clearSession();
        return ok(emptyState());
    });
}

