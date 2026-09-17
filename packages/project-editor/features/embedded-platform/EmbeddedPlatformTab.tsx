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
import { HiddenComponent, ProtocolResource } from "project-editor/features/embedded-platform/embedded-platform";
import {
    downloadMockProtocol,
    isMockProtocolEndpoint,
    searchMockProtocols,
    type CloudProtocol
} from "project-editor/features/embedded-platform/protocol-cloud";
import {
    detectEmbeddedTarget,
    runEmbeddedBuild,
    runEmbeddedDownload,
    runEmbeddedTransform,
    stopEmbeddedOperation,
    synchronizeEmbeddedResources
} from "project-editor/features/embedded-platform/build-tools";

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

function showEmbeddedBuildWindow(projectStore: ProjectStore) {
    showDialog(
        <ProjectContext.Provider value={projectStore}>
            <EmbeddedBuildWindow />
        </ProjectContext.Provider>,
        {
            jsPanel: {
                id: "eez-embedded-build",
                title: "Embedded Firmware Build",
                width: 1060,
                height: 760,
                modeless: true
            }
        }
    );
}

function showEmbeddedDownloadWindow(projectStore: ProjectStore) {
    showDialog(
        <ProjectContext.Provider value={projectStore}>
            <EmbeddedDownloadWindow />
        </ProjectContext.Provider>,
        {
            jsPanel: {
                id: "eez-embedded-download",
                title: "Firmware Download",
                width: 980,
                height: 700,
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

////////////////////////////////////////////////////////////////////////////////

export const EmbeddedPlatformTab = observer(
    class EmbeddedPlatformTab extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        activeWorkspace = "target";
        workspaceNavCollapsed = false;

        constructor(props: {}) {
            super(props);
            makeObservable(this, {
                activeWorkspace: observable,
                workspaceNavCollapsed: observable,
                selectWorkspace: action.bound,
                toggleWorkspaceNav: action.bound
            });
        }

        selectWorkspace(workspace: string) {
            this.activeWorkspace = workspace;
        }

        toggleWorkspaceNav() {
            this.workspaceNavCollapsed = !this.workspaceNavCollapsed;
        }

        renderConfiguration(platform: any) {
            switch (this.activeWorkspace) {
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
                        <Panel
                            id="embedded-websocket"
                            title="Middleware WebSocket"
                            body={
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.websocket]} />
                                </div>
                            }
                        />
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

            return (
                <div className="EezStudio_EmbeddedPlatform">
                    <div className="EezStudio_EmbeddedPlatform_Header">
                        <div className="EezStudio_EmbeddedPlatform_Title">
                            <Icon icon="material:developer_board" size={22} />
                            <span>Embedded Platform</span>
                        </div>
                        <div className="EezStudio_EmbeddedPlatform_Actions">
                            <ButtonAction
                                text="Build Firmware"
                                icon="material:build"
                                title="Open firmware build window"
                                onClick={() => showEmbeddedBuildWindow(this.context)}
                            />
                            <ButtonAction
                                text="Download Firmware"
                                icon="material:system_update_alt"
                                title="Open firmware download window"
                                onClick={() => showEmbeddedDownloadWindow(this.context)}
                            />
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
                            {[
                                ["target", "material:memory", "Target"],
                                ["protocols", "material:cable", "Protocols"],
                                ["resources", "material:storage", "Resources"],
                                ["connection", "material:settings_ethernet", "Connection"],
                                ["components", "material:visibility", "Components"]
                            ].map(([id, icon, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    className={
                                        this.activeWorkspace === id
                                            ? "is-active"
                                            : ""
                                    }
                                    aria-current={
                                        this.activeWorkspace === id
                                            ? "page"
                                            : undefined
                                    }
                                    aria-label={label}
                                    title={label}
                                    onClick={() => this.selectWorkspace(id)}
                                >
                                    <Icon icon={icon} size={18} />
                                    <span className="EezStudio_EmbeddedPlatform_WorkspaceNavLabel">
                                        {label}
                                    </span>
                                </button>
                            ))}
                        </nav>
                        <div className="EezStudio_EmbeddedPlatform_Configuration">
                            {this.renderConfiguration(platform)}
                        </div>
                    </div>
                    <footer className="EezStudio_EmbeddedPlatform_StatusBar">
                        <span className="EezStudio_EmbeddedPlatform_StatusDot" />
                        <span>Ready</span>
                        <span>{platform.bsp.name || "No target configured"}</span>
                        <span>
                            {platform.websocket.enabled
                                ? "Middleware connected"
                                : "Local tooling"}
                        </span>
                        <span>
                            {platform.protocols.length} protocol
                            {platform.protocols.length === 1 ? "" : "s"}
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
        transformType = "picture";
        transformModel = "rom";

        constructor(props: {}) {
            super(props);
            makeObservable(this, {
                running: observable,
                progress: observable,
                status: observable,
                transformType: observable,
                transformModel: observable,
                start: action.bound,
                stop: action.bound,
                transform: action.bound
            });
        }

        async start() {
            this.running = true;
            this.progress = 0;
            this.status = "Generating resources and building firmware...";
            const result = await runEmbeddedBuild(this.context, {
                onProgress: value =>
                    runInAction(() => {
                        this.progress = value;
                    })
            });
            runInAction(() => {
                this.running = false;
                this.status = result.message;
            });
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
            this.running = false;
            this.status = "Build stopped.";
        }

        render() {
            const platform = this.context.project.embeddedPlatform;
            return (
                <div className="EezStudio_EmbeddedPlatform_Window">
                    <div className="EezStudio_EmbeddedPlatform_WindowGrid">
                        <Panel
                            id="embedded-build-bsp"
                            title="BSP Information"
                            body={
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.bsp]} />
                                </div>
                            }
                        />
                        <Panel
                            id="embedded-build-resources"
                            title="Resource Storage"
                            body={
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.storage]} />
                                </div>
                            }
                        />
                        <Panel
                            id="embedded-build-settings"
                            title="Build Settings"
                            body={
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.build]} />
                                </div>
                            }
                        />
                        <Panel
                            id="embedded-build-transform"
                            title="Resource Transform (WebSocket)"
                            body={
                                <div className="EezStudio_EmbeddedPlatform_InlineForm">
                                    <select
                                        value={this.transformType}
                                        onChange={event =>
                                            (this.transformType = event.target.value)
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
                                            (this.transformModel = event.target.value)
                                        }
                                        disabled={this.running}
                                    >
                                        <option value="rom">rom</option>
                                        <option value="xip">xip</option>
                                        <option value="non-xip">non-xip</option>
                                    </select>
                                </div>
                            }
                        />
                    </div>
                    <div className="EezStudio_EmbeddedPlatform_WindowFooter">
                        <div className="EezStudio_EmbeddedPlatform_Status">{this.status}</div>
                        {renderProgress(this.progress)}
                        <div className="EezStudio_EmbeddedPlatform_Actions">
                            <ButtonAction
                                text="Start Build"
                                icon="material:build"
                                title="Generate resources and start firmware build"
                                onClick={this.start}
                                enabled={!this.running}
                            />
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
            this.running = true;
            this.progress = 0;
            this.status = "Downloading firmware...";
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
            return (
                <div className="EezStudio_EmbeddedPlatform_Window">
                    <div className="EezStudio_EmbeddedPlatform_WindowGrid EezStudio_EmbeddedPlatform_WindowGridSingle">
                        <Panel
                            id="embedded-download-settings"
                            title="Download Settings"
                            body={
                                <div className="EezStudio_EmbeddedPlatform_PropertyGrid">
                                    <PropertyGrid objects={[platform.download]} />
                                </div>
                            }
                        />
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
                                text="Download"
                                icon="material:system_update_alt"
                                title="Download firmware to target"
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
