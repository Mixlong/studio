import React from "react";
import { ipcRenderer } from "electron";
import { action, makeObservable, observable, runInAction } from "mobx";
import { observer } from "mobx-react";
import classNames from "classnames";

import { Icon } from "eez-studio-ui/icon";
import * as notification from "eez-studio-ui/notification";
import { settingsController } from "home/settings";
import type {
    DigiwiseAuthState,
    DigiwiseCaptcha,
    DigiwiseIpcError,
    DigiwiseIpcResult
} from "eez-studio-shared/digiwise-auth";

export type AuthMode = "login";
type BusyAction = "login" | "logout" | null;

interface Notice {
    kind: "info" | "success" | "error";
    text?: string;
    zh?: string;
    en?: string;
}

const initialAuthState: DigiwiseAuthState = { authenticated: false };

function isChineseLocale() {
    return settingsController.locale.toLowerCase().startsWith("zh");
}

function errorMessage(error: DigiwiseIpcError, isChinese: boolean) {
    const messages: Record<string, [string, string]> = {
        BAD_CREDENTIALS: ["用户名或密码不正确", "Username or password is incorrect"],
        CAPTCHA_REQUIRED: ["请输入验证码", "Enter the captcha code"],
        CAPTCHA_INVALID: ["验证码无效，请点击图片刷新后重试", "Invalid captcha, click the image to refresh"],
        ACCOUNT_DISABLED: ["账号已被停用", "This account is disabled"],
        AUTH_REQUIRED: ["登录状态已失效，请重新登录", "Your session has expired; sign in again"],
        ACCESS_DENIED: ["当前账号无权访问此功能", "This account is not allowed to access this feature"],
        RATE_LIMITED: ["请求过于频繁，请稍后再试", "Too many requests; try again later"],
        INVALID_REQUEST: ["登录信息不完整或格式不正确", "The login information is invalid"],
        PUBLIC_API_UNAVAILABLE: ["服务暂不可用，请检查网络连接", "Authentication service is unavailable"],
        PUBLIC_API_NOT_CONFIGURED: ["服务接口地址尚未配置", "Authentication service is not configured"],
        PUBLIC_API_INVALID_RESPONSE: ["服务返回了无效响应", "Authentication service returned an invalid response"],
        CLIENT_AUTH_ERROR: ["账号认证暂时不可用", "Authentication failed"],
        HTTP_401: ["登录状态已失效，请重新登录", "Your session has expired; sign in again"],
        HTTP_403: ["当前账号无权访问此功能", "This account is not allowed to access this feature"]
    };
    const knownMessage = messages[error.code];
    if (knownMessage) {
        return knownMessage[isChinese ? 0 : 1];
    }

    const raw = (error.message || "").trim();
    if (/验证码.*(失效|过期)/.test(raw) || /captcha.*expired/i.test(raw)) {
        return isChinese
            ? "验证码已失效，请重新输入"
            : "Captcha has expired; please try again";
    }
    if (/验证码/.test(raw) || /captcha/i.test(raw)) {
        return isChinese
            ? "验证码错误，请重新输入"
            : "Incorrect captcha code";
    }
    if (/(密码|用户|账号).*(错误|不存在)/.test(raw) || /password|credential|user/i.test(raw)) {
        return isChinese
            ? "用户名或密码不正确"
            : "Username or password is incorrect";
    }
    if (/停用|禁用|disabled/i.test(raw)) {
        return isChinese ? "账号已被停用" : "This account is disabled";
    }

    return raw || (isChinese ? "操作失败，请重试" : "Operation failed; please try again");
}

function noticeText(notice: Notice, isChinese: boolean) {
    if (isChinese && notice.zh) {
        return notice.zh;
    }
    if (!isChinese && notice.en) {
        return notice.en;
    }
    return notice.text || "";
}

function userInitial(authState: DigiwiseAuthState) {
    const user = authState.user;
    return (user?.displayName || user?.username || "U")
        .trim()
        .charAt(0)
        .toUpperCase();
}

