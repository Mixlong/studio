import fs from "fs";
import path from "path";
import React from "react";
import { action, makeObservable, observable, runInAction } from "mobx";
import { observer } from "mobx-react";
import { dialog, getCurrentWindow } from "@electron/remote";

import { ButtonAction, IconAction } from "eez-studio-ui/action";
import { showDialog } from "eez-studio-ui/dialog";
import { Icon } from "eez-studio-ui/icon";
import { validators } from "eez-studio-shared/validation";

import { showGenericDialog } from "project-editor/core/util";
import {
    createObject,
    getUniquePropertyValue,
    type ProjectStore
} from "project-editor/store";
import { ProjectContext } from "project-editor/project/context";
import { Panel } from "project-editor/ui-components/Panel";
import { PropertyGrid } from "project-editor/ui-components/PropertyGrid";
import { AbsoluteFileInput } from "project-editor/ui-components/FileInput";
import {
    EmbeddedPlatform,
    HiddenComponent,
    ProtocolResource
} from "project-editor/features/embedded-platform/embedded-platform";
import {
    downloadMockProtocol,
    isMockProtocolEndpoint,
    searchMockProtocols,
    type CloudProtocol
} from "project-editor/features/embedded-platform/protocol-cloud";
import {
    detectEmbeddedTarget,
    connectEmbeddedWebSocket,
    runEmbeddedBuild,
    runEmbeddedDownload,
    runEmbeddedTransform,
    stopEmbeddedOperation,
    synchronizeEmbeddedResources
} from "project-editor/features/embedded-platform/build-tools";
import type {
    EmbeddedTransformModel,
    EmbeddedTransformType
} from "project-editor/features/embedded-platform/embedded-protocol";
import type { EmbeddedWebSocketState } from "project-editor/features/embedded-platform/embedded-websocket";
import {
    getActiveEmbeddedWorkspace,
    getEmbeddedWorkspaceItems,
    type EmbeddedWorkspaceItem
} from "project-editor/features/embedded-platform/workspace-navigation";

////////////////////////////////////////////////////////////////////////////////

function renderProgress(value: number) {
    return (
        <div className="progress EezStudio_EmbeddedPlatform_Progress">
            <div
                className="progress-bar"
                role="progressbar"
                style={{ width: `${value}%` }}
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                {value}%
            </div>
        </div>
    );
}

const REMOTE_FIRMWARE_BUILD_PANEL_ID = "eez-embedded-build-v2";

export function showEmbeddedBuildWindow(projectStore: ProjectStore) {
    const remoteMode = projectStore.project.embeddedPlatform.websocket?.enabled === true;
    showDialog(
        <ProjectContext.Provider value={projectStore}>
            <EmbeddedBuildWindow />
        </ProjectContext.Provider>,
        {
            jsPanel: {
                id: remoteMode ? REMOTE_FIRMWARE_BUILD_PANEL_ID : "eez-embedded-build",
                title: remoteMode ? "Remote Firmware Build" : "Embedded Firmware Build",
                width: remoteMode ? 1180 : 1060,
                height: 760,
                headerControls: {
                    minimize: "remove",
                    maximize: "remove",
                    smallify: "remove"
                },
                modeless: true
            }
        }
    );
}

export function showEmbeddedDownloadWindow(projectStore: ProjectStore) {
    const remoteMode = projectStore.project.embeddedPlatform.websocket?.enabled === true;
    showDialog(
        <ProjectContext.Provider value={projectStore}>
            {remoteMode ? <EmbeddedBuildWindow /> : <EmbeddedDownloadWindow />}
        </ProjectContext.Provider>,
        {
            jsPanel: {
                id: remoteMode
                    ? REMOTE_FIRMWARE_BUILD_PANEL_ID
                    : "eez-embedded-download",
                title: remoteMode ? "Remote Firmware Build" : "Firmware Download",
                width: remoteMode ? 1180 : 980,
                height: remoteMode ? 760 : 700,
                headerControls: {
                    minimize: "remove",
                    maximize: "remove",
                    smallify: "remove"
                },
                modeless: true
            }
        }
    );
}

const STORAGE_MODE_LABELS: Record<string, string> = {
    rom: "ROM",
    xip: "External Flash XIP",
    "non-xip": "External Flash non-XIP"
};

function getStorageModeLabel(mode: string, enabled: boolean) {
    return enabled ? STORAGE_MODE_LABELS[mode] || mode : "Project defaults";
}

