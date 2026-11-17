import React from "react";

import type { Rect } from "eez-studio-shared/geometry";
import type { Transform } from "project-editor/flow/editor/transform";
import { getCanvasRulerTicks } from "project-editor/flow/editor/ruler-ticks";

// The ruler draws into (not outside) the existing canvas viewport.
const TOP_RULER_DEPTH = 22;
const LEFT_RULER_DEPTH = 16;

// Show actual Screen dimensions, not the on-screen dimensions after zoom.
// Clip the span to the viewport so size labels stay visible when the Screen
// is partly outside the editing area.
function visibleScreenSpan(start: number, size: number, length: number) {
    if (!Number.isFinite(start) || !Number.isFinite(size) ||
        !Number.isFinite(length) || size <= 0 || length <= 0) {
        return undefined;
    }
    const from = Math.max(0, start);
    const to = Math.min(length, start + size);
    return to > from ? { from, to, middle: (from + to) / 2 } : undefined;
}

// Viewport-fixed rulers; visual ticks track the same transform as the Screen.
export function CanvasRulers({ transform, screenRect }: {
    transform: Transform;
    screenRect?: Rect;
}) {
    const { width, height } = transform.clientRect;
    if (width <= 0 || height <= 0) {
        return null;
    }

    // The ruler shares the actual viewport origin. Do not subtract ruler
    // dimensions: the top/left axes are overlays, not reserved gutters.
    const xLength = width;
    const yLength = height;
    const originX = width / 2 + transform.translate.x;
    const originY = height / 2 + transform.translate.y;

    const xTicks = getCanvasRulerTicks(xLength, originX, transform.scale);
    const yTicks = getCanvasRulerTicks(yLength, originY, transform.scale);

    const screenX = screenRect
        ? visibleScreenSpan(
              originX + screenRect.left * transform.scale,
              screenRect.width * transform.scale,
              xLength
          )
        : undefined;
    const screenY = screenRect
        ? visibleScreenSpan(
              originY + screenRect.top * transform.scale,
              screenRect.height * transform.scale,
              yLength
          )
        : undefined;

    return (
        <div className="DigiStudio_CanvasRulers" aria-hidden="true">
            <svg
                className="DigiStudio_CanvasRulerX"
                width={xLength}
                height={TOP_RULER_DEPTH}
                viewBox={`0 0 ${xLength} ${TOP_RULER_DEPTH}`}
            >
                {xTicks.map(tick => (
                    <line
                        key={tick.value}
                        className="DigiStudio_CanvasRulerTick"
                        x1={tick.position}
                        y1={0}
                        x2={tick.position}
                        y2={tick.major ? 11 : 6}
                    />
                ))}
                {screenX && screenRect && (
                    <g>
                        <line
                            className="DigiStudio_CanvasRulerScreenSpan"
                            x1={screenX.from}
                            y1={1}
                            x2={screenX.to}
                            y2={1}
                        />
                        <text
                            className="DigiStudio_CanvasRulerDimension"
                            x={screenX.middle}
                            y={18}
                            textAnchor="middle"
                        >
                            {`${screenRect.width}px`}
                        </text>
                    </g>
                )}
            </svg>
            <svg
                className="DigiStudio_CanvasRulerY"
                width={LEFT_RULER_DEPTH}
                height={yLength}
                viewBox={`0 0 ${LEFT_RULER_DEPTH} ${yLength}`}
            >
                {yTicks.map(tick => (
                    <line
                        key={tick.value}
                        className="DigiStudio_CanvasRulerTick"
                        x1={0}
                        y1={tick.position}
                        x2={tick.major ? 11 : 6}
                        y2={tick.position}
                    />
                ))}
                {screenY && (
                    <line
                        className="DigiStudio_CanvasRulerScreenSpan"
                        x1={1}
                        y1={screenY.from}
                        x2={1}
                        y2={screenY.to}
                    />
                )}
            </svg>
            {screenY && screenRect && (
                <div
                    className="DigiStudio_CanvasScreenHeight"
                    style={{ top: screenY.middle }}
                >
                    {`${screenRect.height}px`}
                </div>
            )}
        </div>
    );
}
