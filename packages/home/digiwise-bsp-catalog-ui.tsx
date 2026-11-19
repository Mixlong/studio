import React from "react";
import { observer } from "mobx-react";

import type {
    DigiwiseIpcError,
    DigiwiseIpcResult
} from "eez-studio-shared/digiwise-auth";
import type {
    DigiwiseCategory,
    DigiwiseBspVersion
} from "eez-studio-shared/digiwise-bsp-catalog";
import { settingsController } from "home/settings";
import {
    listDigiwiseCategories,
    listDigiwiseBspVersions
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
    const requestId = React.useRef(0);

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
    }, [accountId]);

    React.useEffect(() => {
        requestId.current += 1;
        setCategories([]);
        setCategoryCode(null);
        setVersions([]);
        setSelectedVersionId(null);
        setCategoryError(null);
        setVersionError(null);
        if (authenticated) {
            void loadCategories();
        } else {
            setCategoryState("idle");
            setVersionState("idle");
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
                    <p>{isChinese ? "选择品类和版本查看目录信息。此页面不执行下载。" : "Choose a category and version to inspect catalog metadata. Downloads are not implemented here."}</p>
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
                            {versions.map(version => (
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={selectedVersionId === version.id}
                                    className={selectedVersionId === version.id ? "selected" : ""}
                                    key={version.id}
                                    onClick={() => setSelectedVersionId(version.id)}
                                >
                                    <strong>{version.version}</strong>
                                    <span>{version.fileName}</span>
                                    <span>{formatBspFileSize(version.fileSize)} · {formatCatalogDate(version.publishedAt, isChinese)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {selectedVersionId !== null && (() => {
                        const version = versions.find(item => item.id === selectedVersionId);
                        if (!version) return null;
                        return (
                            <div className="DigiwiseBspCatalog_Details" aria-live="polite">
                                <h4>{version.fileName}</h4>
                                <dl>
                                    <div><dt>{isChinese ? "版本" : "Version"}</dt><dd>{version.version}</dd></div>
                                    <div><dt>{isChinese ? "摘要" : "Summary"}</dt><dd>{version.modelName} · {version.categoryName}</dd></div>
                                    <div><dt>{isChinese ? "文件大小" : "File size"}</dt><dd>{formatBspFileSize(version.fileSize)}</dd></div>
                                    <div><dt>{isChinese ? "发布时间" : "Published"}</dt><dd>{formatCatalogDate(version.publishedAt, isChinese)}</dd></div>
                                    <div><dt>SHA-256</dt><dd className="DigiwiseBspCatalog_Checksum">{version.sha256}</dd></div>
                                </dl>
                                <button type="button" disabled title={isChinese ? "下载流程尚未实现" : "Download flow is not implemented"}>
                                    {isChinese ? "下载（未实现）" : "Download (not implemented)"}
                                </button>
                            </div>
                        );
                    })()}
                </section>
            </div>
        </div>
    );
});
