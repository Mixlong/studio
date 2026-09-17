import {
    getClassInfo,
    getClassInfoLvglProperties,
    getObjectPropertyDisplayName,
    IEezObject,
    PropertyInfo,
    PropertyType
} from "project-editor/core/object";
import type { ProjectStore } from "project-editor/store";
import type { LVGLWidget } from "project-editor/lvgl/widgets";

////////////////////////////////////////////////////////////////////////////////

/**
 * A serializable description for external LVGL property editors and BSP plugins.
 * It deliberately exposes only editable widget properties; rendering remains the
 * responsibility of the host UI.
 */
export interface LVGLWidgetPropertyDescriptor {
    name: string;
    displayName: string;
    type: PropertyType;
    readOnly: boolean;
    disabled: boolean;
    value: unknown;
}

export interface LVGLWidgetPropertyInterface {
    parts: string[];
    defaultFlags: string;
    properties: LVGLWidgetPropertyDescriptor[];
}

function getBooleanPropertyValue(
    value: boolean | ((object: IEezObject, property: PropertyInfo) => boolean) | undefined,
    object: IEezObject,
    property: PropertyInfo
) {
    return typeof value === "function" ? value(object, property) : !!value;
}

export function getLVGLWidgetPropertyInterface(
    widget: LVGLWidget
): LVGLWidgetPropertyInterface {
    const lvgl = getClassInfoLvglProperties(widget);
    const parts =
        typeof lvgl.parts === "function" ? lvgl.parts(widget) : lvgl.parts;

    return {
        parts,
        defaultFlags: lvgl.defaultFlags,
        properties: getClassInfo(widget).properties
            .filter(property => !getBooleanPropertyValue(property.hideInPropertyGrid, widget, property))
            .map(property => ({
                name: property.name,
                displayName: getObjectPropertyDisplayName(widget, property),
                type: property.dynamicType
                    ? property.dynamicType(widget)
                    : property.type,
                readOnly: getBooleanPropertyValue(
                    property.readOnlyInPropertyGrid,
                    widget,
                    property
                ),
                disabled: getBooleanPropertyValue(property.disabled, widget, property),
                value: (widget as any)[property.name]
            }))
    };
}

export function updateLVGLWidgetProperty(
    projectStore: ProjectStore,
    widget: LVGLWidget,
    name: string,
    value: unknown
) {
    const property = getClassInfo(widget).properties.find(
        candidate => candidate.name === name
    );

    if (!property) {
        throw new Error(`Unknown LVGL widget property: ${name}`);
    }

    if (
        getBooleanPropertyValue(property.readOnlyInPropertyGrid, widget, property) ||
        getBooleanPropertyValue(property.disabled, widget, property)
    ) {
        throw new Error(`LVGL widget property is not editable: ${name}`);
    }

    projectStore.updateObject(widget, { [name]: value });
}

