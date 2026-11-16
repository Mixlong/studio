import type { ProjectStore } from "project-editor/store";
import type { Page } from "project-editor/features/page/page";
import type { LVGLStyle } from "project-editor/lvgl/style";
import { LVGLWidget } from "project-editor/lvgl/widgets/Base";
import { mcpReadError, McpReadTool } from "../protocol";
import { widgetPropertySchema } from "./property-schema";

const MAX_STYLES = 1200;
const MAX_ASSETS = 1000;
const MAX_WIDGETS = 3000;
const MAX_EVENTS = 1000;
const MAX_DEPTH = 32;
const MAX_PROPERTIES = 600;
const MAX_VALUE_LENGTH = 384;

type ReadValue = string | number | boolean;

function scalar(value: unknown): ReadValue | undefined {
    if (typeof value === "string") {
        return value.length <= MAX_VALUE_LENGTH ? value : undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean") return value;
    return undefined;
}

function safeName(value: unknown): string {
    return typeof value === "string" ? value.slice(0, 160) : "";
}

/**
 * Style definitions can contain code-backed expressions and rich editor
 * objects. Export literal scalar values and small explicit literal wrappers
 * only; never serialize MobX state, scripts, functions, image blobs or code.
 */
function literalStyleValue(value: unknown): unknown {
    const simple = scalar(value);
    if (simple !== undefined) return simple;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { omitted: "complex" };
    }
    const record = value as Record<string, unknown>;
    if (record.type !== "literal") return { omitted: "non-literal" };
    const literal = scalar(record.value);
    if (literal === undefined) return { omitted: "complex literal" };
    return { type: "literal", value: literal };
}

function readDefinition(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const definition: Record<string, unknown> = Object.create(null);
    let properties = 0;
    for (const [part, states] of Object.entries(raw)) {
        if (!/^[\w-]{1,64}$/.test(part) || !states || typeof states !== "object" || Array.isArray(states)) continue;
        const partOutput: Record<string, unknown> = Object.create(null);
        for (const [state, values] of Object.entries(states)) {
            if (!/^[\w-]{1,64}$/.test(state) || !values || typeof values !== "object" || Array.isArray(values)) continue;
            const stateOutput: Record<string, unknown> = Object.create(null);
            for (const [property, value] of Object.entries(values)) {
                if (!/^[\w-]{1,64}$/.test(property)) continue;
                if (++properties > MAX_PROPERTIES) {
                    throw mcpReadError("LIMIT_EXCEEDED", "Too many style properties");
                }
                stateOutput[property] = literalStyleValue(value);
            }
            partOutput[state] = stateOutput;
        }
        definition[part] = partOutput;
    }
    return definition;
}

function listStyles(projectStore: ProjectStore) {
    const roots = projectStore.project.lvglStyles?.styles || [];
    let count = 0;
    const seen = new WeakSet<object>();
    const serialize = (style: LVGLStyle, stylePath: number[], depth: number): unknown => {
        if (depth >= MAX_DEPTH || ++count > MAX_STYLES || seen.has(style)) {
            throw mcpReadError("LIMIT_EXCEEDED", "Style tree exceeds its limit");
        }
        seen.add(style);
        return {
            stylePath,
            styleId: style.objID || null,
            name: safeName(style.name),
            forWidgetType: safeName(style.forWidgetType),
            children: (style.childStyles || []).map((child, index) =>
                serialize(child, [...stylePath, index], depth + 1))
        };
    };
    const allDefaults = projectStore.project.lvglStyles?.defaultStyles || {};
    const defaultStyles: Record<string, string> = Object.create(null);
    if (Object.keys(allDefaults).length > MAX_STYLES) {
        throw mcpReadError("LIMIT_EXCEEDED", "Too many default style mappings");
    }
    for (const [key, value] of Object.entries(allDefaults)) {
        if (key.length <= 128 && typeof value === "string" && value.length <= 128) {
            defaultStyles[key] = value;
        }
    }
    const styles = roots.map((style, index) => serialize(style, [index], 0));
    return { styleCount: count, styles, defaultStyles };
}

function getStyle(projectStore: ProjectStore, stylePath: number[]) {
    let styles = projectStore.project.lvglStyles?.styles || [];
    let style: LVGLStyle | undefined;
    for (const index of stylePath) {
        style = styles[index];
        if (!style) {
            throw mcpReadError("STYLE_NOT_FOUND", "Style path does not exist");
        }
        styles = style.childStyles || [];
    }
    if (!style) throw mcpReadError("STYLE_NOT_FOUND", "Style not found");
    return {
        stylePath,
        name: safeName(style.name),
        styleId: style.objID || null,
        forWidgetType: safeName(style.forWidgetType),
        definition: readDefinition(style.definition?.definition),
        note: "Only literal style values are exposed; expressions and complex values are omitted"
    };
}

