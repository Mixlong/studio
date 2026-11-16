import { MenuItem } from "@electron/remote";
import React from "react";
import { action, computed, makeObservable, observable, runInAction, toJS, untracked } from "mobx";
import classNames from "classnames";
import { observer } from "mobx-react";
import * as FlexLayout from "flexlayout-react";

import { validators } from "eez-studio-shared/validation";

import { FlexLayoutContainer } from "eez-studio-ui/FlexLayout";
import { Dialog, showDialog } from "eez-studio-ui/dialog";

import {
    ClassInfo,
    EezObject,
    getClassesDerivedFrom,
    getParent,
    IEezObject,
    IMessage,
    PropertyProps,
    PropertyType,
    registerClass
} from "project-editor/core/object";
import { LVGLStylesDefinitionProperty } from "project-editor/lvgl/LVGLStylesDefinitionProperty";
import { ProjectContext } from "project-editor/project/context";
import { extractAnimProperties, LVGLStylesDefinition } from "project-editor/lvgl/style-definition";
import { ProjectEditor } from "project-editor/project-editor-interface";
import { createObject } from "project-editor/store";
import {
    getComponentGroupDisplayName,
    getComponentGroupName,
    getComponentName,
    getComponentVisualData
} from "project-editor/flow/components/components-registry";
import { getComponentMaterialIcon } from "project-editor/flow/components/component-icons";
import { LVGLStylesEditorRuntime } from "project-editor/lvgl/page-runtime";
import { Checkbox } from "project-editor/ui-components/PropertyGrid/Checkbox";
import { Icon } from "eez-studio-ui/icon";
import type { ProjectEditorFeature } from "project-editor/store/features";
import { LVGLStylesTreeNavigation } from "project-editor/lvgl/LVGLStylesTreeNavigation";
import type { LVGLPageRuntime } from "project-editor/lvgl/page-runtime";
import {
    findBitmap,
    findFont,
    ProjectType,
    type Project
} from "project-editor/project/project";
import { getSelectorCode } from "project-editor/lvgl/style-helper";
import {
    BUILT_IN_FONTS,
    lvglPropertiesMap,
    text_font_property_info
} from "project-editor/lvgl/style-catalog";
import { LVGL_STYLE_PROP_CODES } from "project-editor/lvgl/lvgl-constants";

////////////////////////////////////////////////////////////////////////////////

export type LVGLStyleObjects = {
    [part: string]: {
        [state: string]: number;
    };
};

////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////

interface StyleWidgetOption {
    id: string;
    label: string;
    group: string;
    icon: React.ReactNode;
}