function captchaImageSource(captcha: DigiwiseCaptcha | null) {
    if (!captcha?.enabled || !captcha.imageBase64) {
        return undefined;
    }

    return `data:${captcha.mimeType || "image/jpeg"};base64,${captcha.imageBase64}`;
}

async function invokeAuth<T>(
    channel: string,
    input?: unknown
): Promise<DigiwiseIpcResult<T>> {
    return ipcRenderer.invoke(channel, input) as Promise<DigiwiseIpcResult<T>>;
}

class DigiwiseAuthController {
    authState: DigiwiseAuthState = initialAuthState;
    loading = true;
    busy: BusyAction = null;
    notice: Notice | null = null;
    authMode: AuthMode = "login";
    modalOpen = false;
    popoverOpen = false;
    hasAutoPromptedOnStartup = false;
    captcha: DigiwiseCaptcha | null = null;
    captchaLoading = false;
    captchaCode = "";
    loginUsername = "";
    loginPassword = "";

    private refreshTimer: number | null = null;
    private initialized = false;

    constructor() {
        makeObservable(this, {
            authState: observable,
            loading: observable,
            busy: observable,
            notice: observable,
            authMode: observable,
            modalOpen: observable,
            popoverOpen: observable,
            captcha: observable,
            captchaLoading: observable,
            captchaCode: observable,
            loginUsername: observable,
            loginPassword: observable,
            openModal: action.bound,
            closeModal: action.bound,
            togglePopover: action.bound,
            closePopover: action.bound,
            setAuthMode: action.bound,
            setNotice: action.bound,
            setCaptchaCode: action.bound,
            setLoginUsername: action.bound,
            setLoginPassword: action.bound,
            applyAuthState: action.bound
        });
    }

    openModal(mode?: AuthMode) {
        if (mode) {
            this.authMode = mode;
        }
        this.notice = null;
        this.popoverOpen = false;
        this.modalOpen = true;
    }

    closeModal() {
        this.modalOpen = false;
    }

    togglePopover() {
        this.popoverOpen = !this.popoverOpen;
    }

    closePopover() {
        this.popoverOpen = false;
    }

    setAuthMode(mode: AuthMode) {
        this.authMode = mode;
        this.notice = null;
    }

    setNotice(
        notice: Notice | null,
        isChinese = isChineseLocale()
    ) {
        this.notice = notice;

        if (!notice) {
            return;
        }

        const message = noticeText(notice, isChinese);
        if (notice.kind === "error") {
            notification.error(message);
        } else if (notice.kind === "success") {
            notification.success(message);
        } else {
            notification.info(message);
        }
    }

    setCaptchaCode(value: string) {
        this.captchaCode = value;
    }

    setLoginUsername(value: string) {
        this.loginUsername = value;
    }

    setLoginPassword(value: string) {
        this.loginPassword = value;
    }

    applyAuthState(nextState: DigiwiseAuthState) {
        this.authState = nextState;
        if (nextState.authenticated) {
            this.modalOpen = false;
            this.popoverOpen = false;
        }
    }

    ensureInitialized(isChinese: boolean) {
        if (this.initialized) {
            return;
        }

        this.initialized = true;
        void this.refresh(false, isChinese, true);
        if (this.refreshTimer === null && typeof window !== "undefined") {
            this.refreshTimer = window.setInterval(
                () => void this.refresh(false, isChinese, false),
                30000
            );
        }
    }

    async refresh(
        showError: boolean,
        isChinese: boolean,
        autoPopupIfUnauthenticated = false
    ) {
        const result = await invokeAuth<DigiwiseAuthState>(
            "digistudio:auth:state"
        );

        runInAction(() => {
            if (result.ok) {
                this.applyAuthState(result.data);
                if (showError) {
                    this.setNotice(null);
                }
                if (
                    autoPopupIfUnauthenticated &&
                    !this.hasAutoPromptedOnStartup &&
                    !result.data.authenticated
                ) {
                    this.hasAutoPromptedOnStartup = true;
                    this.modalOpen = true;
                }
            } else {
                // Access is granted only while the backend can confirm the
                // IDE session. Fail closed when validation cannot complete.
                this.applyAuthState(initialAuthState);
                if (showError) {
                    this.setNotice({
                        kind: "error",
                        zh: errorMessage(result.error, true),
                        en: errorMessage(result.error, false)
                    }, isChinese);
                }
                if (autoPopupIfUnauthenticated && !this.hasAutoPromptedOnStartup) {
                    this.hasAutoPromptedOnStartup = true;
                    this.modalOpen = true;
                }
            }
            this.loading = false;
        });
    }

