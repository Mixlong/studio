import React from "react";

import { action, computed, makeObservable } from "mobx";
import { observable } from "mobx";
import * as FlexLayout from "flexlayout-react";

import { Icon } from "eez-studio-ui/icon";
import {
    AbstractLayoutModels,
    ILayoutModel
} from "eez-studio-ui/layout-models";

import type { ProjectStore } from "project-editor/store";
import { settingsController } from "home/settings";

////////////////////////////////////////////////////////////////////////////////

export class LayoutModels extends AbstractLayoutModels {
    static GLOBAL_OPTIONS: FlexLayout.IGlobalAttributes = {
        borderEnableAutoHide: true,
        tabEnableRename: false,
        tabSetMinWidth: 50,
        tabSetMinHeight: 50
    };

    static PAGES_TAB_ID = "PAGES";
    static USER_WIDGETS_TAB_ID = "WIDGETS";
    static ACTIONS_TAB_ID = "ACTIONS";
    static VARIABLES_TAB_ID = "VARIABLES";
    static CHECKS_TAB_ID = "CHECKS";
    static OUTPUT_TAB_ID = "OUTPUT";
    static SEARCH_TAB_ID = "SEARCH";
    static REFERENCES_TAB_ID = "REFERENCES";
    static EDITOR_MODE_EDITORS_TABSET_ID = "EDITORS";
    static RUNTIME_MODE_EDITORS_TABSET_ID = "RUNTIME-EDITORS";
    static PROPERTIES_TAB_ID = "PROPERTIES";
    static COMPONENTS_PALETTE_TAB_ID = "COMPONENTS_PALETTE";
    static BREAKPOINTS_TAB_ID = "BREAKPOINTS_PALETTE";
    static DEBUGGER_TAB_ID = "DEBUGGER";
    static DEBUGGER_LOGS_TAB_ID = "DEBUGGER_LOGS";

    static SCPI_SUBSYSTEMS_TAB_ID = "SCPI_SUBSYSTEMS";
    static SCPI_ENUMS_TAB_ID = "SCPI_ENUMS";
    static SCPI_COMMANDS_TAB_ID = "SCPI_COMMANDS";

    static LANGUAGES_TAB_ID = "LANGUAGES";
    static TEXT_RESOURCES_TAB_ID = "TEXT_RESOURCES";
    static TEXTS_STATISTICS_TAB_ID = "TEXTS_STATISTICS";

    static STYLES_TAB_ID = "styles";
    static FONTS_TAB_ID = "fonts";
    static BITMAPS_TAB_ID = "bitmaps";
    static AUDIO_TAB_ID = "audio";
    static EMBEDDED_PLATFORM_TAB_ID = "embedded-platform";
    static THEMES_TAB_ID = "themes";
    static TEXTS_TAB_ID = "texts";
    static SCPI_TAB_ID = "scpi";
    static INSTRUMENT_COMMANDS_TAB_ID = "instrument-commands";
    static EXTENSION_DEFINITIONS_TAB_ID = "iext";
    static CHANGES_TAB_ID = "changes";
    static FLOW_STRUCTURE_TAB_ID = "FLOW_STRUCTURE";
    static MICRO_PYTHON_TAB_ID = "micro-python";
    static README_TAB_ID = "readme";
    static LVGL_GROUPS_TAB_ID = "lvgl-groups";
    static DOCKER_SIMULATOR_PREVIEW_TAB_ID = "DOCKER_SIMULATOR_PREVIEW";
    static DOCKER_SIMULATOR_LOGS_TAB_ID = "DOCKER_SIMULATOR_LOGS";
    static DOCKER_SIMULATOR_PREVIEW_LOGS_TAB_ID =
        "DOCKER_SIMULATOR_PREVIEW_LOGS";

