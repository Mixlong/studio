import fs from "fs";
import path from "path";
import { app, ipcMain, safeStorage } from "electron";
import { readUpdateReleaseIdentity } from "main/update-discovery";
import {
    validateDigiwiseChangelog,
    DigiwiseChangelog,
    DigiwiseChangelogIdentity,
    DigiwiseChangelogLanguage
} from "eez-studio-shared/digiwise-changelog";

import type {
    DigiwiseAuthState,
    DigiwiseCaptcha,
    DigiwiseIpcError,
    DigiwiseIpcResult,
    DigiwiseIdeUser
} from "eez-studio-shared/digiwise-auth";
import {
    DigiwisePublicApi,
    DigiwisePublicApiError
} from "main/digiwise-auth-api";
import {
    createDigiwiseDownloadUrlPolicy,
    DigiwiseDownloadUrlPolicy
} from "main/digiwise-download-policy";

interface StoredAuthSession {
    accessToken: string;
    user: DigiwiseIdeUser;
    expiresAt: number;
}

interface EncryptedSessionFile {
    version: 1;
    encrypted: true;
    payload: string;
}

// The token must only be sent to the deployed Java IDE API in installed builds.
// At packaging time an HTTPS URL is embedded into the app, never a dev localhost fallback.
function readPublicApiBaseUrl(): string | undefined {
    const injected = process.env.DIGIWISE_IDE_API_BASE_URL?.trim();
    if (injected) return injected;
    if (!app.isPackaged) return "http://127.0.0.1:18080/api/ide/v1";
    try {
        const value = JSON.parse(
            fs.readFileSync(
                path.join(app.getAppPath(), "build/main/ide-public-api.json"),
                "utf8"
            )
        );
        return typeof value.baseUrl === "string" ? value.baseUrl.trim() : undefined;
    } catch (_error) {
        return undefined;
    }
}
const publicApiBaseUrl = readPublicApiBaseUrl();
let publicApi: DigiwisePublicApi | null = null;
let publicApiConfigError: DigiwisePublicApiError | null = null;
let currentSession: StoredAuthSession | null = null;
let authGeneration = 0;
let ipcRegistered = false;
const sessionListeners = new Set<() => void>();

export function getDigiwiseDownloadUrlPolicy(): DigiwiseDownloadUrlPolicy {
    return createDigiwiseDownloadUrlPolicy({
        isPackaged: app.isPackaged,
        allowLocalHttp: process.env.DIGIWISE_ALLOW_LOCAL_HTTP === "1",
        apiBaseUrl: publicApiBaseUrl
    });
}

export function onDigiwiseAuthSessionChanged(listener: () => void): () => void {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
}
function notifySessionListeners() {
    for (const listener of sessionListeners) {
        try {
            listener();
        } catch (error) {
            console.error("[auth] Session listener failed", error);
        }
    }
}


/** Main-process-only security guard. Never exposes a token to the MCP client. */
export function getDigiwiseAuthGuard() {
    const valid = !!currentSession &&
        currentSession.expiresAt > Date.now() &&
        currentSession.user.accountStatus === "active";
    return {
        authenticated: valid,
        userId: valid ? currentSession!.user.id : null,
        generation: authGeneration
    };
}

function getPublicApi() {
    if (publicApiConfigError) {
        throw publicApiConfigError;
    }

    if (!publicApiBaseUrl ||
        (app.isPackaged && !publicApiBaseUrl.startsWith("https://"))) {
        publicApiConfigError = new DigiwisePublicApiError(
            500,
            "PUBLIC_API_NOT_CONFIGURED",
            "The Digiwise IDE Public API URL is not configured",
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
                      "The Digiwise IDE Public API URL is invalid",
                      "local-config"
                  );
        throw publicApiConfigError;
    }
}

function sessionFilePath() {
    return path.join(app.getPath("userData"), "digiwise-auth-session.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdeUser(value: unknown): value is DigiwiseIdeUser {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.id === "string" &&
        typeof value.username === "string" &&
        typeof value.displayName === "string" &&
        (value.identityType === "internal" || value.identityType === "external") &&
        (value.accountStatus === "active" || value.accountStatus === "disabled") &&
        (typeof value.email === "string" || value.email === null)
    );
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
        const session = JSON.parse(decrypted) as Partial<StoredAuthSession>;
        if (
            typeof session.accessToken === "string" &&
            isIdeUser(session.user) &&
            typeof session.expiresAt === "number" &&
            Number.isFinite(session.expiresAt) &&
            session.expiresAt > Date.now()
        ) {
            currentSession = {
                accessToken: session.accessToken,
                user: session.user,
                expiresAt: session.expiresAt
            };
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
    authGeneration++;
    notifySessionListeners();

    try {
        await fs.promises.unlink(sessionFilePath());
    } catch (_error) {
        // The file may not exist when safeStorage was unavailable.
    }
}

function emptyState(): DigiwiseAuthState {
    return { authenticated: false };
}

function stateFromSession(session: StoredAuthSession): DigiwiseAuthState {
    return {
        authenticated: true,
        user: session.user,
        expiresIn: Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000))
    };
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

export async function callDigiwisePublicApiWithSession<T>(
    operation: (
        api: DigiwisePublicApi,
        accessToken: string
    ) => Promise<T>
): Promise<DigiwiseIpcResult<T>> {
    const session = currentSession;
    if (!session || session.expiresAt <= Date.now()) {
        if (session) {
            await clearSession();
        }
        return fail<T>(
            new DigiwisePublicApiError(
                401,
                "AUTH_REQUIRED",
                "Sign in before accessing IDE templates",
                "session-required"
            )
        );
    }

    return call(() => operation(getPublicApi(), session.accessToken));
}

