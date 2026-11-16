/**
 * Render a simple native LVGL style sample without constructing the editor's
 * synthetic Page / Widget hierarchy. This isolates the style preview from
 * normal page rendering and works with both LVGL 8.x and 9.x runtimes.
 */
export type NativeStyleSampleWasm = {
    _lvglCreateScreen(
        parent: number,
        widgetIndex: number,
        left: number,
        top: number,
        width: number,
        height: number
    ): number;
    _lv_btn_create?: (parent: number) => number;
    _lv_button_create?: (parent: number) => number;
    _lv_label_create: (parent: number) => number;
    _lv_obj_set_size: (obj: number, width: number, height: number) => void;
    _lv_obj_set_pos: (obj: number, left: number, top: number) => void;
    _lv_obj_center?: (obj: number) => void;
    _lvglObjSetLocalStylePropNum?: (
        obj: number,
        prop: number,
        value: number,
        selector: number
    ) => void;
    _lv_label_set_text: (obj: number, textPtr: number) => void;
    stringToNewUTF8: (text: string) => number;
    _free: (ptr: number) => void;
};

export interface NativeStyleSample {
    screenObj: number;
    widgetObj: number;
}

const LV_ALIGN_CENTER = 9;

function getAlignStylePropCode(lvglVersion: string): number {
    if (lvglVersion.startsWith("9.5")) {
        return 18;
    }
    if (lvglVersion.startsWith("9.")) {
        return 10;
    }
    return 9;
}

function centerObject(
    wasm: NativeStyleSampleWasm,
    obj: number,
    lvglVersion: string,
    fallbackLeft: number,
    fallbackTop: number
) {
    if (wasm._lv_obj_center) {
        wasm._lv_obj_center(obj);
    } else if (wasm._lvglObjSetLocalStylePropNum) {
        wasm._lvglObjSetLocalStylePropNum(
            obj,
            getAlignStylePropCode(lvglVersion),
            LV_ALIGN_CENTER,
            0
        );
        wasm._lv_obj_set_pos(obj, 0, 0);
    } else {
        wasm._lv_obj_set_pos(obj, fallbackLeft, fallbackTop);
    }
}

/**
 * Returns undefined for widgets requiring special objects or project assets.
 * The caller may use the ordinary synthetic preview for those types.
 */
export function createNativeStyleSample(
    wasm: NativeStyleSampleWasm,
    widgetType: string,
    lvglVersion: string,
    width: number,
    height: number
): NativeStyleSample | undefined {
    if (
        widgetType !== "LVGLButtonWidget" &&
        widgetType !== "LVGLLabelWidget"
    ) {
        return undefined;
    }

    const screenObj = wasm._lvglCreateScreen(0, 0, 0, 0, width, height);
    if (!screenObj) {
        throw new Error("LVGL did not create the style sample screen.");
    }

    let widgetObj: number;
    if (widgetType === "LVGLButtonWidget") {
        const createButton = lvglVersion.startsWith("9.")
            ? wasm._lv_button_create
            : wasm._lv_btn_create;
        if (!createButton) {
            throw new Error("LVGL Button creation is unavailable.");
        }
        widgetObj = createButton(screenObj);
        if (!widgetObj) {
            throw new Error("LVGL did not create the sample Button.");
        }
        wasm._lv_obj_set_size(widgetObj, 160, 56);
        wasm._lv_obj_set_pos(
            widgetObj,
            Math.round((width - 160) / 2),
            Math.round((height - 56) / 2)
        );
        addText(wasm, widgetObj, "Button", 54, 18, lvglVersion);
    } else {
        widgetObj = wasm._lv_label_create(screenObj);
        if (!widgetObj) {
            throw new Error("LVGL did not create the sample Label.");
        }
        addLabelText(wasm, widgetObj, "Aa Sample");
        // The label keeps its natural width so the font style is visible.
        centerObject(
            wasm,
            widgetObj,
            lvglVersion,
            57,
            Math.round((height - 28) / 2)
        );
    }

    return { screenObj, widgetObj };
}

function addLabelText(
    wasm: NativeStyleSampleWasm,
    obj: number,
    text: string
) {
    const textPtr = wasm.stringToNewUTF8(text);
    try {
        wasm._lv_label_set_text(obj, textPtr);
    } finally {
        wasm._free(textPtr);
    }
}

function addText(
    wasm: NativeStyleSampleWasm,
    parent: number,
    text: string,
    left: number,
    top: number,
    lvglVersion: string
) {
    const label = wasm._lv_label_create(parent);
    if (!label) {
        throw new Error("LVGL did not create the sample caption.");
    }
    addLabelText(wasm, label, text);
    centerObject(wasm, label, lvglVersion, left, top);
}