    static PAGES_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Pages",
        component: "pages",
        icon: "svg:pages",
        id: LayoutModels.PAGES_TAB_ID
    };
    static WIDGETS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "User Widgets",
        component: "widgets",
        icon: "svg:user_widgets",
        id: LayoutModels.USER_WIDGETS_TAB_ID
    };
    static ACTIONS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "User Actions",
        component: "actions",
        icon: "material:code",
        id: LayoutModels.ACTIONS_TAB_ID
    };

    static FLOW_STRUCTURE_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Widgets Structure",
        id: LayoutModels.FLOW_STRUCTURE_TAB_ID,
        component: "flow-structure",
        icon: "svg:hierarchy"
    };

    static VARIABLES_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Variables",
        id: LayoutModels.VARIABLES_TAB_ID,
        component: "variables",
        icon: "svg:variable"
    };

    static PROPERTIES_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Properties",
        id: LayoutModels.PROPERTIES_TAB_ID,
        component: "propertiesPanel",
        icon: "svg:properties"
    };

    static STYLES_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Styles",
        id: LayoutModels.STYLES_TAB_ID,
        component: "styles",
        icon: "material:format_color_fill"
    };

    static FONTS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Fonts",
        id: LayoutModels.FONTS_TAB_ID,
        component: "fonts",
        icon: "material:font_download"
    };

    static BITMAPS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Bitmaps",
        id: LayoutModels.BITMAPS_TAB_ID,
        component: "bitmaps",
        icon: "material:image"
    };

    static AUDIO_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Audio",
        id: LayoutModels.AUDIO_TAB_ID,
        component: "audio",
        icon: "material:volume_up",
        borderWidth: 420
    };

    static EMBEDDED_PLATFORM_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Embedded Platform",
        id: LayoutModels.EMBEDDED_PLATFORM_TAB_ID,
        component: "embedded-platform",
        icon: "material:developer_board",
        className: "DigiStudio_ActivityBarTab",
        helpText: "Embedded Platform",
        borderWidth: 560
    };

    static THEMES_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Themes",
        id: LayoutModels.THEMES_TAB_ID,
        component: "themesSideView",
        icon: "svg:palette"
    };

    static TEXTS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Texts",
        id: LayoutModels.TEXTS_TAB_ID,
        component: "texts",
        icon: "svg:language",
        className: "DigiStudio_ActivityBarTab",
        helpText: "Texts"
    };

    static SCPI_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "SCPI",
        id: LayoutModels.SCPI_TAB_ID,
        component: "scpi",
        icon: "material:navigate_next",
        className: "DigiStudio_ActivityBarTab",
        helpText: "SCPI"
    };

    static INSTRUMENT_COMMANDS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Instrument Commands",
        id: LayoutModels.INSTRUMENT_COMMANDS_TAB_ID,
        component: "instrument-commands",
        icon: "material:navigate_next",
        className: "DigiStudio_ActivityBarTab",
        helpText: "Instrument Commands"
    };

    static EXTENSION_DEFINITIONS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "IEXT",
        id: LayoutModels.EXTENSION_DEFINITIONS_TAB_ID,
        component: "extension-definitions",
        icon: "material:extension",
        className: "DigiStudio_ActivityBarTab",
        helpText: "Extensions"
    };

    static CHANGES_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Changes",
        id: LayoutModels.CHANGES_TAB_ID,
        component: "changes",
        icon: "svg:changes",
        className: "DigiStudio_ActivityBarTab",
        helpText: "Changes"
    };

    static BREAKPOINTS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Breakpoints",
        id: LayoutModels.BREAKPOINTS_TAB_ID,
        icon: "svg:breakpoints_panel",
        component: "breakpointsPanel"
    };

    static LVGL_GROUPS_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Groups",
        id: LayoutModels.LVGL_GROUPS_TAB_ID,
        component: "lvgl-groups",
        icon: "material:view_compact"
    };

    static COMPONENTS_PALETTE_TAB: FlexLayout.IJsonTabNode = {
        type: "tab",
        enableClose: false,
        name: "Components Palette",
        id: LayoutModels.COMPONENTS_PALETTE_TAB_ID,
        component: "componentsPalette",
        icon: "svg:components"
    };

    static iconFactory = (node: FlexLayout.TabNode) => {
        let icon = node.getIcon();
        if (!icon || typeof icon != "string") {
            return null;
        }
        const parent = node.getParent();
        const isActivityBar =
            node.getClassName() === "DigiStudio_ActivityBarTab" ||
            (parent instanceof FlexLayout.BorderNode &&
                parent.getLocation().getName() === "left");
        return <Icon icon={icon} size={isActivityBar ? 22 : 20} />;
    };

    rootEditor: FlexLayout.Model;
    rootEditorForIEXT: FlexLayout.Model;
    rootRuntime: FlexLayout.Model;
    rootDockerSimulator: FlexLayout.Model;

    // Track if docker simulator mode is active
    isDockerSimulatorMode: boolean = false;

    get root() {
        if (this.projectStore.projectTypeTraits.isIEXT) {
            return this.rootEditorForIEXT;
        }
        if (this.isDockerSimulatorMode) {
            return this.rootDockerSimulator;
        }
        return this.projectStore.runtime ? this.rootRuntime : this.rootEditor;
    }

    styles: FlexLayout.Model;
    lvglStyles: FlexLayout.Model;
    bitmaps: FlexLayout.Model;
    audio: FlexLayout.Model;
    fonts: FlexLayout.Model;
    themes: FlexLayout.Model;
    scpi: FlexLayout.Model;
    texts: FlexLayout.Model;
    lvglGroups: FlexLayout.Model;

    constructor(public projectStore: ProjectStore) {
        super();

        makeObservable(this, {
            rootEditor: observable,
            rootEditorForIEXT: observable,
            rootRuntime: observable,
            rootDockerSimulator: observable,

            isDockerSimulatorMode: observable,
            root: computed,

            styles: observable,
            lvglStyles: observable,
            bitmaps: observable,
            audio: observable,
            fonts: observable,
            themes: observable,
            scpi: observable,
            texts: observable,
            lvglGroups: observable
        });
    }

    get borders() {
        const borders: FlexLayout.IJsonBorderNode[] = [
            {
                type: "border",
                location: "top",
                children: []
            }
        ];

        borders.push({
            type: "border",
            location: "right",
            size: 360,
            selected: 0,
            className: "DigiStudio_AuxiliaryBar",
            children: [
                LayoutModels.PROPERTIES_TAB,
                LayoutModels.COMPONENTS_PALETTE_TAB,
                LayoutModels.STYLES_TAB,
                LayoutModels.FONTS_TAB,
                LayoutModels.BITMAPS_TAB,
                LayoutModels.AUDIO_TAB,
                LayoutModels.THEMES_TAB,
                LayoutModels.LVGL_GROUPS_TAB,
                LayoutModels.BREAKPOINTS_TAB
            ]
        });

        borders.push({
            type: "border",
            location: "bottom",
            children: [
                {
                    type: "tab",
                    enableClose: false,
                    name: "Checks",
                    id: LayoutModels.CHECKS_TAB_ID,
                    component: "checksMessages"
                },
                {
                    type: "tab",
                    enableClose: false,
                    name: "Output",
                    id: LayoutModels.OUTPUT_TAB_ID,
                    component: "outputMessages"
                },
                {
                    type: "tab",
                    enableClose: false,
                    name: "Search",
                    id: LayoutModels.SEARCH_TAB_ID,
                    component: "search"
                },
                {
                    type: "tab",
                    enableClose: false,
                    name: "References",
                    id: LayoutModels.REFERENCES_TAB_ID,
                    component: "references"
                }
            ]
        });

        borders.push({
            type: "border",
            location: "left",
            size: 340,
            selected: 0,
            className: "DigiStudio_ActivityBar",
            children: [
                LayoutModels.PAGES_TAB,
                LayoutModels.WIDGETS_TAB,
                LayoutModels.ACTIONS_TAB,
                LayoutModels.FLOW_STRUCTURE_TAB,
                LayoutModels.VARIABLES_TAB,
                LayoutModels.TEXTS_TAB,
                LayoutModels.EMBEDDED_PLATFORM_TAB,
                LayoutModels.SCPI_TAB,
                LayoutModels.INSTRUMENT_COMMANDS_TAB,
                LayoutModels.EXTENSION_DEFINITIONS_TAB,
                LayoutModels.CHANGES_TAB
            ]
        });

        return borders;
    }

    get bordersIEXT() {
        const borders: FlexLayout.IJsonBorderNode[] = [
            {
                type: "border",
                location: "top",
                children: []
            }
        ];

        borders.push({
            type: "border",
            location: "right",
            size: 420,
            selected: 0,
            className: "DigiStudio_AuxiliaryBar",
            children: [LayoutModels.PROPERTIES_TAB]
        });

        borders.push({
            type: "border",
            location: "bottom",
            children: [
                {
                    type: "tab",
                    enableClose: false,
                    name: "Checks",
                    id: LayoutModels.CHECKS_TAB_ID,
                    component: "checksMessages"
                },
                {
                    type: "tab",
                    enableClose: false,
                    name: "Output",
                    id: LayoutModels.OUTPUT_TAB_ID,
                    component: "outputMessages"
                },
                {
                    type: "tab",
                    enableClose: false,
                    name: "Search",
                    id: LayoutModels.SEARCH_TAB_ID,
                    component: "search"
                },
                {
                    type: "tab",
                    enableClose: false,
                    name: "References",
                    id: LayoutModels.REFERENCES_TAB_ID,
                    component: "references"
                }
            ]
        });

        borders.push({
            type: "border",
            location: "left",
            size: 350,
            selected: 0,
            className: "DigiStudio_ActivityBar",
            children: [
                LayoutModels.EXTENSION_DEFINITIONS_TAB,
                LayoutModels.SCPI_TAB,
                LayoutModels.INSTRUMENT_COMMANDS_TAB,
                LayoutModels.CHANGES_TAB
            ]
        });

        return borders;
    }

    get bordersRuntime() {
        return [
            {
                type: "border",
                location: "left",
                size: 320,
                selected: 0,
                className: "DigiStudio_ActivityBar",
                children: [
                    LayoutModels.PAGES_TAB,
                    LayoutModels.WIDGETS_TAB,
                    LayoutModels.ACTIONS_TAB,
                    {
                        type: "tab",
                        enableClose: false,
                        name: "Active Flows",
                        icon: "svg:active_flows_panel",
                        component: "active-flows"
                    },
                    {
                        type: "tab",
                        enableClose: false,
                        name: "Watch",
                        icon: "svg:watch_panel",
                        component: "watch"
                    }
                ]
            },
            {
                type: "border",
                location: "right",
                size: 320,
                selected: 0,
                className: "DigiStudio_AuxiliaryBar",
                children: [
                    {
                        type: "tab",
                        enableClose: false,
                        name: "Queue",
                        icon: "svg:queue_panel",
                        component: "queue"
                    },
                    LayoutModels.BREAKPOINTS_TAB,
                    {
                        type: "tab",
                        enableClose: false,
                        name: "Logs",
                        id: LayoutModels.DEBUGGER_LOGS_TAB_ID,
                        icon: "svg:log",
                        component: "logs"
                    }
                ]
            }
        ] as FlexLayout.IJsonBorderNode[];
    }

    get models(): ILayoutModel[] {
        return [
            {
                name: "rootEditor",
                version: 119,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: this.borders,
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "tabset",
                                weight: 1,
                                enableDeleteWhenEmpty: false,
                                enableClose: false,
                                id: LayoutModels.EDITOR_MODE_EDITORS_TABSET_ID,
                                children: []
                            }
                        ]
                    }
                },
                get: () => this.rootEditor,
                set: action(model => (this.rootEditor = model))
            },
            {
                name: "rootEditorForIEXT",
                version: 6,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: this.bordersIEXT,
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "tabset",
                                weight: 50,
                                enableClose: false,
                                enableDeleteWhenEmpty: false,
                                id: LayoutModels.EDITOR_MODE_EDITORS_TABSET_ID,
                                children: []
                            }
                        ]
                    }
                },
                get: () => this.rootEditorForIEXT,
                set: action(model => (this.rootEditorForIEXT = model))
            },
            {
                name: "rootRuntime",
                version: 55,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: this.bordersRuntime,
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "tabset",
                                weight: 3,
                                enableClose: false,
                                enableDeleteWhenEmpty: false,
                                id: LayoutModels.RUNTIME_MODE_EDITORS_TABSET_ID,
                                children: []
                            }
                        ]
                    }
                },
                get: () => this.rootRuntime,
                set: action(model => (this.rootRuntime = model))
            },
            {
                name: "rootDockerSimulator",
                version: 1,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "tabset",
                                weight: 70,
                                enableTabStrip: true,
                                enableDrag: false,
                                enableDrop: false,
                                enableClose: false,
                                children: [
                                    {
                                        type: "tab",
                                        enableClose: false,
                                        name: "Preview",
                                        id: LayoutModels.DOCKER_SIMULATOR_PREVIEW_TAB_ID,
                                        icon: "material:computer",
                                        component: "dockerSimulatorPreview"
                                    }
                                ]
                            },
                            {
                                type: "row",
                                weight: 30,
                                children: [
                                    {
                                        type: "tabset",
                                        weight: 50,
                                        enableTabStrip: true,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Build Logs",
                                                id: LayoutModels.DOCKER_SIMULATOR_LOGS_TAB_ID,
                                                icon: "svg:log",
                                                component: "dockerSimulatorLogs"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        weight: 50,
                                        enableTabStrip: true,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Preview Logs",
                                                id: LayoutModels.DOCKER_SIMULATOR_PREVIEW_LOGS_TAB_ID,
                                                icon: "svg:log",
                                                component:
                                                    "dockerSimulatorPreviewLogs"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.rootDockerSimulator,
                set: action(model => (this.rootDockerSimulator = model))
            },
            {
                name: "bitmaps",
                version: 2,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "row",
                                children: [
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 75,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Bitmaps",
                                                component: "bitmaps"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 25,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Preview",
                                                component: "preview"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.bitmaps,
                set: action(model => (this.bitmaps = model))
            },
            {
                name: "audio",
                version: 3,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "row",
                                children: [
                                    {
                                        type: "tabset",
                                        enableClose: false,
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        weight: 25,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Audio Resources",
                                                component: "resources"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 50,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Preview",
                                                component: "preview"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 25,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Flash Layout",
                                                component: "flash-layout"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.audio,
                set: action(model => (this.audio = model))
            },
            {
                name: "fonts",
                version: 1,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "tabset",
                                enableTabStrip: false,
                                enableDrag: false,
                                enableDrop: false,
                                enableClose: false,
                                children: [
                                    {
                                        type: "tab",
                                        enableClose: false,
                                        component: "glyphs"
                                    }
                                ]
                            },
                            {
                                type: "tabset",
                                enableTabStrip: false,
                                enableDrag: false,
                                enableDrop: false,
                                enableClose: false,
                                children: [
                                    {
                                        type: "tab",
                                        enableClose: false,
                                        component: "editor"
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.fonts,
                set: action(model => (this.fonts = model))
            },
            {
                name: "scpi",
                version: 3,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "row",
                                children: [
                                    {
                                        type: "tabset",
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Subsystems",
                                                id: LayoutModels.SCPI_SUBSYSTEMS_TAB_ID,
                                                component: "subsystems"
                                            },
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Enums",
                                                id: LayoutModels.SCPI_ENUMS_TAB_ID,
                                                component: "enums"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Commands",
                                                id: LayoutModels.SCPI_COMMANDS_TAB_ID,
                                                component: "commands"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.scpi,
                set: action(model => (this.scpi = model))
            },
            {
                name: "styles",
                version: 2,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "row",
                                children: [
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 75,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Styles",
                                                component: "styles"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 25,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Preview",
                                                component: "preview"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.styles,
                set: action(model => (this.styles = model))
            },
            {
                name: "lvglStyles",
                version: 1,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "row",
                                children: [
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 75,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Styles",
                                                component: "styles"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 25,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Preview",
                                                component: "preview"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.lvglStyles,
                set: action(model => (this.lvglStyles = model))
            },
            {
                name: "themes",
                version: 1,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "row",
                                children: [
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                component: "themes"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        enableTabStrip: false,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                component: "colors"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.themes,
                set: action(model => (this.themes = model))
            },
            {
                name: "texts",
                version: 7,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "row",
                                children: [
                                    {
                                        type: "tabset",
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Text resources",
                                                id: LayoutModels.TEXT_RESOURCES_TAB_ID,
                                                component: "resources"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Languages",
                                                id: LayoutModels.LANGUAGES_TAB_ID,
                                                component: "languages"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Statistics",
                                                id: LayoutModels.TEXTS_STATISTICS_TAB_ID,
                                                component: "statistics"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.texts,
                set: action(model => (this.texts = model))
            },
            {
                name: "lvglGroups",
                version: 3,
                json: {
                    global: LayoutModels.GLOBAL_OPTIONS,
                    borders: [],
                    layout: {
                        type: "row",
                        children: [
                            {
                                type: "row",
                                children: [
                                    {
                                        type: "tabset",
                                        enableTabStrip: true,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 50,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Groups",
                                                component: "groups"
                                            }
                                        ]
                                    },
                                    {
                                        type: "tabset",
                                        enableTabStrip: true,
                                        enableDrag: false,
                                        enableDrop: false,
                                        enableClose: false,
                                        weight: 50,
                                        children: [
                                            {
                                                type: "tab",
                                                enableClose: false,
                                                name: "Group Widgets",
                                                component: "order"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                get: () => this.lvglGroups,
                set: action(model => (this.lvglGroups = model))
            }
        ];
    }

    load(layoutModels: any) {
        super.load(layoutModels);
        this.projectStore.project.enableTabs();
        this.ensureAudioBorderWidth();
        this.ensureLeftBorder();
    }

    ensureAudioBorderWidth() {
        const audioTab = this.rootEditor.getNodeById(
            LayoutModels.AUDIO_TAB_ID
        );

        if (
            audioTab instanceof FlexLayout.TabNode &&
            audioTab.toJson().borderWidth == undefined
        ) {
            this.rootEditor.doAction(
                FlexLayout.Actions.updateNodeAttributes(
                    LayoutModels.AUDIO_TAB_ID,
                    { borderWidth: 420 }
                )
            );
        }
    }

    ensureLeftBorder() {
        const models = [
            this.rootEditor,
            this.rootEditorForIEXT,
            this.rootRuntime,
            this.rootDockerSimulator
        ];

        for (const model of models) {
            if (!model) continue;
            try {
                model.visitNodes(node => {
                    if (!(node instanceof FlexLayout.BorderNode)) {
                        return;
                    }
                    const border = node;
                    const location = border.getLocation().getName();
                    const isLeft = location === "left";
                    const isEditorRightSidebar =
                        location === "right" &&
                        (model === this.rootEditor ||
                            model === this.rootEditorForIEXT);

                    if (!isLeft && !isEditorRightSidebar) {
                        return;
                    }

                    const expectedBorderClassName = isLeft
                        ? "DigiStudio_ActivityBar"
                        : "DigiStudio_AuxiliaryBar";
                    const borderUpdates: any = {};

                    if (border.getClassName() !== expectedBorderClassName) {
                        borderUpdates.className = expectedBorderClassName;
                    }
                    if (Object.keys(borderUpdates).length > 0) {
                        model.doAction(
                            FlexLayout.Actions.updateNodeAttributes(
                                border.getId(),
                                borderUpdates
                            )
                        );
                    }

                    for (const child of border.getChildren()) {
                        if (child instanceof FlexLayout.TabNode) {
                            const tabId = child.getId();
                            const expectedHelpText = isLeft
                                ? getActivityBarTabTitle(
                                      tabId,
                                      child.getName()
                                  )
                                : child.getName();
                            const updates: any = {};

                            if (child.getHelpText() !== expectedHelpText) {
                                updates.helpText = expectedHelpText;
                            }
                            if (
                                isLeft &&
                                child.getClassName() !==
                                    "DigiStudio_ActivityBarTab"
                            ) {
                                updates.className =
                                    "DigiStudio_ActivityBarTab";
                            }

                            if (Object.keys(updates).length > 0) {
                                model.doAction(
                                    FlexLayout.Actions.updateNodeAttributes(
                                        tabId,
                                        updates
                                    )
                                );
                            }
                        }
                    }
                });
            } catch (err) {
                console.error("Error ensuring left border:", err);
            }
        }
    }

    selectTab(model: FlexLayout.Model, tabId: string) {
        const node = model.getNodeById(tabId);
        if (node) {
            const parentNode = node.getParent();
            let isSelected = false;

            if (parentNode instanceof FlexLayout.TabSetNode) {
                isSelected = parentNode.getSelectedNode() == node;
            } else if (parentNode instanceof FlexLayout.BorderNode) {
                isSelected = parentNode.getSelectedNode() == node;
            }

            if (!isSelected) {
                model.doAction(FlexLayout.Actions.selectTab(tabId));
            }
        }

        this.projectStore.project.enableTabs();
        this.ensureAudioBorderWidth();
        this.ensureLeftBorder();
    }

    toggleComponentsPalette() {
        settingsController.showComponentsPaletteInProjectEditor =
            !settingsController.showComponentsPaletteInProjectEditor;
        this.projectStore.project.enableTabs();
        this.ensureLeftBorder();
    }

    reset() {
        for (const model of this.models) {
            model.set(FlexLayout.Model.fromJson(model.json));
        }

        this.projectStore.project.enableTabs();
        this.ensureAudioBorderWidth();
        this.ensureLeftBorder();
    }

    unmount() {}
}

export function getActivityBarTabTitle(nodeId: string, name?: string): string {
    switch (nodeId) {
        case LayoutModels.EMBEDDED_PLATFORM_TAB_ID:
            return "Embedded Platform";
        case LayoutModels.TEXTS_TAB_ID:
            return "Texts";
        case LayoutModels.SCPI_TAB_ID:
            return "SCPI";
        case LayoutModels.INSTRUMENT_COMMANDS_TAB_ID:
            return "Instrument Commands";
        case LayoutModels.EXTENSION_DEFINITIONS_TAB_ID:
            return "Extensions";
        case LayoutModels.CHANGES_TAB_ID:
            return "Changes";
        default:
            return name || nodeId;
    }
}
