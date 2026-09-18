import React from "react";
import { observer } from "mobx-react";
import * as FlexLayout from "flexlayout-react";
import { Menu, MenuItem } from "@electron/remote";
import classNames from "classnames";
import { action, computed, makeObservable, runInAction } from "mobx";

import { Messages } from "project-editor/ui-components/Output";
import { Toolbar } from "project-editor/project/ui/Toolbar";
import { Icon } from "eez-studio-ui/icon";
import { Loader } from "eez-studio-ui/loader";
import { Button } from "eez-studio-ui/button";
import { IExtension } from "eez-studio-shared/extensions/extension";
import * as notification from "eez-studio-ui/notification";
import { FlexLayoutContainer } from "eez-studio-ui/FlexLayout";

import {
    PageEditor,
    PageTabState
} from "project-editor/features/page/PageEditor";
import { ProjectContext } from "project-editor/project/context";
import {
    Editor,
    LayoutModels,
    Section,
    getActivityBarTabTitle
} from "project-editor/store";
import { PropertiesPanel } from "./PropertiesPanel";
import { ComponentsPalette } from "project-editor/flow/editor/ComponentsPalette";
import { BreakpointsPanel } from "project-editor/flow/debugger/BreakpointsPanel";
import { ThemesSideView } from "project-editor/features/style/theme";
import { getEditorComponent } from "project-editor/project/ui/EditorComponentFactory";
import { QueuePanel } from "project-editor/flow/debugger/QueuePanel";
import { WatchPanel } from "project-editor/flow/debugger/WatchPanel";
import { ActiveFlowsPanel } from "project-editor/flow/debugger/ActiveFlowsPanel";
import { LogsPanel } from "project-editor/flow/debugger/LogsPanel";
import { ListNavigation } from "project-editor/ui-components/ListNavigation";
import { VariablesTab } from "project-editor/features/variable/VariablesNavigation";
import { StylesTab } from "project-editor/features/style/StylesNavigation";
import { FontsTab } from "project-editor/features/font/FontsNavigation";
import { BitmapsTab } from "project-editor/features/bitmap/BitmapsNavigation";
import { AudioTab } from "project-editor/features/audio/AudioNavigation";
import { EmbeddedPlatformTab } from "project-editor/features/embedded-platform/EmbeddedPlatformTab";
import { TextsTab } from "project-editor/features/texts/navigation";
import { ScpiTab } from "project-editor/features/scpi/ScpiNavigation";
import { InstrumentCommandsList } from "project-editor/features/instrument-commands/InstrumentCommandsNavigation";
import { ExtensionDefinitionsTab } from "project-editor/features/extension-definitions/extension-definitions";
import { ChangesTab } from "project-editor/features/changes/navigation";
import { SearchPanel } from "project-editor/project/ui/SearchPanel";
import { ReferencesPanel } from "project-editor/project/ui/ReferencesPanel";
import {
    downloadAndInstallExtension,
    extensionsManagerStore
} from "home/extensions-manager/extensions-manager";
import { LVGLGroupsTab } from "project-editor/lvgl/groups";
import { settingsController } from "home/settings";
import { PageStructure } from "project-editor/features/page/PagesNavigation";

////////////////////////////////////////////////////////////////////////////////

