import React from "react";
import { observer } from "mobx-react";
import classnames from "classnames";

import {
    LANGUAGE_ICON,
    CHANGES_ICON,
    VARIABLE_ICON,
    HIERARCHY_ICON,
    PROPERTIES_ICON,
    COMPONENTS_ICON,
    PALETTE_ICON,
    PAGES_ICON,
    PAGE_ICON,
    USER_WIDGETS_ICON,
    USER_WIDGET_ICON,
    LOG_ICON,
    WATCH_PANEL_ICON,
    QUEUE_PANEL_ICON,
    ACTIVE_FLOWS_PANEL_ICON,
    BREAKPOINTS_PANEL_ICON,
    PROJECT_EDITOR_SCRAPBOOK
} from "project-editor/ui-components/icons";

const MATERIAL_PREFIX = "material:";
const SVG_PREFIX = "svg:";
const GUI_GUIDER_PREFIX = "guider:";
const FONT_AWESOME_PREFIX = "fa:";

// Glyphs recovered from GUI Guider's shipped renderer CSS.
const GUI_GUIDER_ICON_GLYPHS: { [icon: string]: string } = {
    save: "\ue6e2",
    undo: "\ued85",
    redo: "\ued8a",
    python: "\ue6c2",
    debug: "\ue6dd"
};

// GUI Guider's operation bar uses Font Awesome 5 for these actions.
const FONT_AWESOME_ICON_GLYPHS: { [icon: string]: string } = {
    copy: "\uf0c5",
    paste: "\uf0ea",
    check: "\uf00c",
    hammer: "\uf6e3",
    download: "\uf019",
    registered: "\uf25d",
    play: "\uf04b",
    square: "\uf0c8"
};

// Material Symbols removed several style-specific Material Icons aliases.
// Keep existing icon references working while rendering the canonical symbol.
const MATERIAL_SYMBOL_ALIASES: { [icon: string]: string } = {
    error_outline: "error",
    file_download: "download",
    file_upload: "upload",
    font_download: "text_fields",
    cloud_search: "travel_explore",
    lightbulb_outline: "lightbulb",
    mode_edit: "edit",
    play_circle_filled: "play_circle",
    play_circle_outline: "play_circle"
};

const SVG_ICONS: { [icon: string]: JSX.Element } = {
    language: LANGUAGE_ICON,
    changes: CHANGES_ICON,
    variable: VARIABLE_ICON,
    hierarchy: HIERARCHY_ICON,
    properties: PROPERTIES_ICON,
    components: COMPONENTS_ICON,
    palette: PALETTE_ICON,
    pages: PAGES_ICON,
    page: PAGE_ICON,
    user_widgets: USER_WIDGETS_ICON,
    user_widget: USER_WIDGET_ICON,
    log: LOG_ICON,
    watch_panel: WATCH_PANEL_ICON,
    queue_panel: QUEUE_PANEL_ICON,
    active_flows_panel: ACTIVE_FLOWS_PANEL_ICON,
    breakpoints_panel: BREAKPOINTS_PANEL_ICON,
    "project-editor-scrapbook": PROJECT_EDITOR_SCRAPBOOK
};

