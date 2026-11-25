import React from "react";
import { makeObservable, observable, runInAction } from "mobx";
import { observer } from "mobx-react";
import { dialog, getCurrentWindow } from "@electron/remote";
import path from "path";

import { showDialog } from "eez-studio-ui/dialog";
import { Icon } from "eez-studio-ui/icon";
import { ProjectContext } from "project-editor/project/context";
import { digiwiseLocalPipeline } from "home/digiwise-local-pipeline";
import {
    applyManagedBspToEmbeddedBsp,
    type DigiwiseBspDownloadProgress,
    type DigiwiseBspVersion,
    type DigiwiseCategory,
    type DigiwiseInstalledBspRecord
} from "eez-studio-shared/digiwise-bsp-catalog";
import type { ToolchainEnvironmentReport } from "eez-studio-shared/digiwise-toolchain";
import type { LocalBuildRecord } from "eez-studio-shared/digiwise-build";
import type { LocalDownloadRecord, LocalProbeDetectResult } from "eez-studio-shared/digiwise-download";

type StepTone = "idle" | "active" | "ok" | "warn" | "error";

const TONE_COLOR: Record<StepTone, string> = {
    idle: "#6c757d",
    active: "#3b82f6",
    ok: "#22c55e",
    warn: "#f59e0b",
    error: "#ef4444"
};

const cardStyle: React.CSSProperties = {
    background: "#1c1e22",
    border: "1px solid #2f333b",
    borderRadius: 8,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8
};

function btnStyle(
    variant: "primary" | "success" | "secondary" | "danger",
    disabled = false
): React.CSSProperties {
    const bg =
        variant === "primary"
            ? "#2563eb"
            : variant === "success"
              ? "#16a34a"
              : variant === "danger"
                ? "#dc2626"
                : "#2b3038";
    const border =
        variant === "secondary" ? "1px solid #404652" : "1px solid transparent";
    return {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        padding: "5px 10px",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: "16px",
        color: "#f3f4f6",
        background: bg,
        border,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap"
    };
}

function StepBadge(props: { num: number; tone: StepTone; title: string; subtitle?: string }) {
    const color = TONE_COLOR[props.tone];
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
                style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: color,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0
                }}
            >
                {props.tone === "ok" ? "✓" : props.num}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div
                    style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#f3f4f6",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                    }}
                >
                    {props.title}
                </div>
                {props.subtitle && (
                    <div
                        style={{
                            fontSize: 11,
                            color: "#9ca3af",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                        }}
                    >
                        {props.subtitle}
                    </div>
                )}
            </div>
        </div>
    );
}

function ProgressBar(props: { percent: number; color?: string }) {
    const pct = Math.max(0, Math.min(100, Math.round(props.percent)));
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
                style={{
                    flex: 1,
                    height: 6,
                    background: "#2b3038",
                    borderRadius: 999,
                    overflow: "hidden"
                }}
            >
                <div
                    style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: props.color || "#3b82f6",
                        transition: "width 180ms ease"
                    }}
                />
            </div>
            <span style={{ fontSize: 11, color: "#9ca3af", minWidth: 32, textAlign: "right" }}>
                {pct}%
            </span>
        </div>
    );
}

interface LocalPipelinePanelProps {
    wideMode?: boolean;
}

