"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.resolve(__dirname, "..", "..");
const sourcePath = process.env.GUIGUIDER_PATH ||
    "C:\\Users\\Administrator\\Documents\\S350GUI_GUIder\\S350GUI_GUider\\GUI_NEW\\update21.guiguider";
const templatePath = path.join(
    repoRoot,
    "resources",
    "project-templates",
    "templates",
    "v0.23.0",
    "LVGL with EEZ Flow-8.3.eez-project"
);
const outputDir = path.join(repoRoot, "projects", "update21");
const outputPath = path.join(outputDir, "DigiwiseStudio_update21.eez-project");
const reportPath = path.join(outputDir, "import-report.json");

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function idFor(kind, key) {
    const hash = crypto
        .createHash("sha256")
        .update(`${kind}:${key}`)
        .digest("hex");
    const hex = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return hex;
}

function numberValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clampSize(value, fallback) {
    return Math.max(0, numberValue(value, fallback));
}

function sourceNodes(node) {
    if (!node || typeof node !== "object") {
        return [];
    }
    const children = Array.isArray(node.child)
        ? node.child
        : Array.isArray(node.list)
          ? node.list
          : [];
    return children;
}

function allNodes(nodes, result = []) {
    for (const node of nodes || []) {
        result.push(node);
        allNodes(sourceNodes(node), result);
    }
    return result;
}

function safeName(value) {
    return String(value || "widget")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/^([^a-zA-Z_])/, "_$1")
        .slice(0, 48);
}

function colorValue(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const valueTrimmed = value.trim();
    return /^#[0-9a-f]{6}$/i.test(valueTrimmed)
        ? valueTrimmed.toUpperCase()
        : undefined;
}

function fontValue(size) {
    const number = numberValue(size, 20);
    const values = [14, 16, 20, 24, 28, 32, 40, 48];
    let closest = values[0];
    for (const candidate of values) {
        if (Math.abs(candidate - number) < Math.abs(closest - number)) {
            closest = candidate;
        }
    }
    return `MONTSERRAT_${closest}`;
}

function stateName(value) {
    const text = String(value || "LV_STATE_DEFAULT");
    const match = text.match(/LV_STATE_([A-Z0-9_]+)/);
    if (!match) {
        return "DEFAULT";
    }
    const state = match[1];
    return ["DEFAULT", "PRESSED", "DISABLED", "CHECKED", "FOCUSED", "FOCUS_KEY", "EDITED", "HOVERED", "SCROLLED"].includes(state)
        ? state
        : "DEFAULT";
}

function partName(value) {
    const match = String(value || "LV_PART_MAIN").match(/LV_PART_([A-Z0-9_]+)/);
    return match ? match[1] : "MAIN";
}

function alignValue(value) {
    const text = String(value || "");
    const match = text.match(/LV_TEXT_ALIGN_([A-Z]+)/);
    if (match && ["LEFT", "CENTER", "RIGHT"].includes(match[1])) {
        return match[1];
    }
    if (["LEFT", "CENTER", "RIGHT"].includes(text)) {
        return text;
    }
    return undefined;
}

function defaultStyleFor(type) {
    if (type === "LVGLScreenWidget") {
        return { bg_color: "#000000", bg_opa: 255 };
    }
    if (type === "LVGLLabelWidget") {
        return {
            text_font: "MONTSERRAT_20",
            text_color: "#FFFFFF",
            text_opa: 255,
            text_align: "LEFT"
        };
    }
    if (type === "LVGLButtonWidget") {
        return {
            bg_color: "#1D1D1D",
            bg_opa: 255,
            border_color: "#666666",
            border_width: 1,
            radius: 0
        };
    }
    if (type === "LVGLContainerWidget" || type === "LVGLPanelWidget") {
        return { bg_opa: 0 };
    }
    return {};
}