    async refreshCaptcha(isChinese: boolean, showError = true) {
        if (this.captchaLoading) {
            return;
        }

        runInAction(() => {
            this.captchaLoading = true;
        });
        const result = await invokeAuth<DigiwiseCaptcha>(
            "digistudio:auth:captcha"
        );

        runInAction(() => {
            this.captchaLoading = false;
            if (result.ok) {
                this.captcha = result.data;
                this.captchaCode = "";
            } else if (showError) {
                this.setNotice({
                    kind: "error",
                    zh: errorMessage(result.error, true),
                    en: errorMessage(result.error, false)
                }, isChinese);
            }
        });
    }

    async handleLogin(event: React.FormEvent, isChinese: boolean) {
        event.preventDefault();

        if (!this.loginUsername.trim() || !this.loginPassword) {
            this.setNotice({
                kind: "error",
                zh: "请输入用户名和密码",
                en: "Enter your username and password"
            });
            return;
        }

        if (this.captcha?.enabled && !this.captchaCode.trim()) {
            this.setNotice({
                kind: "error",
                zh: "请输入验证码",
                en: "Enter the captcha code"
            });
            return;
        }

        runInAction(() => {
            this.busy = "login";
            this.notice = null;
        });

        const result = await invokeAuth<DigiwiseAuthState>(
            "digistudio:auth:login",
            {
                username: this.loginUsername.trim(),
                password: this.loginPassword,
                ...(this.captcha?.enabled
                    ? {
                          captchaCode: this.captchaCode.trim(),
                          captchaUuid: this.captcha.uuid
                      }
                    : {})
            }
        );

        const shouldRefreshCaptcha = !result.ok && Boolean(this.captcha?.enabled);

        runInAction(() => {
            this.busy = null;
            if (result.ok) {
                this.applyAuthState(result.data);
                this.captchaCode = "";
                this.setNotice({
                    kind: "success",
                    zh: "登录成功",
                    en: "Signed in successfully"
                }, isChinese);
            } else {
                this.setNotice({
                    kind: "error",
                    zh: errorMessage(result.error, true),
                    en: errorMessage(result.error, false)
                }, isChinese);
            }
        });

        if (shouldRefreshCaptcha) {
            void this.refreshCaptcha(isChinese, false);
        }
    }

    async handleLogout(isChinese: boolean) {
        runInAction(() => {
            this.busy = "logout";
            this.popoverOpen = false;
        });
        const result = await invokeAuth<DigiwiseAuthState>(
            "digistudio:auth:logout"
        );
        runInAction(() => {
            this.busy = null;
            if (result.ok) {
                this.applyAuthState(result.data);
                this.setNotice({
                    kind: "info",
                    zh: "已退出登录",
                    en: "Signed out"
                }, isChinese);
                this.modalOpen = true;
            } else {
                this.setNotice({
                    kind: "error",
                    zh: errorMessage(result.error, true),
                    en: errorMessage(result.error, false)
                }, isChinese);
            }
        });
    }
}

export const digiwiseAuthController = new DigiwiseAuthController();