function getSafeProtocolFileName(requestedName: string, sourcePath: string) {
    const fallbackName = path.basename(sourcePath) || "protocol.json";
    const fileName = path.basename(requestedName || fallbackName).replace(
        /[\\/:*?"<>|]/g,
        "_"
    );
    if (path.extname(fileName)) {
        return fileName;
    }
    return `${fileName || "protocol"}${path.extname(sourcePath) || ".json"}`;
}

async function copyProtocolToProject(
    projectStore: ProjectStore,
    sourcePath: string,
    requestedName: string
) {
    if (!projectStore.filePath) {
        throw new Error("Save the project before importing a protocol.");
    }

    const destination = await getProtocolDestination(
        projectStore,
        sourcePath,
        requestedName
    );

    if (path.resolve(sourcePath) !== path.resolve(destination)) {
        await fs.promises.copyFile(sourcePath, destination);
    }
    return projectStore.getFilePathRelativeToProjectPath(destination);
}

async function getProtocolDestination(
    projectStore: ProjectStore,
    sourcePath: string,
    requestedName: string
) {
    if (!projectStore.filePath) {
        throw new Error("Save the project before importing a protocol.");
    }

    const protocolDirectory = path.join(
        path.dirname(projectStore.filePath),
        "protocol"
    );
    await fs.promises.mkdir(protocolDirectory, { recursive: true });

    const originalName = getSafeProtocolFileName(requestedName, sourcePath);
    let destinationName = originalName;
    let suffix = 2;
    let destination = path.join(protocolDirectory, destinationName);
    while (
        fs.existsSync(destination) &&
        path.resolve(destination) !== path.resolve(sourcePath)
    ) {
        const extension = path.extname(originalName);
        destinationName = `${path.basename(
            originalName,
            extension
        )}-${suffix++}${extension}`;
        destination = path.join(protocolDirectory, destinationName);
    }
    return destination;
}

async function writeProtocolToProject(
    projectStore: ProjectStore,
    sourcePath: string,
    requestedName: string,
    contents: Buffer
) {
    const destination = await getProtocolDestination(
        projectStore,
        sourcePath,
        requestedName
    );
    await fs.promises.writeFile(destination, contents);
    return projectStore.getFilePathRelativeToProjectPath(destination);
}

function getUniqueProtocolName(projectStore: ProjectStore, name: string) {
    return getUniquePropertyValue(
        projectStore.project.embeddedPlatform.protocols,
        "name",
        name.trim() || "Protocol"
    ) as string;
}

const ResourceStorageSummary = observer(
    class ResourceStorageSummary extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        render() {
            const platform = this.context.project.embeddedPlatform;
            const storage = platform.storage;
            const resources = [
                {
                    label: "Images",
                    count: this.context.project.bitmaps.length,
                    mode: getStorageModeLabel(storage.image, storage.enabled)
                },
                {
                    label: "Fonts",
                    count: this.context.project.fonts.length,
                    mode: getStorageModeLabel(storage.font, storage.enabled)
                },
                {
                    label: "Audio",
                    count: this.context.project.audio?.resources.length || 0,
                    mode: getStorageModeLabel(storage.audio, storage.enabled)
                }
            ];

            return (
                <div className="EezStudio_EmbeddedPlatform_StorageSummary">
                    <div className="EezStudio_EmbeddedPlatform_StorageSummaryHeader">
                        <span>Resource mapping</span>
                        <span className="EezStudio_EmbeddedPlatform_Muted">
                            {storage.enabled ? "Unified modes" : "Project defaults"}
                        </span>
                    </div>
                    <div className="EezStudio_EmbeddedPlatform_StorageSummaryGrid">
                        {resources.map(resource => (
                            <div
                                key={resource.label}
                                className="EezStudio_EmbeddedPlatform_StorageSummaryItem"
                            >
                                <strong>{resource.label}</strong>
                                <span>{resource.count} resource(s)</span>
                                <small>{resource.mode}</small>
                            </div>
                        ))}
                    </div>
                    {storage.enabled && storage.image !== "rom" && (
                        <div className="EezStudio_EmbeddedPlatform_Muted">
                            Image partition: {storage.imagePartitionSize || 0} bytes
                            {storage.imageBaseAddress
                                ? ` at ${storage.imageBaseAddress}`
                                : " (base address not set)"}
                        </div>
                    )}
                    {!storage.enabled && (
                        <div className="EezStudio_EmbeddedPlatform_Muted">
                            Enable unified storage modes to apply the mappings above
                            to embedded resource output.
                        </div>
                    )}
                </div>
            );
        }
    }
);

const RemoteCommandFlow = observer(
    ({ platform }: { platform: EmbeddedPlatform }) => {
        const build = platform.remote.build;
        const download = platform.remote.download;
        const value = (text: string) => text.trim() || "<not set>";

        return (
            <div className="EezStudio_EmbeddedPlatform_RemoteFlow">
                <div className="EezStudio_EmbeddedPlatform_RemoteFlowRow">
                    <strong>1. cmake</strong>
                    <code>{`output_dir: ${value(build.projectDirectory)}\nconfig_file: ${value(build.configFile)}`}</code>
                </div>
                <div className="EezStudio_EmbeddedPlatform_RemoteFlowRow">
                    <strong>2. build</strong>
                    <code>{`src: ${value(build.projectDirectory)}\ndst: ${value(build.outputDirectory)}`}</code>
                </div>
                <div className="EezStudio_EmbeddedPlatform_RemoteFlowRow">
                    <strong>3. download</strong>
                    <code>{`target: ${value(download.target)}\nfirmware: ${value(download.firmwarePath)}\naddr: ${value(download.addressOffset)}`}</code>
                </div>
                <div className="EezStudio_EmbeddedPlatform_Muted">
                    These paths belong to the middleware server. Studio does not
                    read a local .py or .bin file in WebSocket mode.
                </div>
            </div>
        );
    }
);

