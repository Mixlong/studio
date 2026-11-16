/**
 * Runtime-backed LVGL property discovery shared by MCP read/write tools.
 * The editor's ClassInfo is authoritative; MCP exposes safe scalar values
 * and existing bitmap references, never code, flow objects or file paths.
 */
import type { ProjectStore } from "project-editor/store";
import type { LVGLWidget } from "project-editor/lvgl/widgets/Base";
import {
    getClassInfo, findClass, getDefaultValue, PropertyType, TYPE_NAMES, PropertyInfo
} from "project-editor/core/object";
import { lvglPropertiesMap } from "project-editor/lvgl/style-catalog";
import { mcpReadError } from "../protocol";

const unsafePropertyName = /(?:script|source|code|path|file|directory|url|action|event|handler|expression|^_)|^(?:type|children|localStyles|flow|data|identifier)$/i;
const safeStyleKinds = [
    PropertyType.Number, PropertyType.Color, PropertyType.ThemedColor,
    PropertyType.Enum
];
const MAX_PROPERTY_ITEMS = 220;

function fail(message: string): never {
    throw mcpReadError("INVALID_ARGUMENT", message);
}

function visible(widget: LVGLWidget, prop: PropertyInfo) {
    if (!prop || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(prop.name) ||
        unsafePropertyName.test(prop.name) || prop.name.endsWith("Type") ||
        ["widgetFlags", "states"].includes(prop.name) ||
        prop.computed || prop.modifiable === false) return false;
    try {
        const isGeometry = ["left", "top", "width", "height"].includes(prop.name);
        // Geometry has a custom PropertyGrid row; its individual fields
        // are marked hidden but are still legitimate editor mutations.
        if ((!isGeometry && prop.hideInPropertyGrid === true) ||
            (typeof prop.hideInPropertyGrid === "function" &&
             prop.hideInPropertyGrid(widget, prop))) return false;
        if (typeof prop.disabled === "function" && prop.disabled(widget, prop)) return false;
        if (typeof prop.readOnlyInPropertyGrid === "function" &&
            prop.readOnlyInPropertyGrid(widget, prop)) return false;
        if (prop.readOnlyInPropertyGrid === true) return false;
    } catch (_error) {
        return false;
    }
    return true;
}

function bitmapProperty(prop: PropertyInfo, widget: LVGLWidget) {
    return widget.type === "LVGLImageWidget" && prop.name === "image" &&
        prop.type === PropertyType.ObjectReference &&
        prop.referencedObjectCollectionPath === "bitmaps";
}

function literalExpressionProperty(prop: PropertyInfo, widget: LVGLWidget) {
    return prop.type === PropertyType.ObjectReference &&
        ["integer", "float", "double", "string", "boolean"].includes(prop.expressionType || "") &&
        typeof (widget as unknown as Record<string, unknown>)[prop.name + "Type"] === "string";
}
function existingStyleReference(prop: PropertyInfo) {
    return prop.name === "useStyle" && prop.type === PropertyType.ObjectReference &&
        prop.referencedObjectCollectionPath === "allLvglStyles";
}

export function supportedWidgetProperties(widget: LVGLWidget) {
    return getClassInfo(widget).properties
        .filter(prop => visible(widget, prop) &&
            ([
                PropertyType.Number, PropertyType.Boolean, PropertyType.String,
                PropertyType.MultilineText, PropertyType.Enum,
                PropertyType.Color, PropertyType.ThemedColor
            ].includes(prop.type) || bitmapProperty(prop, widget) ||
            literalExpressionProperty(prop, widget) || existingStyleReference(prop)))
        .slice(0, MAX_PROPERTY_ITEMS);
}

// Native Enum callbacks can depend on widget state, version, and the current
// project. A throwing callback must not take down the entire MCP schema read.
// Keep read options and write validation on the same bounded set.
function safeEnumItems(prop: PropertyInfo, widget: LVGLWidget) {
    try {
        const available = typeof prop.enumItems === "function"
            ? prop.enumItems(widget) : prop.enumItems;
        if (!Array.isArray(available)) return [];
        return available.filter(item => item &&
            ((typeof item.id === "string" && item.id.length <= 128) ||
             (typeof item.id === "number" && Number.isFinite(item.id))))
            .slice(0, 128);
    } catch (_error) {
        return [];
    }
}

