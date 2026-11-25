import React from "react";
import { observer } from "mobx-react";

import type {
    DigiwiseIpcError,
    DigiwiseIpcResult
} from "eez-studio-shared/digiwise-auth";
import type {
    DigiwiseCategory,
    DigiwiseBspVersion,
    DigiwiseInstalledBspRecord,
    DigiwiseBspDownloadProgress
} from "eez-studio-shared/digiwise-bsp-catalog";
import { settingsController } from "home/settings";
import {
    listDigiwiseCategories,
    listDigiwiseBspVersions,
    listInstalledDigiwiseBsps,
    downloadDigiwiseBsp,
    removeInstalledDigiwiseBsp,
    onDigiwiseBspDownloadProgress
} from "home/digiwise-bsp-catalog";
import { digiwiseAuthController } from "home/digiwise-account";

export function formatBspFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes;
    let unit = -1;
    do {
        value /= 1024;
        unit += 1;
    } while (value >= 1024 && unit < units.length - 1);
    const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${units[unit]}`;
}

export function formatCatalogDate(value: string | null, isChinese: boolean) {
    if (!value) return isChinese ? "未发布" : "Not published";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return isChinese ? "日期未知" : "Date unavailable";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function catalogErrorMessage(
    error: Pick<DigiwiseIpcError, "code" | "message"> | null,
    isChinese: boolean
) {
    if (!error) return "";
    const messages: Record<string, [string, string]> = {
        AUTH_REQUIRED: ["请先登录或重新登录", "Sign in or sign in again"],
        ACCESS_DENIED: ["当前账号没有访问 BSP 目录的权限", "This account cannot access the BSP catalog"],
        INVALID_REQUEST: ["目录请求无效", "The catalog request is invalid"],
        NOT_FOUND: ["未找到 BSP 目录", "The BSP catalog was not found"],
        BSP_NOT_FOUND: ["未找到已发布或已授权的 BSP 版本", "Authorized published BSP not found"],
        BSP_INTEGRITY_FAILED: ["服务端 BSP 校验失败，请联系管理员", "Server BSP integrity check failed"],
        BSP_FILE_INTEGRITY_FAILED: ["下载文件的大小或 SHA-256 校验失败，已清理临时文件", "Downloaded BSP size or SHA-256 mismatch"],
        BSP_ARCHIVE_INVALID: ["BSP 压缩包结构不合法或包含不安全路径", "Invalid or unsafe BSP archive"],
        BSP_DOWNLOAD_FAILED: ["BSP 下载失败，请检查网络或重试", "BSP download failed; check network and retry"],
        RATE_LIMITED: ["请求过于频繁，请稍后重试", "Too many requests; try again later"],
        PUBLIC_API_UNAVAILABLE: ["BSP 目录服务不可用", "Catalog service is unavailable"],
        PUBLIC_API_INVALID_RESPONSE: ["BSP 目录返回了无效数据", "The BSP catalog returned invalid data"]
    };
    return messages[error.code]?.[isChinese ? 0 : 1] ||
        (isChinese ? "无法加载 BSP 目录" : "Unable to load the BSP catalog");
}

type LoadState = "idle" | "loading" | "ready" | "empty" | "error";

function ErrorPanel(props: { error: DigiwiseIpcError | null; isChinese: boolean; onRetry: () => void }) {
    return (
        <div className="DigiwiseBspCatalog_Error" role="alert">
            <strong>{props.isChinese ? "目录加载失败" : "Catalog failed to load"}</strong>
            <span>{catalogErrorMessage(props.error, props.isChinese)}</span>
            <button type="button" onClick={props.onRetry}>
                {props.isChinese ? "重试" : "Retry"}
            </button>
        </div>
    );
}

function LoadingPanel({ label }: { label: string }) {
    return <div className="DigiwiseBspCatalog_State" role="status" aria-live="polite">{label}</div>;
}

export const BspCatalogView = observer(() => {
    const isChinese = settingsController.locale.toLowerCase().startsWith("zh");
    const authenticated = digiwiseAuthController.authState.authenticated;
    const accountId = digiwiseAuthController.authState.user?.id || "anonymous";
    const [categories, setCategories] = React.useState<DigiwiseCategory[]>([]);
    const [categoryCode, setCategoryCode] = React.useState<string | null>(null);
    const [versions, setVersions] = React.useState<DigiwiseBspVersion[]>([]);
    const [selectedVersionId, setSelectedVersionId] = React.useState<number | null>(null);
    const [categoryState, setCategoryState] = React.useState<LoadState>("idle");
    const [versionState, setVersionState] = React.useState<LoadState>("idle");
    const [categoryError, setCategoryError] = React.useState<DigiwiseIpcError | null>(null);
    const [versionError, setVersionError] = React.useState<DigiwiseIpcError | null>(null);
    const [versionRetry, setVersionRetry] = React.useState(0);
    const [installedList, setInstalledList] = React.useState<DigiwiseInstalledBspRecord[]>([]);
    const [downloadingId, setDownloadingId] = React.useState<number | null>(null);
    const [downloadProgress, setDownloadProgress] = React.useState<DigiwiseBspDownloadProgress | null>(null);
    const [downloadMessage, setDownloadMessage] = React.useState<{ text: string; isError: boolean } | null>(null);
    const requestId = React.useRef(0);

    const refreshInstalled = React.useCallback(async () => {
        const result = await listInstalledDigiwiseBsps();
        if (result.ok) {
            setInstalledList(result.data);
        }
    }, []);

    const loadCategories = React.useCallback(async () => {
        const request = ++requestId.current;
        setCategoryState("loading");
        setCategoryError(null);
        setCategories([]);
        setCategoryCode(null);
        setVersions([]);
        setSelectedVersionId(null);
        const result = await listDigiwiseCategories();
        if (request !== requestId.current) return;
        if (!result.ok) {
            setCategoryState("error");
            setCategoryError(result.error);
            return;
        }
        setCategories(result.data);
        setCategoryState(result.data.length ? "ready" : "empty");
        setCategoryCode(result.data[0]?.categoryCode || null);
        void refreshInstalled();
    }, [accountId, refreshInstalled]);

    React.useEffect(() => {
        const unsubscribe = onDigiwiseBspDownloadProgress(progress => {
            setDownloadProgress(progress);
        });
        return unsubscribe;
    }, []);

    React.useEffect(() => {
        requestId.current += 1;
        setCategories([]);
        setCategoryCode(null);
        setVersions([]);
        setSelectedVersionId(null);
        setCategoryError(null);
        setVersionError(null);
        setDownloadMessage(null);
        setDownloadProgress(null);
        if (authenticated) {
            void loadCategories();
        } else {
            setCategoryState("idle");
            setVersionState("idle");
            setInstalledList([]);
        }
    }, [authenticated, accountId, loadCategories]);

    React.useEffect(() => {
        if (!categoryCode) {
            setVersionState("idle");
            return;
        }
        const request = ++requestId.current;
        setVersionState("loading");
        setVersionError(null);
        setVersions([]);
        setSelectedVersionId(null);
        void listDigiwiseBspVersions(categoryCode).then((result: DigiwiseIpcResult<DigiwiseBspVersion[]>) => {
            if (request !== requestId.current) return;
            if (!result.ok) {
                setVersionState("error");
                setVersionError(result.error);
                return;
            }
            setVersions(result.data);
            setVersionState(result.data.length ? "ready" : "empty");
        });
    }, [categoryCode, versionRetry]);

    const findInstalled = (version: DigiwiseBspVersion) =>
        installedList.find(
            item =>
                item.categoryCode === version.categoryCode &&
                item.version === version.version &&
                item.sha256.toLowerCase() === version.sha256.toLowerCase()
        );

    const handleDownload = async (version: DigiwiseBspVersion) => {
        if (downloadingId !== null) return;
        setDownloadingId(version.id);
        setDownloadMessage(null);
        setDownloadProgress({ bspId: version.id, stage: "requesting", receivedBytes: 0, totalBytes: version.fileSize });
        try {
            const result = await downloadDigiwiseBsp(version.id);
            if (!result.ok) {
                setDownloadMessage({
                    text: catalogErrorMessage(result.error, isChinese),
                    isError: true
                });
                return;
            }
            await refreshInstalled();
            setDownloadMessage({
                text: isChinese
                    ? `已完成校验并安装到：${result.data.installPath}`
                    : `Verified and installed to: ${result.data.installPath}`,
                isError: false
            });
        } finally {
            setDownloadingId(null);
            setDownloadProgress(null);
        }
    };

    const handleRemove = async (version: DigiwiseBspVersion) => {
        if (downloadingId !== null) return;
        const result = await removeInstalledDigiwiseBsp(version.categoryCode, version.version);
        if (result.ok) {
            await refreshInstalled();
            setDownloadMessage({
                text: isChinese ? "已移除本地安装的 BSP" : "Removed locally installed BSP",
                isError: false
            });
        }
    };

    if (!authenticated) {
        return (
            <div className="DigiwiseBspCatalog" aria-labelledby="digiwise-bsp-title">
                <div className="DigiwiseBspCatalog_Header">
                    <h2 id="digiwise-bsp-title">{isChinese ? "BSP 目录" : "BSP Catalog"}</h2>
                    <p>{isChinese ? "登录后查看已授权的 BSP 版本。" : "Sign in to view authorized BSP versions."}</p>
                </div>
                <div className="DigiwiseBspCatalog_State">{isChinese ? "当前会话未登录" : "No active session"}</div>
            </div>
        );
    }

    return (
        <div className="DigiwiseBspCatalog" aria-labelledby="digiwise-bsp-title">
            <div className="DigiwiseBspCatalog_Header">
                <div>
                    <h2 id="digiwise-bsp-title">{isChinese ? "BSP 版本" : "BSP Versions"}</h2>
                    <p>{isChinese ? "选择已授权品类与 BSP 版本，支持受控下载、SHA-256 校验与本地安装。" : "Choose an authorized category and BSP version for verified download and local installation."}</p>
                </div>
                <button type="button" onClick={() => void loadCategories()} disabled={categoryState === "loading"}>
                    {isChinese ? "刷新目录" : "Refresh catalog"}
                </button>
            </div>
            <div className="DigiwiseBspCatalog_Columns">
                <section className="DigiwiseBspCatalog_Categories" aria-labelledby="digiwise-bsp-categories-title">
                    <h3 id="digiwise-bsp-categories-title">{isChinese ? "品类" : "Categories"}</h3>
                    {categoryState === "loading" && <LoadingPanel label={isChinese ? "正在加载品类…" : "Loading categories…"} />}
                    {categoryState === "error" && <ErrorPanel error={categoryError} isChinese={isChinese} onRetry={() => void loadCategories()} />}
                    {categoryState === "empty" && <div className="DigiwiseBspCatalog_State">{isChinese ? "暂无已授权品类" : "No authorized categories"}</div>}
                    {categoryState === "ready" && (
                        <div className="DigiwiseBspCatalog_CategoryList" role="listbox" aria-label={isChinese ? "BSP品类" : "BSP categories"}>
                            {categories.map(category => (
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={category.categoryCode === categoryCode}
                                    className={category.categoryCode === categoryCode ? "selected" : ""}
                                    key={category.categoryCode}
                                    onClick={() => setCategoryCode(category.categoryCode)}
                                >
                                    <strong>{category.categoryName}</strong>
                                    <span>{category.categoryCode} · {category.chipFamily || (isChinese ? "芯片族未知" : "Chip family unavailable")}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>
                <section className="DigiwiseBspCatalog_Versions" aria-labelledby="digiwise-bsp-versions-title">
                    <h3 id="digiwise-bsp-versions-title">{isChinese ? "版本" : "Versions"}</h3>
                    {versionState === "loading" && <LoadingPanel label={isChinese ? "正在加载版本…" : "Loading versions…"} />}
                    {versionState === "error" && <ErrorPanel error={versionError} isChinese={isChinese} onRetry={() => setVersionRetry(value => value + 1)} />}
                    {versionState === "empty" && <div className="DigiwiseBspCatalog_State">{isChinese ? "该品类暂无 BSP 版本" : "No BSP versions for this category"}</div>}
                    {versionState === "ready" && (
                        <div className="DigiwiseBspCatalog_VersionList" role="listbox" aria-label={isChinese ? "BSP版本" : "BSP versions"}>
                            {versions.map(version => {
                                const installed = !!findInstalled(version);
                                return (
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={selectedVersionId === version.id}
                                        className={selectedVersionId === version.id ? "selected" : ""}
                                        key={version.id}
                                        onClick={() => {
                                            setSelectedVersionId(version.id);
                                            setDownloadMessage(null);
                                        }}
                                    >
                                        <strong>
                                            {version.version}
                                            {installed ? (isChinese ? "（已安装）" : " (Installed)") : ""}
                                        </strong>
                                        <span>{version.fileName}</span>
                                        <span>{formatBspFileSize(version.fileSize)} · {formatCatalogDate(version.publishedAt, isChinese)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {selectedVersionId !== null && (() => {
                        const version = versions.find(item => item.id === selectedVersionId);
                        if (!version) return null;
                        const installed = findInstalled(version);
                        const isDownloading = downloadingId === version.id;
                        const pct = downloadProgress && downloadProgress.bspId === version.id && downloadProgress.totalBytes > 0
                            ? Math.min(100, Math.round((downloadProgress.receivedBytes / downloadProgress.totalBytes) * 100))
                            : 0;
                        return (
                            <div className="DigiwiseBspCatalog_Details" aria-live="polite">
                                <h4>{version.fileName}</h4>
                                <dl>
                                    <div><dt>{isChinese ? "版本" : "Version"}</dt><dd>{version.version}</dd></div>
                                    <div><dt>{isChinese ? "摘要" : "Summary"}</dt><dd>{version.modelName} · {version.categoryName}</dd></div>
                                    <div><dt>{isChinese ? "文件大小" : "File size"}</dt><dd>{formatBspFileSize(version.fileSize)}</dd></div>
                                    <div><dt>{isChinese ? "发布时间" : "Published"}</dt><dd>{formatCatalogDate(version.publishedAt, isChinese)}</dd></div>
                                    <div><dt>SHA-256</dt><dd className="DigiwiseBspCatalog_Checksum">{version.sha256}</dd></div>
                                    {installed && (
                                        <div><dt>{isChinese ? "本地路径" : "Installed path"}</dt><dd>{installed.installPath}</dd></div>
                                    )}
                                </dl>
                                <div className="DigiwiseBspCatalog_Actions">
                                    <button
                                        type="button"
                                        disabled={downloadingId !== null}
                                        onClick={() => void handleDownload(version)}
                                    >
                                        {isDownloading
                                            ? (isChinese ? `下载安装中 (${pct}%)…` : `Downloading (${pct}%)…`)
                                            : installed
                                                ? (isChinese ? "重新校验并安装" : "Re-verify & reinstall")
                                                : (isChinese ? "下载并安装" : "Download & install")}
                                    </button>
                                    {installed && (
                                        <button
                                            type="button"
                                            disabled={downloadingId !== null}
                                            onClick={() => void handleRemove(version)}
                                        >
                                            {isChinese ? "卸载本地包" : "Remove local"}
                                        </button>
                                    )}
                                </div>
                                {downloadMessage && (
                                    <div
                                        className={downloadMessage.isError ? "DigiwiseBspCatalog_Error" : "DigiwiseBspCatalog_State"}
                                        role="status"
                                    >
                                        {downloadMessage.text}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </section>
            </div>
        </div>
    );
});
