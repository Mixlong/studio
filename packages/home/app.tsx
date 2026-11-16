import React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { ipcRenderer } from "electron";
import { action, computed, makeObservable } from "mobx";
import { observer } from "mobx-react";
import update from "immutability-helper";
import * as FlexLayout from "flexlayout-react";

import {
    VerticalHeaderWithBody,
    Header,
    Body
} from "eez-studio-ui/header-with-body";
import { TabsView } from "eez-studio-ui/tabs";
import { makeLazyComponent } from "eez-studio-ui/lazy-component";

import {
    HomeTab,
    IHomeTab,
    ProjectEditorTab,
    loadTabs,
    tabs
} from "home/tabs-store";
import {
    DigiwiseAuthGate,
    digiwiseAuthController
} from "home/digiwise-account";
import "home/home-tab";

import type { InstrumentObject } from "instrument/instrument-object";
import {
    ScrapbookManagerDialog,
    model as scrapbookModel
} from "project-editor/store/scrapbook";
import { FlexLayoutContainer } from "eez-studio-ui/FlexLayout";
import { layoutModels } from "eez-studio-ui/side-dock";
import { Icon } from "eez-studio-ui/icon";
import { settingsController } from "home/settings";
import { handleDragAndDrop } from "home/drag-and-drop";

try {
    const remote = require("@electron/remote");
    if (remote && remote.nativeTheme) {
        remote.nativeTheme.themeSource = "light";
    }
} catch {}

////////////////////////////////////////////////////////////////////////////////

type WorkspaceMenuItem = {
    type?: string;
    label?: string;
    accelerator?: string;
    enabled?: boolean;
    checked?: boolean;
    submenu?: WorkspaceMenuItem[];
};

type WorkspaceMenuState = {
    label: string;
    items: WorkspaceMenuItem[];
    left: number;
    top: number;
};