export const Icon = observer(
    class Icon extends React.Component<
        {
            icon: string | JSX.Element | React.ReactNode;
            size?: number;
            className?: string;
            style?: React.CSSProperties;
            onClick?: (event: React.MouseEvent) => void;
            overlayText?: string;
            attention?: boolean;
            title?: string;
        },
        {}
    > {
        render() {
            const { size, style, className, onClick } = this.props;

            let icon = this.props.icon;

            let iconSize = size || 24;

            let result;

            const renderFontIcon = (fontClassName: string, glyph: string) => {
                const iconClassName = classnames(
                    "EezStudio_Icon",
                    fontClassName,
                    className
                );

                let iconStyle: React.CSSProperties = {
                    fontSize: iconSize + "px"
                };
                if (style) {
                    iconStyle = Object.assign(iconStyle, style);
                }

                const iconEl = (
                    <i
                        className={iconClassName}
                        style={iconStyle}
                        aria-hidden="true"
                        onClick={onClick}
                        title={this.props.title}
                    >
                        {glyph}
                    </i>
                );

                if (this.props.overlayText) {
                    return (
                        <div className="EezStudio_IconWithOverlayContainer">
                            {iconEl}
                            <span className="EezStudio_IconOverlay">
                                {this.props.overlayText}
                            </span>
                        </div>
                    );
                }

                return iconEl;
            };

            if (typeof icon === "string" && icon.startsWith(SVG_PREFIX)) {
                icon = SVG_ICONS[icon.substring(4)];
            }

            if (typeof icon === "string") {
                const guiGuiderGlyph = icon.startsWith(GUI_GUIDER_PREFIX)
                    ? GUI_GUIDER_ICON_GLYPHS[
                          icon.slice(GUI_GUIDER_PREFIX.length)
                      ]
                    : undefined;
                const fontAwesomeGlyph = icon.startsWith(
                    FONT_AWESOME_PREFIX
                )
                    ? FONT_AWESOME_ICON_GLYPHS[
                          icon.slice(FONT_AWESOME_PREFIX.length)
                      ]
                    : undefined;

                if (guiGuiderGlyph) {
                    result = renderFontIcon(
                        "EezStudio_GUI_GuiderIcon",
                        guiGuiderGlyph
                    );
                } else if (fontAwesomeGlyph) {
                    result = renderFontIcon(
                        "font-awesome-icons",
                        fontAwesomeGlyph
                    );
                } else if (icon.startsWith(MATERIAL_PREFIX)) {
                    let iconClassName = classnames(
                        "EezStudio_Icon",
                        "material-symbols-outlined",
                        className
                    );

                    const materialSymbol = icon.slice(MATERIAL_PREFIX.length);
                    const materialSymbolName =
                        MATERIAL_SYMBOL_ALIASES[materialSymbol] ||
                        materialSymbol;

                    let iconStyle = {
                        fontSize: iconSize + "px"
                    };
                    if (style) {
                        iconStyle = Object.assign(iconStyle, style);
                    }

                    const iconEl = (
                        <i
                            className={iconClassName}
                            style={iconStyle}
                            aria-hidden="true"
                            onClick={onClick}
                            title={this.props.title}
                        >
                            {materialSymbolName}
                        </i>
                    );

                    if (this.props.overlayText) {
                        result = (
                            <div className="EezStudio_IconWithOverlayContainer">
                                {iconEl}
                                <span className="EezStudio_IconOverlay">
                                    {this.props.overlayText}
                                </span>
                            </div>
                        );
                    } else {
                        result = iconEl;
                    }
                } else {
                    let iconStyle: React.CSSProperties = {
                        objectFit: "contain"
                    };
                    if (style) {
                        iconStyle = Object.assign(iconStyle, style);
                    }

                    result = (
                        <img
                            src={icon}
                            width={iconSize}
                            height={iconSize}
                            className={className}
                            style={iconStyle}
                            onClick={onClick}
                            title={this.props.title}
                        />
                    );
                }
            } else {
                const iconElement = icon as React.ReactElement<any>;
                let iconStyle: React.CSSProperties = Object.assign(
                    {},
                    iconElement.props.style
                );
                if (
                    typeof iconElement.props.className === "string" &&
                    iconElement.props.className.includes(
                        "material-symbols-outlined"
                    )
                ) {
                    iconStyle = Object.assign(iconStyle, {
                        fontSize: iconSize + "px"
                    });
                }
                if (style) {
                    iconStyle = Object.assign(iconStyle, style);
                }

                result = React.cloneElement(iconElement, {
                    className: classnames(
                        "EezStudio_Icon",
                        iconElement.props.className,
                        className
                    ),
                    style: iconStyle,
                    width: iconSize,
                    height: iconSize,
                    onClick: onClick,
                    title: this.props.title
                });
            }

            if (this.props.attention) {
                return (
                    <div className="EezStudio_AttentionContainer">
                        {result}
                        <div className="EezStudio_AttentionDiv" />
                    </div>
                );
            }

            return result;
        }
    }
);