export const DigiwiseLoginNav = observer(() => {
    const isChinese = settingsController.locale.toLowerCase().startsWith("zh");
    const containerRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        digiwiseAuthController.ensureInitialized(isChinese);
    }, [isChinese]);

    React.useEffect(() => {
        if (!digiwiseAuthController.popoverOpen) {
            return;
        }
        const handleMouseDown = (event: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                digiwiseAuthController.closePopover();
            }
        };
        window.addEventListener("mousedown", handleMouseDown);
        return () => window.removeEventListener("mousedown", handleMouseDown);
    }, [digiwiseAuthController.popoverOpen]);

    const { authState, popoverOpen, busy } = digiwiseAuthController;
    const user = authState.user;
    const avatarLabel = authState.authenticated ? userInitial(authState) : null;

    return (
        <div className="login-nav EezStudio_HomeTab_LoginNav" ref={containerRef}>
            <div
                className="auth-icon EezStudio_HomeTab_AuthIcon"
                role="button"
                tabIndex={0}
                title={
                    authState.authenticated
                        ? user?.displayName || user?.username || "Signed in"
                        : isChinese
                          ? "点击登录"
                          : "Click to sign in"
                }
                onClick={() => {
                    if (authState.authenticated) {
                        digiwiseAuthController.togglePopover();
                    } else {
                        digiwiseAuthController.openModal("login");
                    }
                }}
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (authState.authenticated) {
                            digiwiseAuthController.togglePopover();
                        } else {
                            digiwiseAuthController.openModal("login");
                        }
                    }
                }}
            >
                {avatarLabel ? (
                    <span>{avatarLabel}</span>
                ) : (
                    <i className="font-awesome-icons" aria-hidden="true">
                        {"\uf007"}
                    </i>
                )}
            </div>

            {authState.authenticated && popoverOpen && user && (
                <div
                    className="EezStudio_HomeTab_AuthPopover"
                    role="dialog"
                    aria-label={isChinese ? "账号信息" : "Account info"}
                >
                    <div className="EezStudio_HomeTab_AuthPopoverTitle">
                        <i className="font-awesome-icons" aria-hidden="true">
                            {"\uf007"}
                        </i>
                        <span>{user.displayName || user.username}</span>
                    </div>
                    <div className="EezStudio_HomeTab_AuthPopoverContent">
                        <div className="EezStudio_HomeTab_AuthPopoverMeta">
                            <span className="EezStudio_HomeTab_AuthPopoverMetaLabel">
                                {isChinese ? "用户名：" : "Username: "}
                            </span>
                            <strong>{user.username}</strong>
                        </div>
                        <button
                            type="button"
                            className="EezStudio_HomeTab_AuthPopoverAction"
                            disabled={busy === "logout"}
                            onClick={() => {
                                if (busy === null) {
                                    void digiwiseAuthController.handleLogout(
                                        isChinese
                                    );
                                }
                            }}
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
                </div>
            )}
        </div>
    );
});

function DigiwiseAuthBrandPanel({
    onCancel,
    isChinese = isChineseLocale()
}: {
    onCancel?: () => void;
    isChinese?: boolean;
}) {
    return (
        <aside className="DigiwiseAccount_BrandPanel">
            <div className="DigiwiseAccount_BrandPanelTop">
                <img
                    className="DigiwiseAccount_BrandLogo"
                    src="_images/digiwise-logo-dark-bg.svg"
                    alt="DIGIWISE"
                    draggable={false}
                />
            </div>
            {onCancel && (
                <button
                    type="button"
                    className="DigiwiseAccount_ModalClose"
                    onClick={onCancel}
                    aria-label="Close sign in"
                >
                    ×
                </button>
            )}
            <div className="DigiwiseAccount_BrandPanelContent">
                <span className="DigiwiseAccount_BrandKicker">
                    {isChinese ? "嵌入式界面设计" : "EMBEDDED UI DESIGN"}
                </span>
                <h2
                    className={
                        isChinese
                            ? "DigiwiseAccount_BrandHeadline--chinese"
                            : undefined
                    }
                >
                    {isChinese ? (
                        "设计界面、构建项目"
                    ) : (
                        <>
                            Design screens.
                            <br />
                            Build projects.
                        </>
                    )}
                </h2>
                <p>
                    {isChinese
                        ? "创建并测试嵌入式界面。"
                        : "Create and test embedded interfaces."}
                </p>
            </div>
        </aside>
    );
}