const MainContent = observer(
    class Content extends React.Component<
        {},
        { workspaceMenu: WorkspaceMenuState | null }
    > {
        state = {
            workspaceMenu: null as WorkspaceMenuState | null
        };

        workspaceMenuBarItemsRef = React.createRef<HTMLDivElement>();
        workspaceMenuPopupRef = React.createRef<HTMLDivElement>();

        componentDidMount() {
            document.addEventListener(
                "mousedown",
                this.onWorkspaceMenuOutsideMouseDown,
                true
            );
            document.addEventListener(
                "keydown",
                this.onWorkspaceMenuKeyDown,
                true
            );
        }

        componentWillUnmount() {
            document.removeEventListener(
                "mousedown",
                this.onWorkspaceMenuOutsideMouseDown,
                true
            );
            document.removeEventListener(
                "keydown",
                this.onWorkspaceMenuKeyDown,
                true
            );
            if (this.state.workspaceMenu) {
                ipcRenderer.send("dispose-workspace-menu");
            }
        }

        onWorkspaceMenuOutsideMouseDown = (event: MouseEvent) => {
            if (!this.state.workspaceMenu) return;

            const target = event.target as Node;
            if (
                this.workspaceMenuBarItemsRef.current?.contains(target) ||
                this.workspaceMenuPopupRef.current?.contains(target)
            ) {
                return;
            }

            this.closeWorkspaceMenu();
        };

        onWorkspaceMenuKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && this.state.workspaceMenu) {
                this.closeWorkspaceMenu();
            }
        };

        closeWorkspaceMenu = () => {
            if (!this.state.workspaceMenu) return;
            ipcRenderer.send("dispose-workspace-menu");
            this.setState({ workspaceMenu: null });
        };

        onWorkspaceMenuClick = async (
            label: string,
            event: React.MouseEvent<HTMLButtonElement>
        ) => {
            event.preventDefault();

            if (this.state.workspaceMenu?.label === label) {
                this.closeWorkspaceMenu();
                return;
            }

            const rect = event.currentTarget.getBoundingClientRect();
            try {
                const items = await ipcRenderer.invoke(
                    "get-workspace-menu",
                    label,
                    settingsController.locale
                );
                if (!Array.isArray(items)) return;

                const maxLeft = Math.max(8, window.innerWidth - 240);
                this.setState({
                    workspaceMenu: {
                        label,
                        items,
                        left: Math.max(8, Math.min(rect.left, maxLeft)),
                        top: Math.min(rect.bottom, window.innerHeight - 48)
                    }
                });
            } catch {
                this.setState({ workspaceMenu: null });
            }
        };

        onWorkspaceMenuItemClick = (label: string, path: number[]) => {
            ipcRenderer.send("execute-workspace-menu-command", label, path);
            this.setState({ workspaceMenu: null });
        };

        renderWorkspaceMenuItems(
            items: WorkspaceMenuItem[],
            label: string,
            parentPath: number[] = []
        ): React.ReactNode {
            return items.map((item, index) => {
                const path = [...parentPath, index];
                const key = path.join("-");
                if (item.type === "separator") {
                    return (
                        <div
                            key={key}
                            className="DigiStudio_WorkspaceMenuPopup_Separator"
                            role="separator"
                        />
                    );
                }

                const hasSubmenu = !!item.submenu?.length;
                return (
                    <div
                        key={key}
                        className={
                            "DigiStudio_WorkspaceMenuPopup_ItemContainer" +
                            (hasSubmenu ? " has-submenu" : "")
                        }
                    >
                        <button
                            type="button"
                            role="menuitem"
                            className="DigiStudio_WorkspaceMenuPopup_Item"
                            disabled={item.enabled === false}
                            aria-haspopup={hasSubmenu ? "menu" : undefined}
                            onClick={() => {
                                if (!hasSubmenu) {
                                    this.onWorkspaceMenuItemClick(label, path);
                                }
                            }}
                        >
                            {item.checked && (
                                <span className="DigiStudio_WorkspaceMenuPopup_Check">
                                    ✓
                                </span>
                            )}
                            <span className="DigiStudio_WorkspaceMenuPopup_Label">
                                {item.label?.replace(/\.{3}$/, "")}
                            </span>
                            {item.accelerator && (
                                <span className="DigiStudio_WorkspaceMenuPopup_Accelerator">
                                    {item.accelerator
                                        .replace(
                                            /CommandOrControl|CmdOrCtrl/g,
                                            process.platform === "darwin"
                                                ? "Cmd"
                                                : "Ctrl"
                                        )
                                        .replace(
                                            /\bCommand\b/g,
                                            process.platform === "darwin"
                                                ? "Cmd"
                                                : "Ctrl"
                                        )
                                        .replace(/\bControl\b/g, "Ctrl")
                                        .replace(
                                            /\bAlt\b/g,
                                            process.platform === "darwin"
                                                ? "Option"
                                                : "Alt"
                                        )
                                        .replace(/\+Plus\b/gi, "++")}
                                </span>
                            )}
                            {hasSubmenu && (
                                <span className="DigiStudio_WorkspaceMenuPopup_SubmenuArrow">
                                    ›
                                </span>
                            )}
                        </button>
                        {hasSubmenu && (
                            <div
                                className="DigiStudio_WorkspaceMenuPopup_Submenu"
                                role="menu"
                            >
                                {this.renderWorkspaceMenuItems(
                                    item.submenu!,
                                    label,
                                    path
                                )}
                            </div>
                        )}
                    </div>
                );
            });
        }

        render() {
            const isChinese = settingsController.locale.toLowerCase().startsWith("zh");
            const showWorkspaceTabs =
                !(tabs.activeTab instanceof ProjectEditorTab) &&
                !(tabs.activeTab instanceof HomeTab);

            const activeTitle =
                tabs.activeTab instanceof ProjectEditorTab
                    ? tabs.activeTab.titleStr
                    : "DigiStudio";

            const workspaceMenu = this.state.workspaceMenu;

            return (
                <>
                    <VerticalHeaderWithBody style={{ height: "100%" }}>
                        {process.platform === "win32" && !(tabs.activeTab instanceof HomeTab) && (
                            <Header className="DigiStudio_WorkspaceMenuBar">
                                <div
                                    className="DigiStudio_WorkspaceMenuBar_Items"
                                    ref={this.workspaceMenuBarItemsRef}
                                >
                                    {["File", "Edit", "View", "Help"].map(label => (
                                        <button
                                            key={label}
                                            type="button"
                                            className="DigiStudio_WorkspaceMenuBar_Item"
                                            aria-haspopup="menu"
                                            aria-expanded={workspaceMenu?.label === label}
                                            onClick={event =>
                                                this.onWorkspaceMenuClick(label, event)
                                            }
                                        >
                                            {isChinese ? ({ File: "文件", Edit: "编辑", View: "视图", Help: "帮助" } as any)[label] : label}
                                        </button>
                                    ))}
                                </div>
                                <span className="DigiStudio_WorkspaceMenuBar_Title" title={activeTitle}>
                                    {activeTitle}
                                </span>
                            </Header>
                        )}
                        {showWorkspaceTabs && (
                            <Header className="EezStudio_AppHeader">
                                <TabsView
                                    tabs={tabs.tabs}
                                    moveTab={action(
                                        (dragIndex: number, hoverIndex: number) => {
                                            const tab = tabs.tabs[dragIndex];

                                            tabs.tabs = update(tabs.tabs, {
                                                $splice: [
                                                    [dragIndex, 1],
                                                    [hoverIndex, 0, tab]
                                                ]
                                            });
                                        }
                                    )}
                                />
                            </Header>
                        )}
                        <Body>
                            <Tabs />
                        </Body>
                    </VerticalHeaderWithBody>
                    {workspaceMenu &&
                        createPortal(
                            <div
                                ref={this.workspaceMenuPopupRef}
                                className="DigiStudio_WorkspaceMenuPopup"
                                role="menu"
                                style={{
                                    left: workspaceMenu.left,
                                    top: workspaceMenu.top,
                                    maxHeight: `calc(100vh - ${workspaceMenu.top}px - 8px)`
                                }}
                            >
                                {this.renderWorkspaceMenuItems(
                                    workspaceMenu.items,
                                    workspaceMenu.label
                                )}
                            </div>,
                            document.body
                        )}
                </>
            );
        }
    }
);

