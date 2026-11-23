import React from "react";
import { makeObservable, observable, runInAction } from "mobx";
import { observer } from "mobx-react";
import path from "path";

import { ButtonAction } from "eez-studio-ui/action";
import { Icon } from "eez-studio-ui/icon";
import { ProjectContext } from "project-editor/project/context";
import { Panel } from "project-editor/ui-components/Panel";
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

export const LocalPipelinePanel = observer(
    class LocalPipelinePanel extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        // LB02 state
        categories: DigiwiseCategory[] = [];
        selectedCategory = "";
        remoteVersions: DigiwiseBspVersion[] = [];
        installedBsps: DigiwiseInstalledBspRecord[] = [];
        downloadProgress: DigiwiseBspDownloadProgress | null = null;
        bspMessage = "";
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

        constructor(props: any) {
            super(props);
            makeObservable(this, {
                categories: observable,
                selectedCategory: observable,
                remoteVersions: observable,
                installedBsps: observable,
                downloadProgress: observable,
                bspMessage: observable,
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
                this.bspMessage = "正在从 Java 后台拉取已授权品类与 BSP 列表...";
            });
            try {
                const catRes = await digiwiseLocalPipeline.listCategories();
                if (!catRes.ok) {
                    runInAction(() => {
                        this.bspMessage = `拉取品类失败（${catRes.error.code}）：${catRes.error.message}`;
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
                    this.bspMessage = `已加载 ${catRes.data.length} 个授权品类、${
                        verRes.ok ? verRes.data.length : 0
                    } 个已发布 BSP 版本。`;
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
                        this.bspMessage = `${categoryCode} 下有 ${verRes.data.length} 个已发布 BSP。`;
                    } else {
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
                this.bspMessage = `正在受控下载并校验 BSP #${bspId}...`;
            });
            try {
                const res = await digiwiseLocalPipeline.downloadAndInstallBsp(bspId);
                if (!res.ok) {
                    runInAction(() => {
                        this.bspMessage = `下载/安装失败（${res.error.code}）：${res.error.message}`;
                    });
                    return;
                }
                this.bindInstalledBsp(res.data);
                const instRes = await digiwiseLocalPipeline.listInstalledBsps();
                runInAction(() => {
                    if (instRes.ok) this.installedBsps = instRes.data;
                    this.bspMessage = `已安装并绑定 ${res.data.categoryCode}@${res.data.version}（SHA-256 校验通过）。`;
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
                this.bspMessage = `工程已绑定受控 BSP：${rec.categoryCode}@${rec.version}`;
            });
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
                this.toolchainMessage = "正在检测本地编译工具链...";
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
                        artifacts: [{ role: "firmware" as const, format: "bin" as const, path: "build/HMI_MH2457.bin", required: true }]
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
                            ? "所有必需工具链已就绪（隔离 PATH 模式）。"
                            : `存在 ${res.data.blockingIssues.length} 项工具链缺失或版本不符。`;
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
                    this.buildLogs = ["请先保存工程文件后再执行本地编译。"];
                });
                return;
            }
            if (!bsp.bspId || !bsp.categoryCode || !bsp.version || !bsp.sha256) {
                runInAction(() => {
                    this.buildLogs = ["请先在上方第 1 步选择并绑定一个受控 BSP。"];
                });
                return;
            }
            runInAction(() => {
                this.buildRunning = true;
                this.buildProgress = 0;
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
                this.downloadProgressPct = 0;
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

        override render() {
            const bsp = this.context.project.embeddedPlatform.bsp;
            const boundLabel =
                bsp.bspId > 0
                    ? `${bsp.categoryCode}@${bsp.version} (ID #${bsp.bspId}, sha256=${(bsp.sha256 || "").slice(0, 12)}...)`
                    : "尚未绑定受控 BSP";

            return (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 8, overflow: "auto" }}>
                    {/* Step 1: LB02 Managed BSP */}
                    <Panel
                        id="local-pipeline-bsp"
                        title="1. 受控 BSP 下载、校验与工程绑定（LB02）"
                        body={
                            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <Icon icon="material:memory" size={18} />
                                    <strong>当前工程绑定：</strong>
                                    <code>{boundLabel}</code>
                                    <ButtonAction
                                        text="拉取授权 BSP 列表"
                                        icon="material:cloud_download"
                                        title="从 Java 后台刷新已授权品类与 BSP"
                                        onClick={this.refreshCatalog}
                                        enabled={!this.bspBusy}
                                    />
                                </div>
                                {this.categories.length > 0 && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <span>授权品类：</span>
                                        <select
                                            value={this.selectedCategory}
                                            onChange={e => void this.onSelectCategory(e.target.value)}
                                        >
                                            {this.categories.map(c => (
                                                <option key={c.id} value={c.categoryCode}>
                                                    {c.categoryCode} - {c.categoryName}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                {this.remoteVersions.length > 0 && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        {this.remoteVersions.map(v => (
                                            <div
                                                key={v.id}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    padding: "6px 8px",
                                                    border: "1px solid var(--bs-border-color, #444)",
                                                    borderRadius: 4
                                                }}
                                            >
                                                <span>
                                                    <strong>{v.categoryCode}</strong> v{v.version} ({v.fileName},{" "}
                                                    {Math.round(v.fileSize / 1024)} KB)
                                                </span>
                                                <ButtonAction
                                                    text="下载并绑定"
                                                    icon="material:download"
                                                    title="受控下载、SHA-256 校验、安装并绑定到工程"
                                                    onClick={() => void this.downloadAndBind(v.id)}
                                                    enabled={!this.bspBusy}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {this.installedBsps.length > 0 && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        <small>本机已安装缓存（不可变版本目录）：</small>
                                        {this.installedBsps.map(item => (
                                            <div
                                                key={`${item.categoryCode}@${item.version}`}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    padding: "4px 8px",
                                                    border: "1px dashed var(--bs-border-color, #555)",
                                                    borderRadius: 4
                                                }}
                                            >
                                                <span>
                                                    {item.categoryCode}@{item.version} ({item.sha256.slice(0, 12)}…)
                                                </span>
                                                <ButtonAction
                                                    text="绑定此版本"
                                                    icon="material:link"
                                                    title="绑定到当前工程"
                                                    onClick={() => this.bindInstalledBsp(item)}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {this.downloadProgress && (
                                    <small>
                                        下载阶段：{this.downloadProgress.stage} ({this.downloadProgress.receivedBytes} /{" "}
                                        {this.downloadProgress.totalBytes} bytes)
                                    </small>
                                )}
                                {this.bspMessage && <div style={{ opacity: 0.9 }}>{this.bspMessage}</div>}
                            </div>
                        }
                    />

                    {/* Step 2: LB03 Toolchain Manager */}
                    <Panel
                        id="local-pipeline-toolchain"
                        title="2. 本地工具链就绪检查（LB03 · 隔离 PATH 不改系统环境）"
                        body={
                            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <span>本地离线环境目录（可选）：</span>
                                    <input
                                        style={{ flex: 1, minWidth: 240 }}
                                        value={this.customEnvRoot}
                                        placeholder="例如 D:\桌面文件归档\__ENV__（留空则使用软件私有工具链目录）"
                                        onChange={e =>
                                            runInAction(() => {
                                                this.customEnvRoot = e.target.value;
                                            })
                                        }
                                    />
                                    <ButtonAction
                                        text="检测工具链"
                                        icon="material:build_circle"
                                        title="按 BSP manifest 检测本地工具链版本"
                                        onClick={this.saveCustomEnvAndInspect}
                                        enabled={!this.toolchainBusy}
                                    />
                                </div>
                                {this.toolchainMessage && <div>{this.toolchainMessage}</div>}
                                {this.toolchainReport && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        {this.toolchainReport.tools.map(t => (
                                            <div
                                                key={t.id}
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    padding: "4px 8px",
                                                    border: "1px solid var(--bs-border-color, #444)",
                                                    borderRadius: 4
                                                }}
                                            >
                                                <span>
                                                    <strong>{t.displayName}</strong> [{t.category}] · 要求{" "}
                                                    <code>{t.expectedVersion}</code>
                                                </span>
                                                <span
                                                    style={{
                                                        color: t.status === "ready" ? "#2ecc71" : "#e74c3c",
                                                        fontWeight: 600
                                                    }}
                                                >
                                                    {t.status === "ready"
                                                        ? `就绪 (${t.detectedVersion} · ${t.source})`
                                                        : `${t.status}: ${t.message}`}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        }
                    />

                    {/* Step 3: LB04 Local Build */}
                    <Panel
                        id="local-pipeline-build"
                        title="3. 本地受控编译与固件产物（LB04）"
                        body={
                            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <ButtonAction
                                        text="一键本地 Build"
                                        icon="material:play_arrow"
                                        title="先做在线授权校验，再在隔离目录执行本地编译"
                                        onClick={this.startLocalBuild}
                                        enabled={!this.buildRunning}
                                    />
                                    <span>进度：{this.buildProgress}%</span>
                                </div>
                                {this.buildRecord && (
                                    <div style={{ padding: 8, border: "1px solid #2ecc71", borderRadius: 4 }}>
                                        <div>
                                            <strong>编译成功</strong>（耗时 {this.buildRecord.durationMs} ms）
                                        </div>
                                        {this.buildRecord.artifacts.map(a => (
                                            <div key={a.path}>
                                                产物：<code>{path.basename(a.path)}</code> · {a.fileSize} bytes ·
                                                SHA-256 <code>{a.sha256.slice(0, 16)}…</code>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {this.buildLogs.length > 0 && (
                                    <pre style={{ maxHeight: 160, overflow: "auto", fontSize: 12, margin: 0 }}>
                                        {this.buildLogs.join("\n")}
                                    </pre>
                                )}
                            </div>
                        }
                    />

                    {/* Step 4: LB05 Local Download */}
                    <Panel
                        id="local-pipeline-download"
                        title="4. 本地探针检测与固件烧录（LB05）"
                        body={
                            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <ButtonAction
                                        text="检测烧录探针"
                                        icon="material:usb"
                                        title="检测 J-Link / pyOCD 探针连接状态"
                                        onClick={this.detectProbe}
                                        enabled={!this.downloadRunning}
                                    />
                                    <ButtonAction
                                        text="烧录到开发板"
                                        icon="material:system_update_alt"
                                        title="核验固件 SHA-256 后烧录并回读校验"
                                        onClick={this.startLocalDownload}
                                        enabled={!this.downloadRunning}
                                    />
                                    <span>进度：{this.downloadProgressPct}%</span>
                                </div>
                                {this.probeResult && (
                                    <div>
                                        探针状态：
                                        <strong style={{ color: this.probeResult.connected ? "#2ecc71" : "#f39c12" }}>
                                            {this.probeResult.message}
                                        </strong>
                                    </div>
                                )}
                                {this.downloadRecord && (
                                    <div style={{ padding: 8, border: "1px solid #2ecc71", borderRadius: 4 }}>
                                        烧录完成（探针校验：{this.downloadRecord.verifiedByProbe ? "通过" : "未确认"}
                                        ，实板启动运行需人工目视确认）。
                                    </div>
                                )}
                                {this.downloadLogs.length > 0 && (
                                    <pre style={{ maxHeight: 140, overflow: "auto", fontSize: 12, margin: 0 }}>
                                        {this.downloadLogs.join("\n")}
                                    </pre>
                                )}
                            </div>
                        }
                    />
                </div>
            );
        }
    }
);