function readRequiredString(input: unknown, field: string) {
    if (!isRecord(input)) {
        throw new DigiwisePublicApiError(
            422,
            "INVALID_REQUEST",
            `${field} is required`,
            "local-validation"
        );
    }

    const value = input[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new DigiwisePublicApiError(
            422,
            "INVALID_REQUEST",
            `${field} is required`,
            "local-validation"
        );
    }

    return value;
}

function readOptionalString(input: unknown, field: string) {
    if (!isRecord(input) || typeof input[field] === "undefined") {
        return undefined;
    }

    if (typeof input[field] !== "string") {
        throw new DigiwisePublicApiError(
            422,
            "INVALID_REQUEST",
            `${field} must be a string`,
            "local-validation"
        );
    }

    return input[field] as string;
}

async function getAuthState(): Promise<DigiwiseAuthState> {
    if (!currentSession) {
        return emptyState();
    }

    if (currentSession.expiresAt <= Date.now()) {
        await clearSession();
        return emptyState();
    }

    try {
        const currentUser = await getPublicApi().getCurrentUser(
            currentSession.accessToken
        );
        if (
            !isIdeUser(currentUser.user) ||
            !Number.isFinite(currentUser.expiresIn) ||
            currentUser.expiresIn <= 0
        ) {
            throw new DigiwisePublicApiError(
                502,
                "PUBLIC_API_INVALID_RESPONSE",
                "The current-user response is invalid",
                "current-user-response"
            );
        }
        currentSession = {
            ...currentSession,
            user: currentUser.user,
            expiresAt: Date.now() + currentUser.expiresIn * 1000
        };
        await saveSession(currentSession);
        return stateFromSession(currentSession);
    } catch (error) {
        if (
            error instanceof DigiwisePublicApiError &&
            (error.status === 401 || error.status === 403)
        ) {
            await clearSession();
            return emptyState();
        }
        throw error;
    }
}

function changelogIdentity(): DigiwiseChangelogIdentity {
    const channel = readUpdateReleaseIdentity(
        app.getAppPath(),
        file => fs.readFileSync(file, "utf8")
    )?.channel || "stable";
    return { version: app.getVersion(), channel };
}

export async function registerDigiwiseAuthIpc() {
    if (ipcRegistered) {
        return;
    }

    ipcRegistered = true;
    await loadSession();
    // Public, read-only content. Renderer cannot request another installed version.
    ipcMain.handle("digistudio:release:identity", () => changelogIdentity());
    ipcMain.handle(
        "digistudio:release:changelog",
        (_event, language: DigiwiseChangelogLanguage):
            Promise<DigiwiseIpcResult<DigiwiseChangelog>> =>
            call(async () => {
                if (language !== "zh-CN" && language !== "en-US") {
                    throw new DigiwisePublicApiError(422, "INVALID_REQUEST",
                        "Unsupported changelog language", "local-validation");
                }
                const identity = changelogIdentity();
                return validateDigiwiseChangelog(
                    await getPublicApi().getReleaseChangelog(
                        identity.version, identity.channel, language
                    ),
                    identity,
                    language
                );
            })
    );


    ipcMain.handle("digistudio:auth:state", () => call(() => getAuthState()));

    ipcMain.handle(
        "digistudio:auth:captcha",
        (): Promise<DigiwiseIpcResult<DigiwiseCaptcha>> =>
            call(() => getPublicApi().getCaptcha())
    );

    ipcMain.handle(
        "digistudio:auth:login",
        async (_event, input: unknown): Promise<DigiwiseIpcResult<DigiwiseAuthState>> =>
            call(async () => {
                const username = readRequiredString(input, "username").trim();
                const password = readRequiredString(input, "password");
                const captchaCode = readOptionalString(input, "captchaCode")?.trim();
                const captchaUuid = readOptionalString(input, "captchaUuid")?.trim();
                const login = await getPublicApi().login(
                    username,
                    password,
                    captchaCode,
                    captchaUuid
                );

                if (
                    !login.accessToken ||
                    login.tokenType !== "Bearer" ||
                    !isIdeUser(login.user) ||
                    !Number.isFinite(login.expiresIn) ||
                    login.expiresIn <= 0
                ) {
                    throw new DigiwisePublicApiError(
                        502,
                        "PUBLIC_API_INVALID_RESPONSE",
                        "The login response is invalid",
                        "login-response"
                    );
                }

                const session: StoredAuthSession = {
                    accessToken: login.accessToken,
                    user: login.user,
                    expiresAt: Date.now() + login.expiresIn * 1000
                };
                await saveSession(session);
                authGeneration++;
                notifySessionListeners();
                return stateFromSession(session);
            })
    );

    ipcMain.handle(
        "digistudio:auth:logout",
        (): Promise<DigiwiseIpcResult<DigiwiseAuthState>> =>
            call(async () => {
                const session = currentSession;
                if (session) {
                    try {
                        await getPublicApi().logout(session.accessToken);
                    } catch (_error) {
                        // Local sign-out must still complete if the server is
                        // unavailable. The token is removed before returning.
                    }
                }
                await clearSession();
                return emptyState();
            })
    );
}
