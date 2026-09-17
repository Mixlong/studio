import React from "react";
import ReactDOM from "react-dom";
import {
    action,
    computed,
    makeObservable,
    observable,
    runInAction
} from "mobx";
import { observer } from "mobx-react";
import {
    ButtonAction,
    DropdownIconAction,
    IconAction
} from "eez-studio-ui/action";
import { BuildConfiguration } from "project-editor/project/project";
import { ProjectContext } from "project-editor/project/context";
import { PageTabState } from "project-editor/features/page/PageEditor";
import {
    getChildren,
    getObjectIcon,
    objectToString
} from "project-editor/store";
import { RenderVariableStatus } from "project-editor/features/variable/global-variable-status";
import { FlowTabState } from "project-editor/flow/flow-tab-state";
import { RuntimeType } from "project-editor/project/project-type-traits";
import {
    PROJECT_EDITOR_SCRAPBOOK,
    RUN_ICON
} from "project-editor/ui-components/icons";
import { getEditorComponent } from "./EditorComponentFactory";
import { getId } from "project-editor/core/object";
import type { IObjectVariableValue } from "eez-studio-types";
import { getObjectVariableTypeFromType } from "project-editor/features/variable/value-type";
import {
    isScrapbookItemFilePath,
    showScrapbookManager,
    model as scrapbookModel
} from "project-editor/store/scrapbook";
import { closest } from "eez-studio-shared/dom";
import { isDark } from "eez-studio-shared/color";
import { Icon } from "eez-studio-ui/icon";
import { dockerBuildState } from "project-editor/lvgl/docker-build/docker-build-state";
import { ThemedColorInput } from "project-editor/ui-components/PropertyGrid/ThemedColorInput";

////////////////////////////////////////////////////////////////////////////////