export const LocalPipelinePanel = observer(
    class LocalPipelinePanel extends React.Component<LocalPipelinePanelProps> {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        // LB02 state
        categories: DigiwiseCategory[] = [];
        selectedCategory = "";
        remoteVersions: DigiwiseBspVersion[] = [];
        installedBsps: DigiwiseInstalledBspRecord[] = [];
        downloadProgress: DigiwiseBspDownloadProgress | null = null;
        bspMessage = "";
        bspTone: StepTone = "idle";
        bspBusy = false;

        // LB03 state
        customEnvRoot = "";
        toolchainReport: ToolchainEnvironmentReport | null = null;
        toolchainMessage = "";
        toolchainBusy = false;

        // LB04 state
        buildRunning = false;
        buildProgress = 0;
        buildRecord: LocalBuildRecord | null = null;
        buildLogs: string[] = [];

        // LB05 state
        probeResult: LocalProbeDetectResult | null = null;
        downloadRunning = false;
        downloadProgressPct = 0;
        downloadRecord: LocalDownloadRecord | null = null;
        downloadLogs: string[] = [];

        private unsubscribers: Array<() => void> = [];

        constructor(props: LocalPipelinePanelProps) {
            super(props);
            makeObservable(this, {
                categories: observable,
                selectedCategory: observable,
                remoteVersions: observable,
                installedBsps: observable,
                downloadProgress: observable,
                bspMessage: observable,
                bspTone: observable,
                bspBusy: observable,
                customEnvRoot: observable,
                toolchainReport: observable,
                toolchainMessage: observable,
                toolchainBusy: observable,
                buildRunning: observable,
                buildProgress: observable,
                buildRecord: observable,
                buildLogs: observable,
                probeResult: observable,
                downloadRunning: observable,
                downloadProgressPct: observable,
                downloadRecord: observable,
                downloadLogs: observable
            });
        }

        override componentDidMount() {
            this.unsubscribers.push(
                digiwiseLocalPipeline.onBspDownloadProgress(progress => {
                    runInAction(() => {
                        this.downloadProgress = progress;
                    });
                }),
                digiwiseLocalPipeline.onLocalBuildLog(ev => {
                    runInAction(() => {
                        this.buildLogs.push(`[${ev.stage}] ${ev.line}`);
                        if (this.buildLogs.length > 300) {
                            this.buildLogs.splice(0, this.buildLogs.length - 300);
                        }
                        if (ev.progress !== undefined) {
                            this.buildProgress = ev.progress;
                        }
                    });
                }),
                digiwiseLocalPipeline.onLocalDownloadLog(ev => {
                    runInAction(() => {
                        this.downloadLogs.push(`[${ev.stage}] ${ev.line}`);
                        if (this.downloadLogs.length > 200) {
                            this.downloadLogs.splice(0, this.downloadLogs.length - 200);
                        }
                        if (ev.progress !== undefined) {
                            this.downloadProgressPct = ev.progress;
                        }
                    });
                })
            );
            void this.refreshInitialState();
        }

        override componentWillUnmount() {
            for (const unsub of this.unsubscribers) unsub();
            this.unsubscribers = [];
        }

        openWideWindow = () => {
            showDialog(
                <ProjectContext.Provider value={this.context}>
                    <LocalPipelinePanel wideMode={true} />
                </ProjectContext.Provider>,
                {
                    jsPanel: {
                        id: "digiwise-local-pipeline-wide",
                        title: "DigiwiseStudio · 本地编译与烧录控制台（LB02～LB05）",
                        width: 1080,
                        height: 740,
                        headerControls: {
                            minimize: "remove",
                            maximize: "remove",
                            smallify: "remove"
                        },
                        modeless: true
                    }
                }
            );
        };

        refreshInitialState = async () => {
            const [instRes, cfgRes] = await Promise.all([
                digiwiseLocalPipeline.listInstalledBsps(),
                digiwiseLocalPipeline.getToolchainConfig()
            ]);
            runInAction(() => {
                if (instRes.ok) this.installedBsps = instRes.data;
                if (cfgRes.ok && cfgRes.data.customEnvRoots.length > 0) {
                    this.customEnvRoot = cfgRes.data.customEnvRoots[0];
                }
            });
        };

        refreshCatalog = async () => {
            runInAction(() => {
                this.bspBusy = true;
                this.bspTone = "active";
                this.bspMessage = "正在拉取已授权品类与 BSP 列表...";
            });
            try {
                const catRes = await digiwiseLocalPipeline.listCategories();
                if (!catRes.ok) {
                    runInAction(() => {
                        this.bspTone = "error";
                        this.bspMessage = `${catRes.error.code}: ${catRes.error.message}`;
                    });
                    return;
                }
                const firstCat = this.selectedCategory || catRes.data[0]?.categoryCode || "";
                const verRes = firstCat
                    ? await digiwiseLocalPipeline.listBspVersions(firstCat)
                    : await digiwiseLocalPipeline.listBspVersions();
                const instRes = await digiwiseLocalPipeline.listInstalledBsps();
                runInAction(() => {
                    this.categories = catRes.data;
                    this.selectedCategory = firstCat;
                    if (verRes.ok) this.remoteVersions = verRes.data;
                    if (instRes.ok) this.installedBsps = instRes.data;
                    this.bspTone = catRes.data.length > 0 ? "ok" : "warn";
                    this.bspMessage =
                        catRes.data.length > 0
                            ? `已加载 ${catRes.data.length} 个授权品类，${verRes.ok ? verRes.data.length : 0} 个已发布 BSP。`
                            : "当前账号暂无授权品类，请在 Java 管理后台分配品类并发布 BSP。";
                });
            } finally {
                runInAction(() => {
                    this.bspBusy = false;
                });
            }
        };

        onSelectCategory = async (categoryCode: string) => {
            runInAction(() => {
                this.selectedCategory = categoryCode;
                this.bspBusy = true;
            });
            try {
                const verRes = await digiwiseLocalPipeline.listBspVersions(categoryCode || undefined);
                runInAction(() => {
                    if (verRes.ok) {
                        this.remoteVersions = verRes.data;
                        this.bspTone = verRes.data.length > 0 ? "ok" : "warn";
                        this.bspMessage = `${categoryCode} 下共有 ${verRes.data.length} 个已发布 BSP。`;
                    } else {
                        this.bspTone = "error";
                        this.bspMessage = `${verRes.error.code}: ${verRes.error.message}`;
                    }
                });
            } finally {
                runInAction(() => {
                    this.bspBusy = false;
                });
            }
        };

        downloadAndBind = async (bspId: number) => {
            runInAction(() => {
                this.bspBusy = true;
                this.bspTone = "active";
                this.bspMessage = `正在受控下载并校验 BSP #${bspId}...`;
            });
            try {
                const res = await digiwiseLocalPipeline.downloadAndInstallBsp(bspId);
                if (!res.ok) {
                    runInAction(() => {
                        this.bspTone = "error";
                        this.bspMessage = `${res.error.code}: ${res.error.message}`;
                    });
                    return;
                }
                this.bindInstalledBsp(res.data);
                const instRes = await digiwiseLocalPipeline.listInstalledBsps();
                runInAction(() => {
                    if (instRes.ok) this.installedBsps = instRes.data;
                    this.bspTone = "ok";
                    this.bspMessage = `已安装并绑定 ${res.data.categoryCode}@${res.data.version}（SHA-256 校验通过）`;
                });
            } finally {
                runInAction(() => {
                    this.bspBusy = false;
                });
            }
        };

        bindInstalledBsp = (rec: DigiwiseInstalledBspRecord) => {
            const bsp = this.context.project.embeddedPlatform.bsp;
            const draft = {
                name: bsp.name,
                bspId: bsp.bspId,
                categoryCode: bsp.categoryCode,
                version: bsp.version,
                sha256: bsp.sha256,
                rootPath: bsp.rootPath,
                cmakeListsPath: bsp.cmakeListsPath,
                toolchainFile: bsp.toolchainFile
            };
            applyManagedBspToEmbeddedBsp(draft, rec);
            this.context.updateObject(bsp, draft);
            if (this.context.project.embeddedPlatform.websocket?.enabled) {
                this.context.updateObject(this.context.project.embeddedPlatform.websocket, {
                    enabled: false
                });
            }
            runInAction(() => {
                this.bspTone = "ok";
                this.bspMessage = `已绑定受控 BSP：${rec.categoryCode}@${rec.version}`;
            });
        };

        chooseEnvFolder = async () => {
            const result = await dialog.showOpenDialog(getCurrentWindow(), {
                title: "选择本地离线工具链目录（如 __ENV__）",
                properties: ["openDirectory"]
            });
            if (!result.canceled && result.filePaths[0]) {
                runInAction(() => {
                    this.customEnvRoot = result.filePaths[0];
                });
                await this.saveCustomEnvAndInspect();
            }
        };

        getBoundInstalledRecord(): DigiwiseInstalledBspRecord | undefined {
            const bsp = this.context.project.embeddedPlatform.bsp;
            if (!bsp.categoryCode || !bsp.version || !bsp.sha256) return undefined;
            return this.installedBsps.find(
                item =>
                    item.categoryCode === bsp.categoryCode &&
                    item.version === bsp.version &&
                    item.sha256.toLowerCase() === bsp.sha256.toLowerCase()
            );
        }

        saveCustomEnvAndInspect = async () => {
            runInAction(() => {
                this.toolchainBusy = true;
                this.toolchainMessage = "正在检测工具链...";
            });
            try {
                const roots = this.customEnvRoot.trim() ? [this.customEnvRoot.trim()] : [];
                await digiwiseLocalPipeline.setToolchainCustomRoots(roots);
                const bound = this.getBoundInstalledRecord();
                const manifest = bound?.manifest || {
                    schemaVersion: "1.0" as const,
                    bsp: {
                        id: "default-check",
                        categoryCode: this.context.project.embeddedPlatform.bsp.categoryCode || "S350",
                        version: this.context.project.embeddedPlatform.bsp.version || "1.0.0",
                        name: "Default Toolchain Check",
                        minStudioVersion: "0.0.1",
                        supportedHostOs: ["windows-x64" as const]
                    },
                    target: { chip: "mh2457", arch: "cortex-m4" },
                    build: {
                        system: "cmake" as const,
                        sourceDir: ".",
                        artifacts: [
                            {
                                role: "firmware" as const,
                                format: "bin" as const,
                                path: "build/HMI_MH2457.bin",
                                required: true
                            }
                        ]
                    },
                    toolchain: {
                        compiler: { id: "arm-none-eabi-gcc", version: "14.3.rel1" },
                        cmake: { minVersion: "3.20.0" },
                        ninja: { minVersion: "1.10.0" }
                    },
                    download: {
                        probe: "jlink",
                        target: "mh2457",
                        interface: "SWD" as const,
                        frequencyHz: 500000,
                        flashAddress: "0x08001000"
                    }
                };
                const res = await digiwiseLocalPipeline.inspectToolchain(manifest);
                runInAction(() => {
                    if (res.ok) {
                        this.toolchainReport = res.data;
                        this.toolchainMessage = res.data.ready
                            ? "所有必需工具链已就绪（隔离 PATH）。"
                            : `缺少或版本不符：${res.data.blockingIssues.length} 项`;
                    } else {
                        this.toolchainMessage = `${res.error.code}: ${res.error.message}`;
                    }
                });
            } finally {
                runInAction(() => {
                    this.toolchainBusy = false;
                });
            }
        };

        startLocalBuild = async () => {
            const bsp = this.context.project.embeddedPlatform.bsp;
            if (!this.context.filePath) {
                runInAction(() => {
                    this.buildLogs = ["请先保存工程文件（Ctrl+S）后再执行本地编译。"];
                });
                return;
            }
            if (!bsp.bspId || !bsp.categoryCode || !bsp.version || !bsp.sha256) {
                runInAction(() => {
                    this.buildLogs = ["请先在第 1 步拉取并绑定一个受控 BSP。"];
                });
                return;
            }
            runInAction(() => {
                this.buildRunning = true;
                this.buildProgress = 5;
                this.buildLogs = [];
                this.buildRecord = null;
            });
            try {
                const projectDir = path.dirname(this.context.filePath);
                const res = await digiwiseLocalPipeline.runLocalBuild({
                    projectDir,
                    binding: {
                        bspId: bsp.bspId,
                        categoryCode: bsp.categoryCode,
                        version: bsp.version,
                        sha256: bsp.sha256
                    }
                });
                runInAction(() => {
                    if (res.ok) {
                        this.buildRecord = res.data;
                        this.buildProgress = 100;
                    } else {
                        this.buildLogs.push(`[ERROR] ${res.error.code}: ${res.error.message}`);
                    }
                });
            } finally {
                runInAction(() => {
                    this.buildRunning = false;
                });
            }
        };

        detectProbe = async () => {
            const bound = this.getBoundInstalledRecord();
            const probe = bound?.manifest?.download?.probe || "jlink";
            const res = await digiwiseLocalPipeline.detectLocalProbe(probe);
            runInAction(() => {
                if (res.ok) {
                    this.probeResult = res.data;
                    this.downloadLogs.push(`[detect] ${res.data.message}`);
                } else {
                    this.downloadLogs.push(`[ERROR] ${res.error.code}: ${res.error.message}`);
                }
            });
        };

        startLocalDownload = async () => {
            const bound = this.getBoundInstalledRecord();
            const fw = this.buildRecord?.artifacts.find(a => a.role === "firmware");
            if (!bound?.manifest || !fw || !this.context.filePath) {
                runInAction(() => {
                    this.downloadLogs.push("请先完成第 1 步 BSP 绑定和第 3 步本地编译产出固件。");
                });
                return;
            }
            runInAction(() => {
                this.downloadRunning = true;
                this.downloadProgressPct = 10;
                this.downloadLogs = [];
                this.downloadRecord = null;
            });
            try {
                const res = await digiwiseLocalPipeline.runLocalDownload({
                    projectDir: path.dirname(this.context.filePath),
                    manifest: bound.manifest,
                    firmwarePath: fw.path,
                    expectedSha256: fw.sha256,
                    bspInstallDir: bound.installPath
                });
                runInAction(() => {
                    if (res.ok) {
                        this.downloadRecord = res.data;
                        this.downloadProgressPct = 100;
                    } else {
                        this.downloadLogs.push(`[ERROR] ${res.error.code}: ${res.error.message}`);
                    }
                });
            } finally {
                runInAction(() => {
                    this.downloadRunning = false;
                });
            }
        };

        renderStepCards() {
            const bsp = this.context.project.embeddedPlatform.bsp;
            const hasBound = bsp.bspId > 0 && Boolean(bsp.categoryCode);
            const step1Tone: StepTone = this.bspBusy ? "active" : hasBound ? "ok" : this.bspTone;
            const step2Tone: StepTone = this.toolchainBusy
                ? "active"
                : this.toolchainReport
                  ? this.toolchainReport.ready
                      ? "ok"
                      : "error"
                  : "idle";
            const step3Tone: StepTone = this.buildRunning
                ? "active"
                : this.buildRecord
                  ? "ok"
                  : this.buildLogs.some(l => l.includes("[ERROR]"))
                    ? "error"
                    : "idle";
            const step4Tone: StepTone = this.downloadRunning
                ? "active"
                : this.downloadRecord
                  ? "ok"
                  : this.probeResult
                    ? this.probeResult.connected
                        ? "ok"
                        : "warn"
                    : "idle";

            const dlPct =
                this.downloadProgress && this.downloadProgress.totalBytes > 0
                    ? (this.downloadProgress.receivedBytes / this.downloadProgress.totalBytes) * 100
                    : 0;

            return (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Step 1: LB02 */}
                    <div style={cardStyle}>
                        <StepBadge
                            num={1}
                            tone={step1Tone}
                            title="受控 BSP（LB02）"
                            subtitle={hasBound ? `${bsp.categoryCode}@${bsp.version} (#${bsp.bspId})` : "尚未绑定受控 BSP"}
                        />
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                                type="button"
                                style={btnStyle("primary", this.bspBusy)}
                                disabled={this.bspBusy}
                                onClick={this.refreshCatalog}
                            >
                                <Icon icon="material:cloud_download" size={14} />
                                <span>{this.bspBusy ? "拉取中..." : "拉取授权 BSP"}</span>
                            </button>
                            {this.categories.length > 0 && (
                                <select
                                    style={{
                                        flex: 1,
                                        minWidth: 110,
                                        background: "#141619",
                                        color: "#f3f4f6",
                                        border: "1px solid #3c424d",
                                        borderRadius: 6,
                                        padding: "4px 6px",
                                        fontSize: 12
                                    }}
                                    value={this.selectedCategory}
                                    onChange={e => void this.onSelectCategory(e.target.value)}
                                >
                                    {this.categories.map(c => (
                                        <option key={c.id} value={c.categoryCode}>
                                            {c.categoryCode} · {c.categoryName}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                        {this.remoteVersions.map(v => (
                            <div
                                key={v.id}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 4,
                                    padding: "6px 8px",
                                    background: "#141619",
                                    border: "1px solid #2f333b",
                                    borderRadius: 6
                                }}
                            >
                                <div style={{ fontSize: 12, color: "#e5e7eb", wordBreak: "break-all" }}>
                                    <strong>{v.categoryCode}</strong> v{v.version} · {Math.max(1, Math.round(v.fileSize / 1024))} KB
                                </div>
                                <div>
                                    <button
                                        type="button"
                                        style={btnStyle("success", this.bspBusy)}
                                        disabled={this.bspBusy}
                                        onClick={() => void this.downloadAndBind(v.id)}
                                    >
                                        <Icon icon="material:download" size={14} />
                                        <span>下载并绑定</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                        {this.installedBsps.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <div style={{ fontSize: 11, color: "#9ca3af" }}>本机缓存：</div>
                                {this.installedBsps.map(item => (
                                    <div
                                        key={`${item.categoryCode}@${item.version}`}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "5px 8px",
                                            background: "#141619",
                                            border: "1px dashed #3c424d",
                                            borderRadius: 6,
                                            fontSize: 12
                                        }}
                                    >
                                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {item.categoryCode}@{item.version}
                                        </span>
                                        <button
                                            type="button"
                                            style={btnStyle("secondary")}
                                            onClick={() => this.bindInstalledBsp(item)}
                                        >
                                            绑定
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {this.downloadProgress && this.downloadProgress.stage !== "completed" && (
                            <ProgressBar percent={dlPct} />
                        )}
                        {this.bspMessage && (
                            <div style={{ fontSize: 11, color: TONE_COLOR[this.bspTone], lineHeight: "16px", wordBreak: "break-word" }}>
                                {this.bspMessage}
                            </div>
                        )}
                    </div>

                    {/* Step 2: LB03 */}
                    <div style={cardStyle}>
                        <StepBadge
                            num={2}
                            tone={step2Tone}
                            title="本地工具链（LB03）"
                            subtitle="隔离 PATH · 不改系统环境"
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                            <input
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    background: "#141619",
                                    color: "#f3f4f6",
                                    border: "1px solid #3c424d",
                                    borderRadius: 6,
                                    padding: "5px 8px",
                                    fontSize: 12
                                }}
                                value={this.customEnvRoot}
                                placeholder="离线目录（如 D:\桌面文件归档\__ENV__）"
                                onChange={e =>
                                    runInAction(() => {
                                        this.customEnvRoot = e.target.value;
                                    })
                                }
                            />
                            <button
                                type="button"
                                style={btnStyle("secondary", this.toolchainBusy)}
                                disabled={this.toolchainBusy}
                                title="浏览文件夹"
                                onClick={this.chooseEnvFolder}
                            >
                                <Icon icon="material:folder_open" size={14} />
                            </button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button
                                type="button"
                                style={btnStyle("primary", this.toolchainBusy)}
                                disabled={this.toolchainBusy}
                                onClick={this.saveCustomEnvAndInspect}
                            >
                                <Icon icon="material:build_circle" size={14} />
                                <span>{this.toolchainBusy ? "检测中..." : "检测工具链"}</span>
                            </button>
                            {this.toolchainMessage && (
                                <span
                                    style={{
                                        fontSize: 11,
                                        color: this.toolchainReport?.ready ? "#22c55e" : "#f59e0b",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap"
                                    }}
                                >
                                    {this.toolchainMessage}
                                </span>
                            )}
                        </div>
                        {this.toolchainReport && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {this.toolchainReport.tools.map(t => {
                                    const ok = t.status === "ready";
                                    return (
                                        <div
                                            key={t.id}
                                            title={t.executablePath || t.recoveryHint || t.message}
                                            style={{
                                                padding: "6px 8px",
                                                background: "#141619",
                                                border: `1px solid ${ok ? "#1f4d36" : "#4d2326"}`,
                                                borderRadius: 6,
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 2
                                            }}
                                        >
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                                                <span style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb" }}>
                                                    {t.id}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: 10,
                                                        fontWeight: 600,
                                                        padding: "1px 6px",
                                                        borderRadius: 999,
                                                        background: ok ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.16)",
                                                        color: ok ? "#4ade80" : "#f87171"
                                                    }}
                                                >
                                                    {ok ? `就绪 ${t.detectedVersion || ""}` : t.status === "vendor-driver-required" ? "缺厂商驱动" : "缺失"}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: "15px", wordBreak: "break-word" }}>
                                                {ok ? `来源: ${t.source}` : t.recoveryHint || t.message}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Step 3: LB04 */}
                    <div style={cardStyle}>
                        <StepBadge
                            num={3}
                            tone={step3Tone}
                            title="本地受控编译（LB04）"
                            subtitle={this.buildRecord ? `耗时 ${this.buildRecord.durationMs} ms · ${this.buildRecord.artifacts.length} 个产物` : "先过在线门禁再隔离编译"}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button
                                type="button"
                                style={btnStyle("success", this.buildRunning)}
                                disabled={this.buildRunning}
                                onClick={this.startLocalBuild}
                            >
                                <Icon icon="material:play_arrow" size={14} />
                                <span>{this.buildRunning ? "编译中..." : "一键本地 Build"}</span>
                            </button>
                        </div>
                        <ProgressBar percent={this.buildProgress} color={this.buildRecord ? "#22c55e" : "#3b82f6"} />
                        {this.buildRecord && (
                            <div
                                style={{
                                    padding: "6px 8px",
                                    background: "rgba(34,197,94,0.1)",
                                    border: "1px solid #1f4d36",
                                    borderRadius: 6,
                                    fontSize: 11,
                                    color: "#d1fae5",
                                    wordBreak: "break-all"
                                }}
                            >
                                {this.buildRecord.artifacts.map(a => (
                                    <div key={a.path}>
                                        ✓ {path.basename(a.path)} ({a.fileSize} B · {a.sha256.slice(0, 12)}…)
                                    </div>
                                ))}
                            </div>
                        )}
                        {!this.props.wideMode && this.buildLogs.length > 0 && (
                            <pre
                                style={{
                                    maxHeight: 96,
                                    overflow: "auto",
                                    fontSize: 11,
                                    lineHeight: "15px",
                                    padding: 6,
                                    background: "#111316",
                                    borderRadius: 6,
                                    margin: 0,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word"
                                }}
                            >
                                {this.buildLogs.slice(-12).join("\n")}
                            </pre>
                        )}
                    </div>

                    {/* Step 4: LB05 */}
                    <div style={cardStyle}>
                        <StepBadge
                            num={4}
                            tone={step4Tone}
                            title="本地探针与烧录（LB05）"
                            subtitle="核验 SHA-256 + 探针读回校验"
                        />
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                                type="button"
                                style={btnStyle("secondary", this.downloadRunning)}
                                disabled={this.downloadRunning}
                                onClick={this.detectProbe}
                            >
                                <Icon icon="material:usb" size={14} />
                                <span>检测探针</span>
                            </button>
                            <button
                                type="button"
                                style={btnStyle("primary", this.downloadRunning)}
                                disabled={this.downloadRunning}
                                onClick={this.startLocalDownload}
                            >
                                <Icon icon="material:system_update_alt" size={14} />
                                <span>{this.downloadRunning ? "烧录中..." : "烧录到开发板"}</span>
                            </button>
                        </div>
                        <ProgressBar percent={this.downloadProgressPct} color={this.downloadRecord ? "#22c55e" : "#3b82f6"} />
                        {this.probeResult && (
                            <div
                                style={{
                                    fontSize: 11,
                                    lineHeight: "15px",
                                    color: this.probeResult.connected ? "#4ade80" : "#fbbf24",
                                    wordBreak: "break-word"
                                }}
                            >
                                {this.probeResult.message}
                            </div>
                        )}
                        {this.downloadRecord && (
                            <div
                                style={{
                                    padding: "6px 8px",
                                    background: "rgba(34,197,94,0.1)",
                                    border: "1px solid #1f4d36",
                                    borderRadius: 6,
                                    fontSize: 11,
                                    color: "#d1fae5"
                                }}
                            >
                                ✓ 烧录完成（探针校验：{this.downloadRecord.verifiedByProbe ? "通过" : "未确认"}；实板启动需人工目视确认）
                            </div>
                        )}
                        {!this.props.wideMode && this.downloadLogs.length > 0 && (
                            <pre
                                style={{
                                    maxHeight: 88,
                                    overflow: "auto",
                                    fontSize: 11,
                                    lineHeight: "15px",
                                    padding: 6,
                                    background: "#111316",
                                    borderRadius: 6,
                                    margin: 0,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word"
                                }}
                            >
                                {this.downloadLogs.slice(-10).join("\n")}
                            </pre>
                        )}
                    </div>
                </div>
            );
        }

        override render() {
            if (this.props.wideMode) {
                const combinedLogs = [
                    ...this.buildLogs.map(l => `[BUILD] ${l}`),
                    ...this.downloadLogs.map(l => `[FLASH] ${l}`)
                ];
                return (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "460px 1fr",
                            gap: 14,
                            padding: 14,
                            height: "100%",
                            boxSizing: "border-box",
                            background: "#141619",
                            color: "#f3f4f6",
                            overflow: "hidden"
                        }}
                    >
                        <div style={{ overflow: "auto", paddingRight: 4 }}>{this.renderStepCards()}</div>
                        <div
                            style={{
                                ...cardStyle,
                                height: "100%",
                                minHeight: 0,
                                overflow: "hidden"
                            }}
                        >
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#f3f4f6" }}>
                                实时编译与烧录终端日志
                            </div>
                            <pre
                                style={{
                                    flex: 1,
                                    minHeight: 0,
                                    overflow: "auto",
                                    margin: 0,
                                    padding: 10,
                                    background: "#0d0f12",
                                    border: "1px solid #262a31",
                                    borderRadius: 6,
                                    fontSize: 12,
                                    lineHeight: "18px",
                                    color: "#d1d5db",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word"
                                }}
                            >
                                {combinedLogs.length
                                    ? combinedLogs.join("\n")
                                    : "等待执行本地 Build 或 Download，日志将在此实时流式输出..."}
                            </pre>
                        </div>
                    </div>
                );
            }

            return (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        padding: "8px 10px 16px 10px",
                        height: "100%",
                        overflow: "auto",
                        boxSizing: "border-box"
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#d1d5db" }}>
                            本地编译烧录向导
                        </span>
                        <button
                            type="button"
                            style={btnStyle("secondary")}
                            onClick={this.openWideWindow}
                            title="在独立宽窗口中打开（带实时终端日志面板）"
                        >
                            <Icon icon="material:open_in_new" size={13} />
                            <span>大窗口</span>
                        </button>
                    </div>
                    {this.renderStepCards()}
                </div>
            );
        }
    }
);