export const App = observer(
    class App extends React.Component {
        state = {
            authenticatedWorkspaceReady: false
        };
        private previousAuthenticatedState: boolean | undefined;
        private scrapbookMounted = false;
        private dragAndDropInitialized = false;
        private commandLineProjectRequested = false;

        componentDidMount(): void {
            digiwiseAuthController.ensureInitialized(
                settingsController.locale.toLowerCase().startsWith("zh")
            );
            this.syncAuthenticationState();
        }

        componentDidUpdate(): void {
            this.syncAuthenticationState();
        }

        private syncAuthenticationState() {
            const authenticated =
                digiwiseAuthController.authState.authenticated;
            if (authenticated === this.previousAuthenticatedState) {
                return;
            }

            this.previousAuthenticatedState = authenticated;

            if (authenticated) {
                if (!tabs) {
                    loadTabs();
                }
                if (!this.state.authenticatedWorkspaceReady) {
                    this.setState({ authenticatedWorkspaceReady: true });
                }
                if (tabs?.activeTab && !tabs.activeTab.active) {
                    tabs.activeTab.active = true;
                }
                if (!this.scrapbookMounted) {
                    scrapbookModel.mount();
                    this.scrapbookMounted = true;
                }
                if (!this.dragAndDropInitialized) {
                    handleDragAndDrop();
                    this.dragAndDropInitialized = true;
                }
                if (!this.commandLineProjectRequested) {
                    ipcRenderer.send("open-command-line-project");
                    this.commandLineProjectRequested = true;
                }
                window.dispatchEvent(
                    new Event("digiwise-app-authenticated")
                );
            } else {
                if (tabs?.activeTab) {
                    tabs.activeTab.active = false;
                }
                scrapbookModel.isVisible = false;
                if (this.state.authenticatedWorkspaceReady) {
                    this.setState({ authenticatedWorkspaceReady: false });
                }
            }
        }

        factory = (node: FlexLayout.TabNode) => {
            var component = node.getComponent();

            if (component === "main-content") {
                return <MainContent />;
            }

            if (component === "scrapbook") {
                return <ScrapbookManagerDialog />;
            }

            return null;
        };

        iconFactory = (node: FlexLayout.TabNode) => {
            let icon = node.getIcon();
            if (!icon || typeof icon != "string") {
                return null;
            }
            return <Icon icon={icon} size={20} />;
        };

        render() {
            if (!digiwiseAuthController.authState.authenticated) {
                return <DigiwiseAuthGate />;
            }

            if (!this.state.authenticatedWorkspaceReady || !tabs) {
                const isChinese = settingsController.locale
                    .toLowerCase()
                    .startsWith("zh");
                return (
                    <div className="DigiwiseAccount_RequiredGate">
                        <div className="DigiwiseAccount_RequiredGateLoading">
                            {isChinese
                                ? "登录已验证，正在恢复工作区…"
                                : "Signed in. Restoring your workspace…"}
                        </div>
                    </div>
                );
            }

            let content;
            if (
                !scrapbookModel.isVisible ||
                scrapbookModel.dockOption == "float"
            ) {
                content = <MainContent />;
            } else {
                content = (
                    <FlexLayoutContainer
                        model={layoutModels.app}
                        factory={this.factory}
                        iconFactory={this.iconFactory}
                    />
                );
            }

            return (
                <>
                    {content}
                    <WebSimulators />
                </>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const Tabs = observer(
    class Tabs extends React.Component {
        renderedItems = new Set<string | number>();

        renderContent(item: IHomeTab) {
            this.renderedItems.add(item.id);
            return item.render();
        }

        renderContentIfRenderedBefore(item: IHomeTab) {
            if (!this.renderedItems.has(item.id)) {
                return null;
            }
            return item.render();
        }

        render() {
            return tabs.tabs.map(tab => (
                <div
                    className="EezStudio_TabContainer"
                    key={tab.id}
                    style={{
                        display: tab === tabs.activeTab ? "block" : "none"
                    }}
                >
                    {tab.active
                        ? this.renderContent(tab)
                        : this.renderContentIfRenderedBefore(tab)}
                </div>
            ));
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const WebSimulators = makeLazyComponent(
    async () => {
        const { instruments } = await import("instrument/instrument-object");

        class State {
            constructor() {
                makeObservable(this, {
                    webSimulators: computed
                });
            }

            get webSimulators() {
                return [...instruments.values()].filter(
                    instrument =>
                        !instrument.connection.isIdle &&
                        instrument.extension &&
                        instrument.lastConnection?.type == "web-simulator"
                );
            }
        }

        return { state: new State() };
    },
    ({ state }) => {
        const webSimulatorConnections = state.webSimulators;
        if (webSimulatorConnections.length == 0) {
            return null;
        }

        return webSimulatorConnections.map(instrument => (
            <WebSimulatorPanel key={instrument.id} instrument={instrument} />
        ));
    }
);

////////////////////////////////////////////////////////////////////////////////

class WebSimulatorPanel extends React.Component<{
    instrument: InstrumentObject;
}> {
    dialog: any;

    componentDidMount() {
        const instrument = this.props.instrument;

        let element = document.createElement("div");

        element.style.position = "absolute";
        element.style.width = "100%";
        element.style.height = "100%";
        element.style.overflow = "hidden";

        const connection = instrument.getConnectionProperty();
        const webSimulatorPage = connection?.webSimulator!.src;

        const installationFolderPath =
            instrument.extension?.installationFolderPath;

        const src =
            installationFolderPath +
            "/" +
            webSimulatorPage +
            "?id=" +
            instrument.lastConnection?.webSimulatorParameters.id;

        const simulator = (
            <iframe
                src={src}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
            ></iframe>
        );

        const root = createRoot(element);
        root.render(simulator);

        const jsPanel: any = (window as any).jsPanel;

        const localStorageItemKey =
            "WebSimulatorPanel6:" + this.props.instrument.id;
        let panelDataStr = window.localStorage.getItem(localStorageItemKey);
        let panelData;
        if (panelDataStr) {
            panelData = JSON.parse(panelDataStr);
        }

        const webSimulatorWidth = connection?.webSimulator!.width ?? 640;
        const webSimulatorHeight = connection?.webSimulator!.height ?? 480;

        const TITLE_HEIGHT = 34;

        const panelMaxWidth = webSimulatorWidth;
        const panelMaxHeight = webSimulatorHeight + TITLE_HEIGHT;
        const panelMinWidth = webSimulatorWidth / 8;
        const panelMinHeight = webSimulatorHeight / 8 + TITLE_HEIGHT;

        let panelLeft;
        let panelTop;
        let panelWidth;
        let panelHeight;
        if (panelData) {
            panelLeft = panelData.left;
            panelTop = panelData.top;
            panelWidth = panelData.width;
            panelHeight =
                (panelWidth * webSimulatorHeight) / webSimulatorWidth +
                TITLE_HEIGHT;
        } else {
            panelWidth = Math.min(
                Math.round(window.innerWidth * 0.5),
                panelMaxWidth
            );
            panelHeight = (panelWidth * webSimulatorHeight) / webSimulatorWidth;
            if (panelHeight > Math.round(window.innerWidth * 0.5)) {
                panelHeight = Math.round(window.innerWidth * 0.5);
                panelWidth =
                    (panelHeight * webSimulatorWidth) / webSimulatorHeight;
            }
            panelHeight += TITLE_HEIGHT;

            panelLeft = (window.innerWidth - panelWidth) / 2;
            panelTop = (window.innerHeight - panelHeight) / 2;
        }

        panelWidth = Math.ceil(panelWidth);
        panelHeight = Math.ceil(panelHeight);

        this.dialog = jsPanel.create({
            container: "#EezStudio_Content",
            theme: "primary",
            headerTitle: instrument.name,
            panelSize: {
                width: panelWidth,
                height: panelHeight
            },
            position: {
                my: "top-left",
                offsetX: panelLeft + "px",
                offsetY: panelTop + "px"
            },
            content: element,
            headerControls: {
                maximize: "remove",
                smallify: "remove"
            },
            dragit: {
                drag: (panel: any, panelData: any) => {
                    window.localStorage.setItem(
                        localStorageItemKey,
                        JSON.stringify(panelData)
                    );
                },
                containment: [0]
            },
            resizeit: {
                aspectRatio: "content",
                maxWidth: panelMaxWidth,
                maxHeight: panelMaxHeight,
                minWidth: panelMinWidth,
                minHeight: panelMinHeight,
                resize: (panel: any, panelData: any) => {
                    window.localStorage.setItem(
                        localStorageItemKey,
                        JSON.stringify(panelData)
                    );
                },
                containment: [0]
            },
            closeOnBackdrop: false,
            closeOnEscape: false,
            onclosed: (panel: any, closedByUser: boolean) => {
                if (closedByUser) {
                    this.props.instrument.connection.disconnect();
                    this.dialog = undefined;
                }
            }
        });
    }

    componentWillUnmount() {
        if (this.dialog) {
            this.dialog.close();
        }
    }

    render() {
        return null;
    }
}