const RemoteConfigurationPanel = observer(
    class RemoteConfigurationPanel extends React.Component<{
        platform: EmbeddedPlatform;
    }> {
        expanded = false;

        constructor(props: { platform: EmbeddedPlatform }) {
            super(props);
            makeObservable(this, {
                expanded: observable,
                toggleExpanded: action.bound
            });
        }

        toggleExpanded() {
            this.expanded = !this.expanded;
        }

        render() {
            const { platform } = this.props;
            const download = platform.remote.download;
            const summaryValue = (value: string, fallback: string) =>
                value.trim() || fallback;
            const summary = [
                summaryValue(download.target, "Target not set"),
                `${summaryValue(download.frequency, "Frequency not set")} Hz`,
                summaryValue(download.addressOffset, "Address not set")
            ].join(" · ");

            return (
                <section className="EezStudio_EmbeddedPlatform_RemoteConfiguration">
                    <button
                        type="button"
                        className="EezStudio_EmbeddedPlatform_RemoteConfigurationHeader"
                        aria-expanded={this.expanded}
                        aria-controls="embedded-remote-configuration-body"
                        title={
                            this.expanded
                                ? "Collapse remote configuration"
                                : "Expand remote configuration"
                        }
                        onClick={this.toggleExpanded}
                    >
                        <span className="EezStudio_EmbeddedPlatform_RemoteConfigurationTitle">
                            <Icon
                                icon={
                                    this.expanded
                                        ? "material:keyboard_arrow_down"
                                        : "material:keyboard_arrow_right"
                                }
                                size={18}
                            />
                            <span>Remote Configuration</span>
                        </span>
                        <span className="EezStudio_EmbeddedPlatform_RemoteConfigurationSummary">
                            {summary}
                        </span>
                    </button>
                    {this.expanded && (
                        <div
                            id="embedded-remote-configuration-body"
                            className="EezStudio_EmbeddedPlatform_RemoteConfigurationBody"
                        >
                            <div className="EezStudio_EmbeddedPlatform_RemoteConfigurationSection">
                                <div className="EezStudio_EmbeddedPlatform_RemoteConfigurationSectionTitle">
                                    Remote Project
                                </div>
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.remote.build]} />
                                </div>
                            </div>
                            <div className="EezStudio_EmbeddedPlatform_RemoteConfigurationSection">
                                <div className="EezStudio_EmbeddedPlatform_RemoteConfigurationSectionTitle">
                                    Remote Download
                                </div>
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.remote.download]} />
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

export const EmbeddedPlatformTab = observer(
    class EmbeddedPlatformTab extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        activeWorkspace = "";
        workspaceNavCollapsed = false;
        advancedWorkspacesExpanded = false;

        constructor(props: {}) {
            super(props);
            makeObservable(this, {
                activeWorkspace: observable,
                workspaceNavCollapsed: observable,
                advancedWorkspacesExpanded: observable,
                selectWorkspace: action.bound,
                toggleWorkspaceNav: action.bound,
                toggleAdvancedWorkspaces: action.bound
            });
        }

        selectWorkspace(workspace: string) {
            this.activeWorkspace = workspace;
        }

        toggleWorkspaceNav() {
            this.workspaceNavCollapsed = !this.workspaceNavCollapsed;
        }

        toggleAdvancedWorkspaces() {
            this.advancedWorkspacesExpanded = !this.advancedWorkspacesExpanded;
        }

        renderWorkspaceButton(
            item: EmbeddedWorkspaceItem,
            selectedWorkspace: string
        ) {
            return (
                <button
                    key={item.id}
                    type="button"
                    className={[
                        selectedWorkspace === item.id ? "is-active" : "",
                        item.advanced ? "is-advanced" : ""
                    ].filter(Boolean).join(" ")}
                    aria-current={
                        selectedWorkspace === item.id ? "page" : undefined
                    }
                    aria-label={item.label}
                    title={item.label}
                    onClick={() => this.selectWorkspace(item.id)}
                >
                    <Icon icon={item.icon} size={18} />
                    <span className="EezStudio_EmbeddedPlatform_WorkspaceNavLabel">
                        {item.label}
                    </span>
                </button>
            );
        }

        renderConfiguration(platform: any, selectedWorkspace: string) {
            switch (selectedWorkspace) {
                case "protocols":
                    return <ProtocolCenter />;
                case "resources":
                    return (
                        <Panel
                            id="embedded-storage"
                            title="Resource Storage"
                            body={
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.storage]} />
                                    <ResourceStorageSummary />
                                </div>
                            }
                        />
                    );
                case "connection":
                    return (
                        <>
                            <Panel
                                id="embedded-websocket"
                                title="Middleware WebSocket"
                                body={
                                    <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                        <PropertyGrid objects={[platform.websocket]} />
                                    </div>
                                }
                            />
                            {platform.websocket?.enabled && (
                                <RemoteConfigurationPanel platform={platform} />
                            )}
                        </>
                    );
                case "components":
                    return <ComponentVisibilityPanel />;
                default:
                    return (
                        <Panel
                            id="embedded-bsp"
                            title="Target Board"
                            body={
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.bsp]} />
                                </div>
                            }
                        />
                    );
            }
        }

        render() {
            const platform = this.context.project.embeddedPlatform;
            if (!platform) {
                return null;
            }

            const remoteMode = platform.websocket?.enabled === true;
            const selectedWorkspace = getActiveEmbeddedWorkspace(
                this.activeWorkspace,
                remoteMode,
                this.advancedWorkspacesExpanded
            );
            const visibleWorkspaces = getEmbeddedWorkspaceItems(
                remoteMode,
                this.advancedWorkspacesExpanded
            );

            return (
                <div className="EezStudio_EmbeddedPlatform">
                    <div className="EezStudio_EmbeddedPlatform_Header">
                        <div className="EezStudio_EmbeddedPlatform_Title">
                            <Icon icon="material:developer_board" size={22} />
                            <span>Embedded Platform</span>
                        </div>
                    </div>
                    <div className="EezStudio_EmbeddedPlatform_Content">
                        <nav
                            className={`EezStudio_EmbeddedPlatform_WorkspaceNav${
                                this.workspaceNavCollapsed ? " is-collapsed" : ""
                            }`}
                            aria-label="Embedded workspace"
                        >
                            <button
                                type="button"
                                className="EezStudio_EmbeddedPlatform_WorkspaceNavToggle"
                                aria-label={
                                    this.workspaceNavCollapsed
                                        ? "Expand workspace navigation"
                                        : "Collapse workspace navigation"
                                }
                                aria-expanded={!this.workspaceNavCollapsed}
                                title={
                                    this.workspaceNavCollapsed
                                        ? "Expand workspace navigation"
                                        : "Collapse workspace navigation"
                                }
                                onClick={this.toggleWorkspaceNav}
                            >
                                <Icon
                                    icon={
                                        this.workspaceNavCollapsed
                                            ? "material:menu"
                                            : "material:menu_open"
                                    }
                                    size={18}
                                />
                                <span className="EezStudio_EmbeddedPlatform_WorkspaceNavLabel">
                                    Workspaces
                                </span>
                            </button>
                            {visibleWorkspaces
                                .filter(item => !remoteMode || !item.advanced)
                                .map(item =>
                                    this.renderWorkspaceButton(
                                        item,
                                        selectedWorkspace
                                    )
                                )}
                            {remoteMode && (
                                <>
                                    <button
                                        type="button"
                                        className="EezStudio_EmbeddedPlatform_AdvancedToggle"
                                        aria-label="Advanced Settings"
                                        aria-expanded={this.advancedWorkspacesExpanded}
                                        title="Advanced Settings"
                                        onClick={this.toggleAdvancedWorkspaces}
                                    >
                                        <Icon
                                            icon={
                                                this.advancedWorkspacesExpanded
                                                    ? "material:keyboard_arrow_down"
                                                    : "material:keyboard_arrow_right"
                                            }
                                            size={18}
                                        />
                                        <span className="EezStudio_EmbeddedPlatform_WorkspaceNavLabel">
                                            Advanced Settings
                                        </span>
                                    </button>
                                    {visibleWorkspaces
                                        .filter(item => item.advanced)
                                        .map(item =>
                                            this.renderWorkspaceButton(
                                                item,
                                                selectedWorkspace
                                            )
                                        )}
                                </>
                            )}
                        </nav>
                        <div className="EezStudio_EmbeddedPlatform_Configuration">
                            {this.renderConfiguration(platform, selectedWorkspace)}
                        </div>
                    </div>
                    <footer className="EezStudio_EmbeddedPlatform_StatusBar">
                        <span className="EezStudio_EmbeddedPlatform_StatusDot" />
                        <span>Ready</span>
                        <span>
                            {platform.websocket.enabled
                                ? "Remote project"
                                : platform.bsp.name || "No target configured"}
                        </span>
                        <span>
                            {platform.websocket.enabled
                                ? "Remote middleware"
                                : "Local tooling"}
                        </span>
                    </footer>
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const ComponentVisibilityPanel = observer(
    class ComponentVisibilityPanel extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        componentName = "";
        componentType: "widget" | "action" = "widget";

        constructor(props: {}) {
            super(props);
            makeObservable(this, {
                componentName: observable,
                componentType: observable,
                add: action.bound
            });
        }

        add() {
            const name = this.componentName.trim();
            if (!name) {
                return;
            }

            const hiddenComponents =
                this.context.project.embeddedPlatform.hiddenComponents;
            if (hiddenComponents.some(component => component.name === name)) {
                return;
            }

            const hiddenComponent = createObject<HiddenComponent>(
                this.context,
                { name, type: this.componentType },
                HiddenComponent
            );
            this.context.addObject(hiddenComponents, hiddenComponent);
            this.componentName = "";
        }

        render() {
            const hiddenComponents =
                this.context.project.embeddedPlatform.hiddenComponents;
            return (
                <Panel
                    id="embedded-component-visibility"
                    title="Component Visibility"
                    body={
                        <div className="EezStudio_EmbeddedPlatform_Visibility">
                            <div className="EezStudio_EmbeddedPlatform_InlineForm">
                                <select
                                    value={this.componentType}
                                    onChange={event =>
                                        (this.componentType = event.target.value as
                                            | "widget"
                                            | "action")
                                    }
                                >
                                    <option value="widget">Widget</option>
                                    <option value="action">Action</option>
                                </select>
                                <input
                                    value={this.componentName}
                                    placeholder="Component class name"
                                    onChange={event =>
                                        (this.componentName = event.target.value)
                                    }
                                    onKeyDown={event => {
                                        if (event.key === "Enter") {
                                            this.add();
                                        }
                                    }}
                                />
                                <IconAction
                                    icon="material:add"
                                    iconSize={18}
                                    title="Hide component from palette"
                                    onClick={this.add}
                                />
                            </div>
                            <div className="EezStudio_EmbeddedPlatform_CompactList">
                                {hiddenComponents.map(component => (
                                    <div key={component.objID} className="EezStudio_EmbeddedPlatform_ListRow">
                                        <span>{component.name}</span>
                                        <span className="EezStudio_EmbeddedPlatform_Muted">
                                            {component.type}
                                        </span>
                                        <IconAction
                                            icon="material:close"
                                            iconSize={16}
                                            title="Show component in palette"
                                            onClick={() =>
                                                this.context.deleteObject(component)
                                            }
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    }
                />
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const ProtocolCenter = observer(
    class ProtocolCenter extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        searchText = "";
        selectedCategory = "all";
        cloudResults: CloudProtocol[] = [];
        status = "";
        loading = false;

        constructor(props: {}) {
            super(props);
            makeObservable(this, {
                searchText: observable,
                selectedCategory: observable,
                cloudResults: observable,
                status: observable,
                loading: observable,
                addLocalProtocol: action.bound,
                searchCloud: action.bound,
                addCloudProtocol: action.bound,
                selectCategory: action.bound,
                synchronize: action.bound
            });
        }

        selectCategory(category: string) {
            this.selectedCategory = category;
        }

        async addLocalProtocol() {
            if (!this.context.filePath) {
                this.status = "Save the project before importing a protocol.";
                return;
            }

            let result;
            try {
                result = await showGenericDialog(this.context, {
                    dialogDefinition: {
                        title: "Add Protocol",
                        fields: [
                            {
                                name: "name",
                                type: "string",
                                validators: [
                                    validators.required,
                                    validators.unique(
                                        {},
                                        this.context.project.embeddedPlatform
                                            .protocols
                                    )
                                ]
                            },
                            {
                                name: "category",
                                type: "string",
                                validators: [validators.required]
                            },
                            {
                                name: "filePath",
                                displayName: "Protocol File",
                                type: AbsoluteFileInput,
                                validators: [validators.required],
                                options: {
                                    filters: [
                                        {
                                            name: "Protocol files",
                                            extensions: [
                                                "json",
                                                "yaml",
                                                "yml",
                                                "xml",
                                                "proto",
                                                "c",
                                                "h",
                                                "txt"
                                            ]
                                        },
                                        {
                                            name: "All Files",
                                            extensions: ["*"]
                                        }
                                    ]
                                }
                            }
                        ]
                    },
                    values: {},
                    modal: true,
                    backdrop: "static"
                });
            } catch (_error) {
                // Closing the dialog is a normal user action, not an error.
                return;
            }

            const selectedFilePath = String(result.values.filePath || "").trim();
            const name = String(result.values.name || "").trim();
            const category = String(result.values.category || "Uncategorized").trim();
            if (!selectedFilePath || !name) {
                this.status = "Choose a protocol file and enter a protocol name.";
                return;
            }

            this.loading = true;
            this.status = "";
            try {
                if (!fs.existsSync(selectedFilePath)) {
                    throw new Error(`Protocol file does not exist: ${selectedFilePath}`);
                }
                const filePath = await copyProtocolToProject(
                    this.context,
                    selectedFilePath,
                    selectedFilePath
                );
                const protocol = createObject<ProtocolResource>(
                    this.context,
                    {
                        name: getUniqueProtocolName(this.context, name),
                        category: category || "Uncategorized",
                        filePath,
                        source: "local",
                        enabled: true
                    },
                    ProtocolResource
                );
                this.context.addObject(
                    this.context.project.embeddedPlatform.protocols,
                    protocol
                );
                this.status = `${protocol.name} imported to protocol/.`;
            } catch (error) {
                this.status = `Local protocol import failed: ${error}`;
            } finally {
                this.loading = false;
            }
        }

        async searchCloud() {
            const endpoint =
                this.context.project.embeddedPlatform.cloudEndpoint.trim();
            if (!endpoint) {
                this.status = "Set the protocol cloud endpoint in Embedded Platform settings.";
                return;
            }

            this.loading = true;
            this.status = "";
            try {
                let entries: any[];
                if (isMockProtocolEndpoint(endpoint)) {
                    entries = searchMockProtocols(endpoint, this.searchText);
                } else {
                    const separator = endpoint.includes("?") ? "&" : "?";
                    const response = await fetch(
                        `${endpoint}${separator}q=${encodeURIComponent(this.searchText)}`
                    );
                    if (!response.ok) {
                        throw new Error(`${response.status} ${response.statusText}`);
                    }
                    const responseData = await response.json();
                    entries = Array.isArray(responseData)
                        ? responseData
                        : responseData && typeof responseData === "object"
                          ? responseData.items || responseData.protocols || []
                          : [];
                }
                this.cloudResults = entries
                    .filter((entry: any) => entry && (entry.name || entry.title))
                    .map((entry: any) => ({
                        name: String(entry.name || entry.title),
                        category: String(entry.category || "Uncategorized"),
                        downloadUrl: String(
                            entry.downloadUrl || entry.url || entry.fileUrl || ""
                        )
                    }))
                    .filter((entry: CloudProtocol) => !!entry.downloadUrl);
                this.status = this.cloudResults.length
                    ? `${this.cloudResults.length} protocol(s) found.`
                    : "No cloud protocols found.";
            } catch (error) {
                this.cloudResults = [];
                this.status = `Cloud search failed: ${error}`;
            } finally {
                this.loading = false;
            }
        }

        async addCloudProtocol(entry: CloudProtocol) {
            if (!this.context.filePath) {
                this.status = "Save the project before importing a cloud protocol.";
                return;
            }

            this.loading = true;
            try {
                let contents: Buffer;
                let sourcePath = entry.downloadUrl;
                if (isMockProtocolEndpoint(entry.downloadUrl)) {
                    contents = await downloadMockProtocol(entry);
                } else {
                    const response = await fetch(entry.downloadUrl);
                    if (!response.ok) {
                        throw new Error(`${response.status} ${response.statusText}`);
                    }
                    contents = Buffer.from(await response.arrayBuffer());
                }
                try {
                    sourcePath = new URL(entry.downloadUrl).pathname || sourcePath;
                } catch (_error) {
                    // Keep the original URL so the extension fallback remains deterministic.
                }
                const filePath = await writeProtocolToProject(
                    this.context,
                    sourcePath,
                    entry.name,
                    contents
                );

                const protocol = createObject<ProtocolResource>(
                    this.context,
                    {
                        name: getUniqueProtocolName(this.context, entry.name),
                        category: entry.category,
                        filePath,
                        source: "cloud",
                        enabled: true
                    },
                    ProtocolResource
                );
                this.context.addObject(
                    this.context.project.embeddedPlatform.protocols,
                    protocol
                );
                this.status = `${entry.name} imported.`;
            } catch (error) {
                this.status = `Cloud protocol import failed: ${error}`;
            } finally {
                this.loading = false;
            }
        }

        async synchronize() {
            this.loading = true;
            try {
                const summary = await synchronizeEmbeddedResources(this.context);
                this.status = `${summary.imageFiles.length} image(s), ${summary.fontFiles.length} font(s), ${summary.audioFiles.length} audio file(s), ${summary.protocolFiles.length} protocol(s) synchronized.`;
            } catch (error) {
                this.status = `Protocol synchronization failed: ${error}`;
            } finally {
                this.loading = false;
            }
        }

        render() {
            const protocols = this.context.project.embeddedPlatform.protocols;
            const normalizedSearch = this.searchText.trim().toLowerCase();
            const categories = Array.from(
                new Set([
                    "all",
                    ...protocols.map(protocol => protocol.category || "Uncategorized"),
                    ...this.cloudResults.map(entry => entry.category || "Uncategorized")
                ])
            ).sort((left, right) => {
                if (left === "all") {
                    return -1;
                }
                if (right === "all") {
                    return 1;
                }
                return left.localeCompare(right);
            });
            const selectedCategory = categories.includes(this.selectedCategory)
                ? this.selectedCategory
                : "all";
            const matchesSearch = (values: string[]) =>
                !normalizedSearch ||
                values.join(" ").toLowerCase().includes(normalizedSearch);
            const matchesCategory = (category: string) =>
                selectedCategory === "all" || category === selectedCategory;
            const visibleProtocols = protocols.filter(
                protocol =>
                    matchesSearch([protocol.name, protocol.category, protocol.filePath]) &&
                    matchesCategory(protocol.category || "Uncategorized")
            );
            const visibleCloudResults = this.cloudResults.filter(
                entry =>
                    matchesSearch([entry.name, entry.category]) &&
                    matchesCategory(entry.category || "Uncategorized")
            );
            const categoryCount = (category: string) =>
                protocols.filter(
                    protocol =>
                        (protocol.category || "Uncategorized") === category
                ).length +
                this.cloudResults.filter(
                    entry => (entry.category || "Uncategorized") === category
                ).length;
            const hasVisibleResults =
                visibleProtocols.length > 0 || visibleCloudResults.length > 0;
            return (
                <Panel
                    id="embedded-protocols"
                    title="Protocol Center"
                    buttons={[
                        <IconAction
                            key="add"
                            icon="material:add"
                            iconSize={18}
                            title="Add local protocol"
                            onClick={this.addLocalProtocol}
                            enabled={!this.loading}
                        />,
                        <IconAction
                            key="sync"
                            icon="material:sync"
                            iconSize={18}
                            title="Copy selected protocols to project folder"
                            onClick={this.synchronize}
                            enabled={!this.loading}
                        />
                    ]}
                    body={
                        <div className="EezStudio_EmbeddedPlatform_ProtocolCenter">
                            <div className="EezStudio_EmbeddedPlatform_CloudSearch">
                                <div className="EezStudio_EmbeddedPlatform_EndpointField">
                                    <label htmlFor="embedded-protocol-endpoint">
                                        Protocol catalog URL
                                    </label>
                                    <input
                                        id="embedded-protocol-endpoint"
                                        value={
                                            this.context.project.embeddedPlatform
                                                .cloudEndpoint
                                        }
                                        placeholder="https://catalog.example.com/protocols"
                                        title={
                                            this.context.project.embeddedPlatform
                                                .cloudEndpoint ||
                                            "Protocol catalog endpoint"
                                        }
                                        onChange={event =>
                                            this.context.updateObject(
                                                this.context.project.embeddedPlatform,
                                                { cloudEndpoint: event.target.value }
                                            )
                                        }
                                    />
                                </div>
                                <div className="EezStudio_EmbeddedPlatform_SearchField">
                                    <label htmlFor="embedded-protocol-search">
                                        Find protocols
                                    </label>
                                    <div className="EezStudio_EmbeddedPlatform_SearchControl">
                                        <Icon icon="material:search" size={18} />
                                        <input
                                            id="embedded-protocol-search"
                                            value={this.searchText}
                                            placeholder="Filter protocols"
                                            title="Filter local protocols or search the catalog"
                                            onChange={event =>
                                                (this.searchText = event.target.value)
                                            }
                                            onKeyDown={event => {
                                                if (event.key === "Enter") {
                                                    this.searchCloud();
                                                }
                                            }}
                                        />
                                    </div>
                                </div>
                                <ButtonAction
                                    text="Search catalog"
                                    icon="material:cloud_search"
                                    title="Search the configured protocol catalog"
                                    onClick={this.searchCloud}
                                    enabled={!this.loading}
                                    loader={this.loading}
                                    className="EezStudio_EmbeddedPlatform_SearchButton"
                                />
                            </div>
                            <div
                                className="EezStudio_EmbeddedPlatform_CategoryTabs"
                                role="tablist"
                                aria-label="Protocol categories"
                            >
                                {categories.map(category => (
                                    <button
                                        key={category}
                                        type="button"
                                        role="tab"
                                        aria-selected={selectedCategory === category}
                                        className={
                                            selectedCategory === category
                                                ? "EezStudio_EmbeddedPlatform_CategoryTab is-selected"
                                                : "EezStudio_EmbeddedPlatform_CategoryTab"
                                        }
                                        onClick={() => this.selectCategory(category)}
                                    >
                                        {category === "all"
                                            ? `All (${protocols.length + this.cloudResults.length})`
                                            : `${category} (${categoryCount(category)})`}
                                    </button>
                                ))}
                            </div>
                            {this.status && (
                                <div className="EezStudio_EmbeddedPlatform_Status" role="status">
                                    {this.status}
                                </div>
                            )}
                            <div className="EezStudio_EmbeddedPlatform_ProtocolList">
                                {visibleProtocols.length > 0 && (
                                    <div className="EezStudio_EmbeddedPlatform_ListSectionLabel">
                                        Project protocols
                                    </div>
                                )}
                                {visibleProtocols.map(protocol => (
                                    <div key={protocol.objID} className="EezStudio_EmbeddedPlatform_ProtocolRow">
                                        <input
                                            type="checkbox"
                                            checked={protocol.enabled}
                                            onChange={event =>
                                                this.context.updateObject(protocol, {
                                                    enabled: event.target.checked
                                                })
                                            }
                                        />
                                        <div className="EezStudio_EmbeddedPlatform_ProtocolInfo">
                                            <strong title={protocol.name}>
                                                {protocol.name}
                                            </strong>
                                            <span title={protocol.category}>
                                                {protocol.category}
                                            </span>
                                            <small title={protocol.filePath}>
                                                {protocol.filePath}
                                            </small>
                                        </div>
                                        <IconAction
                                            icon="material:delete"
                                            iconSize={17}
                                            title="Remove protocol"
                                            onClick={() => this.context.deleteObject(protocol)}
                                        />
                                    </div>
                                ))}
                                {visibleCloudResults.length > 0 && (
                                    <div className="EezStudio_EmbeddedPlatform_ListSectionLabel">
                                        Catalog results
                                    </div>
                                )}
                                {visibleCloudResults.map(entry => (
                                    <div key={`${entry.name}-${entry.downloadUrl}`} className="EezStudio_EmbeddedPlatform_ProtocolRow EezStudio_EmbeddedPlatform_CloudResult">
                                        <Icon icon="material:cloud" size={18} />
                                        <div className="EezStudio_EmbeddedPlatform_ProtocolInfo">
                                            <strong title={entry.name}>{entry.name}</strong>
                                            <span title={entry.category}>{entry.category}</span>
                                        </div>
                                        <ButtonAction
                                            text="Import"
                                            icon="material:download"
                                            title="Import cloud protocol into project"
                                            onClick={() => this.addCloudProtocol(entry)}
                                            enabled={!this.loading}
                                        />
                                    </div>
                                ))}
                                {!hasVisibleResults && (
                                    <div className="EezStudio_EmbeddedPlatform_EmptyState">
                                        {normalizedSearch
                                            ? "No protocols match the current search and category."
                                            : "No protocols yet. Add a local file or search the protocol cloud."}
                                    </div>
                                )}
                            </div>
                        </div>
                    }
                />
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const EmbeddedBuildWindow = observer(
    class EmbeddedBuildWindow extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        running = false;
        progress = 0;
        status = "Ready";
        logs: string[] = [];
        lastRunFailed = false;
        lastDownloadFailed = false;
        buildCompleted = false;
        operation: "build" | "download" | undefined;
        terminalRef = React.createRef<HTMLPreElement>();
        followLogs = true;
        transformType: EmbeddedTransformType = "picture";
        transformModel: EmbeddedTransformModel = "rom";

        constructor(props: {}) {
            super(props);
            makeObservable(this, {
                running: observable,
                progress: observable,
                status: observable,
                logs: observable,
                lastRunFailed: observable,
                lastDownloadFailed: observable,
                buildCompleted: observable,
                operation: observable,
                appendLog: action.bound,
                handleWebSocketState: action.bound,
                transformType: observable,
                transformModel: observable,
                start: action.bound,
                download: action.bound,
                stop: action.bound,
                transform: action.bound
            });
        }

        componentDidMount() {
            if (this.context.project.embeddedPlatform.websocket?.enabled) {
                void this.connectWebSocket();
            }
        }

        componentDidUpdate() {
            const terminal = this.terminalRef.current;
            if (terminal && this.followLogs) {
                terminal.scrollTop = terminal.scrollHeight;
            }
        }

        async connectWebSocket() {
            runInAction(() => {
                this.status = "Connecting to middleware WebSocket...";
            });
            const result = await connectEmbeddedWebSocket(this.context);
            runInAction(() => {
                this.status = result.message;
            });
        }

        appendLog(message: string) {
            // Keep the full response while the build window is open. The previous
            // 500-message cap silently discarded earlier middleware output.
            this.logs.push(message);
        }

        handleLogsScroll = () => {
            const terminal = this.terminalRef.current;
            if (!terminal) {
                return;
            }
            this.followLogs =
                terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 24;
        };

        handleWebSocketState(state: EmbeddedWebSocketState) {
            if (state === "connecting") {
                this.status = "Connecting to middleware WebSocket...";
            } else if (state === "open" && this.running) {
                this.status =
                    this.operation === "download"
                        ? "WebSocket connected. Sending remote download command..."
                        : "WebSocket connected. Sending remote build commands...";
            } else if (state === "disconnected") {
                if (this.buildCompleted) {
                    this.lastDownloadFailed = true;
                    this.appendLog(
                        "[WebSocket] disconnected. Click Retry Remote Download to restart."
                    );
                    this.status =
                        "WebSocket disconnected. Click Retry Remote Download to restart the download.";
                } else {
                    this.lastRunFailed = true;
                    this.appendLog(
                        "[WebSocket] disconnected. Click Retry Remote Build to restart."
                    );
                    this.status =
                        "WebSocket disconnected. Click Retry Remote Build to restart cmake and build.";
                }
            }
        }

        async start() {
            if (this.running) {
                return;
            }

            const remoteMode = this.context.project.embeddedPlatform.websocket?.enabled === true;
            this.running = true;
            this.operation = "build";
            this.progress = 0;
            this.lastRunFailed = false;
            this.lastDownloadFailed = false;
            this.buildCompleted = false;
            this.logs = [];
            this.followLogs = true;
            this.status = remoteMode
                ? "Sending remote cmake and build commands..."
                : "Generating resources and building firmware...";
            try {
                const result = await runEmbeddedBuild(this.context, {
                    onProgress: value =>
                        runInAction(() => {
                            this.progress = value;
                        }),
                    onLog: message => this.appendLog(message),
                    onStateChange: state => this.handleWebSocketState(state)
                });
                runInAction(() => {
                    this.running = false;
                    this.operation = undefined;
                    this.lastRunFailed = !result.success;
                    this.buildCompleted = remoteMode && result.success;
                    this.status = result.success
                        ? result.message
                        : `${result.message} Click ${remoteMode ? "Retry Remote Build" : "Start Build"} to try again.`;
                });
            } catch (error) {
                runInAction(() => {
                    this.running = false;
                    this.operation = undefined;
                    this.lastRunFailed = true;
                    this.buildCompleted = false;
                    this.status = `Build failed: ${error}. Click ${remoteMode ? "Retry Remote Build" : "Start Build"} to try again.`;
                });
            }
        }

        async download() {
            if (this.running || !this.buildCompleted) {
                return;
            }

            this.running = true;
            this.operation = "download";
            this.progress = 0;
            this.lastDownloadFailed = false;
            this.status = "Sending remote download command...";
            this.appendLog("[Remote Download] Starting firmware download...");
            try {
                const result = await runEmbeddedDownload(this.context, undefined, {
                    onProgress: value =>
                        runInAction(() => {
                            this.progress = value;
                        }),
                    onLog: message => this.appendLog(message),
                    onStateChange: state => this.handleWebSocketState(state)
                });
                runInAction(() => {
                    this.running = false;
                    this.operation = undefined;
                    this.lastDownloadFailed = !result.success;
                    this.status = result.success
                        ? result.message
                        : `${result.message} Click Retry Remote Download to try again.`;
                });
                this.appendLog(`[Remote Download] ${result.message}`);
            } catch (error) {
                runInAction(() => {
                    this.running = false;
                    this.operation = undefined;
                    this.lastDownloadFailed = true;
                    this.status = `Download failed: ${error}. Click Retry Remote Download to try again.`;
                });
                this.appendLog(`[Remote Download] Download failed: ${error}`);
            }
        }

        async transform() {
            this.running = true;
            this.progress = 0;
            this.status = "Sending resource transform command...";
            const result = await runEmbeddedTransform(
                this.context,
                this.transformType,
                this.transformModel,
                {
                    onProgress: value =>
                        runInAction(() => {
                            this.progress = value;
                        })
                }
            );
            runInAction(() => {
                this.running = false;
                this.status = result.message;
            });
        }

        stop() {
            stopEmbeddedOperation(this.context);
            const operation = this.operation;
            this.running = false;
            this.operation = undefined;
            if (operation === "download") {
                this.lastDownloadFailed = true;
                this.status = "Download stopped. Click Retry Remote Download to try again.";
            } else {
                this.lastRunFailed = true;
                this.buildCompleted = false;
                this.status = "Build stopped. Click Retry Remote Build to try again.";
            }
        }

        render() {
            const platform = this.context.project.embeddedPlatform;
            const remoteMode = platform.websocket?.enabled === true;
            return (
                <div className="EezStudio_EmbeddedPlatform_Window">
                    <div className="EezStudio_EmbeddedPlatform_WindowGrid">
                        {remoteMode ? (
                            <Panel
                                id="embedded-build-remote"
                                title="Remote Project"
                                body={
                                    <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                        <PropertyGrid objects={[platform.remote.build]} />
                                    </div>
                                }
                            />
                        ) : (
                            <Panel
                                id="embedded-build-bsp"
                                title="BSP Information"
                                body={
                                    <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                        <PropertyGrid objects={[platform.bsp]} />
                                    </div>
                                }
                            />
                        )}
                        {remoteMode ? (
                            <Panel
                                id="embedded-build-logs"
                                title="Remote Logs"
                                style={{
                                    gridColumn: "2",
                                    gridRow: "1 / span 2",
                                    minHeight: 0,
                                    display: "flex",
                                    flexDirection: "column"
                                }}
                                body={
                                    <pre
                                        ref={this.terminalRef}
                                        className="EezStudio_EmbeddedPlatform_RemoteLogs"
                                        onScroll={this.handleLogsScroll}
                                    >
                                        {this.logs.length
                                            ? this.logs.join("\n")
                                            : "Waiting for middleware logs..."}
                                    </pre>
                                }
                            />
                        ) : (
                            <Panel
                                id="embedded-build-resources"
                                title="Resource Storage"
                                body={
                                    <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                        <PropertyGrid objects={[platform.storage]} />
                                    </div>
                                }
                            />
                        )}
                        {remoteMode ? (
                            <Panel
                                id="embedded-build-flow"
                                title="Remote Command Flow"
                                body={<RemoteCommandFlow platform={platform} />}
                            />
                        ) : (
                            <Panel
                                id="embedded-build-settings"
                                title="Build Settings"
                                body={
                                    <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                        <PropertyGrid objects={[platform.build]} />
                                    </div>
                                }
                            />
                        )}
                        {!remoteMode && (
                            <Panel
                                id="embedded-build-transform"
                                title="Resource Transform (WebSocket)"
                                body={
                                    <div className="EezStudio_EmbeddedPlatform_InlineForm">
                                        <select
                                            value={this.transformType}
                                            onChange={event =>
                                                (this.transformType = event.target.value as EmbeddedTransformType)
                                            }
                                            disabled={this.running}
                                        >
                                            <option value="picture">picture</option>
                                            <option value="font">font</option>
                                            <option value="audio">audio</option>
                                        </select>
                                        <select
                                            value={this.transformModel}
                                            onChange={event =>
                                                (this.transformModel = event.target.value as EmbeddedTransformModel)
                                            }
                                            disabled={this.running}
                                        >
                                            <option value="rom">rom</option>
                                            <option value="romxip">romxip</option>
                                            <option value="flashnormal">flashnormal</option>
                                        </select>
                                    </div>
                                }
                            />
                        )}
                    </div>
                    <div className="EezStudio_EmbeddedPlatform_WindowFooter">
                        <div className="EezStudio_EmbeddedPlatform_Status">{this.status}</div>
                        {renderProgress(this.progress)}
                        <div className="EezStudio_EmbeddedPlatform_Actions">
                            {remoteMode && this.buildCompleted ? (
                                <ButtonAction
                                    text={
                                        this.lastDownloadFailed
                                            ? "Retry Remote Download"
                                            : "Download Remotely"
                                    }
                                    icon="material:system_update_alt"
                                    title="Continue to remote firmware download and keep its logs in this window"
                                    onClick={this.download}
                                    enabled={!this.running}
                                />
                            ) : (
                                <ButtonAction
                                    text={
                                        remoteMode && this.lastRunFailed
                                            ? "Retry Remote Build"
                                            : remoteMode
                                              ? "Start Remote Build"
                                              : "Start Build"
                                    }
                                    icon="material:build"
                                    title={
                                        remoteMode
                                            ? "Send cmake and build commands to middleware"
                                            : "Generate resources and start firmware build"
                                    }
                                    onClick={this.start}
                                    enabled={!this.running}
                                />
                            )}
                            <ButtonAction
                                text="Transform"
                                icon="material:swap_horiz"
                                title="Send a resource transform command through WebSocket middleware"
                                onClick={this.transform}
                                enabled={!this.running}
                            />
                            <ButtonAction
                                text="Stop"
                                icon="material:stop"
                                title="Stop running firmware build"
                                onClick={this.stop}
                                enabled={this.running}
                            />
                        </div>
                    </div>
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const EmbeddedDownloadWindow = observer(
    class EmbeddedDownloadWindow extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        running = false;
        progress = 0;
        firmwarePath = "";
        status = "Ready";

        constructor(props: {}) {
            super(props);
            makeObservable(this, {
                running: observable,
                progress: observable,
                firmwarePath: observable,
                status: observable,
                chooseFirmware: action.bound,
                detect: action.bound,
                start: action.bound,
                stop: action.bound
            });
        }

        async chooseFirmware() {
            const result = await dialog.showOpenDialog(getCurrentWindow(), {
                properties: ["openFile"],
                filters: [
                    { name: "Firmware", extensions: ["bin", "hex", "elf"] },
                    { name: "All Files", extensions: ["*"] }
                ]
            });
            if (!result.canceled && result.filePaths[0]) {
                this.firmwarePath = result.filePaths[0];
            }
        }

        async detect() {
            this.running = true;
            this.status = this.context.project.embeddedPlatform.websocket?.enabled
                ? "Testing middleware WebSocket..."
                : "Detecting target tool...";
            const result = await detectEmbeddedTarget(this.context);
            runInAction(() => {
                this.running = false;
                this.status = result.message;
            });
        }

        async start() {
            const remoteMode = this.context.project.embeddedPlatform.websocket?.enabled === true;
            this.running = true;
            this.progress = 0;
            this.status = remoteMode
                ? "Sending remote download command..."
                : "Downloading firmware...";
            const result = await runEmbeddedDownload(
                this.context,
                this.firmwarePath || undefined,
                {
                    onProgress: value =>
                        runInAction(() => {
                            this.progress = value;
                        })
                }
            );
            runInAction(() => {
                this.running = false;
                this.status = result.message;
                if (result.firmwarePath) {
                    this.firmwarePath = result.firmwarePath;
                }
            });
        }

        stop() {
            stopEmbeddedOperation(this.context);
            this.running = false;
            this.status = "Download stopped.";
        }

        render() {
            const platform = this.context.project.embeddedPlatform;
            const remoteMode = platform.websocket?.enabled === true;
            return (
                <div className="EezStudio_EmbeddedPlatform_Window">
                    <div className="EezStudio_EmbeddedPlatform_WindowGrid EezStudio_EmbeddedPlatform_WindowGridSingle">
                        <Panel
                            id="embedded-download-settings"
                            title={remoteMode ? "Remote Download" : "Download Settings"}
                            body={
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid
                                        objects={[
                                            remoteMode
                                                ? platform.remote.download
                                                : platform.download
                                        ]}
                                    />
                                </div>
                            }
                        />
                        {remoteMode ? (
                            <Panel
                                id="embedded-download-flow"
                                title="Remote Command Flow"
                                body={<RemoteCommandFlow platform={platform} />}
                            />
                        ) : (
                            <Panel
                                id="embedded-download-image"
                                title="Firmware Image"
                                body={
                                    <div className="EezStudio_EmbeddedPlatform_FirmwarePicker">
                                        <input value={this.firmwarePath} readOnly />
                                        <ButtonAction
                                            text="Choose Image"
                                            icon="material:folder_open"
                                            title="Choose firmware image"
                                            onClick={this.chooseFirmware}
                                            enabled={!this.running}
                                        />
                                    </div>
                                }
                            />
                        )}
                    </div>
                    <div className="EezStudio_EmbeddedPlatform_WindowFooter">
                        <div className="EezStudio_EmbeddedPlatform_Status">{this.status}</div>
                        {renderProgress(this.progress)}
                        <div className="EezStudio_EmbeddedPlatform_Actions">
                            <ButtonAction
                                text="Detect"
                                icon="material:usb"
                                title={
                                    platform.websocket?.enabled
                                        ? "Test middleware WebSocket connection"
                                        : "Check configured download tool"
                                }
                                onClick={this.detect}
                                enabled={!this.running}
                            />
                            <ButtonAction
                                text={remoteMode ? "Download Remotely" : "Download"}
                                icon="material:system_update_alt"
                                title={
                                    remoteMode
                                        ? "Send the remote firmware path to middleware"
                                        : "Download firmware to target"
                                }
                                onClick={this.start}
                                enabled={!this.running}
                            />
                            <ButtonAction
                                text="Stop"
                                icon="material:stop"
                                title="Stop firmware download"
                                onClick={this.stop}
                                enabled={this.running}
                            />
                        </div>
                    </div>
                </div>
            );
        }
    }
);