function styleDefinition(rawStyle, type) {
    const records = Array.isArray(rawStyle)
        ? rawStyle.filter(item => item && typeof item === "object")
        : [];
    const definition = {};
    const propertyMap = {
        border_width: "border_width",
        border_opa: "border_opa",
        radius: "radius",
        text_opa: "text_opa",
        bg_opa: "bg_opa",
        bg_grad_dir: "bg_grad_dir",
        bg_main_stop: "bg_main_stop",
        bg_grad_stop: "bg_grad_stop",
        bg_dither_mode: "bg_dither_mode",
        letter_space: "letter_space",
        line_space: "line_space",
        padding_top: "pad_top",
        padding_right: "pad_right",
        padding_bottom: "pad_bottom",
        padding_left: "pad_left",
        shadow_opa: "shadow_opa",
        shadow_width: "shadow_width",
        shadow_spread: "shadow_spread",
        shadow_ofs_x: "shadow_ofs_x",
        shadow_ofs_y: "shadow_ofs_y",
        outline_width: "outline_width",
        outline_opa: "outline_opa",
        outline_pad: "outline_pad",
        image_opa: "image_opa",
        image_recolor_opa: "image_recolor_opa"
    };

    for (const record of records) {
        const part = partName(record.part);
        const state = stateName(record.state);
        const target = definition[part] || (definition[part] = {});
        const stateStyle = target[state] || (target[state] = {});

        for (const [sourceKey, targetKey] of Object.entries(propertyMap)) {
            const value = record[sourceKey];
            if (value !== undefined && value !== null && value !== "") {
                stateStyle[targetKey] = typeof value === "number"
                    ? value
                    : numberValue(value, value);
            }
        }

        const colors = [
            ["border_color", "border_color"],
            ["text_color", "text_color"],
            ["bg_color", "bg_color"],
            ["bg_grad_color", "bg_grad_color"],
            ["shadow_color", "shadow_color"],
            ["outline_color", "outline_color"],
            ["bg_img_recolor", "image_recolor"]
        ];
        for (const [sourceKey, targetKey] of colors) {
            const color = colorValue(record[sourceKey]);
            if (color) {
                stateStyle[targetKey] = color;
            }
        }

        const alignment = alignValue(record.text_align);
        if (alignment) {
            stateStyle.text_align = alignment;
        }
        if (record.font !== undefined) {
            stateStyle.text_font = fontValue(record.font);
        }
    }

    if (Object.keys(definition).length === 0) {
        const fallback = defaultStyleFor(type);
        if (Object.keys(fallback).length > 0) {
            definition.MAIN = { DEFAULT: fallback };
        }
    }

    for (const part of Object.keys(definition)) {
        for (const state of Object.keys(definition[part])) {
            if (Object.keys(definition[part][state]).length === 0) {
                delete definition[part][state];
            }
        }
        if (Object.keys(definition[part]).length === 0) {
            delete definition[part];
        }
    }
    return definition;
}

function widgetFlags(type, interactive) {
    if (type === "LVGLScreenWidget") {
        return "CLICKABLE|PRESS_LOCK|CLICK_FOCUSABLE|GESTURE_BUBBLE|SNAPPABLE|SCROLLABLE|SCROLL_ELASTIC|SCROLL_MOMENTUM|SCROLL_CHAIN_HOR|SCROLL_CHAIN_VER";
    }
    if (interactive) {
        return "CLICKABLE|PRESS_LOCK|CLICK_FOCUSABLE|GESTURE_BUBBLE|SNAPPABLE|SCROLLABLE|SCROLL_ELASTIC|SCROLL_MOMENTUM|SCROLL_CHAIN_HOR|SCROLL_CHAIN_VER";
    }
    return "CLICK_FOCUSABLE|GESTURE_BUBBLE|PRESS_LOCK|SCROLLABLE|SCROLL_CHAIN_HOR|SCROLL_CHAIN_VER|SCROLL_ELASTIC|SCROLL_MOMENTUM|SCROLL_WITH_ARROW|SNAPPABLE";
}

function mapWidgetType(sourceType) {
    return {
        scr: "LVGLScreenWidget",
        cont: "LVGLContainerWidget",
        obj: "LVGLPanelWidget",
        label: "LVGLLabelWidget",
        btn: "LVGLButtonWidget",
        img: "LVGLImageWidget",
        roller: "LVGLRollerWidget",
        tabview: "LVGLTabviewWidget",
        tab: "LVGLTabWidget",
        line: "LVGLLineWidget",
        tileview: "LVGLTileViewWidget",
        qrcode: "LVGLQRCodeWidget",
        sw: "LVGLSwitchWidget"
    }[sourceType] || "LVGLContainerWidget";
}

