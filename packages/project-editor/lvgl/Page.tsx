import React from "react";
import { observer } from "mobx-react";
import { runInAction } from "mobx";

import { ProjectContext } from "project-editor/project/context";
import type { Page } from "project-editor/features/page/page";
import type { IFlowContext } from "project-editor/flow/flow-interfaces";
import {
    LVGLNonActivePageViewerRuntime,
    LVGLPageEditorRuntime,
    LVGLPageRuntime
} from "project-editor/lvgl/page-runtime";
import { settingsController } from "home/settings";
import { ProjectEditor } from "project-editor/project-editor-interface";
import { getLVGLEditorPreviewHeight } from "project-editor/lvgl/EditorPreview";
import type { PageTabState } from "project-editor/features/page/PageEditor";

export const LVGLPage = observer(
    class LVGLPage extends React.Component<{
        page: Page;
        flowContext: IFlowContext;
    }> {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        canvasRef = React.createRef<HTMLCanvasElement>();
        runtime: LVGLPageRuntime | undefined;
        fitPreviewAnimationFrame: number | undefined;

        // Renderer updates frequently during selection/drag. Recreating the
        // WASM runtime on every React update races the old and new frame loops,
        // leaving a stale/gray canvas after mouse release.
        private runtimeConfig:
            | {
                  page: Page;
                  width: number;
                  height: number;
                  version: string;
                  darkTheme: boolean;
                  runtimeMode: boolean;
                  expanded: boolean;
              }
            | undefined;

        private getRuntimeConfig() {
            const page = this.props.page;
            const editor = this.context.editorsStore.getEditorByObject(page);
            const runtimeMode = !!this.context.runtime;
            const expanded =
                !runtimeMode &&
                (editor?.state as PageTabState | undefined)
                    ?.lvglEditorViewMode === "expanded";
            return {
                page,
                width: page.width,
                height: expanded
                    ? getLVGLEditorPreviewHeight(page)
                    : page.height,
                version: this.context.project.settings.general.lvglVersion,
                darkTheme: this.context.project.settings.general.darkTheme,
                runtimeMode,
                expanded
            };
        }

        createPageRuntime() {
            this.runtimeConfig = this.getRuntimeConfig();
            if (this.context.runtime) {
                this.runtime = new LVGLNonActivePageViewerRuntime(
                    this.props.page,
                    this.props.page.width,
                    this.props.page.height,
                    this.canvasRef.current!.getContext("2d")!
                );
            } else {
                this.runtime = new LVGLPageEditorRuntime(
                    this.props.page,
                    this.canvasRef.current!.getContext("2d")!,
                    this.props.flowContext
                );
            }

            this.runtime.mount();
        }

        componentDidMount() {
            this.createPageRuntime();
            this.autoFitInitialExpandedView();
        }

        // Only the first opening of an unsaved editing viewport is auto-fitted.
        // Existing user pan and zoom settings always take precedence.
        autoFitInitialExpandedView(attempt = 0) {
            if (this.context.runtime) {
                return;
            }
            const page = this.props.page;
            const editor = this.context.editorsStore.getEditorByObject(page);
            const state = editor?.state as PageTabState | undefined;
            if (
                !state ||
                state.lvglEditorViewMode !== "expanded" ||
                this.context.uiStateStore.getObjectUIState(
                    page,
                    "flow-state"
                )?.transform
            ) {
                return;
            }
            const transform = state.transform.clone();
            const client = transform.clientRect;
            if (client.width <= 1 || client.height <= 1) {
                if (attempt < 12) {
                    this.fitPreviewAnimationFrame = requestAnimationFrame(
                        () => this.autoFitInitialExpandedView(attempt + 1)
                    );
                }
                return;
            }
            const previewHeight = getLVGLEditorPreviewHeight(page);
            const scale = Math.max(
                0.05,
                Math.min(
                    1,
                    (client.width - 40) / page.width,
                    (client.height - 40) / previewHeight
                )
            );
            transform.scale = scale;
            transform.translate = {
                x: -(page.left + page.width / 2) * scale,
                y: -(page.top + previewHeight / 2) * scale
            };
            runInAction(() => {
                state.transform = transform;
            });
        }

        componentDidUpdate() {
            const previous = this.runtimeConfig;
            const current = this.getRuntimeConfig();
            const needsReinitialization =
                !this.runtime ||
                !previous ||
                previous.page !== current.page ||
                previous.width !== current.width ||
                previous.height !== current.height ||
                previous.version !== current.version ||
                previous.darkTheme !== current.darkTheme ||
                previous.runtimeMode !== current.runtimeMode ||
                previous.expanded !== current.expanded;

            if (needsReinitialization) {
                this.runtime?.unmount();
                this.runtime = undefined;
                this.createPageRuntime();
            }
        }

        componentWillUnmount() {
            if (this.fitPreviewAnimationFrame !== undefined) {
                cancelAnimationFrame(this.fitPreviewAnimationFrame);
            }
            // Stop drawing before React destroys the canvas, never on a
            // delayed timer where it could invalidate a newly mounted runtime.
            this.runtime?.unmount();
            this.runtime = undefined;
            this.runtimeConfig = undefined;
        }

        render() {
            this.context.project.settings.general.lvglVersion;
            this.context.project.settings.general.darkTheme;

            const { page, expanded, height } = this.getRuntimeConfig();

            return (
                <>
                    <LVGLPageCanvas
                        ref={this.canvasRef}
                        width={page.width}
                        height={height}
                        flowContext={this.props.flowContext}
                    />
                    {expanded && height > page.height && (
                        <div
                            title={"Real device boundary: " +
                                page.width + " × " + page.height}
                            style={{
                                position: "absolute",
                                left: page.left,
                                top: page.top + page.height,
                                width: page.width,
                                height: 0,
                                borderTop: "2px dashed #0ea5e9",
                                pointerEvents: "none",
                                zIndex: 1
                            }}
                        />
                    )}
                </>
            );
        }
    }
);

const LVGLPageCanvas = observer(
    React.forwardRef(
        (
            props: {
                width: number;
                height: number;
                flowContext: IFlowContext;
            },
            ref: React.Ref<HTMLCanvasElement>
        ) => {
            const style: React.CSSProperties = {
                imageRendering:
                    props.flowContext.viewState.transform.scale > 2
                        ? "pixelated"
                        : "auto"
            };

            const page = ProjectEditor.getPage(
                props.flowContext.document.flow.object
            );

            if (
                !(page && page.isUsedAsUserWidget) &&
                (props.flowContext.projectStore.project.settings.general
                    .circularDisplay ||
                    props.flowContext.projectStore.project.settings.general
                        .displayBorderRadius != 0)
            ) {
                style.borderRadius = props.flowContext.projectStore.project
                    .settings.general.circularDisplay
                    ? Math.min(props.width, props.height)
                    : props.flowContext.projectStore.project.settings.general
                          .displayBorderRadius;

                style.border = `1px solid ${
                    settingsController.isDarkTheme ? "#444" : "#eee"
                }`;
                style.transform = "translate(-1px, -1px)";
            }

            return (
                <canvas
                    ref={ref}
                    width={props.width}
                    height={props.height}
                    style={style}
                ></canvas>
            );
        }
    )
);
