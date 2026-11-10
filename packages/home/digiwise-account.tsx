import React from "react";
import { ipcRenderer } from "electron";
import { observer } from "mobx-react";

import { settingsController } from "home/settings";
import type {
    DigiwiseAuthState,
    DigiwiseEntitlementSnapshot,
    DigiwiseIpcError,
    DigiwiseIpcResult,
    DigiwiseRedeemIpcResponse,
    DigiwiseRegisterResponse,
    DigiwiseSendCodeResponse
} from "eez-studio-shared/digiwise-auth";

type AuthMode = "register" | "login";
type BusyAction = "send-code" | "register" | "login" | "redeem" | "logout" | null;

interface Notice {
    kind: "info" | "success" | "error";
    text: string;
}

interface ServerClockAnchor {
    serverTimeMs: number;
    monotonicTimeMs: number;
}

const initialAuthState: DigiwiseAuthState = {
    authenticated: false,
    isMockApi: true
};

function createIdempotencyKey() {
    const randomId = window.crypto?.randomUUID?.();
    return `digiwise-${randomId || Math.random().toString(36).slice(2)}`;
}

function formatServerDate(value: string | null, isChinese: boolean) {
    if (!value) {
        return isChinese ? "未设置" : "Not set";
    }

    return new Date(value).toLocaleString(isChinese ? "zh-CN" : "en-US");
}