function eventName(value) {
    const map = {
        clicked: "CLICKED",
        click: "CLICKED",
        short_clicked: "SHORT_CLICKED",
        pressed: "PRESSED",
        released: "RELEASED",
        long_pressed: "LONG_PRESSED",
        gesture: "GESTURE",
        gesture_left: "GESTURE",
        gesture_right: "GESTURE",
        gesture_up: "GESTURE",
        gesture_down: "GESTURE",
        value_changed: "VALUE_CHANGED",
        screen_load_start: "SCREEN_LOAD_START",
        screen_loaded: "SCREEN_LOADED",
        screen_unload_start: "SCREEN_UNLOAD_START",
        screen_unloaded: "SCREEN_UNLOADED"
    };
    return map[String(value || "").toLowerCase()];
}

function animationName(value) {
    const map = {
        LV_SCR_LOAD_ANIM_NONE: "NONE",
        LV_SCR_LOAD_ANIM_MOVE_LEFT: "MOVE_LEFT",
        LV_SCR_LOAD_ANIM_MOVE_RIGHT: "MOVE_RIGHT",
        LV_SCR_LOAD_ANIM_MOVE_TOP: "MOVE_TOP",
        LV_SCR_LOAD_ANIM_MOVE_BOTTOM: "MOVE_BOTTOM",
        LV_SCR_LOAD_ANIM_FADE_ON: "FADE_IN",
        LV_SCR_LOAD_ANIM_FADE_IN: "FADE_IN",
        LV_SCR_LOAD_ANIM_FADE_OUT: "FADE_OUT",
        LV_SCR_LOAD_ANIM_OVER_LEFT: "OVER_LEFT",
        LV_SCR_LOAD_ANIM_OVER_RIGHT: "OVER_RIGHT",
        LV_SCR_LOAD_ANIM_OVER_TOP: "OVER_TOP",
        LV_SCR_LOAD_ANIM_OVER_BOTTOM: "OVER_BOTTOM",
        LV_SCR_LOAD_ANIM_OUT_LEFT: "OUT_LEFT",
        LV_SCR_LOAD_ANIM_OUT_RIGHT: "OUT_RIGHT",
        LV_SCR_LOAD_ANIM_OUT_TOP: "OUT_TOP",
        LV_SCR_LOAD_ANIM_OUT_BOTTOM: "OUT_BOTTOM"
    };
    return map[value] || "FADE_IN";
}

function collectLoadActions(event, result) {
    if (!event || typeof event !== "object") {
        return;
    }
    const widgetEvents = event.widget;
    if (!widgetEvents || typeof widgetEvents !== "object") {
        return;
    }
    for (const [eventKey, eventValue] of Object.entries(widgetEvents)) {
        const stack = [eventValue];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current || typeof current !== "object") {
                continue;
            }
            if (current.actionList && current.actionList.load_screen) {
                result.push({
                    eventKey,
                    action: current.actionList.load_screen
                });
            }
            if (Array.isArray(current)) {
                stack.push(...current);
            } else {
                stack.push(...Object.values(current));
            }
        }
    }
}