const NewStyleDialog = observer(
    class NewStyleDialog extends React.Component<{
        project: Project;
        parent: IEezObject;
        defaultWidgetType: string;
        lockedWidgetType?: string;
        parentStyleName?: string;
        onOk: (result: { name: string; forWidgetType: string }) => void;
        onCancel: () => void;
    }> {
        open = true;
        name = "";
        forWidgetType: string;
        searchText = "";
        selectedCategory = "All";
        nameError: string | undefined;
        submitted = false;
        nameInputRef = React.createRef<HTMLInputElement>();

        constructor(props: any) {
            super(props);

            this.forWidgetType =
                props.lockedWidgetType ||
                props.defaultWidgetType ||
                "LVGLPanelWidget";

            makeObservable(this, {
                open: observable,
                name: observable,
                forWidgetType: observable,
                searchText: observable,
                selectedCategory: observable,
                nameError: observable,
                submitted: observable,
                widgetOptions: computed,
                categories: computed,
                filteredOptions: computed,
                groupedOptions: computed,
                selectedWidgetOption: computed,
                validateName: action,
                onNameChange: action.bound,
                onSelectWidget: action.bound,
                onSelectCategory: action.bound,
                onSearchChange: action.bound,
                onClearSearch: action.bound,
                handleOk: action.bound,
                handleCancel: action.bound
            });
        }

        componentDidMount() {
            setTimeout(() => {
                this.nameInputRef.current?.focus();
            }, 50);
        }

        get widgetOptions(): StyleWidgetOption[] {
            const projectStore = this.props.project._store;
            const classes = getClassesDerivedFrom(
                projectStore,
                ProjectEditor.LVGLWidgetClass
            ).filter(componentClass => {
                if (componentClass.name === "LVGLUserWidgetWidget") {
                    return false;
                }
                if (componentClass.name === "LVGLScreenWidget") {
                    return true;
                }
                const enabled =
                    componentClass.objectClass.classInfo
                        .enabledInComponentPalette;
                return enabled
                    ? enabled(ProjectType.LVGL, projectStore)
                    : true;
            });

            return classes.map(componentClass => {
                const { icon, label } = getComponentVisualData(
                    componentClass,
                    projectStore
                );
                const rawGroup =
                    componentClass.name === "LVGLScreenWidget"
                        ? "!1Basic"
                        : getComponentGroupName(componentClass);
                const group =
                    getComponentGroupDisplayName(rawGroup) || "Basic";

                const renderedIcon =
                    typeof icon === "string" &&
                    icon.startsWith("material:") ? (
                        <Icon icon={icon} size={16} />
                    ) : typeof icon === "string" ? (
                        <img src={icon} alt={label} />
                    ) : (
                        icon
                    );

                return {
                    id: componentClass.name,
                    label:
                        componentClass.name === "LVGLScreenWidget"
                            ? "Screen"
                            : label,
                    group,
                    icon: renderedIcon
                };
            });
        }

        get categories(): { name: string; count: number }[] {
            const counts = new Map<string, number>();
            for (const opt of this.widgetOptions) {
                counts.set(opt.group, (counts.get(opt.group) || 0) + 1);
            }
            const result = [
                { name: "All", count: this.widgetOptions.length }
            ];
            for (const [name, count] of counts.entries()) {
                result.push({ name, count });
            }
            return result;
        }

        get filteredOptions(): StyleWidgetOption[] {
            const query = this.searchText.trim().toLowerCase();
            return this.widgetOptions.filter(opt => {
                if (
                    this.selectedCategory !== "All" &&
                    opt.group !== this.selectedCategory
                ) {
                    return false;
                }
                if (
                    query &&
                    !opt.label.toLowerCase().includes(query) &&
                    !opt.id.toLowerCase().includes(query)
                ) {
                    return false;
                }
                return true;
            });
        }

        get groupedOptions(): {
            group: string;
            items: StyleWidgetOption[];
        }[] {
            const groups = new Map<string, StyleWidgetOption[]>();
            for (const opt of this.filteredOptions) {
                let list = groups.get(opt.group);
                if (!list) {
                    list = [];
                    groups.set(opt.group, list);
                }
                list.push(opt);
            }
            return Array.from(groups.entries()).map(([group, items]) => ({
                group,
                items
            }));
        }

        get selectedWidgetOption(): StyleWidgetOption | undefined {
            return this.widgetOptions.find(
                opt => opt.id === this.forWidgetType
            );
        }

        async validateName(nameValue: string): Promise<string | undefined> {
            const trimmed = nameValue.trim();
            const values = { name: trimmed };
            const requiredErr = await validators.required(values, "name");
            if (requiredErr) {
                return requiredErr;
            }
            const uniqueValidator = validators.unique(
                {},
                this.props.parent
            );
            const uniqueErr = await uniqueValidator(values, "name");
            if (uniqueErr) {
                return uniqueErr;
            }
            return undefined;
        }

        onNameChange(event: React.ChangeEvent<HTMLInputElement>) {
            this.name = event.target.value;
            if (this.submitted || this.nameError) {
                this.validateName(this.name).then(err => {
                    runInAction(() => {
                        this.nameError = err;
                    });
                });
            }
        }

        onSelectWidget(widgetId: string) {
            if (this.props.lockedWidgetType) {
                return;
            }
            this.forWidgetType = widgetId;
        }

        onSelectCategory(category: string) {
            this.selectedCategory = category;
        }

        onSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
            this.searchText = event.target.value;
        }

        onClearSearch() {
            this.searchText = "";
        }

        async handleOk() {
            this.submitted = true;
            const err = await this.validateName(this.name);
            runInAction(() => {
                this.nameError = err;
            });
            if (err) {
                this.nameInputRef.current?.focus();
                return false;
            }

            runInAction(() => {
                this.open = false;
            });

            this.props.onOk({
                name: this.name.trim(),
                forWidgetType: this.forWidgetType
            });
            return true;
        }

        handleCancel() {
            this.open = false;
            this.props.onCancel();
        }

        renderWidgetCard(opt: StyleWidgetOption) {
            const isSelected = opt.id === this.forWidgetType;
            return (
                <button
                    key={opt.id}
                    type="button"
                    className={classNames(
                        "EezStudio_LVGLNewStyleDialog_WidgetCard",
                        {
                            selected: isSelected
                        }
                    )}
                    onClick={() => this.onSelectWidget(opt.id)}
                    onDoubleClick={() => {
                        this.onSelectWidget(opt.id);
                        if (this.name.trim()) {
                            this.handleOk();
                        }
                    }}
                    title={opt.label}
                >
                    <span className="EezStudio_LVGLNewStyleDialog_WidgetIcon">
                        {opt.icon}
                    </span>
                    <span className="EezStudio_LVGLNewStyleDialog_WidgetLabel">
                        {opt.label}
                    </span>
                    {isSelected && (
                        <span className="EezStudio_LVGLNewStyleDialog_SelectedDot" />
                    )}
                </button>
            );
        }

        render() {
            const selectedOpt = this.selectedWidgetOption;

            return (
                <Dialog
                    className="EezStudio_LVGLNewStyleDialog"
                    open={this.open}
                    modal={true}
                    backdrop="static"
                    title={
                        this.props.parentStyleName
                            ? `New Child Style (under ${this.props.parentStyleName})`
                            : "New Style"
                    }
                    okButtonText="Create Style"
                    onOk={this.handleOk}
                    onCancel={this.handleCancel}
                >
                    <div className="EezStudio_LVGLNewStyleDialog_Body">
                        <div className="EezStudio_LVGLNewStyleDialog_Section">
                            <div className="EezStudio_LVGLNewStyleDialog_LabelRow">
                                <label
                                    className="EezStudio_LVGLNewStyleDialog_Label"
                                    htmlFor="eez-new-style-name-input"
                                >
                                    Style Name
                                    <span className="required-star">*</span>
                                </label>
                            </div>
                            <input
                                ref={this.nameInputRef}
                                id="eez-new-style-name-input"
                                type="text"
                                className={classNames(
                                    "form-control EezStudio_LVGLNewStyleDialog_NameInput",
                                    {
                                        "is-invalid": !!this.nameError
                                    }
                                )}
                                placeholder="Enter style name (e.g. BTN_PRIMARY)..."
                                value={this.name}
                                onChange={this.onNameChange}
                                autoComplete="off"
                                spellCheck={false}
                            />
                            {this.nameError && (
                                <div className="EezStudio_LVGLNewStyleDialog_Error">
                                    {this.nameError}
                                </div>
                            )}
                        </div>

                        <div className="EezStudio_LVGLNewStyleDialog_Section">
                            <div className="EezStudio_LVGLNewStyleDialog_LabelRow">
                                <span className="EezStudio_LVGLNewStyleDialog_Label">
                                    For Widget Type
                                </span>
                                {selectedOpt && (
                                    <span className="EezStudio_LVGLNewStyleDialog_SelectedBadge">
                                        <span className="badge-icon">
                                            {selectedOpt.icon}
                                        </span>
                                        <span className="badge-text">
                                            {selectedOpt.label}
                                        </span>
                                    </span>
                                )}
                            </div>

                            {this.props.lockedWidgetType ? (
                                <div className="EezStudio_LVGLNewStyleDialog_LockedNotice">
                                    Child style inherits widget type{" "}
                                    <strong>
                                        {selectedOpt?.label ||
                                            this.props.lockedWidgetType}
                                    </strong>{" "}
                                    from parent style{" "}
                                    <strong>
                                        {this.props.parentStyleName}
                                    </strong>
                                    .
                                </div>
                            ) : (
                                <>
                                    <div className="EezStudio_LVGLNewStyleDialog_Toolbar">
                                        <div className="EezStudio_LVGLNewStyleDialog_Categories">
                                            {this.categories.map(cat => (
                                                <button
                                                    key={cat.name}
                                                    type="button"
                                                    className={classNames(
                                                        "EezStudio_LVGLNewStyleDialog_CategoryBtn",
                                                        {
                                                            active:
                                                                this
                                                                    .selectedCategory ===
                                                                cat.name
                                                        }
                                                    )}
                                                    onClick={() =>
                                                        this.onSelectCategory(
                                                            cat.name
                                                        )
                                                    }
                                                >
                                                    <span>{cat.name}</span>
                                                    <span className="cat-count">
                                                        {cat.count}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="EezStudio_LVGLNewStyleDialog_SearchBox">
                                            <Icon
                                                icon="material:search"
                                                size={15}
                                                className="search-icon"
                                            />
                                            <input
                                                type="text"
                                                className="EezStudio_LVGLNewStyleDialog_SearchInput"
                                                placeholder="Filter widget..."
                                                value={this.searchText}
                                                onChange={this.onSearchChange}
                                                onKeyDown={e => {
                                                    if (
                                                        e.key === "Enter"
                                                    ) {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                    }
                                                }}
                                            />
                                            {this.searchText && (
                                                <button
                                                    type="button"
                                                    className="clear-btn"
                                                    onClick={
                                                        this.onClearSearch
                                                    }
                                                    title="Clear search"
                                                >
                                                    ×
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="EezStudio_LVGLNewStyleDialog_WidgetGridContainer">
                                        {this.filteredOptions.length === 0 ? (
                                            <div className="EezStudio_LVGLNewStyleDialog_Empty">
                                                No matching widget types found
                                            </div>
                                        ) : this.selectedCategory === "All" &&
                                          !this.searchText.trim() ? (
                                            this.groupedOptions.map(group => (
                                                <div
                                                    key={group.group}
                                                    className="EezStudio_LVGLNewStyleDialog_Group"
                                                >
                                                    <div className="EezStudio_LVGLNewStyleDialog_GroupHeader">
                                                        {group.group}
                                                    </div>
                                                    <div className="EezStudio_LVGLNewStyleDialog_WidgetGrid">
                                                        {group.items.map(opt =>
                                                            this.renderWidgetCard(
                                                                opt
                                                            )
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="EezStudio_LVGLNewStyleDialog_WidgetGrid">
                                                {this.filteredOptions.map(opt =>
                                                    this.renderWidgetCard(opt)
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </Dialog>
            );
        }
    }
);

function showNewStyleDialog(params: {
    project: Project;
    parent: IEezObject;
    defaultWidgetType: string;
    lockedWidgetType?: string;
    parentStyleName?: string;
}) {
    return new Promise<{ name: string; forWidgetType: string } | undefined>(
        resolve => {
            showDialog(
                <NewStyleDialog
                    {...params}
                    onOk={result => resolve(result)}
                    onCancel={() => resolve(undefined)}
                />
            );
        }
    );
}

const DefaultStylePropertyGridUI = observer(
    class DefaultStylePropertyGridUI extends React.Component<PropertyProps> {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        get lvglStyle() {
            return this.props.objects[0] as LVGLStyle;
        }

        onChange = (value: boolean) => {
            const defaultStyles = Object.assign(
                {},
                this.context.project.lvglStyles.defaultStyles,
                {
                    [this.lvglStyle.forWidgetType]: value
                        ? this.lvglStyle.name
                        : undefined
                }
            );

            this.context.updateObject(this.context.project.lvglStyles, {
                defaultStyles
            });
        };

        render() {
            const state =
                this.context.project.lvglStyles.defaultStyles[
                    this.lvglStyle.forWidgetType
                ] == this.lvglStyle.name;

            return (
                <Checkbox
                    state={state}
                    onChange={this.onChange}
                    readOnly={false}
                    switchStyle={true}
                ></Checkbox>
            );
        }
    }
);

export class LVGLStyle extends EezObject {
    name: string;
    forWidgetType: string;
    childStyles: LVGLStyle[];
    definition: LVGLStylesDefinition;

    constructor() {
        super();

        makeObservable(this, {
            fullDefinition: computed
        });
    }

    override makeEditable() {
        super.makeEditable();

        makeObservable(this, {
            name: observable,
            forWidgetType: observable,
            childStyles: observable,
            definition: observable
        });
    }

    static classInfo: ClassInfo = {
        properties: [
            {
                name: "name",
                type: PropertyType.String,
                unique: true
            },
            {
                name: "forWidgetType",
                type: PropertyType.String,
                displayValue: (style: LVGLStyle) => {
                    const componentClass = getClassesDerivedFrom(
                        ProjectEditor.getProjectStore(style),
                        ProjectEditor.LVGLWidgetClass
                    ).find(
                        componentClass =>
                            componentClass.name == style.forWidgetType
                    );
                    return componentClass
                        ? componentClass.displayName
                            ? componentClass.displayName
                            : componentClass.objectClass.classInfo
                                  .componentPaletteLabel ||
                              getComponentName(componentClass.name)
                        : style.forWidgetType;
                },
                readOnlyInPropertyGrid: true
            },
            {
                name: "childStyles",
                type: PropertyType.Array,
                typeClass: LVGLStyle,
                hideInPropertyGrid: true
            },
            {
                name: "defaultStyle",
                type: PropertyType.Any,
                computed: true,
                propertyGridColumnComponent: DefaultStylePropertyGridUI
            },
            {
                name: "definition",
                type: PropertyType.Object,
                typeClass: LVGLStylesDefinition,
                propertyGridRowComponent: LVGLStylesDefinitionProperty,
                enumerable: false
            }
        ],
        listLabel: (lvglStyle: LVGLStyle) => {
            const componentClass = getClassesDerivedFrom(
                ProjectEditor.getProjectStore(lvglStyle),
                ProjectEditor.LVGLWidgetClass
            ).find(
                componentClass => componentClass.name == lvglStyle.forWidgetType
            );

            const icon =
                getComponentMaterialIcon(lvglStyle.forWidgetType) ??
                componentClass?.objectClass.classInfo.icon;

            const isDefault =
                ProjectEditor.getProject(lvglStyle).lvglStyles.defaultStyles[
                    lvglStyle.forWidgetType
                ] == lvglStyle.name;

            return (
                <div
                    className="EezStudio_LVGLStyleTreeRow"
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flex: 1,
                        minWidth: 0,
                        paddingRight: 10
                    }}
                >
                    <div className="EezStudio_LVGLStyleTreeItemLabel">
                        {icon && (
                            <span className="EezStudio_LVGLStyleTreeItemIconSlot">
                                <Icon
                                    icon={icon as any}
                                    size={16}
                                    className="EezStudio_LVGLStyleTreeItemIcon"
                                />
                            </span>
                        )}
                        <span className="EezStudio_LVGLStyleTreeItemName">
                            {lvglStyle.name}
                        </span>
                    </div>
                    {lvglStyle.redundantModifications.length > 0 && (
                        <div className="EezStudio_LVGLStyleTreeItemMeta">
                            {lvglStyle.redundantModifications.length} redundant
                            {lvglStyle.redundantModifications.length == 1
                                ? " modification"
                                : " modifications"}
                        </div>
                    )}
                    {isDefault && (
                        <div className="EezStudio_LVGLStyleTreeItemMeta">
                            Default
                        </div>
                    )}
                </div>
            );
        },
        propertiesPanelLabel: (lvglStyle: LVGLStyle) => {
            const widgetType = lvglStyle.forWidgetType
                .replace(/^LVGL/, "")
                .replace(/Widget$/, "");
            return `Style: ${lvglStyle.name} (${widgetType})`;
        },
        getIcon: (lvglStyle: LVGLStyle) => {
            const componentClass = getClassesDerivedFrom(
                ProjectEditor.getProjectStore(lvglStyle),
                ProjectEditor.LVGLWidgetClass
            ).find(
                componentClass => componentClass.name == lvglStyle.forWidgetType
            );
            return (
                getComponentMaterialIcon(lvglStyle.forWidgetType) ??
                componentClass?.objectClass.classInfo.icon
            );
        },
        newItem: async (parent: IEezObject) => {
            const project = ProjectEditor.getProject(parent);
            const parentObj = getParent(parent);
            const parentStyle =
                parentObj instanceof LVGLStyle ? parentObj : undefined;
            const currentSelectedStyle =
                project._store.navigationStore?.selectedStyleObject.get();
            const defaultWidgetType =
                parentStyle?.forWidgetType ||
                (currentSelectedStyle instanceof LVGLStyle
                    ? currentSelectedStyle.forWidgetType
                    : "LVGLPanelWidget");

            const result = await showNewStyleDialog({
                project,
                parent,
                defaultWidgetType,
                lockedWidgetType: parentStyle?.forWidgetType,
                parentStyleName: parentStyle?.name
            });

            if (!result) {
                return undefined;
            }

            const styleProperties: Partial<LVGLStyle> = {
                name: result.name,
                forWidgetType: result.forWidgetType,
                definition: {} as any
            };

            const style = createObject<LVGLStyle>(
                project._store,
                styleProperties,
                LVGLStyle
            );

            return style;
        },
        defaultValue: {
            forWidgetType: "LVGLPanelWidget",
            definition: {}
        },
        lvgl: (lvglStyle: LVGLStyle, project: Project) => {
            const componentClass = getClassesDerivedFrom(
                project._store,
                ProjectEditor.LVGLWidgetClass
            ).find(
                componentClass => componentClass.name == lvglStyle.forWidgetType
            );

            if (componentClass) {
                if (
                    typeof componentClass.objectClass.classInfo.lvgl ==
                    "function"
                ) {
                    return componentClass.objectClass.classInfo.lvgl(
                        lvglStyle,
                        project
                    );
                } else if (componentClass.objectClass.classInfo.lvgl) {
                    return componentClass.objectClass.classInfo.lvgl;
                }
            }

            return {
                parts: [],
                defaultFlags: "",
                states: []
            };
        },
        check: (style: LVGLStyle, messages: IMessage[]) => {
            style.definition.check(messages);
        },
        showTreeCollapseIcon: "has-children",
        extendContextMenu(
            thisObject: LVGLStyle,
            context,
            objects,
            menuItems,
            editable
        ) {
            if (thisObject.redundantModifications.length > 0) {
                menuItems.push(
                    new MenuItem({
                        type: "separator"
                    })
                );
                menuItems.push(
                    new MenuItem({
                        label: "Remove Redundant Modifications",
                        click: () => {
                            thisObject.removeRedundantModifications();
                        }
                    })
                );
            }
        }
    };

    get parentStyle(): LVGLStyle | undefined {
        const object = getParent(getParent(this));
        if (object && object instanceof LVGLStyle) {
            return object;
        }
        return undefined;
    }

    get redundantModifications() {
        function getValue(
            style: LVGLStyle,
            part: string,
            state: string,
            propertyName: string
        ): any {
            const definition = style.definition.definition;
            const value = definition?.[part]?.[state]?.[propertyName];
            if (value == undefined && style.parentStyle) {
                return getValue(style.parentStyle, part, state, propertyName);
            }
            return value;
        }

        const redundantModifications: {
            part: string;
            state: string;
            propertyName: string;
        }[] = [];

        const definition = this.definition.definition || {};
        Object.keys(definition).forEach(part => {
            Object.keys(definition[part]).forEach(state => {
                Object.keys(definition[part][state]).forEach(propertyName => {
                    const value = definition[part][state][propertyName];
                    if (
                        value != undefined &&
                        this.parentStyle &&
                        value ==
                            getValue(
                                this.parentStyle,
                                part,
                                state,
                                propertyName
                            )
                    ) {
                        redundantModifications.push({
                            part,
                            state,
                            propertyName
                        });
                    }
                });
            });
        });

        return redundantModifications;
    }

    removeRedundantModifications() {
        ProjectEditor.getProjectStore(this).updateObject(this.definition, {
            definition: this.definition.removeModifications(
                this.redundantModifications
            )
        });
    }

    get fullDefinition() {
        let fullDefinition = toJS(this.definition.definition);

        if (this.parentStyle) {
            const parentDefinition = this.parentStyle.fullDefinition;

            if (parentDefinition) {
                Object.keys(parentDefinition).forEach(part => {
                    Object.keys(parentDefinition[part]).forEach(state => {
                        Object.keys(parentDefinition[part][state]).forEach(
                            propertyName => {
                                if (!fullDefinition) {
                                    fullDefinition = {};
                                }
                                if (!fullDefinition[part]) {
                                    fullDefinition[part] = {};
                                }
                                if (!fullDefinition[part][state]) {
                                    fullDefinition[part][state] = {};
                                }

                                if (
                                    fullDefinition[part][state][propertyName] ==
                                    undefined
                                ) {
                                    fullDefinition[part][state][propertyName] =
                                        parentDefinition[part][state][
                                            propertyName
                                        ];
                                }
                            }
                        );
                    });
                });
            }
        }

        return fullDefinition;
    }

    lvglCreateStyles(runtime: LVGLPageRuntime) {
        const lvglStyleObjects: LVGLStyleObjects = {};

        const project = ProjectEditor.getProject(runtime.page);
        const lvglVersion = project.settings.general.lvglVersion;

        const definition = this.fullDefinition;

        if (definition) {
            Object.keys(definition).forEach(part => {
                Object.keys(definition[part]).forEach(state => {
                    let styleObj: number | undefined;

                    function getStyleObj() {
                        if (!styleObj) {
                            styleObj = runtime.wasm._lvglStyleCreate();
                        }
                        return styleObj;
                    }

                    Object.keys(definition[part][state]).forEach(
                        propertyName => {
                            const propertyInfo =
                                lvglPropertiesMap.get(propertyName);
                            if (
                                !propertyInfo ||
                                propertyInfo.lvglStyleProp.code[lvglVersion] ==
                                    undefined
                            ) {
                                return;
                            }

                            const value = definition[part][state][propertyName];

                            if (propertyInfo.type == PropertyType.ThemedColor) {
                                runtime.lvglSetAndUpdateStyleColor(
                                    value,
                                    (wasm, colorNum) => {
                                        wasm._lvglStyleSetPropColor(
                                            getStyleObj(),
                                            runtime.getLvglStylePropCode(
                                                propertyInfo.lvglStyleProp.code
                                            ),
                                            colorNum
                                        );
                                    }
                                );
                            } else if (
                                propertyInfo.type == PropertyType.Number ||
                                propertyInfo.type == PropertyType.Enum
                            ) {
                                if (propertyInfo == text_font_property_info) {
                                    const index = BUILT_IN_FONTS.indexOf(value);
                                    if (index != -1) {
                                        runtime.wasm._lvglSetStylePropBuiltInFont(
                                            getStyleObj(),
                                            runtime.getLvglStylePropCode(
                                                propertyInfo.lvglStyleProp.code
                                            ),
                                            index
                                        );
                                    } else {
                                        const font = findFont(project, value);

                                        if (font) {
                                            const fontPtr =
                                                runtime.getFontPtr(font);
                                            if (fontPtr) {
                                                runtime.wasm._lvglSetStylePropPtr(
                                                    getStyleObj(),
                                                    runtime.getLvglStylePropCode(
                                                        propertyInfo
                                                            .lvglStyleProp.code
                                                    ),
                                                    fontPtr
                                                );
                                            }
                                        }
                                    }
                                } else {
                                    const numValue = propertyInfo.lvglStyleProp
                                        .valueToNum
                                        ? propertyInfo.lvglStyleProp.valueToNum(
                                              value,
                                              project._store
                                          )
                                        : value;

                                    runtime.wasm._lvglSetStylePropNum(
                                        getStyleObj(),
                                        runtime.getLvglStylePropCode(
                                            propertyInfo.lvglStyleProp.code
                                        ),
                                        numValue
                                    );
                                }
                            } else if (
                                propertyInfo.type ==
                                PropertyType.NumberArrayAsString
                            ) {
                                const arrValue: number[] = propertyInfo
                                    .lvglStyleProp.valueToNum
                                    ? propertyInfo.lvglStyleProp.valueToNum(
                                          value,
                                          project._store
                                      )
                                    : value;

                                runtime.wasm._lvglSetStylePropPtr(
                                    getStyleObj(),
                                    runtime.getLvglStylePropCode(
                                        propertyInfo.lvglStyleProp.code
                                    ),
                                    propertyInfo.lvglStyleProp.isInt16Array &&
                                        propertyInfo.lvglStyleProp.isInt16Array(
                                            project._store
                                        )
                                        ? runtime.allocateInt16Array(
                                              arrValue,
                                              true
                                          )
                                        : runtime.allocateInt32Array(
                                              arrValue,
                                              true
                                          )
                                );
                            } else if (
                                propertyInfo.type == PropertyType.Boolean
                            ) {
                                const numValue = value ? 1 : 0;

                                runtime.wasm._lvglSetStylePropNum(
                                    getStyleObj(),
                                    runtime.getLvglStylePropCode(
                                        propertyInfo.lvglStyleProp.code
                                    ),
                                    numValue
                                );
                            } else if (
                                propertyInfo.type ==
                                    PropertyType.ObjectReference &&
                                propertyInfo.referencedObjectCollectionPath ==
                                    "bitmaps"
                            ) {
                                const bitmap = findBitmap(project, value);
                                if (bitmap && bitmap.image) {
                                    const bitmapPtr =
                                        runtime.getBitmapPtr(bitmap);
                                    if (bitmapPtr) {
                                        runtime.wasm._lvglSetStylePropPtr(
                                            getStyleObj(),
                                            runtime.getLvglStylePropCode(
                                                propertyInfo.lvglStyleProp.code
                                            ),
                                            bitmapPtr
                                        );
                                    }
                                }
                            } else if (propertyInfo.type == PropertyType.String) {
                                if (value) {
                                    // For anim property
                                    let { setDelay, setRepeatDelay, setRepeatCount, delay, repeatDelay, repeatCount } = 
                                        extractAnimProperties(value);
    
                                    if (setDelay || setRepeatDelay || setRepeatCount) {
                                        const animPtr = runtime.wasm._lvglCreateAnim(setDelay, delay, setRepeatDelay, repeatDelay, setRepeatCount, repeatCount);
                                        runtime.pointers.push(animPtr);
                                        runtime.wasm._lvglSetStylePropPtr(
                                            getStyleObj(),
                                            runtime.getLvglStylePropCode(
                                                propertyInfo.lvglStyleProp.code
                                            ),
                                            animPtr
                                        );
                                    }
                                }
                            }
                        }
                    );

                    if (
                        styleObj &&
                        state.includes("PRESSED") &&
                        definition[part][state]["color_filter_opa"] == undefined
                    ) {
                        const colorFilterOpaCode =
                            runtime.getLvglStylePropCode(
                                LVGL_STYLE_PROP_CODES.LV_STYLE_COLOR_FILTER_OPA
                            );
                        if (colorFilterOpaCode) {
                            runtime.wasm._lvglSetStylePropNum(
                                styleObj,
                                colorFilterOpaCode,
                                0
                            );
                        }
                    }

                    if (styleObj) {
                        if (!lvglStyleObjects[part]) {
                            lvglStyleObjects[part] = {};
                        }

                        lvglStyleObjects[part][state] = styleObj;
                    }
                });
            });
        }

        return lvglStyleObjects;
    }

    lvglDeleteStyles(runtime: LVGLPageRuntime, styles: LVGLStyleObjects) {
        Object.keys(styles).forEach(part => {
            Object.keys(styles[part]).forEach(state => {
                runtime.wasm._lvglStyleDelete(styles[part][state]);
            });
        });
    }

    lvglAddStyleToObject(
        runtime: LVGLPageRuntime,
        obj: number,
        partOverride?: { from: string; to: string }
    ) {
        const lvglStyleObjects = runtime.styleObjMap.get(this) || {};

        const parts = partOverride
            ? [partOverride.from]
            : Object.keys(lvglStyleObjects);

        parts.forEach(part => {
            if (!lvglStyleObjects[part]) {
                return;
            }
            const selectorPart = partOverride ? partOverride.to : part;
            Object.keys(lvglStyleObjects[part]).forEach(state => {
                const selectorCode = getSelectorCode(this, selectorPart, state);
                runtime.wasm._lvglObjAddStyle(
                    obj,
                    lvglStyleObjects[part][state],
                    selectorCode
                );
            });
        });
    }

    lvglRemoveStyleFromObject(runtime: LVGLPageRuntime, obj: number) {
        const lvglStyleObjects = runtime.styleObjMap.get(this) || {};

        Object.keys(lvglStyleObjects).forEach(part => {
            Object.keys(lvglStyleObjects[part]).forEach(state => {
                const selectorCode = getSelectorCode(this, part, state);
                runtime.wasm._lvglObjRemoveStyle(
                    obj,
                    lvglStyleObjects[part][state],
                    selectorCode
                );
            });
        });
    }
}

registerClass("LVGLStyle", LVGLStyle);

////////////////////////////////////////////////////////////////////////////////

export class LVGLStyles extends EezObject {
    styles: LVGLStyle[];
    defaultStyles: {
        [widgetType: string]: string;
    };

    _lvglRuntime: LVGLStylesEditorRuntime | undefined;
    _lvglRuntimeVersion: string | undefined;

    constructor() {
        super();

        makeObservable(this, {
            allStyles: computed
        });
    }

    override makeEditable() {
        super.makeEditable();

        makeObservable(this, {
            styles: observable,
            defaultStyles: observable
        });
    }

    static classInfo: ClassInfo = {
        label: () => "Styles",
        properties: [
            {
                name: "styles",
                type: PropertyType.Array,
                typeClass: LVGLStyle
            },
            {
                name: "defaultStyles",
                type: PropertyType.Any
            }
        ],
        beforeLoadHook: (object: LVGLStyles, jsObject: Partial<LVGLStyles>) => {
            if (jsObject.defaultStyles == undefined) {
                jsObject.defaultStyles = {};
            }
        },
        defaultValue: {
            styles: [],
            defaultStyles: {}
        },
        icon: "material:format_color_fill"
    };

    get lvglRuntime() {
        const project = ProjectEditor.getProject(this);
        const lvglVersion = project.settings.general.lvglVersion;
        if (!this._lvglRuntime || this._lvglRuntimeVersion !== lvglVersion) {
            if (this._lvglRuntime) {
                this._lvglRuntime.unmount();
            }
            this._lvglRuntimeVersion = lvglVersion;
            this._lvglRuntime = untracked(
                () => new LVGLStylesEditorRuntime(project)
            );
        }
        return this._lvglRuntime;
    }

    get allStyles() {
        const styles: LVGLStyle[] = [];

        function addStyles(style: LVGLStyle) {
            styles.push(style);
            for (const childStyle of style.childStyles) {
                addStyles(childStyle);
            }
        }

        for (const style of this.styles) {
            addStyles(style);
        }

        return styles;
    }
}

registerClass("LVGLStyles", LVGLStyles);

export const LVGLStylesNavigation = observer(
    class LVGLStylesNavigation extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        factory = (node: FlexLayout.TabNode) => {
            var component = node.getComponent();

            if (component === "styles") {
                return (
                    <LVGLStylesTreeNavigation
                        id={"lvgl-styles"}
                        navigationObject={
                            this.context.project.lvglStyles.styles
                        }
                        selectedObject={
                            this.context.navigationStore.selectedStyleObject
                        }
                    />
                );
            }

            if (component === "preview") {
                return <LVGLSelectedStyleEditor />;
            }

            return null;
        };

        render() {
            return (
                <FlexLayoutContainer
                    model={this.context.layoutModels.lvglStyles}
                    factory={this.factory}
                />
            );
        }
    }
);

export const LVGLSelectedStyleEditor = observer(
    class LVGLSelectedStyleEditor extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        canvasRef = React.createRef<HTMLCanvasElement>();

        constructor(props: any) {
            super(props);

            makeObservable(this, {
                selectedStyle: computed
            });
        }

        get runtime() {
            return this.context.project.lvglStyles.lvglRuntime;
        }

        get selectedStyle() {
            const navigationStore = this.context.navigationStore;

            if (navigationStore.selectedPanel) {
                if (
                    navigationStore.selectedPanel.selectedObject instanceof
                    LVGLStyle
                ) {
                    return navigationStore.selectedPanel.selectedObject;
                }
            }

            return navigationStore.selectedStyleObject.get() as LVGLStyle;
        }

        componentDidMount() {
            this.runtime.setSelectedStyle(
                this.selectedStyle,
                this.canvasRef.current
            );
        }

        componentDidUpdate() {
            this.runtime.setSelectedStyle(
                this.selectedStyle,
                this.canvasRef.current
            );
        }

        componentWillUnmount() {
            this.runtime.setSelectedStyle(undefined, null);
        }

        render() {
            const selectedStyle = this.selectedStyle;
            const runtime = this.runtime;
            const supported = selectedStyle
                ? runtime.lvglWidgetsMap.has(selectedStyle.forWidgetType)
                : false;

            // The native LVGL engine can load asynchronously in Electron.
            // Show a clearly labeled CSS approximation derived from the
            // actual selected style while waiting, rather than empty pixels.
            const sampleStyle = selectedStyle?.fullDefinition?.MAIN?.DEFAULT as
                | Record<string, any>
                | undefined;
            const sampleType = selectedStyle?.forWidgetType;
            const fontMatch = String(sampleStyle?.text_font || "").match(
                /_(\d+)$/
            );
            const fontSize = fontMatch ? Math.min(40, Number(fontMatch[1])) : 14;
            const bgOpacity = Number(sampleStyle?.bg_opa);
            const fallbackButtonStyle: React.CSSProperties = {
                width: sampleType === "LVGLButtonWidget" ? 160 : "auto",
                minHeight: sampleType === "LVGLButtonWidget" ? 56 : 40,
                padding: sampleType === "LVGLButtonWidget" ? "8px 18px" : 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: Number(sampleStyle?.radius) || 4,
                backgroundColor:
                    sampleType === "LVGLButtonWidget"
                        ? String(sampleStyle?.bg_color || "#637483")
                        : "transparent",
                opacity:
                    sampleType === "LVGLButtonWidget" &&
                    Number.isFinite(bgOpacity)
                        ? Math.max(0, Math.min(1, bgOpacity / 255))
                        : 1,
                color: String(sampleStyle?.text_color || "#303030"),
                fontSize,
                fontFamily: "Arial, sans-serif",
                fontWeight: 500,
                boxSizing: "border-box",
                whiteSpace: "nowrap"
            };

            this.context.project.settings.general.lvglVersion;

            return (
                <div
                    className="EezStudio_LVGLStylePreview"
                    style={{
                        width: "100%",
                        height: "100%",
                        boxSizing: "border-box",
                        padding: 10,
                        display: "flex",
                        minHeight: 0,
                        flexDirection: "column",
                        alignItems: "center",
                        overflow: "auto"
                    }}
                >
                    {selectedStyle ? (
                        <>
                            <div style={{
                                alignSelf: "stretch",
                                fontSize: 12,
                                marginBottom: 6,
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                overflow: "hidden"
                            }}>
                                Style Sample: {selectedStyle.name} ({selectedStyle.forWidgetType.replace(/^LVGL/, "").replace(/Widget$/, "")})
                            </div>
                            {supported ? (
                                <div style={{
                                    flex: "0 0 auto",
                                    minHeight: runtime.displayHeight,
                                    width: "100%",
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    position: "relative"
                                }}>
                                    <canvas
                                        ref={this.canvasRef}
                                        width={runtime.displayWidth}
                                        height={runtime.displayHeight}
                                        aria-label={"LVGL preview of " + selectedStyle.name}
                                        style={{
                                            display: "block",
                                            width: runtime.displayWidth,
                                            height: runtime.displayHeight,
                                            maxWidth: "100%",
                                            flex: "0 0 auto",
                                            border: "1px solid rgba(127, 127, 127, 0.35)",
                                            boxSizing: "border-box",
                                            visibility: runtime.previewFrameReady
                                                ? "visible"
                                                : "hidden"
                                        }}
                                    />
                                    {!runtime.previewFrameReady && (
                                        <div
                                            role="img"
                                            aria-label="Approximate style sample while LVGL loads"
                                            style={{
                                                position: "absolute",
                                                width: runtime.displayWidth,
                                                height: runtime.displayHeight,
                                                maxWidth: "100%",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                border: "1px solid rgba(127, 127, 127, 0.35)",
                                                backgroundColor: "#f5f5f5",
                                                boxSizing: "border-box"
                                            }}
                                        >
                                            <div style={fallbackButtonStyle}>
                                                {sampleType === "LVGLButtonWidget"
                                                    ? "Button"
                                                    : sampleType === "LVGLLabelWidget"
                                                      ? "Aa Sample"
                                                      : "Sample"}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div style={{ fontSize: 12, opacity: 0.7 }}>
                                    Preview is unavailable for this widget type:
                                    {" "}{selectedStyle.forWidgetType}
                                </div>
                            )}
                            {!runtime.previewError && (
                                <div
                                    style={{
                                        alignSelf: "stretch",
                                        marginTop: 6,
                                        fontSize: 11,
                                        opacity: 0.65
                                    }}
                                >
                                    {runtime.previewFrameReady
                                        ? "Ready"
                                        : runtime.previewObjectReady
                                          ? "Rendering..."
                                          : "Approximate preview - " +
                                            runtime.previewStage}
                                </div>
                            )}
                            {runtime.previewError && (
                                <div
                                    role="alert"
                                    title={runtime.previewError}
                                    style={{
                                        fontSize: 11,
                                        color: "#c43d38",
                                        alignSelf: "stretch",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap"
                                    }}
                                >
                                    Style sample failed: {runtime.previewError}
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                            Select a style to preview it.
                        </div>
                    )}
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const feature: ProjectEditorFeature = {
    name: "eezstudio-project-feature-lvgl-style",
    version: "0.1.0",
    description: "Styles support for your project",
    author: "EEZ",
    authorLogo: "../eez-studio-ui/_images/eez_logo.png",
    displayName: "Styles",
    mandatory: true,
    key: "lvglStyles",
    type: PropertyType.Object,
    typeClass: LVGLStyles,
    icon: "material:format_color_fill",
    create: () => {
        styles: [];
    }
};

export default feature;