export const DigiwiseAuthFormContent = observer(
    ({
        inModal = false,
        inGate = false
    }: {
        inModal?: boolean;
        inGate?: boolean;
    }) => {
        const isChinese = isChineseLocale();
        const {
            busy,
            captcha,
            captchaLoading,
            captchaCode,
            loginUsername,
            loginPassword,
            authState
        } = digiwiseAuthController;

        React.useEffect(() => {
            if (
                !authState.authenticated &&
                !captcha &&
                !captchaLoading
            ) {
                void digiwiseAuthController.refreshCaptcha(isChinese, false);
            }
        }, [
            isChinese,
            authState.authenticated,
            captcha,
            captchaLoading
        ]);

        const captchaSrc = captchaImageSource(captcha);

        return (
            <div
                className={classNames("DigiwiseAccount_AuthPanel", {
                    "DigiwiseAccount_AuthPanel--modal": inModal,
                    "DigiwiseAccount_AuthPanel--gate": inGate
                })}
            >
                {!authState.authenticated && (
                    <header className="DigiwiseAccount_LoginHeader">
                        <h1>{isChinese ? "登录" : "Sign in"}</h1>
                        <p>
                            {isChinese
                                ? "请输入用户名和密码。"
                                : "Enter your username and password."}
                        </p>
                    </header>
                )}
                <div className="modal-body DigiwiseAccount_ModalBody">
                    <form
                        className="DigiwiseAccount_Form"
                        onSubmit={event =>
                            void digiwiseAuthController.handleLogin(
                                event,
                                isChinese
                            )
                        }
                    >
                        <label className="DigiwiseAccount_FieldRow">
                            <span className="DigiwiseAccount_FieldLabel">
                                {isChinese ? "用户名" : "Username"}
                            </span>
                            <input
                                type="text"
                                className="ant-input"
                                value={loginUsername}
                                autoComplete="username"
                                onChange={event =>
                                    digiwiseAuthController.setLoginUsername(
                                        event.target.value
                                    )
                                }
                                placeholder={
                                    isChinese ? "请输入用户名" : "Enter username"
                                }
                                required
                                autoFocus={inModal || inGate}
                            />
                        </label>
                        <label className="DigiwiseAccount_FieldRow">
                            <span className="DigiwiseAccount_FieldLabel">
                                {isChinese ? "密码" : "Password"}
                            </span>
                            <input
                                type="password"
                                className="ant-input"
                                value={loginPassword}
                                autoComplete="current-password"
                                onChange={event =>
                                    digiwiseAuthController.setLoginPassword(
                                        event.target.value
                                    )
                                }
                                placeholder={
                                    isChinese ? "请输入密码" : "Enter password"
                                }
                                required
                            />
                        </label>

                        {captcha?.enabled && (
                            <label className="DigiwiseAccount_FieldRow">
                                <span className="DigiwiseAccount_FieldLabel">
                                    {isChinese ? "验证码" : "Captcha"}
                                </span>
                                <div className="DigiwiseAccount_InlineField DigiwiseAccount_CaptchaRow">
                                    <input
                                        type="text"
                                        className="ant-input"
                                        value={captchaCode}
                                        autoComplete="one-time-code"
                                        onChange={event =>
                                            digiwiseAuthController.setCaptchaCode(
                                                event.target.value
                                            )
                                        }
                                        placeholder={
                                            isChinese
                                                ? "请输入验证码"
                                                : "Enter captcha"
                                        }
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="DigiwiseAccount_CaptchaImageButton"
                                        onClick={() =>
                                            void digiwiseAuthController.refreshCaptcha(
                                                isChinese
                                            )
                                        }
                                        disabled={captchaLoading || busy !== null}
                                        title={
                                            isChinese
                                                ? "点击刷新验证码"
                                                : "Click to refresh captcha"
                                        }
                                    >
                                        {captchaSrc ? (
                                            <img
                                                className="DigiwiseAccount_CaptchaImage"
                                                src={captchaSrc}
                                                alt={
                                                    isChinese
                                                        ? "验证码图片"
                                                        : "Captcha"
                                                }
                                            />
                                        ) : (
                                            <span className="DigiwiseAccount_CaptchaPlaceholder">
                                                {captchaLoading
                                                    ? isChinese
                                                        ? "加载中…"
                                                        : "Loading…"
                                                    : isChinese
                                                      ? "点击获取"
                                                      : "Refresh"}
                                            </span>
                                        )}
                                    </button>
                                </div>
                            </label>
                        )}

                        <div className="modal-foot DigiwiseAccount_ModalFoot">
                            {inModal && (
                                <button
                                    type="button"
                                    className="DigiwiseAccount_FootButton"
                                    onClick={digiwiseAuthController.closeModal}
                                >
                                    {isChinese ? "取消" : "Cancel"}
                                </button>
                            )}
                            <button
                                type="submit"
                                className="DigiwiseAccount_PrimaryButton"
                                disabled={busy !== null || captchaLoading}
                            >
                                {busy === "login"
                                    ? isChinese
                                        ? "登录中…"
                                        : "Signing in…"
                                    : isChinese
                                      ? "登录"
                                      : "Sign in"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
);

export const DigiwiseAuthGate = observer(() => {
    const isChinese = isChineseLocale();
    const { loading } = digiwiseAuthController;

    return (
        <main
            className="DigiwiseAccount_RequiredGate"
            aria-label={
                isChinese
                    ? "DigiwiseStudio 账号登录"
                    : "DigiwiseStudio Sign In"
            }
        >
            <section className="DigiwiseAccount_RequiredGateCard DigiwiseAccount_AuthLayout">
                <DigiwiseAuthBrandPanel />
                <div className="DigiwiseAccount_LoginPanel">
                {loading ? (
                    <div
                        className="DigiwiseAccount_RequiredGateLoading"
                        role="status"
                    >
                        {isChinese ? "正在检查账号…" : "Checking account…"}
                    </div>
                ) : (
                    <DigiwiseAuthFormContent inGate={true} />
                )}
                </div>
            </section>
        </main>
    );
});

export const DigiwiseAuthModal = observer(() => {
    const isChinese = isChineseLocale();

    React.useEffect(() => {
        digiwiseAuthController.ensureInitialized(isChinese);
    }, [isChinese]);

    React.useEffect(() => {
        if (!digiwiseAuthController.modalOpen) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                digiwiseAuthController.closeModal();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [digiwiseAuthController.modalOpen]);

    if (
        !digiwiseAuthController.modalOpen ||
        digiwiseAuthController.authState.authenticated
    ) {
        return null;
    }

    return (
        <div
            className="mask login-mask DigiwiseAccount_ModalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label={
                isChinese ? "DigiwiseStudio 账号登录" : "DigiwiseStudio sign in"
            }
            onMouseDown={event => {
                if (event.target === event.currentTarget) {
                    digiwiseAuthController.closeModal();
                }
            }}
        >
            <div className="com-modal DigiwiseAccount_ModalDialog">
                <div className="modal-content DigiwiseAccount_AuthLayout">
                    <DigiwiseAuthBrandPanel
                        onCancel={digiwiseAuthController.closeModal}
                    />
                    <div className="DigiwiseAccount_LoginPanel">
                        <DigiwiseAuthFormContent inModal={true} />
                    </div>
                </div>
            </div>
        </div>
    );
});

export const DigiwiseAccount = observer(() => {
    const isChinese = settingsController.locale.toLowerCase().startsWith("zh");

    React.useEffect(() => {
        digiwiseAuthController.ensureInitialized(isChinese);
        if (!digiwiseAuthController.authState.authenticated) {
            digiwiseAuthController.openModal();
        }
    }, [isChinese]);

    const { authState, loading, busy } = digiwiseAuthController;
    const user = authState.user;

    const renderSignedIn = () => (
        <div className="DigiwiseAccount_SignedInPanel settings-card">
            <div className="settings-card-header DigiwiseAccount_CardHeader">
                <div className="settings-card-header-left">
                    <Icon
                        icon="material:verified_user"
                        size={20}
                        className="settings-card-icon"
                    />
                    <div>
                        <h4 className="settings-card-title">
                            {isChinese ? "当前已登录账号" : "Signed-In Account"}
                        </h4>
                        <p className="settings-card-desc">
                            {isChinese
                                ? "已连接 DigiwiseStudio IDE 公共接口"
                                : "Connected to the DigiwiseStudio IDE Public API"}
                        </p>
                    </div>
                </div>
                <span className="DigiwiseAccount_Badge is-authenticated">
                    {isChinese ? "已认证" : "Verified"}
                </span>
            </div>

            {user && (
                <div className="DigiwiseAccount_AccountHeader">
                    <div className="DigiwiseAccount_AvatarBadge" aria-hidden="true">
                        {userInitial(authState)}
                    </div>
                    <div className="DigiwiseAccount_IdentityMeta">
                        <span className="DigiwiseAccount_Eyebrow">
                            {isChinese ? "显示名称" : "Display name"}
                        </span>
                        <strong>{user.displayName || user.username}</strong>
                        <small>
                            {isChinese
                                ? `用户名：${user.username}`
                                : `Username: ${user.username}`}
                        </small>
                        {user.email && <small>{user.email}</small>}
                    </div>
                    <button
                        type="button"
                        className="DigiwiseAccount_SecondaryButton"
                        onClick={() =>
                            void digiwiseAuthController.handleLogout(isChinese)
                        }
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
            )}
        </div>
    );

    const renderConnectionOverview = () => (
        <div className="DigiwiseAccount_OverviewPanel settings-card">
            <div className="DigiwiseAccount_GuiderBanner">
                <strong>DigiwiseStudio</strong>
                <span>
                    {authState.authenticated
                        ? isChinese
                            ? "账号会话由新版 RuoYi IDE 公共接口管理"
                            : "The account session is managed by the RuoYi IDE Public API"
                        : isChinese
                          ? "使用后台创建的账号登录 DigiwiseStudio"
                          : "Sign in with an account provisioned by the backend"}
                </span>
            </div>

            <div className="DigiwiseAccount_EntitlementGrid">
                <section className="DigiwiseAccount_EntitlementCard">
                    <span className="DigiwiseAccount_Eyebrow">
                        {isChinese ? "账号类型" : "Identity type"}
                    </span>
                    <strong>
                        {user
                            ? user.identityType === "internal"
                                ? isChinese
                                    ? "内部员工"
                                    : "Internal employee"
                                : isChinese
                                  ? "外部用户"
                                  : "External user"
                            : isChinese
                              ? "登录后查看"
                              : "Sign in to view"}
                    </strong>
                    <small>
                        {user
                            ? isChinese
                                ? `状态：${user.accountStatus === "active" ? "正常" : "已停用"}`
                                : `Status: ${user.accountStatus}`
                            : isChinese
                              ? "服务端校验"
                              : "Validated by the server"}
                    </small>
                </section>

                <section className="DigiwiseAccount_EntitlementCard">
                    <span className="DigiwiseAccount_Eyebrow">
                        {isChinese ? "会话状态" : "Session"}
                    </span>
                    <strong>
                        {authState.authenticated
                            ? isChinese
                                ? "已连接"
                                : "Connected"
                            : isChinese
                              ? "未登录"
                              : "Signed out"}
                    </strong>
                    <small>
                        {authState.expiresIn
                            ? isChinese
                                ? `剩余有效期：${Math.ceil(authState.expiresIn / 60)} 分钟`
                                : `Expires in about ${Math.ceil(authState.expiresIn / 60)} minutes`
                            : isChinese
                              ? "登录后读取服务端会话"
                              : "Read from the server after sign-in"}
                    </small>
                </section>
            </div>
        </div>
    );

    return (
        <div className="EezStudio_DigiwiseAccount">
            <div className="DigiwiseAccount_Dashboard">
                <div className="DigiwiseAccount_Column DigiwiseAccount_Column--left">
                    {loading ? (
                        <div className="DigiwiseAccount_Loading settings-card">
                            {isChinese
                                ? "正在读取账号状态…"
                                : "Loading account status…"}
                        </div>
                    ) : authState.authenticated ? (
                        renderSignedIn()
                    ) : (
                        <DigiwiseAuthFormContent inModal={false} />
                    )}
                </div>
                <div className="DigiwiseAccount_Column DigiwiseAccount_Column--right">
                    {renderConnectionOverview()}
                </div>
            </div>
        </div>
    );
});