export function validateRuntimeWidgetProperty(
    store: ProjectStore, widget: LVGLWidget, property: string, value: unknown
): { [key: string]: string | number | boolean } {
    const prop = supportedWidgetProperties(widget)
        .find(candidate => candidate.name === property);
    if (!prop) fail("Property is not available or editable on this widget: " + property);
    if (literalExpressionProperty(prop, widget)) {
        if ((widget as unknown as Record<string, unknown>)[property + "Type"] !== "literal") {
            throw mcpReadError("INVALID_STATE", "Property is not in Literal mode");
        }
        if (prop.expressionType === "boolean" ? typeof value !== "boolean" :
            ["integer", "float", "double"].includes(prop.expressionType || "") ?
                typeof value !== "number" || !Number.isFinite(value) ||
                (prop.expressionType === "integer" && !Number.isInteger(value)) :
                typeof value !== "string" || value.length > 512) {
            fail("Literal value has the wrong type for the LVGL expression property");
        }
    }
    if (property === "useStyle" && typeof value === "string" && value &&
        !store.project.allLvglStyles.some(style =>
            style.name === value && style.forWidgetType === widget.type)) {
        fail("Referenced Style does not exist for this widget type");
    }
    if (existingStyleReference(prop)) {
        if (typeof value !== "string" || value.length > 128 ||
            (value !== "" && !store.project.allLvglStyles.some(style =>
                style.name === value && style.forWidgetType === widget.type))) {
            fail("Referenced LVGL Style does not exist for this widget type");
        }
    } else if (literalExpressionProperty(prop, widget)) {
        // Type and Literal mode checked above; skip ObjectReference handling.
    } else if (bitmapProperty(prop, widget)) {
        if (typeof value !== "string" || value.length > 128 ||
            !store.project.bitmaps.some(bitmap => bitmap.name === value)) {
            fail("Image must reference an existing project Bitmap name");
        }
    } else if (prop.type === PropertyType.Enum) {
        const items = safeEnumItems(prop, widget);
        if (typeof value !== "string" && typeof value !== "number") fail("Enum value required");
        if (!items.some(item => item.id === value)) fail("Invalid or unavailable enum value");
    } else if (prop.type === PropertyType.Number) {
        if (typeof value !== "number" || !Number.isFinite(value) ||
            Math.abs(value) > 1_000_000) fail("Numeric value out of range");
    } else if (prop.type === PropertyType.Boolean) {
        if (typeof value !== "boolean") fail("Boolean value required");
    } else if (prop.type === PropertyType.Color || prop.type === PropertyType.ThemedColor) {
        if (typeof value !== "string" || !/^#[a-fA-F0-9]{6}$/.test(value)) {
            fail("Color must be a six-digit hex value");
        }
    } else if (typeof value !== "string" || value.length > 512) {
        fail("Text value must be <= 512 characters");
    }
    // Expression-driven LVGL fields must not be overwritten as literals.
    const controlMode = (widget as unknown as Record<string, unknown>)[property + "Type"];
    if (controlMode !== undefined && controlMode !== "literal") {
        throw mcpReadError("INVALID_STATE", "Property is expression-controlled");
    }
    return { [property]: value as string | number | boolean };
}

export function widgetStyleParts(widget: LVGLWidget, store: ProjectStore) {
    const lvglInfo = getClassInfo(widget).lvgl;
    const info = typeof lvglInfo === "function"
        ? lvglInfo(widget, store.project) : lvglInfo;
    const parts = typeof info?.parts === "function"
        ? info.parts(widget) : info?.parts || [];
    return Array.from(new Set(["MAIN", ...parts]));
}