function listAssets(projectStore: ProjectStore) {
    const project = projectStore.project;
    const fonts = project.fonts || [];
    const bitmaps = project.bitmaps || [];
    if (fonts.length + bitmaps.length > MAX_ASSETS) {
        throw mcpReadError("LIMIT_EXCEEDED", "Too many project assets");
    }
    return {
        fontCount: fonts.length,
        bitmapCount: bitmaps.length,
        fonts: fonts.map(font => ({
            name: safeName(font.name),
            renderingEngine: safeName(font.renderingEngine),
            height: scalar(font.height) ?? null,
            bpp: scalar(font.bpp) ?? null,
            glyphCount: font.glyphs?.length ?? 0,
            alwaysBuild: !!font.alwaysBuild
        })),
        bitmaps: bitmaps.map(bitmap => ({
            name: safeName(bitmap.name),
            bpp: scalar(bitmap.bpp) ?? null,
            lvglBinaryOutputFormat: scalar(bitmap.lvglBinaryOutputFormat) ?? null,
            alwaysBuild: !!bitmap.alwaysBuild,
            // Bitmap.image can be an embedded binary/base64 payload.
            // Intentionally do not export it.
            hasImage: !!bitmap.image
        }))
    };
}

function getRoots(page: Page): LVGLWidget[] {
    return page.components.filter(component =>
        component instanceof LVGLWidget) as LVGLWidget[];
}

function getWidget(page: Page, widgetPath: number[]) {
    let siblings = getRoots(page);
    let widget: LVGLWidget | undefined;
    for (const index of widgetPath) {
        widget = siblings[index];
        if (!widget) throw mcpReadError("WIDGET_NOT_FOUND", "Widget path does not exist");
        siblings = (widget.children || []).filter(child =>
            child instanceof LVGLWidget);
    }
    if (!widget) throw mcpReadError("WIDGET_NOT_FOUND", "Widget not found");
    return widget;
}

function readEvents(widget: LVGLWidget) {
    const handlers = widget.eventHandlers || [];
    if (handlers.length > MAX_EVENTS) {
        throw mcpReadError("LIMIT_EXCEEDED", "Too many widget event bindings");
    }
    return handlers.map(handler => ({
        eventId: handler.objID || null,
        eventName: safeName(handler.eventName),
        handlerType: handler.handlerType === "action" ? "action" : "flow",
        action: handler.handlerType === "action" ? safeName(handler.action) : null
    }));
}

function widgetDetails(page: Page, widgetPath: number[]) {
    const widget = getWidget(page, widgetPath);
    return {
        pageName: page.name,
        widgetPath,
        type: safeName(widget.type),
        widgetId: widget.objID || null,
        identifier: safeName(widget.identifier),
        geometry: {
            left: scalar(widget.left) ?? null,
            top: scalar(widget.top) ?? null,
            width: scalar(widget.width) ?? null,
            height: scalar(widget.height) ?? null
        },
        properties: {
            text: scalar((widget as unknown as { text?: unknown }).text) ?? null,
            value: scalar((widget as unknown as { value?: unknown }).value) ?? null,
            hiddenFlag: scalar(widget.hiddenFlag) ?? null,
            clickableFlag: scalar(widget.clickableFlag) ?? null,
            widgetFlags: scalar(widget.widgetFlags) ?? null
        },
        useStyle: safeName(widget.useStyle),
        localStyles: readDefinition(widget.localStyles?.definition),
        eventHandlers: readEvents(widget)
    };
}

function listWidgetEvents(page: Page) {
    const seen = new WeakSet<object>();
    const results: unknown[] = [];
    let count = 0;
    const visit = (widget: LVGLWidget, widgetPath: number[], depth: number) => {
        if (depth >= MAX_DEPTH || ++count > MAX_WIDGETS || seen.has(widget)) {
            throw mcpReadError("LIMIT_EXCEEDED", "Widget tree exceeds its limit");
        }
        seen.add(widget);
        const handlers = widget.eventHandlers || [];
        if (handlers.length) {
            if (results.length >= MAX_EVENTS) {
                throw mcpReadError("LIMIT_EXCEEDED", "Too many widgets with event bindings");
            }
            results.push({
                widgetPath,
                identifier: safeName(widget.identifier),
                widgetId: widget.objID || null,
                type: safeName(widget.type),
                eventHandlers: readEvents(widget)
            });
        }
        (widget.children || []).filter(child => child instanceof LVGLWidget)
            .forEach((child, index) => visit(child, [...widgetPath, index], depth + 1));
    };
    getRoots(page).forEach((widget, index) => visit(widget, [index], 0));
    return { pageName: page.name, widgetCount: count, bindings: results };
}

export function runExtendedReadTool(
    projectStore: ProjectStore,
    tool: McpReadTool,
    args: Record<string, unknown>
): unknown {
    if (tool === "list_styles") return listStyles(projectStore);
    if (tool === "get_style") return getStyle(projectStore, args.stylePath as number[]);
    if (tool === "list_assets") return listAssets(projectStore);

    const pageName = args.pageName as string;
    const page = projectStore.project.pages.find(candidate => candidate.name === pageName);
    if (!page) throw mcpReadError("PAGE_NOT_FOUND", `Page "${pageName}" was not found`);
    if (tool === "get_widget_details") {
        return widgetDetails(page, args.widgetPath as number[]);
    }
    if (tool === "get_widget_schema") {
        const widget = getWidget(page, args.widgetPath as number[]);
        return {
            pageName: page.name,
            widgetPath: args.widgetPath,
            widgetId: widget.objID || null,
            ...widgetPropertySchema(projectStore, widget)
        };
    }
    return listWidgetEvents(page);
}