function formatRemaining(
    entitlements: DigiwiseEntitlementSnapshot,
    anchor: ServerClockAnchor | null,
    isChinese: boolean
) {
    if (entitlements.trial.status !== "active" || !entitlements.trial.expiresAt) {
        return null;
    }

    const expiresAtMs = Date.parse(entitlements.trial.expiresAt);
    if (!anchor || Number.isNaN(expiresAtMs)) {
        return isChinese ? "等待服务器时间" : "Waiting for server time";
    }

    // This is display-only. The server's entitlement status remains the
    // authority, and performance.now() is monotonic so changing the local
    // wall clock cannot extend the displayed trial.
    const currentServerTimeMs =
        anchor.serverTimeMs + (performance.now() - anchor.monotonicTimeMs);
    const remainingMs = Math.max(0, expiresAtMs - currentServerTimeMs);
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return isChinese
        ? `${days}天 ${hours}小时 ${minutes}分 ${seconds}秒`
        : `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function errorMessage(error: DigiwiseIpcError, isChinese: boolean) {
    const messages: Record<string, [string, string]> = {
        AUTH_EMAIL_EXISTS: ["该邮箱已注册", "This email is already registered"],
        AUTH_CODE_INVALID: ["验证码无效或已过期", "The verification code is invalid or expired"],
        AUTH_INVALID_CREDENTIALS: ["邮箱或密码不正确", "Email or password is incorrect"],
        AUTH_REQUIRED: ["请先登录", "Please sign in first"],
        LICENSE_INVALID: ["授权码无效", "The license code is invalid"],
        VALIDATION_ERROR: ["请检查输入内容", "Please check the input"],
        CLIENT_AUTH_ERROR: ["认证服务暂时不可用", "The authentication service is unavailable"]
    };
    const knownMessage = messages[error.code];
    return knownMessage
        ? knownMessage[isChinese ? 0 : 1]
        : isChinese
          ? `${error.message}（请求号：${error.requestId}）`
          : `${error.message} (request ${error.requestId})`;
}

function trialStatusLabel(status: DigiwiseEntitlementSnapshot["trial"]["status"], isChinese: boolean) {
    const labels: Record<string, [string, string]> = {
        not_started: ["未开始", "Not started"],
        active: ["试用中", "Active"],
        expired: ["已到期", "Expired"],
        revoked: ["已撤销", "Revoked"]
    };
    const label = labels[status] || labels.not_started;
    return label[isChinese ? 0 : 1];
}

function licenseStatusLabel(
    status: DigiwiseEntitlementSnapshot["license"]["status"],
    isChinese: boolean
) {
    const labels: Record<string, [string, string]> = {
        inactive: ["未激活", "Inactive"],
        active: ["已激活", "Active"],
        expired: ["已到期", "Expired"],
        revoked: ["已撤销", "Revoked"],
        suspended: ["已暂停", "Suspended"]
    };
    const label = labels[status] || labels.inactive;
    return label[isChinese ? 0 : 1];
}

async function invokeAuth<T>(
    channel: string,
    input?: unknown
): Promise<DigiwiseIpcResult<T>> {
    return ipcRenderer.invoke(channel, input) as Promise<DigiwiseIpcResult<T>>;
}

export const DigiwiseAccount = observer(() => {
    const isChinese = settingsController.locale.toLowerCase().startsWith("zh");
    const [authMode, setAuthMode] = React.useState<AuthMode>("register");
    const [authState, setAuthState] = React.useState(initialAuthState);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState<BusyAction>(null);
    const [notice, setNotice] = React.useState<Notice | null>(null);
    const [serverClockAnchor, setServerClockAnchor] =
        React.useState<ServerClockAnchor | null>(null);
    const [, setClockTick] = React.useState(0);

    const [registerEmail, setRegisterEmail] = React.useState("");
    const [registerPassword, setRegisterPassword] = React.useState("");
    const [verificationCode, setVerificationCode] = React.useState("");
    const [codeSent, setCodeSent] = React.useState(false);
    const [loginEmail, setLoginEmail] = React.useState("");
    const [loginPassword, setLoginPassword] = React.useState("");
    const [licenseCode, setLicenseCode] = React.useState("");
    const [redemptionKey, setRedemptionKey] = React.useState<string | null>(null);

    const applyAuthState = (nextState: DigiwiseAuthState) => {
        setAuthState(nextState);
        if (nextState.entitlements?.serverTime) {
            const serverTimeMs = Date.parse(nextState.entitlements.serverTime);
            if (!Number.isNaN(serverTimeMs)) {
                setServerClockAnchor({
                    serverTimeMs,
                    monotonicTimeMs: performance.now()
                });
            }
        } else {
            setServerClockAnchor(null);
        }
    };

    React.useEffect(() => {
        let disposed = false;

        const refresh = async (showError: boolean) => {
            const result = await invokeAuth<DigiwiseAuthState>(
                "digistudio:auth:state"
            );
            if (disposed) {
                return;
            }

            if (result.ok) {
                applyAuthState(result.data);
                if (showError) {
                    setNotice(null);
                }
            } else if (showError) {
                setNotice({
                    kind: "error",
                    text: errorMessage(result.error, isChinese)
                });
            }
            setLoading(false);
        };

        void refresh(false);
        const refreshTimer = window.setInterval(() => void refresh(false), 30000);
        return () => {
            disposed = true;
            window.clearInterval(refreshTimer);
        };
    }, [isChinese]);

    React.useEffect(() => {
        const timer = window.setInterval(() => setClockTick(value => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const handleSendCode = async () => {
        if (!registerEmail.trim()) {
            setNotice({
                kind: "error",
                text: isChinese ? "请输入邮箱" : "Enter an email address"
            });
            return;
        }

        setBusy("send-code");
        setNotice(null);
        const result = await invokeAuth<DigiwiseSendCodeResponse>(
            "digistudio:auth:send-code",
            { email: registerEmail.trim() }
        );
        setBusy(null);

        if (result.ok) {
            setCodeSent(true);
            setNotice({
                kind: "success",
                text: isChinese
                    ? "验证码已发送，请查收邮箱。"
                    : "The verification code has been sent."
            });
        } else {
            setNotice({ kind: "error", text: errorMessage(result.error, isChinese) });
        }
    };

    const handleRegister = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy("register");
        setNotice(null);
        const result = await invokeAuth<DigiwiseRegisterResponse>(
            "digistudio:auth:register",
            {
                email: registerEmail.trim(),
                code: verificationCode.trim(),
                password: registerPassword
            }
        );
        setBusy(null);

        if (result.ok) {
            setLoginEmail(registerEmail.trim());
            setLoginPassword(registerPassword);
            setAuthMode("login");
            setNotice({
                kind: "success",
                text: isChinese
                    ? "注册成功，请登录查看试用状态。"
                    : "Registration succeeded. Sign in to view your trial."
            });
        } else {
            setNotice({ kind: "error", text: errorMessage(result.error, isChinese) });
        }
    };

    const handleLogin = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy("login");
        setNotice(null);
        const result = await invokeAuth<DigiwiseAuthState>(
            "digistudio:auth:login",
            { email: loginEmail.trim(), password: loginPassword }
        );
        setBusy(null);

        if (result.ok) {
            applyAuthState(result.data);
            setNotice({
                kind: "success",
                text: isChinese ? "登录成功" : "Signed in successfully"
            });
        } else {
            setNotice({ kind: "error", text: errorMessage(result.error, isChinese) });
        }
    };

    const handleRedeem = async (event: React.FormEvent) => {
        event.preventDefault();
        const currentRedemptionKey = redemptionKey || createIdempotencyKey();
        setRedemptionKey(currentRedemptionKey);
        setBusy("redeem");
        setNotice(null);
        const result = await invokeAuth<DigiwiseRedeemIpcResponse>(
            "digistudio:auth:redeem",
            { code: licenseCode.trim(), idempotencyKey: currentRedemptionKey }
        );
        setBusy(null);

        if (result.ok) {
            applyAuthState(result.data.state);
            setLicenseCode("");
            setRedemptionKey(null);
            setNotice({
                kind: "success",
                text: isChinese
                    ? `授权成功（${result.data.redemptionId.slice(0, 8)}）`
                    : `License activated (${result.data.redemptionId.slice(0, 8)})`
            });
        } else {
            // Keep the same idempotency key so a retry cannot create a second
            // redemption after a transient transport failure.
            setNotice({ kind: "error", text: errorMessage(result.error, isChinese) });
        }
    };

    const handleLogout = async () => {
        setBusy("logout");
        const result = await invokeAuth<DigiwiseAuthState>("digistudio:auth:logout");
        setBusy(null);
        if (result.ok) {
            applyAuthState(result.data);
            setNotice({ kind: "info", text: isChinese ? "已退出登录" : "Signed out" });
        }
    };

    const renderAuthForm = () => (
        <div className="DigiwiseAccount_AuthPanel">
            <div className="DigiwiseAccount_ModeTabs" role="tablist">
                <button
                    type="button"
                    role="tab"
                    aria-selected={authMode === "register"}
                    className={authMode === "register" ? "selected" : undefined}
                    onClick={() => setAuthMode("register")}
                >
                    {isChinese ? "邮箱注册" : "Email registration"}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={authMode === "login"}
                    className={authMode === "login" ? "selected" : undefined}
                    onClick={() => setAuthMode("login")}
                >
                    {isChinese ? "登录" : "Sign in"}
                </button>
            </div>

            {authMode === "register" ? (
                <form className="DigiwiseAccount_Form" onSubmit={handleRegister}>
                    <label>
                        <span>{isChinese ? "邮箱" : "Email"}</span>
                        <input
                            type="email"
                            value={registerEmail}
                            autoComplete="email"
                            onChange={event => setRegisterEmail(event.target.value)}
                            placeholder="name@example.com"
                            required
                        />
                    </label>
                    <label>
                        <span>{isChinese ? "密码（至少 8 位）" : "Password (8+ characters)"}</span>
                        <input
                            type="password"
                            value={registerPassword}
                            autoComplete="new-password"
                            onChange={event => setRegisterPassword(event.target.value)}
                            required
                            minLength={8}
                        />
                    </label>
                    <label>
                        <span>{isChinese ? "邮箱验证码" : "Email verification code"}</span>
                        <div className="DigiwiseAccount_InlineField">
                            <input
                                type="text"
                                value={verificationCode}
                                autoComplete="one-time-code"
                                onChange={event => setVerificationCode(event.target.value)}
                                placeholder="000000"
                                required
                            />
                            <button
                                type="button"
                                className="DigiwiseAccount_SecondaryButton"
                                onClick={() => void handleSendCode()}
                                disabled={busy !== null}
                            >
                                {busy === "send-code"
                                    ? isChinese
                                        ? "发送中…"
                                        : "Sending…"
                                    : isChinese
                                      ? "发送验证码"
                                      : "Send code"}
                            </button>
                        </div>
                    </label>
                    {codeSent && (
                        <p className="DigiwiseAccount_Hint">
                            {isChinese ? "已创建验证码请求。" : "A verification request is ready."}
                        </p>
                    )}
                    <button
                        type="submit"
                        className="DigiwiseAccount_PrimaryButton"
                        disabled={busy !== null}
                    >
                        {busy === "register"
                            ? isChinese
                                ? "注册中…"
                                : "Registering…"
                            : isChinese
                              ? "创建账号"
                              : "Create account"}
                    </button>
                    <p className="DigiwiseAccount_Hint">
                        {isChinese
                            ? "试用资格由服务端按身份发放一次，客户端不计算授权结果。"
                            : "The server grants one trial per identity; the client does not decide entitlement."}
                    </p>
                </form>
            ) : (
                <form className="DigiwiseAccount_Form" onSubmit={handleLogin}>
                    <label>
                        <span>{isChinese ? "邮箱" : "Email"}</span>
                        <input
                            type="email"
                            value={loginEmail}
                            autoComplete="email"
                            onChange={event => setLoginEmail(event.target.value)}
                            placeholder="name@example.com"
                            required
                        />
                    </label>
                    <label>
                        <span>{isChinese ? "密码" : "Password"}</span>
                        <input
                            type="password"
                            value={loginPassword}
                            autoComplete="current-password"
                            onChange={event => setLoginPassword(event.target.value)}
                            required
                        />
                    </label>
                    <button
                        type="submit"
                        className="DigiwiseAccount_PrimaryButton"
                        disabled={busy !== null}
                    >
                        {busy === "login"
                            ? isChinese
                                ? "登录中…"
                                : "Signing in…"
                            : isChinese
                              ? "登录"
                              : "Sign in"}
                    </button>
                </form>
            )}

            <div className="DigiwiseAccount_MockNotice">
                <strong>{isChinese ? "当前为 Mock API" : "Mock API"}</strong>
                <span>
                    {isChinese
                        ? "开发验证码：000000；测试授权码：MOCK-LICENSE-001"
                        : "Dev code: 000000; test license: MOCK-LICENSE-001"}
                </span>
            </div>
        </div>
    );

    const renderSignedIn = () => {
        const entitlements = authState.entitlements;
        const remaining = entitlements
            ? formatRemaining(entitlements, serverClockAnchor, isChinese)
            : null;

        return (
            <div className="DigiwiseAccount_SignedInPanel">
                <div className="DigiwiseAccount_AccountHeader">
                    <div>
                        <span className="DigiwiseAccount_Eyebrow">
                            {isChinese ? "当前账号" : "Signed-in account"}
                        </span>
                        <strong>{authState.email}</strong>
                    </div>
                    <button
                        type="button"
                        className="DigiwiseAccount_SecondaryButton"
                        onClick={() => void handleLogout()}
                        disabled={busy !== null}
                    >
                        {busy === "logout"
                            ? isChinese
                                ? "退出中…"
                                : "Signing out…"
                            : isChinese
                              ? "退出登录"
                              : "Sign out"}
                    </button>
                </div>

                {entitlements && (
                    <div className="DigiwiseAccount_EntitlementGrid">
                        <section className="DigiwiseAccount_EntitlementCard">
                            <span className="DigiwiseAccount_Eyebrow">
                                {isChinese ? "限时试用" : "Limited trial"}
                            </span>
                            <strong>{trialStatusLabel(entitlements.trial.status, isChinese)}</strong>
                            <small>
                                {isChinese ? "服务器到期时间：" : "Server expiry: "}
                                {formatServerDate(entitlements.trial.expiresAt, isChinese)}
                            </small>
                            {remaining && <small>{isChinese ? `剩余：${remaining}` : `Remaining: ${remaining}`}</small>}
                        </section>
                        <section className="DigiwiseAccount_EntitlementCard">
                            <span className="DigiwiseAccount_Eyebrow">
                                {isChinese ? "正式授权" : "License"}
                            </span>
                            <strong>{licenseStatusLabel(entitlements.license.status, isChinese)}</strong>
                            <small>
                                {isChinese ? "来源：" : "Source: "}
                                {entitlements.license.source}
                            </small>
                            <small>
                                {isChinese ? "服务端时间：" : "Server time: "}
                                {formatServerDate(entitlements.serverTime, isChinese)}
                            </small>
                        </section>
                    </div>
                )}

                {entitlements?.trial.status === "expired" &&
                    entitlements.license.status !== "active" && (
                        <div className="DigiwiseAccount_Warning">
                            {isChinese
                                ? "试用已到期。账号和本地工程仍可访问，编辑能力以服务端授权状态为准。"
                                : "The trial has expired. The account and local projects remain available; editing follows server entitlements."}
                        </div>
                    )}

                <form className="DigiwiseAccount_RedeemForm" onSubmit={handleRedeem}>
                    <div>
                        <span className="DigiwiseAccount_Eyebrow">
                            {isChinese ? "兑换授权码" : "Redeem license code"}
                        </span>
                        <p>
                            {isChinese
                                ? "每次提交都带有幂等键，网络重试不会重复兑换。"
                                : "Each submission uses an idempotency key, so retries cannot redeem twice."}
                        </p>
                    </div>
                    <div className="DigiwiseAccount_InlineField">
                        <input
                            type="text"
                            value={licenseCode}
                            onChange={event => setLicenseCode(event.target.value)}
                            placeholder="MOCK-LICENSE-001"
                            minLength={6}
                            required
                        />
                        <button
                            type="submit"
                            className="DigiwiseAccount_PrimaryButton"
                            disabled={busy !== null}
                        >
                            {busy === "redeem"
                                ? isChinese
                                    ? "兑换中…"
                                    : "Redeeming…"
                                : isChinese
                                  ? "兑换"
                                  : "Redeem"}
                        </button>
                    </div>
                </form>

                {entitlements && entitlements.capabilities.length > 0 && (
                    <div className="DigiwiseAccount_Capabilities">
                        <span className="DigiwiseAccount_Eyebrow">
                            {isChinese ? "当前能力" : "Current capabilities"}
                        </span>
                        <div>
                            {entitlements.capabilities.map(capability => (
                                <span key={capability}>{capability}</span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="EezStudio_DigiwiseAccount">
            <div className="DigiwiseAccount_PageHeader">
                <div>
                    <span className="DigiwiseAccount_Eyebrow">DigiwiseStudio</span>
                    <h2>{isChinese ? "账号与授权" : "Account and license"}</h2>
                    <p>
                        {isChinese
                            ? "注册、查看服务端试用状态并兑换授权码。"
                            : "Register, view server-side trial status, and redeem a license code."}
                    </p>
                </div>
                <span className="DigiwiseAccount_Badge">
                    {authState.isMockApi ? "Mock API" : "Public API"}
                </span>
            </div>

            {notice && <div className={`DigiwiseAccount_Notice ${notice.kind}`}>{notice.text}</div>}

            {loading ? (
                <div className="DigiwiseAccount_Loading">
                    {isChinese ? "正在读取账号状态…" : "Loading account status…"}
                </div>
            ) : authState.authenticated ? (
                renderSignedIn()
            ) : (
                renderAuthForm()
            )}
        </div>
    );
});