export function validateLocalStyleProperty(
    store: ProjectStore, widget: LVGLWidget,
    part: string, state: string, property: string, value: unknown
): string | number {
    if (!widgetStyleParts(widget, store).includes(part)) {
        fail("Part is not supported by widget " + widget.type);
    }
    const supportedStates = new Set([
        "DEFAULT", "CHECKED", "FOCUSED", "FOCUS_KEY", "EDITED",
        "HOVERED", "PRESSED", "SCROLLED", "DISABLED"
    ]);
    const stateTokens = state.split("|");
    if (stateTokens.length > 3 || stateTokens.some(token => !supportedStates.has(token))) {
        fail("Invalid LVGL state selector");
    }
    const info = lvglPropertiesMap.get(property);
    if (!info || !safeStyleKinds.includes(info.type)) {
        fail("Unsupported LVGL style property");
    }
    if (info.type === PropertyType.Number) {
        if (typeof value !== "number" || !Number.isFinite(value) ||
            !Number.isInteger(value) || Math.abs(value) > 4096) {
            fail("Style number must be an integer in [-4096,4096]");
        }
        if (/_opa$/.test(property) && (value < 0 || value > 255)) {
            fail("Opacity must be between 0 and 255");
        }
        if (/^(?:pad_|radius$|border_width$|outline_width$|shadow_width$|arc_width$)/.test(property) && value < 0) {
            fail("Spacing and width style properties must not be negative");
        }
    } else if (info.type === PropertyType.Color || info.type === PropertyType.ThemedColor) {
        if (typeof value !== "string" || !/^#[a-fA-F0-9]{6}$/.test(value)) {
            fail("Style color must be a six-digit hex value");
        }
    } else {
        const items = typeof info.enumItems === "function"
            ? info.enumItems(widget) : info.enumItems || [];
        if (typeof value !== "string" || !items.some(item => item.id === value)) {
            fail("Invalid LVGL enum style value");
        }
    }
    return value as string | number;
}

/**
 * Global Styles must obey the same LVGL catalog, widget part and state
 * restrictions as local widget Styles. Use a non-persistent class instance
 * only for metadata lookup; no editor mutation occurs during validation.
 */
export function validateGlobalStyleProperty(
    store: ProjectStore, widgetType: string,
    part: string, state: string, property: string, value: unknown
): string | number {
    const WidgetClass = findClass(widgetType);
    if (!WidgetClass) {
        fail("Style targets an unknown LVGL widget type");
    }
    const virtual = Object.assign(
        Object.create(WidgetClass.prototype),
        getDefaultValue(store, WidgetClass.classInfo) || {},
        { type: widgetType, projectStore: store }
    ) as LVGLWidget;
    return validateLocalStyleProperty(store, virtual, part, state, property, value);
}

/**
 * Allowlist is resolved using the very same ClassInfo widgetEvents metadata
 * as the editor's EventHandler dropdown. Never accept invented event names.
 */
export function allowedWidgetEvents(widget: LVGLWidget): string[] {
    const source = getClassInfo(widget).widgetEvents;
    if (!source) return [];
    const events = typeof source === "function" ? source(widget) : source;
    return Object.keys(events || {})
        .filter(name => /^[A-Z][A-Z0-9_]{0,63}$/.test(name))
        .slice(0, 128);
}

