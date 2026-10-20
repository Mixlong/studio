/**
 * Fit the simulator's device-sized framebuffer into the available Run pane.
 * This only affects CSS presentation: firmware resolution and WASM buffer
 * dimensions remain untouched.
 */
export interface RunCanvasLayout {
    scale: number;
    x: number;
    y: number;
}

export function fitRunCanvas(
    viewportWidth: number,
    viewportHeight: number,
    deviceWidth: number,
    deviceHeight: number,
    requestedScale: number,
    margin = 12
): RunCanvasLayout {
    if (
        !Number.isFinite(viewportWidth) ||
        !Number.isFinite(viewportHeight) ||
        !Number.isFinite(deviceWidth) ||
        !Number.isFinite(deviceHeight) ||
        viewportWidth <= 1 ||
        viewportHeight <= 1 ||
        deviceWidth <= 0 ||
        deviceHeight <= 0
    ) {
        return { scale: 1, x: 0, y: 0 };
    }

    const preferred = Number.isFinite(requestedScale) && requestedScale > 0
        ? requestedScale
        : 1;
    const availableWidth = Math.max(1, viewportWidth - 2 * margin);
    const availableHeight = Math.max(1, viewportHeight - 2 * margin);

    // Never enlarge the physical screen automatically. If a project already
    // uses a smaller zoom, respect it while still making it fit.
    const scale = Math.min(
        preferred,
        1,
        availableWidth / deviceWidth,
        availableHeight / deviceHeight
    );
    return {
        scale,
        x: Math.max(0, Math.round((viewportWidth - deviceWidth * scale) / 2)),
        y: Math.max(0, Math.round((viewportHeight - deviceHeight * scale) / 2))
    };
}
