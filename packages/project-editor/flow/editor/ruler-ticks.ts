// Pixel-space ruler geometry for the LVGL editor viewport.
// These ticks are presentation only; they never modify LVGL object positions.
export interface CanvasRulerTick {
    position: number;
    value: number;
    major: boolean;
}

export function getCanvasRulerMajorStep(scale: number): number {
    if (!Number.isFinite(scale) || scale <= 0) {
        return 100;
    }

    const desiredUnits = 75 / scale;
    const magnitude = Math.pow(10, Math.floor(Math.log10(desiredUnits)));
    for (const multiplier of [1, 2, 5, 10]) {
        if (multiplier * magnitude >= desiredUnits) {
            return multiplier * magnitude;
        }
    }

    return magnitude * 10;
}

export function getCanvasRulerTicks(
    length: number,
    origin: number,
    scale: number
): CanvasRulerTick[] {
    if (
        !Number.isFinite(length) ||
        !Number.isFinite(origin) ||
        !Number.isFinite(scale) ||
        length <= 0 ||
        scale <= 0
    ) {
        return [];
    }

    const minorStep = getCanvasRulerMajorStep(scale) / 5;
    const pixelsPerMinorStep = minorStep * scale;
    const first = Math.ceil(-origin / pixelsPerMinorStep);
    const last = Math.floor((length - origin) / pixelsPerMinorStep);
    const ticks: CanvasRulerTick[] = [];

    // Bound work even for an unexpectedly large editor window.
    for (let index = first; index <= last && ticks.length < 2000; index++) {
        const value = Number((index * minorStep).toPrecision(10));
        ticks.push({
            position: origin + index * pixelsPerMinorStep,
            value: Object.is(value, -0) ? 0 : value,
            major: index % 5 === 0
        });
    }

    return ticks;
}