function dataUri(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".gif"
          ? "image/gif"
          : "image/png";
    return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

if (!fs.existsSync(sourcePath)) {
    throw new Error(`找不到 GUI Guider 工程：${sourcePath}`);
}
if (!fs.existsSync(templatePath)) {
    throw new Error(`找不到 DigiwiseStudio LVGL 模板：${templatePath}`);
}

const guider = readJson(sourcePath);
const template = readJson(templatePath);
const pages = Array.isArray(guider.FrontJson) ? guider.FrontJson : [];
const pageById = new Map(pages.map(page => [page.id, page]));
const pageByName = new Map(pages.map(page => [page.name, page]));
const styles = [];
const styleNames = new Map();
const unsupportedTypes = new Map();
const sourceToWidget = new Map();
const navigationReport = [];
const unresolvedNavigation = [];
let convertedWidgetCount = 0;
let customCodeHooks = 0;

// GUI Guider stores many of update21's screen changes in empty custom_code
// action shells.  Those shells contain no executable code in the exported
// project, but the page/component names are enough to recover the intended
// navigation without inventing device business logic.
const inferredNavigationTargets = {
    menu_screen: {
        menu_list_cont_1: "basic_setting_screen",
        menu_list_cont_2: "ebike_setting_screen",
        menu_list_cont_3: "app_connect_screen",
        menu_list_cont_4: "smart_devices_screen",
        menu_list_cont_5: "battery_info_screen",
        menu_list_cont_6: "system_information_screen"
    },
    basic_setting_screen: {
        menu_list_cont_1: "languages_screen",
        menu_list_cont_2: "time_format_screen",
        menu_list_cont_3: "rtc_time_screen",
        menu_list_cont_4: "unit_screen",
        menu_list_cont_5: "menu_screen"
    },
    app_connect_screen: {
        menu_list_cont_1: "download_app_screen"
    },
    control_information_screen: {
        cont_5: "menu_screen"
    },
    clear_trip_screen: {
        back_btn: "ebike_setting_screen"
    },
    smart_devices_screen: {
        menu_list_cont_1: "add_smart_devices_screen"
    },
    add_smart_devices_screen: {
        menu_list_cont_1: "add_radar_screen",
        menu_list_cont_2: "my_tire_pressure_screen",
        menu_list_cont_3: "my_helmet_screen",
        menu_list_cont_4: "my_radar_camer_screen",
        menu_list_cont_5: "smart_devices_screen"
    },
    Factory_Resets_screen: {
        back_btn: "ebike_setting_screen",
        ok_btn: "top_state_screen"
    },
    advanced_setting_screen: {
        push_power_percent_cont: "Push_Power_Percent_screen",
        slow_start_cont: "Slow_Start_screen",
        controller_current_limit_cont: "controller_current_limit_screen",
        undervoltage_value_cont: "under_voltage_value_screen",
        PAS_Level_range_cont: "PAS_level_range_screen",
        maxvoltage_value_cont: "maxvoltage_value_screen",
        PAS_sensor_ratio_cont: "PAS_sensor_ratio_screen",
        speed_sensor_number_cont: "speed_sensor_number_screen",
        PAS_level_cont: "pas_Level_screen",
        throttle_level_cont: "Throttle_Level_screen",
        back_cont: "ebike_setting_screen",
        battery_voltage_cont: "battery_voltage_screen",
        speed_sensor_cont: "speed_sensor_screen",
        wheel_circum_cont: "wheel_circumference_screen",
        wheel_diameter_cont: "wheel_diameter_screen"
    },
    open_password_screen: {
        submit_btn: "advanced_setting_screen"
    },
    add_radar_screen: {
        Back_cont: "smart_devices_screen"
    },
    my_radar_camer_screen: {
        back_cont: "smart_devices_screen"
    },
    my_helmet_screen: {
        back_cont: "smart_devices_screen",
        mode_cont: "light_model_screen"
    },
    light_model_screen: {
        back_cont: "my_helmet_screen"
    },
    add_tire_pressure_screen: {
        back_cont: "smart_devices_screen",
        confirm_cont: "my_tire_pressure_screen"
    },
    my_tire_pressure_screen: {
        high_cont: "set_tire_presssure_value_screen",
        low_cont: "set_tire_presssure_value_screen",
        unit_cont: "set_tire_presssure_unit_screen",
        back_cont: "smart_devices_screen"
    },
    set_tire_presssure_value_screen: {
        btn_1: "my_tire_pressure_screen"
    },
    set_tire_presssure_unit_screen: {
        btn_1: "my_tire_pressure_screen"
    },
    languages_screen: { btn_1: "basic_setting_screen" },
    time_format_screen: { btn_1: "basic_setting_screen" },
    unit_screen: { btn_1: "basic_setting_screen" },
    rtc_time_screen: { btn_1: "basic_setting_screen" },
    auto_power_off_screen: { btn_1: "advanced_setting_screen" },
    auto_headlight_screen: { btn_1: "advanced_setting_screen" },
    auto_backlight_screen: { btn_1: "advanced_setting_screen" },
    speed_limit_screen: { btn_1: "advanced_setting_screen" },
    wheel_diameter_screen: { btn_1: "advanced_setting_screen" },
    wheel_circumference_screen: { btn_1: "advanced_setting_screen" },
    speed_sensor_screen: { btn_1: "advanced_setting_screen" },
    battery_voltage_screen: { btn_1: "advanced_setting_screen" },
    PAS_level_range_screen: { btn_1: "advanced_setting_screen" },
    pas_Level_screen: { btn_1: "advanced_setting_screen" },
    controller_current_limit_screen: { btn_1: "advanced_setting_screen" },
    PAS_sensor_direction_screen: { btn_1: "advanced_setting_screen" },
    under_voltage_value_screen: { btn_1: "advanced_setting_screen" },
    maxvoltage_value_screen: { btn_1: "advanced_setting_screen" },
    speed_sensor_number_screen: { btn_1: "advanced_setting_screen" },
    PAS_sensor_ratio_screen: { btn_1: "advanced_setting_screen" },
    Throttle_Walk_Assit_screen: { btn_1: "advanced_setting_screen" },
    Throttle_Level_screen: { btn_1: "advanced_setting_screen" },
    Slow_Start_screen: { btn_1: "advanced_setting_screen" },
    Push_Power_Percent_screen: { btn_1: "advanced_setting_screen" }
};

function inferredTarget(pageName, sourceNode, eventKey) {
    if (String(eventKey).toLowerCase() !== "clicked") {
        return undefined;
    }
    return inferredNavigationTargets[pageName]?.[sourceNode?.name];
}

function registerStyle(type, definition) {
    if (!definition || Object.keys(definition).length === 0) {
        return "default";
    }
    const key = `${type}:${JSON.stringify(definition)}`;
    const existing = styleNames.get(key);
    if (existing) {
        return existing;
    }
    const name = `UPDATE21_${safeName(type.replace(/^LVGL/, "").replace(/Widget$/, ""))}_${crypto.createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
    styleNames.set(key, name);
    styles.push({
        objID: idFor("style", key),
        name,
        forWidgetType: type,
        childStyles: [],
        definition: {
            objID: idFor("style-definition", key),
            definition
        }
    });
    return name;
}

function makeWidget(source, pageName, indexPath) {
    const type = mapWidgetType(source.type);
    if (!mapWidgetType.hasOwnProperty?.(source.type) && !["scr", "cont", "obj", "label", "btn", "img", "roller", "tabview", "tab", "line", "tileview", "qrcode", "sw"].includes(source.type)) {
        unsupportedTypes.set(source.type || "unknown", (unsupportedTypes.get(source.type || "unknown") || 0) + 1);
    }

    const key = `${pageName}:${source.id || indexPath}`;
    const children = sourceNodes(source).map((child, childIndex) =>
        makeWidget(child, pageName, `${indexPath}.${childIndex}`)
    );
    const hasKnownEvents = !!source.event;
    const interactive = type === "LVGLButtonWidget" || type === "LVGLSwitchWidget" || hasKnownEvents;
    const definition = styleDefinition(source.style, type);
    const styleName = registerStyle(type, definition);
    const widget = {
        objID: idFor("widget", key),
        type,
        left: numberValue(source.left, 0),
        top: numberValue(source.top, 0),
        width: clampSize(source.width, type === "LVGLLabelWidget" ? 180 : 100),
        height: clampSize(source.height, type === "LVGLLabelWidget" ? 32 : 32),
        customInputs: [],
        customOutputs: [],
        style: {
            objID: idFor("widget-style", key),
            useStyle: "default",
            conditionalStyles: [],
            childStyles: []
        },
        timeline: [],
        eventHandlers: [],
        leftUnit: "px",
        topUnit: "px",
        widthUnit: "px",
        heightUnit: "px",
        children,
        widgetFlags: widgetFlags(type, interactive),
        hiddenFlagType: "literal",
        clickableFlagType: "literal",
        checkedStateType: "literal",
        disabledStateType: "literal",
        states: "",
        localStyles: {
            objID: idFor("local-style", key),
            definition
        },
        groupIndex: 0
    };

    if (styleName !== "default") {
        widget.useStyle = styleName;
    }
    if (source.visible === false) {
        widget.visible = false;
    }
    if (interactive) {
        widget.clickableFlag = true;
    }
    if (type === "LVGLLabelWidget") {
        widget.text = source.text == null ? "" : String(source.text);
        widget.textType = "literal";
        widget.longMode = String(source.long_mode || "").includes("DOT") ? "DOT" : "WRAP";
        widget.recolor = false;
        widget.useStaticText = true;
    } else if (type === "LVGLImageWidget") {
        const imagePath = typeof source.img_path === "string" ? source.img_path : "";
        const basename = path.basename(imagePath).replace(/\.[^.]+$/, "");
        widget.image = basename;
        widget.setPivot = true;
        widget.pivotX = numberValue(source.x, 50);
        widget.pivotY = numberValue(source.y, 50);
        widget.zoom = numberValue(source.zoom, 256);
        widget.angle = numberValue(source.rotate, 0);
        widget.innerAlign = "CENTER";
        widget.sizeMode = "VIRTUAL";
    } else if (type === "LVGLRollerWidget") {
        widget.options = typeof source.options === "string" ? source.options : "";
        widget.optionsType = "literal";
        widget.mode = "NORMAL";
        widget.selected = 0;
        widget.selectedType = "literal";
    } else if (type === "LVGLTabviewWidget") {
        // DigiwiseStudio requires these tabview properties even when the
        // source project only describes the tab children.
        widget.tabviewPosition = "TOP";
        widget.tabviewSize = 32;
        widget.selectedTab = 0;
        widget.selectedTabType = "literal";
    } else if (type === "LVGLTabWidget") {
        widget.tabName = String(source.name || source.tab_name || source.text || "Tab");
        widget.tabNameType = "literal";
    } else if (type === "LVGLLineWidget") {
        widget.points = typeof source.points === "string" ? source.points : "0,0 50,50 100,0";
        widget.invertY = false;
    } else if (type === "LVGLQRCodeWidget") {
        widget.text = typeof source.text === "string" ? source.text : "";
        widget.darkColor = "#000000";
        widget.lightColor = "#FFFFFF";
    } else if (type === "LVGLSwitchWidget") {
        widget.checked = false;
    }

    sourceToWidget.set(source.id, widget);
    convertedWidgetCount += 1;
    return widget;
}

function makeNavigationAction(pageName, sourceWidget, action, eventKey, sourceNode) {
    let targetPage = pageById.get(action.scrId);
    if (!targetPage) {
        const inferredPageName = inferredTarget(pageName, sourceNode, eventKey);
        if (inferredPageName) {
            targetPage = pageByName.get(inferredPageName);
        }
    }
    if (!targetPage) {
        unresolvedNavigation.push({
            page: pageName,
            source: sourceNode?.name || sourceNode?.id,
            event: eventKey,
            reason: action.scrId ? `目标页面不存在：${action.scrId}` : "GUI Guider 动作未给出目标页面"
        });
        return;
    }

    const handlerEvent = eventName(eventKey);
    if (!handlerEvent) {
        unresolvedNavigation.push({
            page: pageName,
            source: sourceNode?.name || sourceNode?.id,
            event: eventKey,
            target: targetPage.name,
            reason: "DigiwiseStudio 没有同名事件，已保留在导入报告"
        });
        return;
    }

    const actionId = idFor("navigation-action", `${pageName}:${sourceNode.id}:${eventKey}:${targetPage.name}`);
    const componentId = idFor("navigation-component", `${pageName}:${sourceNode.id}:${eventKey}:${targetPage.name}`);
    const animation = animationName(action.anim_type);
    const duration = numberValue(action.duration, 200);
    const delay = numberValue(action.delay, 0);
    const actionComponent = {
        objID: componentId,
        type: "LVGLActionComponent",
        left: 0,
        top: 660,
        width: 320,
        height: 80,
        customInputs: [],
        customOutputs: [],
        actions: [
            {
                objID: actionId,
                action: "changeScreen",
                fadeMode: animation,
                speed: duration,
                delay,
                fadeModeType: "literal",
                speedType: "literal",
                delayType: "literal",
                screen: targetPage.name,
                screenType: "literal",
                useStack: !action.is_clean,
                useStackType: "literal"
            }
        ]
    };
    sourceWidget.eventHandlers.push({
        objID: idFor("event-handler", `${pageName}:${sourceNode.id}:${eventKey}:${targetPage.name}`),
        eventName: handlerEvent,
        handlerType: "flow",
        userData: 0
    });
    navigationReport.push({
        page: pageName,
        source: sourceNode.name || sourceNode.id,
        event: eventKey,
        mappedEvent: handlerEvent,
        target: targetPage.name,
        animation,
        duration,
        delay,
        directionPreserved: !eventKey.startsWith("gesture_")
    });
    return {
        actionComponent,
        connectionLine: {
            objID: idFor("connection", `${pageName}:${sourceNode.id}:${eventKey}:${targetPage.name}`),
            source: sourceWidget.objID,
            output: handlerEvent,
            target: componentId,
            input: "@seqin"
        }
    };
}

function placeNavigationComponent(component, index) {
    // Keep multiple menu actions readable in the Flow editor instead of
    // stacking every recovered transition on the same coordinates.
    component.left = (index % 2) * 360;
    component.top = 660 + Math.floor(index / 2) * 100;
}

function convertPage(sourcePage) {
    sourceToWidget.clear();
    const root = makeWidget({
        ...sourcePage,
        type: "scr",
        child: Array.isArray(sourcePage.list) ? sourcePage.list : []
    }, sourcePage.name, "root");
    root.width = numberValue(sourcePage.width, 960);
    root.height = numberValue(sourcePage.height, 640);
    root.clickableFlag = true;

    const pageActionComponents = [];
    const connectionLines = [];
    const nodes = [sourcePage, ...allNodes(sourcePage.list || [])];

    for (const sourceNode of nodes) {
        const sourceWidget = sourceToWidget.get(sourceNode.id) || root;
        const loadActions = [];
        collectLoadActions(sourceNode.event, loadActions);
        for (const { eventKey, action } of loadActions) {
            const navigation = makeNavigationAction(
                sourcePage.name,
                sourceWidget,
                action,
                eventKey,
                sourceNode
            );
            if (navigation) {
                placeNavigationComponent(navigation.actionComponent, pageActionComponents.length);
                pageActionComponents.push(navigation.actionComponent);
                connectionLines.push(navigation.connectionLine);
            }
        }
    }

    // Add safe, name-based screen transitions for empty custom_code shells
    // that have no load_screen action at all.  This makes the imported
    // update21 project navigable while leaving value changes and device
    // protocol logic untouched.
    const inferredPageTargets = inferredNavigationTargets[sourcePage.name] || {};
    for (const [sourceName, targetName] of Object.entries(inferredPageTargets)) {
        const sourceNode = nodes.find(node => node.name === sourceName);
        if (!sourceNode || !pageByName.has(targetName)) {
            continue;
        }
        const alreadyMapped = navigationReport.some(item =>
            item.page === sourcePage.name &&
            item.source === sourceName &&
            item.event === "clicked"
        );
        if (alreadyMapped) {
            continue;
        }
        const sourceWidget = sourceToWidget.get(sourceNode.id) || root;
        const navigation = makeNavigationAction(
            sourcePage.name,
            sourceWidget,
            {
                scrId: pageByName.get(targetName).id,
                anim_type: "LV_SCR_LOAD_ANIM_NONE",
                duration: 0,
                delay: 0,
                is_clean: false
            },
            "clicked",
            sourceNode
        );
        if (navigation) {
            placeNavigationComponent(navigation.actionComponent, pageActionComponents.length);
            pageActionComponents.push(navigation.actionComponent);
            connectionLines.push(navigation.connectionLine);
        }
    }

    for (const node of nodes) {
        const event = node.event;
        if (event?.widget?.screen_load_start || event?.widget?.screen_loaded || event?.widget?.screen_unload_start || event?.widget?.screen_unloaded) {
            // Lifecycle events are counted and represented by the page root when their action has a valid target.
        }
        const serialized = JSON.stringify(node);
        if (serialized.includes('"custom_code"')) {
            customCodeHooks += (serialized.match(/"custom_code"/g) || []).length;
        }
    }

    return {
        objID: idFor("page", sourcePage.name),
        components: [root, ...pageActionComponents],
        connectionLines,
        localVariables: [],
        componentGroups: [],
        userProperties: [],
        name: sourcePage.name,
        left: 0,
        top: 0,
        width: root.width,
        height: root.height,
        createAtStart: sourcePage.name === guider.Application?.default_scr,
        deleteOnScreenUnload: false
    };
}

const project = JSON.parse(JSON.stringify(template));
project.themesVersion = 1;
project.objID = idFor("project", "DigiwiseStudio_update21");
project.settings.objID = idFor("settings", "DigiwiseStudio_update21");
project.settings.general.objID = idFor("general", "DigiwiseStudio_update21");
project.settings.general.projectType = "lvgl";
project.settings.general.lvglVersion = "8.3";
project.settings.general.flowSupport = true;
project.settings.general.displayWidth = 960;
project.settings.general.displayHeight = 640;
project.settings.general.colorFormat = "BGR";
project.settings.general.description = "GUI Guider update21 导入工程：58 个页面、可识别页面跳转和本地图片资源。";
project.settings.general.keywords = "DigiwiseStudio update21 GUI Guider LVGL";
project.settings.general.embedBitmaps = true;
project.settings.general.embedFonts = false;
project.variables.objID = idFor("variables", "DigiwiseStudio_update21");
project.actions = [];
project.userPages = pages.map(convertPage);
project.lvglStyles = {
    objID: idFor("lvglStyles", "DigiwiseStudio_update21"),
    styles,
    defaultStyles: {}
};
project.lvglGroups = project.lvglGroups || {
    objID: idFor("lvglGroups", "DigiwiseStudio_update21"),
    groups: []
};

const imageSourceDir = path.join(path.dirname(sourcePath), "import", "image");
const assetDir = path.join(outputDir, "assets");
fs.mkdirSync(assetDir, { recursive: true });
const bitmaps = [];
if (fs.existsSync(imageSourceDir)) {
    for (const file of fs.readdirSync(imageSourceDir)) {
        const filePath = path.join(imageSourceDir, file);
        if (!fs.statSync(filePath).isFile() || !/\.(png|jpe?g|gif)$/i.test(file)) {
            continue;
        }
        fs.copyFileSync(filePath, path.join(assetDir, file));
        bitmaps.push({
            objID: idFor("bitmap", file),
            name: path.basename(file, path.extname(file)),
            image: dataUri(filePath),
            bpp: 32,
            alwaysBuild: true,
            lvglBinaryOutputFormat: 3,
            lvglDither: false
        });
    }
}
project.bitmaps = bitmaps;

fs.mkdirSync(outputDir, { recursive: true });
writeJson(outputPath, project);

const report = {
    source: sourcePath,
    output: outputPath,
    projectName: "DigiwiseStudio_update21",
    display: { width: 960, height: 640 },
    pageCount: project.userPages.length,
    pageNames: project.userPages.map(page => page.name),
    widgetCount: convertedWidgetCount,
    imageCount: bitmaps.length,
    styleCount: styles.length,
    navigationCount: navigationReport.length,
    navigation: navigationReport,
    unresolvedNavigation,
    protectedCustomCodeHooks: customCodeHooks,
    unsupportedTypes: Object.fromEntries(unsupportedTypes),
    note: "GUI Guider custom.c/custom.h 为受保护固件代码；本导入保留可识别页面结构和跳转，未伪造受保护业务逻辑。"
};
writeJson(reportPath, report);

const readme = `# DigiwiseStudio update21\n\n这是从 GUI Guider update21 批量导入的 DigiwiseStudio LVGL 工程。\n\n- 页面：${report.pageCount}\n- 组件：${report.widgetCount}\n- 图片资源：${report.imageCount}\n- 页面跳转：${report.navigationCount}（含根据 update21 页面/组件命名恢复的安全跳转）\n- 原项目中的受保护 custom_code 钩子：${report.protectedCustomCodeHooks}\n\n打开 DigiwiseStudio_update21.eez-project 后，可以在 Pages 中查看全部页面，在 Flow 中查看页面跳转；设备协议、传感器读写等原固件业务逻辑仍需按硬件接口接入。\n`;
fs.writeFileSync(path.join(outputDir, "README.md"), readme, "utf8");

console.log(JSON.stringify({
    output: outputPath,
    report: reportPath,
    pageCount: report.pageCount,
    widgetCount: report.widgetCount,
    imageCount: report.imageCount,
    navigationCount: report.navigationCount,
    protectedCustomCodeHooks: report.protectedCustomCodeHooks
}, null, 2));
