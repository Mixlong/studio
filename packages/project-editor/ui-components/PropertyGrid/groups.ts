import type {
    IEezObject,
    IPropertyGridGroupDefinition,
    PropertyInfo
} from "project-editor/core/object";
import { ProjectEditor } from "project-editor/project-editor-interface";

export const indentationGroup: IPropertyGridGroupDefinition = {
    id: "indentation",
    title: "Indentation",
    position: 2
};

export const generalGroup: IPropertyGridGroupDefinition = {
    id: "general",
    title: "General",
    position: (object: IEezObject) =>
        object instanceof ProjectEditor.ActionComponentClass ? 0 : 1
};

export const specificGroup: IPropertyGridGroupDefinition = {
    id: "specific",
    title: "Specific",
    position: (object: IEezObject) =>
        object instanceof ProjectEditor.ActionComponentClass ? 1 : 2
};

export const layoutGroup: IPropertyGridGroupDefinition = {
    id: "layout",
    title: "Layout",
    position: (object: IEezObject) =>
        object instanceof ProjectEditor.ActionComponentClass
            ? 3
            : object instanceof ProjectEditor.LVGLWidgetClass
            ? 2
            : 0
};

export const flowGroup: IPropertyGridGroupDefinition = {
    id: "flow",
    title: "Flow",
    position: (object: IEezObject) =>
        object instanceof ProjectEditor.ActionComponentClass ? 2 : 5
};

export const geometryGroup: IPropertyGridGroupDefinition = {
    id: "geometry",
    title: "Position and size",
    position: (object: IEezObject) =>
        object instanceof ProjectEditor.ActionComponentClass
            ? 3
            : object instanceof ProjectEditor.LVGLWidgetClass ||
              object instanceof ProjectEditor.PageClass
            ? 2
            : 0
};

export const styleGroup: IPropertyGridGroupDefinition = {
    id: "style",
    title: "Style",
    position: (object: IEezObject) =>
        object instanceof ProjectEditor.ActionComponentClass ? 4 : 3
};

export const timelineGroup: IPropertyGridGroupDefinition = {
    id: "timeline",
    title: "Timeline keyframe",
    position: (object: IEezObject) => -2
};

export interface IGroupProperties {
    group: IPropertyGridGroupDefinition;
    properties: PropertyInfo[];
}

// Only LVGL widgets use this simplified layout. The full PropertyInfo list
// stays intact and is rendered by the original editors in either group.
export const lvglWidgetBasicGroup: IPropertyGridGroupDefinition = {
    id: "lvgl-widget-basic",
    title: "Common Properties",
    position: 0
};

export const lvglWidgetAdvancedGroup: IPropertyGridGroupDefinition = {
    id: "lvgl-widget-advanced",
    title: "Advanced Settings",
    position: 1
};

const LVGL_COMMON_PROPERTY_NAMES = new Set([
    "identifier",
    "geometryProperties",
    "left",
    "top",
    "width",
    "height",
    "leftUnit",
    "topUnit",
    "widthUnit",
    "heightUnit",
    "text",
    "textType",
    "image",
    "value",
    "valueType",
    "previewValue",
    "useStyle",
    "localStyles",
    "hiddenFlag",
    "hiddenFlagType",
    "clickableFlag",
    "clickableFlagType"
]);

export function groupLVGLWidgetProperties(
    groups: IGroupProperties[]
): IGroupProperties[] {
    const common: PropertyInfo[] = [];
    const advanced: PropertyInfo[] = [];

    for (const group of groups) {
        // The leading widget-specific fields are typically its main value,
        // e.g. Label.text, Image.image, or Slider.mode. Keep them accessible.
        const primarySpecific = group.group.id === "specific"
            ? new Set(group.properties.slice(0, 2).map(prop => prop.name))
            : undefined;

        for (const property of group.properties) {
            const destination =
                LVGL_COMMON_PROPERTY_NAMES.has(property.name) ||
                primarySpecific?.has(property.name)
                    ? common
                    : advanced;
            destination.push(property);
        }
    }

    return [
        { group: lvglWidgetBasicGroup, properties: common },
        ...(advanced.length
            ? [{ group: lvglWidgetAdvancedGroup, properties: advanced }]
            : [])
    ];
}

export function getPropertyGroups(
    object: IEezObject,
    properties: PropertyInfo[]
) {
    const groupPropertiesArray: IGroupProperties[] = [];

    let groupForPropertiesWithoutGroupSpecified: IGroupProperties | undefined;

    for (let propertyInfo of properties) {
        const propertyGroup = propertyInfo.propertyGridGroup;

        let propertiesInGroup: PropertyInfo[];

        if (propertyGroup) {
            let groupProperties = groupPropertiesArray.find(
                groupProperties => groupProperties.group.id === propertyGroup.id
            );

            if (!groupProperties) {
                groupProperties = {
                    group: propertyGroup,
                    properties: []
                };
                groupPropertiesArray.push(groupProperties);
            }

            propertiesInGroup = groupProperties.properties;
        } else {
            if (!groupForPropertiesWithoutGroupSpecified) {
                groupForPropertiesWithoutGroupSpecified = {
                    group: {
                        id: "",
                        title: ""
                    },
                    properties: []
                };

                groupPropertiesArray.push(
                    groupForPropertiesWithoutGroupSpecified
                );
            }
            propertiesInGroup =
                groupForPropertiesWithoutGroupSpecified.properties;
        }

        propertiesInGroup.push(propertyInfo);
    }

    let maxPosition = 0;

    groupPropertiesArray.forEach(groupProperties => {
        if (groupProperties.group.position != undefined) {
            let position;
            if (typeof groupProperties.group.position == "number") {
                position = groupProperties.group.position;
            } else {
                position = groupProperties.group.position(object);
            }
            if (position > maxPosition) {
                maxPosition = position;
            }
        }
    });

    groupPropertiesArray.sort((a: IGroupProperties, b: IGroupProperties) => {
        const aPosition =
            a.group.position !== undefined
                ? typeof a.group.position == "number"
                    ? a.group.position
                    : a.group.position(object)
                : maxPosition + 1;

        const bPosition =
            b.group.position !== undefined
                ? typeof b.group.position == "number"
                    ? b.group.position
                    : b.group.position(object)
                : maxPosition + 1;

        return aPosition - bPosition;
    });

    if (object instanceof ProjectEditor.LVGLWidgetClass) {
        return groupLVGLWidgetProperties(groupPropertiesArray);
    }

    return groupPropertiesArray;
}