/** Only direct references to existing global variables, never arbitrary expressions. */
export function validateWidgetVariableBinding(
    store: ProjectStore, widget: LVGLWidget, property: string,
    variableName: string | null, literalValue?: unknown
): Record<string, string | number | boolean> {
    const field = getClassInfo(widget).properties.find(prop => prop.name === property);
    if (!field || !visible(widget, field) || field.type !== PropertyType.ObjectReference ||
        field.referencedObjectCollectionPath !== "variables/globalVariables" ||
        !["integer", "float", "double", "boolean", "string"].includes(field.expressionType || "")) {
        fail("This property cannot bind to a global variable");
    }
    const typeKey = property + "Type";
    const mode = (widget as unknown as Record<string, unknown>)[typeKey];
    if (mode !== "literal" && mode !== "expression") {
        fail("Widget property mode is not bindable");
    }
    if (variableName !== null) {
        if (!store.projectTypeTraits.hasFlowSupport) fail("Flow support is required for binding");
        const variable = store.project.variables?.globalVariables.find(v => v.name === variableName);
        if (!variable || variable.type !== field.expressionType) {
            fail("Global variable is missing or has the wrong type");
        }
        return { [typeKey]: "expression", [property]: variableName };
    }
    if (mode !== "expression") fail("Property is not currently bound");
    const valid = field.expressionType === "boolean" ? typeof literalValue === "boolean" :
        field.expressionType === "string" ? typeof literalValue === "string" && literalValue.length <= 512 :
        typeof literalValue === "number" && Number.isFinite(literalValue) &&
        Math.abs(literalValue) <= 1_000_000 &&
        (field.expressionType !== "integer" || Number.isSafeInteger(literalValue));
    if (!valid) fail("Literal does not match property type");
    return { [typeKey]: "literal", [property]: literalValue as string | number | boolean };
}

export function widgetPropertySchema(store: ProjectStore, widget: LVGLWidget) {
    const isScreen = widget.type === "LVGLScreenWidget";
    const properties = (isScreen ? [] : supportedWidgetProperties(widget)).map(prop => {
        const choices = prop.type === PropertyType.Enum ? safeEnumItems(prop, widget) : [];
        return {
            name: prop.name,
            type: TYPE_NAMES[prop.type],
            mode: (widget as unknown as Record<string, unknown>)[prop.name + "Type"] ?? null,
            editable: widget.type !== "LVGLScreenWidget" &&
                (prop.type !== PropertyType.Enum || choices.length > 0) &&
                (!literalExpressionProperty(prop, widget) ||
                 (widget as unknown as Record<string, unknown>)[prop.name + "Type"] === "literal"),
            value: (() => {
                const current: unknown =
                    (widget as unknown as Record<string, unknown>)[prop.name];
                return (typeof current === "string" && current.length <= 512) ||
                    typeof current === "boolean" ||
                    (typeof current === "number" && Number.isFinite(current))
                    ? current : null;
            })(),
            enumItems: prop.type === PropertyType.Enum
                ? choices.map(item => item.id)
                : undefined,
            bitmapNames: bitmapProperty(prop, widget)
                ? store.project.bitmaps.slice(0, 128).map(bitmap => bitmap.name)
                : undefined
        };
    });
    return {
        type: widget.type,
        identifier: widget.identifier || null,
        editable: !isScreen,
        availableEvents: allowedWidgetEvents(widget),
        readOnlyReason: isScreen ? "Screen root is edited through page settings, not widget writes" : null,
        properties,
        bindableProperties: isScreen ? [] : getClassInfo(widget).properties
            .filter(prop => visible(widget, prop) && prop.type === PropertyType.ObjectReference &&
                prop.referencedObjectCollectionPath === "variables/globalVariables" &&
                ["integer", "float", "double", "boolean", "string"].includes(prop.expressionType || "") &&
                ["literal", "expression"].includes(String((widget as any)[prop.name + "Type"])))
            .slice(0, MAX_PROPERTY_ITEMS)
            .map(prop => ({ name: prop.name, variableType: prop.expressionType,
                mode: (widget as any)[prop.name + "Type"] })),
        supportedParts: widgetStyleParts(widget, store),
        supportedStates: ["DEFAULT", "CHECKED", "FOCUSED", "FOCUS_KEY",
            "EDITED", "HOVERED", "PRESSED", "SCROLLED", "DISABLED"],
        // Scalar-only values; expressions, arbitrary code and binary sources
        // are purposefully excluded from MCP's write surface.
        styleProperties: Array.from(lvglPropertiesMap.values())
            .filter(prop => safeStyleKinds.includes(prop.type))
            .map(prop => ({ name: prop.name, type: TYPE_NAMES[prop.type] }))
            .slice(0, MAX_PROPERTY_ITEMS)
    };
}