export const Toolbar = observer(
    class Toolbar extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        toolbarRef = React.createRef<HTMLElement>();

        get globalVariableStatuses() {
            let globalVariablesStatus: React.ReactNode[] = [];

            for (const variable of this.context.project.allGlobalVariables) {
                const objectVariableType = getObjectVariableTypeFromType(
                    this.context,
                    variable.type
                );
                if (objectVariableType) {
                    let objectVariableValue: IObjectVariableValue | undefined =
                        this.context.dataContext.get(variable.fullName);

                    if (objectVariableValue) {
                        const managedValue = objectVariableType.getValue
                            ? objectVariableType.getValue(objectVariableValue)
                            : undefined;
                        if (managedValue) {
                            objectVariableValue = managedValue;
                        }
                    }

                    globalVariablesStatus.push(
                        <RenderVariableStatus
                            key={variable.fullName}
                            variable={variable}
                            value={objectVariableValue}
                            onClick={async () => {
                                if (objectVariableType.editConstructorParams) {
                                    const constructorParams =
                                        await objectVariableType.editConstructorParams(
                                            variable,
                                            objectVariableValue?.constructorParams ||
                                                objectVariableValue,
                                            true
                                        );
                                    if (constructorParams !== undefined) {
                                        this.context.runtime!.setObjectVariableValue(
                                            variable.fullName,
                                            objectVariableType.createValue(
                                                constructorParams,
                                                true
                                            )
                                        );
                                    }
                                }
                            }}
                        />
                    );
                }
            }

            return globalVariablesStatus;
        }

        render() {
            const showEditorButtons =
                this.context.context.type != "run-tab" &&
                !this.context.project._isDashboardBuild &&
                !(
                    this.context.runtime &&
                    !this.context.runtime.isDebuggerActive
                );

            const showRunEditSwitchControls =
                this.context.context.type != "run-tab" &&
                !this.context.project._isDashboardBuild &&
                this.context.projectTypeTraits.runtimeType != RuntimeType.NONE;

            const globalVariablesStatuses = this.context.runtime
                ? this.globalVariableStatuses
                : [];

            const showWorkspaceSwitcher =
                this.context.context.type == "project-editor" ||
                this.context.context.type == "run-tab";

            if (
                !showEditorButtons &&
                !showRunEditSwitchControls &&
                globalVariablesStatuses.length == 0 &&
                !showWorkspaceSwitcher
            ) {
                return null;
            }
            return (
                <nav
                    ref={this.toolbarRef}
                    className="EezStudio_ProjectEditor_ToolbarNav"
                >
                    <div className="EezStudio_ProjectEditor_ToolbarNav_LeftGroup">
                        <WorkspaceSwitcher />
                        {showEditorButtons && <EditorButtons />}
                    </div>

                    <ToolbarProjectContext />

                    <div className="EezStudio_ProjectEditor_ToolbarNav_RightGroup">
                        {showRunEditSwitchControls && (
                            <RunEditSwitchControls />
                        )}
                        <div className="EezStudio_ProjectEditor_ToolbarNav_FlowRuntimeControls">
                            {globalVariablesStatuses}
                        </div>
                    </div>
                    <ToolbarTooltip toolbarRef={this.toolbarRef} />
                </nav>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

interface IToolbarTooltipProps {
    toolbarRef: React.RefObject<HTMLElement>;
}

interface IToolbarTooltipState {
    visible: boolean;
    text: string;
    top: number;
    left: number;
    placement: "above" | "below";
}

const TOOLBAR_TOOLTIP_SELECTOR =
    'button[title]:not([title=""]), select[title]:not([title=""]), ' +
    'button[data-toolbar-tooltip-text]:not([data-toolbar-tooltip-text=""]), ' +
    'select[data-toolbar-tooltip-text]:not([data-toolbar-tooltip-text=""])';
const TOOLBAR_TOOLTIP_DATA_ATTRIBUTE = "data-toolbar-tooltip-text";
const TOOLBAR_TOOLTIP_ARIA_ATTRIBUTE = "data-toolbar-tooltip-aria-label";

/**
 * A single delegated tooltip keeps the toolbar quiet and prevents native
 * browser tooltips from competing with the IDE-style hint.
 */
class ToolbarTooltip extends React.Component<
    IToolbarTooltipProps,
    IToolbarTooltipState
> {
    state: IToolbarTooltipState = {
        visible: false,
        text: "",
        top: 0,
        left: 0,
        placement: "below"
    };

    tooltipRef = React.createRef<HTMLDivElement>();
    toolbarElement: HTMLElement | null = null;
    activeTarget: HTMLElement | null = null;
    hideTimer: any = null;
    showTimer: any = null;
    bindTimer: any = null;

    componentDidMount() {
        // The portal mounts before the parent nav ref is consistently available
        // in React's commit phase, so bind once on the next task as a fallback.
        this.bindTimer = setTimeout(this.bindToolbarListeners, 0);
    }

    bindToolbarListeners = () => {
        this.bindTimer = null;
        this.toolbarElement = this.props.toolbarRef.current;
        if (!this.toolbarElement) {
            return;
        }

        this.toolbarElement.addEventListener("mouseover", this.onMouseOver);
        this.toolbarElement.addEventListener("mouseout", this.onMouseOut);
        this.toolbarElement.addEventListener("focusin", this.onFocusIn);
        this.toolbarElement.addEventListener("focusout", this.onFocusOut);
        this.toolbarElement.addEventListener("mousedown", this.onMouseDown);
        window.addEventListener("resize", this.onWindowChange);
        window.addEventListener("scroll", this.onWindowChange, true);
    }

    componentDidUpdate(
        previousProps: IToolbarTooltipProps,
        previousState: IToolbarTooltipState
    ) {
        if (
            this.state.visible &&
            (!previousState.visible || previousState.text !== this.state.text)
        ) {
            this.adjustTooltipPosition();
        }
    }

    componentWillUnmount() {
        clearTimeout(this.bindTimer);
        if (this.toolbarElement) {
            this.toolbarElement.removeEventListener(
                "mouseover",
                this.onMouseOver
            );
            this.toolbarElement.removeEventListener(
                "mouseout",
                this.onMouseOut
            );
            this.toolbarElement.removeEventListener(
                "focusin",
                this.onFocusIn
            );
            this.toolbarElement.removeEventListener(
                "focusout",
                this.onFocusOut
            );
            this.toolbarElement.removeEventListener(
                "mousedown",
                this.onMouseDown
            );
        }
        window.removeEventListener("resize", this.onWindowChange);
        window.removeEventListener("scroll", this.onWindowChange, true);
        this.restoreTitle(this.activeTarget);
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
    }

    getTarget = (eventTarget: EventTarget | null) => {
        if (!(eventTarget instanceof Element) || !this.toolbarElement) {
            return null;
        }

        const target = eventTarget.closest(TOOLBAR_TOOLTIP_SELECTOR);
        return target && this.toolbarElement.contains(target)
            ? (target as HTMLElement)
            : null;
    };

    getText = (target: HTMLElement) => {
        return (
            target.getAttribute("title") ||
            target.getAttribute(TOOLBAR_TOOLTIP_DATA_ATTRIBUTE) ||
            ""
        ).trim();
    };

    suppressNativeTitle = (target: HTMLElement, text: string) => {
        if (target.hasAttribute("title")) {
            target.setAttribute(TOOLBAR_TOOLTIP_DATA_ATTRIBUTE, text);
            if (!target.hasAttribute("aria-label")) {
                target.setAttribute("aria-label", text);
                target.setAttribute(TOOLBAR_TOOLTIP_ARIA_ATTRIBUTE, "true");
            }
            target.removeAttribute("title");
        }
    };

    restoreTitle = (target: HTMLElement | null) => {
        if (!target) {
            return;
        }

        const savedTitle = target.getAttribute(TOOLBAR_TOOLTIP_DATA_ATTRIBUTE);
        if (savedTitle !== null) {
            target.setAttribute("title", savedTitle);
            target.removeAttribute(TOOLBAR_TOOLTIP_DATA_ATTRIBUTE);
            if (target.hasAttribute(TOOLBAR_TOOLTIP_ARIA_ATTRIBUTE)) {
                target.removeAttribute("aria-label");
                target.removeAttribute(TOOLBAR_TOOLTIP_ARIA_ATTRIBUTE);
            }
        }
    };

    showForTarget = (target: HTMLElement) => {
        const text = this.getText(target);
        if (!text) {
            return;
        }

        if (this.activeTarget && this.activeTarget !== target) {
            this.restoreTitle(this.activeTarget);
        }
        this.activeTarget = target;
        this.suppressNativeTitle(target, text);

        clearTimeout(this.hideTimer);
        clearTimeout(this.showTimer);

        const rect = target.getBoundingClientRect();
        const placement: IToolbarTooltipState["placement"] =
            rect.bottom + 44 <= window.innerHeight ? "below" : "above";
        const top = placement === "below" ? rect.bottom + 8 : rect.top - 8;

        if (this.state.visible) {
            this.setState(
                {
                    visible: true,
                    text,
                    top,
                    left: rect.left + rect.width / 2,
                    placement
                },
                this.adjustTooltipPosition
            );
        } else {
            this.showTimer = setTimeout(() => {
                if (this.activeTarget !== target) {
                    return;
                }

                this.setState(
                    {
                        visible: true,
                        text,
                        top,
                        left: rect.left + rect.width / 2,
                        placement
                    },
                    this.adjustTooltipPosition
                );
            }, 140);
        }
    };

    hideForTarget = (target: HTMLElement) => {
        this.restoreTitle(target);
        if (this.activeTarget !== target) {
            return;
        }

        this.activeTarget = null;
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => {
            this.setState({ visible: false });
        }, 80);
    };

    onMouseOver = (event: MouseEvent) => {
        const target = this.getTarget(event.target);
        if (!target) {
            return;
        }

        const relatedTarget = event.relatedTarget as Node | null;
        if (relatedTarget && target.contains(relatedTarget)) {
            return;
        }

        this.showForTarget(target);
    };

    onMouseOut = (event: MouseEvent) => {
        const target = this.getTarget(event.target);
        if (!target) {
            return;
        }

        const relatedTarget = event.relatedTarget as Node | null;
        if (relatedTarget && target.contains(relatedTarget)) {
            return;
        }

        this.hideForTarget(target);
    };

    onFocusIn = (event: FocusEvent) => {
        const target = this.getTarget(event.target);
        if (target) {
            this.showForTarget(target);
        }
    };

    onFocusOut = (event: FocusEvent) => {
        const target = this.getTarget(event.target);
        if (target) {
            this.hideForTarget(target);
        }
    };

    onMouseDown = () => {
        clearTimeout(this.showTimer);
        clearTimeout(this.hideTimer);
        this.restoreTitle(this.activeTarget);
        this.activeTarget = null;
        this.setState({ visible: false });
    };

    onWindowChange = () => {
        if (this.state.visible && this.activeTarget) {
            this.updateTooltipPosition(this.activeTarget);
        }
    };

    updateTooltipPosition = (target: HTMLElement) => {
        const rect = target.getBoundingClientRect();
        const placement: IToolbarTooltipState["placement"] =
            rect.bottom + 44 <= window.innerHeight ? "below" : "above";

        this.setState({
            top: placement === "below" ? rect.bottom + 8 : rect.top - 8,
            left: rect.left + rect.width / 2,
            placement
        }, this.adjustTooltipPosition);
    };

    adjustTooltipPosition = () => {
        if (!this.state.visible || !this.tooltipRef.current) {
            return;
        }

        const tooltipRect = this.tooltipRef.current.getBoundingClientRect();
        const margin = 10;
        let left = this.state.left;
        let top = this.state.top;
        let placement = this.state.placement;

        if (tooltipRect.left < margin) {
            left += margin - tooltipRect.left;
        } else if (tooltipRect.right > window.innerWidth - margin) {
            left -= tooltipRect.right - (window.innerWidth - margin);
        }

        if (
            placement === "below" &&
            tooltipRect.bottom > window.innerHeight - margin &&
            this.activeTarget
        ) {
            const targetRect = this.activeTarget.getBoundingClientRect();
            placement = "above";
            top = targetRect.top - 8;
        } else if (
            placement === "above" &&
            tooltipRect.top < margin &&
            this.activeTarget
        ) {
            const targetRect = this.activeTarget.getBoundingClientRect();
            placement = "below";
            top = targetRect.bottom + 8;
        }

        if (
            left !== this.state.left ||
            top !== this.state.top ||
            placement !== this.state.placement
        ) {
            this.setState({ left, top, placement });
        }
    };

    render() {
        if (typeof document === "undefined") {
            return null;
        }

        const { visible, text, top, left, placement } = this.state;
        return ReactDOM.createPortal(
            <div
                ref={this.tooltipRef}
                className={`EezStudio_ProjectEditor_ToolbarTooltip is-${placement}`}
                role="tooltip"
                aria-hidden={!visible}
                style={{
                    top: `${top}px`,
                    left: `${left}px`,
                    opacity: visible ? 1 : 0
                }}
            >
                <span className="EezStudio_ProjectEditor_ToolbarTooltip_Text">
                    {text}
                </span>
            </div>,
            document.body
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

const ToolbarProjectContext = observer(
    class ToolbarProjectContext extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        render() {
            const bspName =
                this.context.project.embeddedPlatform?.bsp?.name ||
                "No target configured";

            return (
                <div
                    className="EezStudio_ProjectEditor_ToolbarNav_ProjectContext"
                    title={`${this.context.title} - ${bspName}`}
                >
                    <span className="ProjectContext_ProjectName">
                        {this.context.title}
                    </span>
                    <span className="ProjectContext_Separator" aria-hidden="true">
                        ·
                    </span>
                    <span className="ProjectContext_TargetName">{bspName}</span>
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const WorkspaceSwitcher = observer(
    class WorkspaceSwitcher extends React.Component {
        render() {
            // Resolve lazily to avoid eagerly coupling the editor toolbar to the
            // tab store while the project editor is being bootstrapped.
            const { tabs } = require("home/tabs-store") as typeof import("home/tabs-store");

            if (!tabs) {
                return null;
            }

            return (
                <DropdownIconAction
                    className="EezStudio_ProjectEditor_WorkspaceSwitcher"
                    icon="material:apps"
                    iconSize={18}
                    title="Switch workspace"
                >
                    <div className="EezStudio_ProjectEditor_WorkspaceMenu">
                        <div className="EezStudio_ProjectEditor_WorkspaceMenuHeader">
                            Open workspaces
                        </div>
                        {tabs.tabs.map(tab => (
                            <div
                                className="EezStudio_ProjectEditor_WorkspaceMenuRow"
                                key={tab.id}
                            >
                                <button
                                    type="button"
                                    className={
                                        "dropdown-item EezStudio_ProjectEditor_WorkspaceMenuItem" +
                                        (tab === tabs.activeTab ? " active" : "")
                                    }
                                    title={tab.titleStr}
                                    onClick={() => tab.makeActive()}
                                >
                                    <Icon
                                        icon={
                                            tab.icon ||
                                            "material:description"
                                        }
                                        size={17}
                                    />
                                    <span>{tab.titleStr}</span>
                                    {tab === tabs.activeTab && (
                                        <Icon icon="material:check" size={16} />
                                    )}
                                </button>
                                {tab.close && (
                                    <button
                                        type="button"
                                        className="EezStudio_ProjectEditor_WorkspaceMenuClose"
                                        title={`Close ${tab.titleStr}`}
                                        aria-label={`Close ${tab.titleStr}`}
                                        onClick={event => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            tab.close!();
                                        }}
                                    >
                                        <Icon icon="material:close" size={16} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </DropdownIconAction>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const EditorButtons = observer(
    class EditorButtons extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        constructor(props: any) {
            super(props);

            makeObservable(this, {
                featureItems: computed
            });
        }

        setFrontFace = action((enabled: boolean) => {
            if (this.pageTabState) {
                this.pageTabState.frontFace = enabled;
            }
        });

        get pageTabState() {
            const editorState = this.context.editorsStore.activeEditor?.state;
            if (editorState instanceof PageTabState) {
                return editorState as PageTabState;
            }
            return undefined;
        }

        get flowTabState() {
            const editorState = this.context.editorsStore.activeEditor?.state;
            if (editorState instanceof FlowTabState) {
                return editorState as FlowTabState;
            }
            return undefined;
        }

        get isBuildConfigurationSelectorVisible() {
            return false;
        }

        onSelectedBuildConfigurationChange(event: any) {
            this.context.uiStateStore.setSelectedBuildConfiguration(
                event.target.value
            );
        }

        toggleShowTimeline = action(() => {
            if (this.pageTabState) {
                this.pageTabState.timeline.isEditorActive =
                    !this.pageTabState.timeline.isEditorActive;
            }
        });

        get isShowTimeline() {
            if (this.pageTabState) {
                return this.pageTabState.timeline.isEditorActive;
            }
            return false;
        }

        get featureItems() {
            if (this.context.runtime) {
                return undefined;
            }

            let featureItems = getChildren(this.context.project).filter(
                object =>
                    getObjectIcon(object) &&
                    getEditorComponent(object, undefined) &&
                    !(
                        object == this.context.project.userPages ||
                        object == this.context.project.userWidgets ||
                        object == this.context.project.actions ||
                        object == this.context.project.variables ||
                        object == this.context.project.styles ||
                        object == this.context.project.lvglStyles ||
                        object == this.context.project.fonts ||
                        object == this.context.project.bitmaps ||
                        object == this.context.project.texts ||
                        object == this.context.project.scpi ||
                        object == this.context.project.extensionDefinitions ||
                        object == this.context.project.changes
                    )
            );

            // push Settings to the end
            if (featureItems) {
                const settingsIndex = featureItems.findIndex(
                    item => item == this.context.project.settings
                );
                if (settingsIndex != -1) {
                    featureItems.splice(settingsIndex, 1);
                    featureItems.push(this.context.project.settings);
                }
            }

            return featureItems;
        }

        render() {
            let configurations =
                this.context.project.settings.build.configurations.map(
                    (item: BuildConfiguration) => {
                        return (
                            <option key={item.name} value={item.name}>
                                {objectToString(item)}
                            </option>
                        );
                    }
                );

            return (
                <div className="EezStudio_ProjectEditor_ToolbarNav_EditorButtons">
                    {!this.context.runtime && (
                        <div className="btn-group" role="group">
                            <IconAction
                                title="Save"
                                icon="material:save"
                                onClick={() => this.context.save()}
                                enabled={this.context.isModified}
                            />
                        </div>
                    )}

                    {!this.context.runtime && (
                        <>
                            <div className="btn-group" role="group">
                                <IconAction
                                    title={
                                        this.context.undoManager.canUndo
                                            ? `Undo "${this.context.undoManager.undoDescription}"`
                                            : "Undo"
                                    }
                                    icon="material:undo"
                                    onClick={() =>
                                        this.context.undoManager.undo()
                                    }
                                    enabled={this.context.undoManager.canUndo}
                                />
                                <IconAction
                                    title={
                                        this.context.undoManager.canRedo
                                            ? `Redo "${this.context.undoManager.redoDescription}"`
                                            : "Redo"
                                    }
                                    icon="material:redo"
                                    onClick={() =>
                                        this.context.undoManager.redo()
                                    }
                                    enabled={this.context.undoManager.canRedo}
                                />
                            </div>

                            <div className="btn-group" role="group">
                                {false && (
                                    <IconAction
                                        title="Cut"
                                        icon="material:content_cut"
                                        iconSize={22}
                                        onClick={this.context.cut}
                                        enabled={this.context.canCut}
                                    />
                                )}
                                <IconAction
                                    title="Copy"
                                    icon="material:content_copy"
                                    iconSize={22}
                                    onClick={this.context.copy}
                                    enabled={this.context.canCopy}
                                />
                                <IconAction
                                    title="Paste"
                                    icon="material:content_paste"
                                    iconSize={22}
                                    onClick={this.context.paste}
                                    enabled={this.context.canPaste}
                                />
                            </div>
                            <div className="btn-group" role="group">
                                <IconAction
                                    title="Scrapbook"
                                    icon={PROJECT_EDITOR_SCRAPBOOK}
                                    iconSize={24}
                                    onClick={() => showScrapbookManager()}
                                    selected={scrapbookModel.isVisible}
                                />
                            </div>
                        </>
                    )}

                    {!this.context.runtime &&
                        this.isBuildConfigurationSelectorVisible && (
                            <div className="btn-group">
                                <select
                                    title="Configuration"
                                    id="btn-toolbar-configuration"
                                    className="form-select"
                                    value={
                                        this.context.uiStateStore
                                            .selectedBuildConfiguration
                                    }
                                    onChange={this.onSelectedBuildConfigurationChange.bind(
                                        this
                                    )}
                                >
                                    {configurations}
                                </select>
                            </div>
                        )}

                    {!this.context.runtime && (
                        <div className="btn-group" role="group">
                            {!this.context.projectTypeTraits.isDashboard && (
                                <IconAction
                                    title="Check"
                                    icon="material:check"
                                    onClick={() => this.context.check()}
                                    enabled={this.context.project._fullyLoaded}
                                />
                            )}
                            {!(
                                this.context.filePath &&
                                isScrapbookItemFilePath(this.context.filePath)
                            ) && (
                                <IconAction
                                    title="Build"
                                    icon="material:build"
                                    onClick={() => this.context.build()}
                                    enabled={this.context.project._fullyLoaded}
                                />
                            )}
                        </div>
                    )}

                    {this.context.projectTypeTraits.isResource &&
                        this.context.project.micropython && (
                            <div className="btn-group" role="group">
                                <IconAction
                                    title="Run MicroPython Script"
                                    icon={RUN_ICON}
                                    iconSize={28}
                                    onClick={() =>
                                        this.context.project.micropython.runScript()
                                    }
                                    enabled={this.context.project._fullyLoaded}
                                />
                            </div>
                        )}

                    {this.context.projectTypeTraits.hasFlowSupport && (
                        <>
                            {this.pageTabState && (
                                <>
                                    <div className="btn-group" role="group">
                                        <IconAction
                                            title="Show front face"
                                            icon="material:flip_to_front"
                                            iconSize={20}
                                            onClick={() =>
                                                this.setFrontFace(true)
                                            }
                                            selected={
                                                this.pageTabState.frontFace
                                            }
                                        />
                                        <IconAction
                                            title="Show back face"
                                            icon="material:flip_to_back"
                                            iconSize={20}
                                            onClick={() =>
                                                this.setFrontFace(false)
                                            }
                                            selected={
                                                !this.pageTabState.frontFace
                                            }
                                        />
                                    </div>

                                    {!this.flowTabState?.flowState && (
                                        <div className="btn-group" role="group">
                                            <IconAction
                                                title="Show timeline"
                                                icon={
                                                    <svg viewBox="0 0 551 372">
                                                        <path d="M42.4631 336.4972H204.996v-42.4224h-65.4195v-60.132h65.4195v-42.4495H0l.0008 145.005zm-.0045-102.5747H99.046v60.132H42.4586zm233.9184-42.4632v42.4405h61.8929v60.132h-61.893v42.4405h61.352l42.4247.009h171.5298v-145.013zM442.0555 294.007h-61.893v-60.132h61.893zm67.1986 0h-24.74v-60.132h24.74z" />
                                                        <path d="M348.4318 42.4321c0-10.8489-4.1291-21.7155-12.4228-30.0003C327.7332 4.138 316.8667.009 306.0177.009L176.8741 0c-10.849 0-21.7243 4.129-30.0185 12.4227-8.2757 8.2937-12.7264 19.1555-12.4227 30.0004v53.5542l85.791 54.0862v221.6388h42.4495V150.0637l85.7751-54.0861.009-53.5362z" />
                                                    </svg>
                                                }
                                                iconSize={24}
                                                onClick={() =>
                                                    this.toggleShowTimeline()
                                                }
                                                selected={this.isShowTimeline}
                                            />
                                        </div>
                                    )}
                                </>
                            )}

                            {(this.flowTabState ||
                                (this.pageTabState &&
                                    !this.pageTabState.frontFace)) && (
                                <div className="btn-group" role="group">
                                    <IconAction
                                        title="Show component descriptions"
                                        icon="material:comment"
                                        iconSize={20}
                                        onClick={action(
                                            () =>
                                                (this.context.uiStateStore.showComponentDescriptions =
                                                    !this.context.uiStateStore
                                                        .showComponentDescriptions)
                                        )}
                                        selected={
                                            this.context.uiStateStore
                                                .showComponentDescriptions
                                        }
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {!this.context.runtime &&
                        this.context.project.texts?.languages.length > 0 && (
                            <div className="btn-group" role="group">
                                <SelectLanguage />
                            </div>
                        )}

                    {this.featureItems && (
                        <div className="btn-group" role="group">
                            {this.featureItems.map(featureItem => {
                                const title = objectToString(featureItem);

                                let icon = getObjectIcon(featureItem);

                                const editorComponent = getEditorComponent(
                                    featureItem,
                                    undefined
                                )!;

                                const onClick = action(() => {
                                    if (editorComponent) {
                                        this.context.editorsStore.openEditor(
                                            editorComponent.object,
                                            editorComponent.subObject
                                        );
                                    }
                                });

                                const isActive =
                                    editorComponent &&
                                    this.context.editorsStore.activeEditor &&
                                    this.context.editorsStore.getEditorByObject(
                                        editorComponent.object
                                    ) == this.context.editorsStore.activeEditor;

                                return (
                                    <IconAction
                                        key={getId(featureItem)}
                                        title={title}
                                        icon={icon}
                                        onClick={onClick}
                                        enabled={!isActive}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {this.pageTabState && (
                        <PageZoomButton pageTabState={this.pageTabState} />
                    )}

                    {this.pageTabState &&
                        this.pageTabState.page.isUsedAsUserWidget && (
                            <PreviewBackgroundColorButton
                                pageTabState={this.pageTabState}
                            />
                        )}
                </div>
            );
        }
    }
);

const SelectLanguage = observer(
    class SelectLanguage extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        render() {
            return (
                <select
                    className="form-select"
                    title="Select language"
                    value={
                        this.context.uiStateStore.selectedLanguage.languageID
                    }
                    onChange={action(
                        (event: React.ChangeEvent<HTMLSelectElement>) =>
                            (this.context.uiStateStore.selectedLanguageID =
                                event.currentTarget.value)
                    )}
                    style={{ width: "fit-content" }}
                >
                    {this.context.project.texts.languages.map(language => (
                        <option
                            key={language.languageID}
                            value={language.languageID}
                        >
                            {language.languageID}
                        </option>
                    ))}
                </select>
            );
        }
    }
);

const PreviewBackgroundColorButton = observer(
    class PreviewBackgroundColorButton extends React.Component<{
        pageTabState: PageTabState;
    }> {
        onChange = action((newValue: any) => {
            this.props.pageTabState.previewBackgroundColor = newValue;
        });

        onReset = action(() => {
            this.props.pageTabState.previewBackgroundColor = undefined;
        });

        render() {
            const { previewBackgroundColor } = this.props.pageTabState;

            const iconColor = previewBackgroundColor
                ? isDark(previewBackgroundColor)
                    ? "#fff"
                    : "#000"
                : undefined;

            return (
                <div
                    className="btn-group EezStudio_ProjectEditor_PreviewBackgroundColor"
                    role="group"
                    title="Preview background color (this editor session only)"
                >
                    <div className="EezStudio_ProjectEditor_PreviewBackgroundColor_Swatch">
                        <ThemedColorInput
                            value={
                                previewBackgroundColor
                            }
                            onChange={this.onChange}
                            readOnly={false}
                            simpleMode={true}
                        />
                        <Icon
                            icon="material:format_color_fill"
                            size={20}
                            className="EezStudio_ProjectEditor_PreviewBackgroundColor_Icon"
                            style={iconColor ? { color: iconColor } : undefined}
                        />
                    </div>

                    {previewBackgroundColor && (
                        <IconAction
                            title="Reset preview background color"
                            icon="material:close"
                            iconSize={16}
                            onClick={this.onReset}
                        />
                    )}
                </div>
            );
        }
    }
);

const PageZoomButton = observer(
    class PageZoomButton extends React.Component<{
        pageTabState: PageTabState;
    }> {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        buttonRef = React.createRef<HTMLButtonElement>();

        dropDownRef = React.createRef<HTMLDivElement>();

        dropDownOpen: boolean | undefined = false;
        dropDownLeft = 0;
        dropDownTop = 0;
        dropDownWidth = 0;

        zoomInput: string | undefined;

        constructor(props: any) {
            super(props);

            makeObservable(this, {
                dropDownOpen: observable,
                dropDownLeft: observable,
                dropDownTop: observable,
                dropDownWidth: observable,
                zoomInput: observable
            });
        }

        get zoom() {
            return this.globalZoom
                ? this.context.uiStateStore.flowZoom
                : this.props.pageTabState.transform.scale;
        }

        set zoom(value: number) {
            runInAction(() => {
                this.context.uiStateStore.flowZoom = value;
            });

            if (!this.globalZoom) {
                const newTransform = this.props.pageTabState.transform.clone();
                newTransform.scale = value;
                runInAction(() => {
                    this.props.pageTabState.transform = newTransform;
                });
            }
        }

        get globalZoom() {
            return this.context.uiStateStore.globalFlowZoom;
        }

        set globalZoom(value: boolean) {
            runInAction(() => {
                if (value) {
                    this.context.uiStateStore.flowZoom = this.zoom;
                } else {
                    for (const page of this.context.project.pages) {
                        if (page == this.props.pageTabState.flow) {
                            const newTransform =
                                this.props.pageTabState.transform.clone();
                            newTransform.scale = this.zoom;
                            runInAction(() => {
                                this.props.pageTabState.transform =
                                    newTransform;
                            });
                        } else {
                            let uiState =
                                this.context.uiStateStore.getObjectUIState(
                                    page,
                                    "flow-state"
                                );

                            if (!uiState) {
                                uiState = {};
                            }

                            uiState.transform = {
                                translate: uiState.transform?.translate,
                                scale: this.zoom
                            };

                            runInAction(() => {
                                this.context.uiStateStore.updateObjectUIState(
                                    page,
                                    "flow-state",
                                    uiState
                                );
                            });
                        }
                    }
                }

                this.context.uiStateStore.globalFlowZoom = value;
            });
        }

        setDropDownOpen = action((open: boolean) => {
            if (this.dropDownOpen === false) {
                document.removeEventListener(
                    "pointerdown",
                    this.onDocumentPointerDown,
                    true
                );
            }

            this.dropDownOpen = open;

            if (this.dropDownOpen) {
                document.addEventListener(
                    "pointerdown",
                    this.onDocumentPointerDown,
                    true
                );
            }
        });

        openDropdown = action(() => {
            const buttonEl = this.buttonRef.current;
            if (!buttonEl) {
                return;
            }

            const dropDownEl = this.dropDownRef.current;
            if (!dropDownEl) {
                return;
            }

            this.setDropDownOpen(!this.dropDownOpen);

            if (this.dropDownOpen) {
                const rectInputGroup =
                    buttonEl.parentElement!.getBoundingClientRect();

                this.dropDownLeft = rectInputGroup.left;
                this.dropDownTop = rectInputGroup.bottom;
                this.dropDownWidth = rectInputGroup.width;

                if (
                    this.dropDownLeft + this.dropDownWidth >
                    window.innerWidth
                ) {
                    this.dropDownLeft = window.innerWidth - this.dropDownWidth;
                }

                const DROP_DOWN_HEIGHT = 270;
                if (
                    this.dropDownTop + DROP_DOWN_HEIGHT + 20 >
                    window.innerHeight
                ) {
                    this.dropDownTop =
                        window.innerHeight - (DROP_DOWN_HEIGHT + 20);
                }
            }
        });

        onDocumentPointerDown = action((event: MouseEvent) => {
            if (this.dropDownOpen) {
                if (
                    !closest(
                        event.target,
                        el =>
                            this.buttonRef.current == el ||
                            this.dropDownRef.current == el
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.setDropDownOpen(false);
                }
            }
        });

        render() {
            const portal = ReactDOM.createPortal(
                <div
                    ref={this.dropDownRef}
                    className="dropdown-menu dropdown-menu-end EezStudio_PageZoomButton_DropdownContent shadow rounded"
                    style={{
                        display: this.dropDownOpen ? "block" : "none",
                        left: this.dropDownLeft,
                        top: this.dropDownTop,
                        width: this.dropDownWidth
                    }}
                >
                    <ul>
                        <div className="EezStudio_PageZoomButton_DropdownContent_ZoomInput">
                            <input
                                type="text"
                                className="form-control"
                                value={
                                    this.zoomInput ??
                                    `${Math.round(this.zoom * 100)}%`
                                }
                                onChange={action(event => {
                                    this.zoomInput = event.target.value;
                                })}
                                onKeyDown={event => {
                                    if (event.key === "Enter") {
                                        let value = parseInt(
                                            this.zoomInput!.replace("%", "")
                                        );
                                        if (value) {
                                            if (value < 5) value = 5;
                                            else if (value > 1600) value = 1600;

                                            this.zoom = value / 100;
                                        }
                                        this.zoomInput = undefined;
                                        this.setDropDownOpen(false);
                                    }
                                }}
                            />
                        </div>
                        <hr className="dropdown-divider" />
                        {[10, 25, 50, 75, 100, 150, 200, 400, 800, 1600].map(
                            zoom => (
                                <li
                                    key={zoom}
                                    className="EezStudio_PageZoomButton_DropdownContent_MenuItem"
                                    onClick={() => {
                                        this.zoom = zoom / 100;
                                        this.setDropDownOpen(false);
                                    }}
                                >
                                    Zoom to {zoom}%
                                </li>
                            )
                        )}
                        <hr className="dropdown-divider" />
                        <li
                            className="EezStudio_PageZoomButton_DropdownContent_Checkmark"
                            onClick={() => {
                                this.globalZoom = !this.globalZoom;
                                this.setDropDownOpen(false);
                            }}
                        >
                            {this.globalZoom ? (
                                <Icon icon="material:check_box" size={20} />
                            ) : (
                                <Icon
                                    icon="material:check_box_outline_blank"
                                    size={20}
                                />
                            )}
                            <span style={{ paddingLeft: 2 }}>Global zoom</span>
                        </li>
                    </ul>
                </div>,
                document.body
            );

            return (
                <div className="btn-group" role="group">
                    <button
                        ref={this.buttonRef}
                        className="btn btn-primary dropdown-toggle EezStudio_PageZoomButton"
                        type="button"
                        title="Change zoom level"
                        aria-label="Change zoom level"
                        onClick={this.openDropdown}
                    >
                        {Math.round(this.zoom * 100)}%
                    </button>
                    {portal}
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const RunEditSwitchControls = observer(
    class RunEditSwitchControls extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        get showFullSimulatorButton() {
            const projectStore = this.context;
            return (
                projectStore.projectTypeTraits.isLVGL &&
                projectStore.project.settings.build.useDockerDesktop
            );
        }

        get isFullSimulatorMode() {
            return this.context.layoutModels.isDockerSimulatorMode;
        }

        get isFullSimulatorBuilding() {
            const previewStore = dockerBuildState.getProjectState(
                this.context.filePath
            );
            return previewStore.state === "building";
        }

        render() {
            const iconSize = 18;
            const isExecuting =
                !!this.context.runtime || this.isFullSimulatorMode;

            return (
                <div className="EezStudio_ProjectEditor_ToolbarNav_RunEditSwitchControls">
                    {isExecuting ? (
                        <ButtonAction
                            className="DigiStudio_StopExecution"
                            text="Stop"
                            title="Stop and return to editor (Shift+F5)"
                            icon="material:stop"
                            iconSize={iconSize}
                            onClick={this.context.onSetEditorMode}
                        />
                    ) : (
                        <>
                            <ButtonAction
                                className="DigiStudio_RunAction"
                                text="Run"
                                title="Enter run mode (F5)"
                                icon={RUN_ICON}
                                iconSize={iconSize}
                                onClick={this.context.onSetRuntimeMode}
                            />

                            <ButtonAction
                                text="Debug"
                                title="Enter debug mode (Ctrl+F5)"
                                icon="material:bug_report"
                                iconSize={iconSize}
                                onClick={this.context.onSetDebuggerMode}
                            />

                            {this.showFullSimulatorButton && (
                                <ButtonAction
                                    text="Full Sim"
                                    title="Run in Full Simulator (F7)"
                                    icon="material:computer"
                                    iconSize={iconSize}
                                    onClick={
                                        this.context.onSetFullSimulatorMode
                                    }
                                    loader={this.isFullSimulatorBuilding}
                                />
                            )}
                        </>
                    )}
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////