export const ProjectEditorView = observer(
    class ProjectEditorView extends React.Component<{
        showToolbar: boolean;
    }> {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        render() {
            if (!this.context.project || !this.context.project._fullyLoaded) {
                return <div className="EezStudio_ProjectEditorWrapper" />;
            }

            if (
                this.context.project.missingExtensions.length > 0 &&
                !this.context.missingExtensionsResolved
            ) {
                return <MissingExtensions />;
            }

            if (
                this.context.context.type != "project-editor" &&
                !this.context.runtime
            ) {
                return <div className="EezStudio_ProjectEditorWrapper" />;
            }

            return (
                <div className="EezStudio_ProjectEditorWrapper">
                    <div className="EezStudio_ProjectEditor_MainContentWrapper">
                        {this.props.showToolbar && <Toolbar />}
                        <Content
                            key={
                                this.context.layoutModels.isDockerSimulatorMode
                                    ? "full-simulator"
                                    : this.context.runtime
                                      ? this.context.runtime.isDebuggerActive
                                          ? "debugger"
                                          : "runtime"
                                      : "editor"
                            }
                        />
                    </div>
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const Content = observer(
    class Content extends React.Component<{}, { layoutRevision: number }> {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        state = {
            layoutRevision: 0
        };

        _prevPageTabState: PageTabState | undefined;

        componentDidMount(): void {
            this.context.editorsStore?.openInitialEditors();
            this.context.editorsStore?.refresh(true);
        }

        factory = (node: FlexLayout.TabNode) => {
            var component = node.getComponent();

            if (component === "pages") {
                return (
                    <ListNavigation
                        id="pages"
                        navigationObject={this.context.project.userPages}
                        selectedObject={
                            this.context.navigationStore.selectedUserPageObject
                        }
                        editable={!this.context.runtime}
                    />
                );
            }

            if (component === "widgets") {
                return (
                    <ListNavigation
                        id="widgets"
                        navigationObject={this.context.project.userWidgets}
                        selectedObject={
                            this.context.navigationStore
                                .selectedUserWidgetObject
                        }
                        editable={!this.context.runtime}
                    />
                );
            }

            if (component === "actions") {
                return (
                    <ListNavigation
                        id="actions"
                        navigationObject={this.context.project.actions}
                        selectedObject={
                            this.context.navigationStore.selectedActionObject
                        }
                        editable={!this.context.runtime}
                    />
                );
            }

            if (component === "flow-structure") {
                return <PageStructure />;
            }

            if (component === "variables") {
                return <VariablesTab />;
            }

            if (component === "styles") {
                return <StylesTab />;
            }

            if (component === "fonts") {
                return <FontsTab />;
            }

            if (component === "bitmaps") {
                return <BitmapsTab />;
            }

            if (component === "audio") {
                return <AudioTab />;
            }

            if (component === "embedded-platform") {
                return <EmbeddedPlatformTab />;
            }

            if (component === "changes") {
                return <ChangesTab />;
            }

            if (component === "texts") {
                return <TextsTab />;
            }

            if (component === "scpi") {
                return <ScpiTab />;
            }

            if (component === "instrument-commands") {
                return <InstrumentCommandsList />;
            }

            if (component === "extension-definitions") {
                return <ExtensionDefinitionsTab />;
            }

            if (this.context.runtime) {
                if (component === "queue") {
                    return <QueuePanel runtime={this.context.runtime} />;
                }

                if (component === "watch") {
                    return <WatchPanel runtime={this.context.runtime} />;
                }

                if (component === "active-flows") {
                    return <ActiveFlowsPanel runtime={this.context.runtime} />;
                }

                if (component === "logs") {
                    return <LogsPanel runtime={this.context.runtime} />;
                }
            }

            if (component === "propertiesPanel") {
                return <PropertiesPanel />;
            }

            if (component === "componentsPalette") {
                return <ComponentsPalette />;
            }

            if (component === "breakpointsPanel") {
                return <BreakpointsPanel />;
            }

            if (component === "themesSideView") {
                return <ThemesSideView />;
            }

            if (component === "checksMessages") {
                return (
                    <Messages
                        section={this.context.outputSectionsStore.getSection(
                            Section.CHECKS
                        )}
                    />
                );
            }

            if (component === "outputMessages") {
                return (
                    <Messages
                        section={this.context.outputSectionsStore.getSection(
                            Section.OUTPUT
                        )}
                    />
                );
            }

            if (component === "search") {
                return <SearchPanel />;
            }

            if (component === "references") {
                return <ReferencesPanel />;
            }

            if (component === "editor") {
                const editor = this.context.editorsStore.tabIdToEditorMap.get(
                    node.getId()
                );

                node.setEventListener("visibility", (p: any) => {
                    this.context.editorsStore.refresh(true);
                });

                node.setEventListener("close", (p: any) => {
                    this.context.editorsStore.refresh(true);
                });

                if (editor) {
                    let result = getEditorComponent(
                        editor.object,
                        editor.params
                    );
                    if (result) {
                        return <result.EditorComponent editor={editor} />;
                    }
                }

                return null;
            }

            if (component === "lvgl-groups") {
                return <LVGLGroupsTab />;
            }

            if (component === "dockerSimulatorPreview") {
                const {
                    DockerSimulatorPreviewPanel
                } = require("project-editor/lvgl/docker-build/DockerSimulatorPreviewPanel");
                return <DockerSimulatorPreviewPanel />;
            }

            if (component === "dockerSimulatorLogs") {
                const {
                    DockerSimulatorLogsPanel
                } = require("project-editor/lvgl/docker-build/DockerSimulatorLogsPanel");
                return <DockerSimulatorLogsPanel />;
            }

            if (component === "dockerSimulatorPreviewLogs") {
                const {
                    PreviewLogsPanel
                } = require("project-editor/lvgl/docker-build/PreviewLogsPanel");
                return <PreviewLogsPanel />;
            }

            return null;
        };

        onRenderTab = (
            node: FlexLayout.TabNode,
            renderValues: FlexLayout.ITabRenderValues
        ) => {
            if (
                node.getId() == LayoutModels.CHECKS_TAB_ID ||
                node.getId() == LayoutModels.OUTPUT_TAB_ID
            ) {
                const section = this.context.outputSectionsStore.getSection(
                    node.getId() == LayoutModels.CHECKS_TAB_ID
                        ? Section.CHECKS
                        : Section.OUTPUT
                );

                let icon;
                let numMessages;
                if (section.numErrors > 0) {
                    icon = <Icon icon="material:error" className="error" />;
                    numMessages = section.numErrors;
                } else if (section.numWarnings > 0) {
                    icon = <Icon icon="material:warning" className="warning" />;
                    numMessages = section.numWarnings;
                } else {
                    icon = (
                        <Icon
                            icon="material:check"
                            className="info"
                            style={
                                node.getId() == LayoutModels.OUTPUT_TAB_ID &&
                                this.context.lastSuccessfulBuildRevision ==
                                    this.context.lastRevision
                                    ? {
                                          color: settingsController.isDarkTheme
                                              ? "#27FB2C"
                                              : "#00FF21",
                                          fontWeight: "bold"
                                      }
                                    : undefined
                            }
                        />
                    );
                    numMessages = 0;
                }

                renderValues.leading = section.loading ? (
                    <Loader size={20} />
                ) : (
                    icon
                );

                renderValues.content =
                    section.name + (numMessages > 0 ? ` (${numMessages})` : "");
            } else if (
                node.getId() == LayoutModels.SEARCH_TAB_ID ||
                node.getId() == LayoutModels.REFERENCES_TAB_ID
            ) {
                const section = this.context.outputSectionsStore.getSection(
                    node.getId() == LayoutModels.SEARCH_TAB_ID
                        ? Section.SEARCH
                        : Section.REFERENCES
                );

                renderValues.leading = section.loading ? (
                    <Loader size={20} />
                ) : null;

                renderValues.content =
                    section.name +
                    (section.messages.searchResults.length > 0
                        ? ` (${section.messages.searchResults.length})`
                        : "");
            } else if (node.getId() == LayoutModels.DEBUGGER_LOGS_TAB_ID) {
                if (this.context.runtime && this.context.runtime.error) {
                    renderValues.leading = (
                        <div className="EezStudio_AttentionContainer">
                            <span></span>
                            <div className="EezStudio_AttentionDiv" />
                        </div>
                    );
                }
            } else if (node.getComponent() == "editor") {
                renderValues.content = (
                    <div>{node.getName()}</div>
                );
            }
        };

        onAuxMouseClick = (
            node:
                | FlexLayout.TabNode
                | FlexLayout.TabSetNode
                | FlexLayout.BorderNode,
            event: React.MouseEvent<HTMLElement, MouseEvent>
        ) => {
            if (
                node instanceof FlexLayout.TabNode &&
                node.getComponent() == "editor"
            ) {
                if (event.button == 1) {
                    // delete tab on mouse middle click
                    node.getModel().doAction(
                        FlexLayout.Actions.deleteTab(node.getId())
                    );
                }
            }
        };

        onContextMenu = (
            node:
                | FlexLayout.TabNode
                | FlexLayout.TabSetNode
                | FlexLayout.BorderNode,
            event: React.MouseEvent<HTMLElement, MouseEvent>
        ) => {
            event.preventDefault();
            event.stopPropagation();

            if (
                node instanceof FlexLayout.TabNode &&
                node.getComponent() == "editor"
            ) {
                const editor = this.context.editorsStore.tabIdToEditorMap.get(
                    node.getId()
                );
                if (editor && !editor.permanent) {
                    // open context menu
                    const menu = new Menu();
                    menu.append(
                        new MenuItem({
                            label: "Keep Tab Open",
                            click: () => {
                                runInAction(() => (editor.permanent = true));

                                this.context.editorsStore.tabsModel.doAction(
                                    FlexLayout.Actions.updateNodeAttributes(
                                        node.getId(),
                                        {
                                            config: editor.getConfig()
                                        }
                                    )
                                );
                            }
                        })
                    );
                    menu.popup();
                }
            }
        };

        onModelChange = (
            model: FlexLayout.Model,
            action: FlexLayout.Action
        ) => {
            // Keep the sidebar collapse controls in sync with border selection.
            this.setState(state => ({
                layoutRevision: state.layoutRevision + 1
            }));
            this.context.editorsStore.refresh(false);
        };

        render() {
            if (
                this.context.runtime &&
                !this.context.runtime.isDebuggerActive
            ) {
                const pageTabState = new PageTabState(
                    this.context.runtime.selectedPage,
                    this._prevPageTabState
                        ? this._prevPageTabState.transform
                        : undefined
                );

                if (this.context.projectTypeTraits.isLVGL) {
                    // prevent flickering when changing selected page
                    this._prevPageTabState = pageTabState;
                }

                return (
                    <PageEditor
                        editor={
                            new Editor(
                                this.context,
                                this.context.runtime.selectedPage,
                                undefined,
                                undefined,
                                pageTabState
                            )
                        }
                    ></PageEditor>
                );
            }

            // to make sure onRenderTab is observable
            this.context.editorsStore.editors.forEach(editor => {
                editor.permanent;
            });

            const checksSection = this.context.outputSectionsStore.getSection(
                Section.CHECKS
            );
            checksSection.numErrors;
            checksSection.numWarnings;
            checksSection.loading;

            this.context.lastRevisionStable;
            this.context.lastSuccessfulBuildRevision;

            const sectionOutput = this.context.outputSectionsStore.getSection(
                Section.OUTPUT
            );
            sectionOutput.numErrors;
            sectionOutput.numWarnings;
            sectionOutput.loading;

            const sectionSearch = this.context.outputSectionsStore.getSection(
                Section.SEARCH
            );
            sectionSearch.messages.searchResults.length;
            sectionSearch.loading;

            const sectionReferences =
                this.context.outputSectionsStore.getSection(Section.REFERENCES);
            sectionReferences.messages.searchResults.length;
            sectionReferences.loading;

            this.context.runtime && this.context.runtime.error;

            return (
                <div
                    style={{
                        flexGrow: 1,
                        display: "flex",
                        flexDirection: "row"
                    }}
                >
                    <div
                        style={{
                            position: "relative",
                            flexGrow: 1
                        }}
                    >
                        <FlexLayoutContainer
                            model={this.context.layoutModels.root}
                            factory={this.factory}
                            onRenderTab={this.onRenderTab}
                            iconFactory={LayoutModels.iconFactory}
                            onAuxMouseClick={this.onAuxMouseClick}
                            onContextMenu={this.onContextMenu}
                            onModelChange={this.onModelChange}
                            font={{
                                size: "small"
                            }}
                        />
                        <SidebarCollapseControls
                            model={this.context.layoutModels.root}
                            revision={this.state.layoutRevision}
                        />
                        <ActivityBarTooltip
                            layoutModels={this.context.layoutModels}
                        />
                    </div>
                </div>
            );
        }
    }
);

interface IActivityBarTooltipProps {
    layoutModels: LayoutModels;
}

interface IActivityBarTooltipState {
    visible: boolean;
    text: string;
    top: number;
    left: number;
    side: "left" | "right";
}

interface ISidebarCollapseControlsProps {
    model: FlexLayout.Model;
    revision: number;
}

/** IDE-style collapse actions anchored to the top of each side rail. */
const SidebarCollapseControls = observer(
    ({ model }: ISidebarCollapseControlsProps) => {
        const controls: React.ReactNode[] = [];

        model.visitNodes(node => {
            if (!(node instanceof FlexLayout.BorderNode)) {
                return;
            }
            const border = node;
            const location = border.getLocation().getName();
            if (location !== "left" && location !== "right") {
                return;
            }

            const selectedTab = border.getSelectedNode();
            if (!(selectedTab instanceof FlexLayout.TabNode)) {
                return;
            }

            const isLeft = location === "left";
            const title = isLeft
                ? "Hide left sidebar"
                : "Hide right sidebar";

            controls.push(
                <button
                    key={`collapse-${border.getId()}`}
                    type="button"
                    className={classNames(
                        "DigiStudio_SidebarCollapseControl",
                        isLeft
                            ? "DigiStudio_SidebarCollapseControl_Left"
                            : "DigiStudio_SidebarCollapseControl_Right"
                    )}
                    title={title}
                    aria-label={title}
                    onMouseDown={event => event.stopPropagation()}
                    onTouchStart={event => event.stopPropagation()}
                    onClick={event => {
                        event.stopPropagation();
                        model.doAction(
                            FlexLayout.Actions.selectTab(selectedTab.getId())
                        );
                    }}
                >
                    <Icon
                        icon={
                            isLeft
                                ? "material:chevron_left"
                                : "material:chevron_right"
                        }
                        size={18}
                    />
                </button>
            );
        });

        return <>{controls}</>;
    }
);

export class ActivityBarTooltip extends React.Component<
    IActivityBarTooltipProps,
    IActivityBarTooltipState
> {
    state: IActivityBarTooltipState = {
        visible: false,
        text: "",
        top: 0,
        left: 0,
        side: "left"
    };

    containerRef = React.createRef<HTMLDivElement>();
    hideTimer: any = null;
    showTimer: any = null;

    componentDidMount() {
        document.addEventListener("mouseover", this.onMouseOver);
        document.addEventListener("mouseout", this.onMouseOut);
        document.addEventListener("mousedown", this.onMouseDown);
    }

    componentWillUnmount() {
        document.removeEventListener("mouseover", this.onMouseOver);
        document.removeEventListener("mouseout", this.onMouseOut);
        document.removeEventListener("mousedown", this.onMouseDown);
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
    }

    onMouseDown = () => {
        this.hideTooltip(true);
    };

    onMouseOver = (e: MouseEvent) => {
        const target = (e.target as HTMLElement).closest(
            ".flexlayout__border_left.DigiStudio_ActivityBar .flexlayout__border_button, " +
                ".flexlayout__border_right.DigiStudio_AuxiliaryBar .flexlayout__border_button"
        ) as HTMLElement | null;

        if (!target) {
            return;
        }

        const wrapper = this.containerRef.current?.parentElement;
        if (wrapper && !wrapper.contains(target)) {
            return;
        }

        // Suppress native browser title tooltip so it doesn't clash
        const existingTitle = target.getAttribute("title");
        if (existingTitle) {
            target.setAttribute("data-tooltip-text", existingTitle);
            target.removeAttribute("title");
        }

        const side = target.closest(
            ".flexlayout__border_right.DigiStudio_AuxiliaryBar"
        )
            ? "right"
            : "left";

        let text = target.getAttribute("data-tooltip-text") || "";
        if (!text) {
            const path = target.getAttribute("data-layout-path");
            const match = path && path.match(/\/tb(\d+)$/);
            if (match) {
                const index = parseInt(match[1], 10);
                let border: FlexLayout.BorderNode | undefined;
                const model = this.props.layoutModels.root;
                if (model) {
                    model.visitNodes(node => {
                        if (
                            !border &&
                            node instanceof FlexLayout.BorderNode &&
                            node.getLocation().getName() === side
                        ) {
                            border = node;
                        }
                    });
                }
                const tabNode = border?.getChildren()[index] as
                    | FlexLayout.TabNode
                    | undefined;
                if (tabNode) {
                    text =
                        tabNode.getHelpText() ||
                        getActivityBarTabTitle(
                            tabNode.getId(),
                            tabNode.getName()
                        );
                }
            }
        }

        if (!text) {
            return;
        }

        clearTimeout(this.hideTimer);
        clearTimeout(this.showTimer);

        const btnRect = target.getBoundingClientRect();
        const wrapperRect = wrapper
            ? wrapper.getBoundingClientRect()
            : { top: 0, left: 0 };

        const top = btnRect.top - wrapperRect.top + btnRect.height / 2;
        const left =
            side === "right"
                ? btnRect.left - wrapperRect.left - 8
                : btnRect.right - wrapperRect.left + 8;

        if (this.state.visible) {
            this.setState({
                visible: true,
                text,
                top,
                left,
                side
            });
        } else {
            this.showTimer = setTimeout(() => {
                this.setState({
                    visible: true,
                    text,
                    top,
                    left,
                    side
                });
            }, 120);
        }
    };

    onMouseOut = (e: MouseEvent) => {
        const target = (e.target as HTMLElement).closest(
            ".flexlayout__border_left.DigiStudio_ActivityBar .flexlayout__border_button, " +
                ".flexlayout__border_right.DigiStudio_AuxiliaryBar .flexlayout__border_button"
        ) as HTMLElement | null;

        if (!target) {
            return;
        }

        const related = e.relatedTarget as HTMLElement | null;
        if (related && target.contains(related)) {
            return;
        }

        const savedTitle = target.getAttribute("data-tooltip-text");
        if (savedTitle) {
            target.setAttribute("title", savedTitle);
        }

        clearTimeout(this.showTimer);
        this.hideTimer = setTimeout(() => {
            this.setState({ visible: false });
        }, 80);
    };

    hideTooltip = (immediate = false) => {
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
        if (immediate) {
            this.setState({ visible: false });
        } else {
            this.hideTimer = setTimeout(() => {
                this.setState({ visible: false });
            }, 80);
        }
    };

    render() {
        const { visible, text, top, left, side } = this.state;
        return (
            <div
                ref={this.containerRef}
                className={classNames("DigiStudio_ActivityBarTooltip", {
                    "is-visible": visible,
                    "is-right": side === "right"
                })}
                style={{
                    top: `${top}px`,
                    left: `${left}px`,
                    opacity: visible ? 1 : 0
                }}
            >
                <div className="DigiStudio_ActivityBarTooltip_Arrow" />
                <span className="DigiStudio_ActivityBarTooltip_Text">
                    {text}
                </span>
            </div>
        );
    }
}

const MissingExtensions = observer(
    class MissingExtensions extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        constructor(props: any) {
            super(props);

            makeObservable(this, {
                installableExtensions: computed
            });
        }

        get installableExtensions() {
            return extensionsManagerStore.extensionsVersionsCatalogBuilder
                .get()
                .filter(extensionsVersions =>
                    this.context.project.missingExtensions.find(
                        missingExtension =>
                            extensionsVersions.versionInFocus.name ==
                            missingExtension.extensionName
                    )
                );
        }

        installExtension = async (extensionToInstall: IExtension) => {
            const progressToastId = notification.info("Updating...", {
                autoClose: false
            });

            await new Promise(resolve => setTimeout(resolve, 500));

            await downloadAndInstallExtension(
                extensionToInstall,
                progressToastId
            );

            if (this.installableExtensions.length == 0) {
                this.context.reloadProject();
            }
        };

        installAll = () => {};

        render() {
            return (
                <div className="EezStudio_ProjectEditor_MissingExtensions">
                    <div className="EezStudio_ProjectEditor_MissingExtensions_Title">
                        <h6>
                            {this.context.project.missingExtensions.length > 1
                                ? "Install missing extensions"
                                : "Install missing extension"}
                            :
                        </h6>
                    </div>
                    <div className="EezStudio_ProjectEditor_MissingExtensions_Body">
                        {this.context.project.missingExtensions.map(
                            extension => {
                                const installableExtension =
                                    this.installableExtensions.find(
                                        installableExtension =>
                                            installableExtension.versionInFocus
                                                .name ===
                                            extension.extensionName
                                    )?.versionInFocus;

                                return (
                                    <div key={extension.extensionName}>
                                        {extension.extensionName}
                                        {installableExtension ? (
                                            <Button
                                                color="primary"
                                                size="small"
                                                onClick={() =>
                                                    this.installExtension(
                                                        installableExtension
                                                    )
                                                }
                                            >
                                                Install
                                            </Button>
                                        ) : (
                                            <div className="unknown-extension">
                                                Unknown extension
                                            </div>
                                        )}
                                    </div>
                                );
                            }
                        )}
                    </div>
                    <div className="EezStudio_ProjectEditor_MissingExtensions_Footer">
                        <Button
                            color="secondary"
                            size="small"
                            onClick={action(() => {
                                this.context.missingExtensionsResolved = true;
                            })}
                        >
                            Edit Project
                        </Button>

                        {this.installableExtensions.length >= 1 && (
                            <Button
                                color="primary"
                                size="small"
                                onClick={this.installAll}
                            >
                                Install All
                            </Button>
                        )}
                    </div>
                </div>
            );
        }
    }
);
