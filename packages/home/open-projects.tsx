import path from "path";
import fs from "fs";
import { clipboard, ipcRenderer } from "electron";
import React from "react";
import ReactDOM from "react-dom";
import {
    computed,
    action,
    observable,
    runInAction,
    makeObservable,
    autorun
} from "mobx";
import { observer } from "mobx-react";

import { ButtonAction, IconAction } from "eez-studio-ui/action";
import { Icon } from "eez-studio-ui/icon";

import { stringCompare } from "eez-studio-shared/string";

import { IListNode, List, ListContainer, ListItem } from "eez-studio-ui/list";
import { settingsController } from "home/settings";
import type { IMruItem } from "main/settings";
import { SearchInput } from "eez-studio-ui/search-input";
import { getProjectIcon } from "home/helper";
import { HOME_TAB_OPEN_ICON } from "project-editor/ui-components/icons";

////////////////////////////////////////////////////////////////////////////////

const SORT_ALPHA_ICON = (
    <svg
        viewBox="0 0 24 24"
        strokeWidth="2"
        stroke="currentColor"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
        <path d="M15 10v-5c0 -1.38 .62 -2 2 -2s2 .62 2 2v5m0 -3h-4"></path>
        <path d="M19 21h-4l4 -7h-4"></path>
        <path d="M4 15l3 3l3 -3"></path>
        <path d="M7 6v12"></path>
    </svg>
);

const SORT_RECENT_ICON = (
    <svg
        viewBox="0 0 24 24"
        strokeWidth="2"
        stroke="currentColor"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
        <line x1="4" y1="6" x2="13" y2="6"></line>
        <line x1="4" y1="12" x2="11" y2="12"></line>
        <line x1="4" y1="18" x2="11" y2="18"></line>
        <polyline points="15 15 18 18 21 15"></polyline>
        <line x1="18" y1="6" x2="18" y2="18"></line>
    </svg>
);

////////////////////////////////////////////////////////////////////////////////

interface ProjectActionsPopupPosition {
    left: number;
    right: number;
    top: number;
    bottom: number;
    rowTop: number;
}

class OpenProjectsStore {
    selectedMruItem: IMruItem | undefined;
    projectActionsPopupPosition: ProjectActionsPopupPosition | undefined;
    searchText: string = "";
    sortAlphabetically: boolean = false;
    lvglVersions = observable.map<string, string>();
    private pendingLvglVersionReads = new Set<string>();

    constructor() {
        this.sortAlphabetically =
            localStorage.getItem("homeTabProjectsSort") == "alphabetically"
                ? true
                : false;

        makeObservable(this, {
            selectedMruItem: observable,
            projectActionsPopupPosition: observable,
            searchText: observable,
            sortAlphabetically: observable,
            mru: computed,
            mruAlpha: computed,
            allMruItems: computed,
            toggleSort: action,
            onSearchChange: action,
            openProjectActions: action,
            closeProjectActionsPopup: action,
            editProject: action,
            copyProjectPath: action,
            removeFromList: action
        });

        // Read only the LVGL version metadata needed by the home-page filters.
        // Keep this separate from project loading so the recent-project list stays lightweight.
        autorun(() => {
            settingsController.mru.forEach(mruItem => {
                if (mruItem.projectType != "lvgl") {
                    return;
                }

                const filePath = mruItem.filePath;
                if (
                    this.lvglVersions.has(filePath) ||
                    this.pendingLvglVersionReads.has(filePath)
                ) {
                    return;
                }

                this.pendingLvglVersionReads.add(filePath);
                void fs.promises
                    .readFile(filePath, "utf8")
                    .then(jsonStr => {
                        const projectJSON = JSON.parse(jsonStr);
                        const version =
                            projectJSON.settings?.general?.lvglVersion;
                        runInAction(() => {
                            this.lvglVersions.set(
                                filePath,
                                typeof version == "string" ? version : ""
                            );
                        });
                    })
                    .catch(() => {
                        runInAction(() => this.lvglVersions.set(filePath, ""));
                    })
                    .finally(() => {
                        this.pendingLvglVersionReads.delete(filePath);
                    });
            });
        });

    }

    get mruAlpha() {
        const mru = [...settingsController.mru];
        mru.sort((mruItem1, mruItem2) => {
            const baseName1 = path.basename(mruItem1.filePath);
            const baseName2 = path.basename(mruItem2.filePath);
            return stringCompare(baseName1, baseName2);
        });
        return mru;
    }

    get mru() {
        return this.sortAlphabetically ? this.mruAlpha : settingsController.mru;
    }

    get allMruItems() {
        return openProjectsStore.mru
            .filter(
                mruItem =>
                    mruItem.filePath
                        .toLowerCase()
                        .indexOf(
                            openProjectsStore.searchText.trim().toLowerCase()
                        ) != -1
            )
            .map(mruItem => ({
                id: mruItem.filePath,
                data: mruItem,
                selected: mruItem == openProjectsStore.selectedMruItem
            }));
    }

    getMruItemsForLvglVersion(version: "8" | "9") {
        return this.allMruItems.filter(mruNode => {
            const lvglVersion = this.lvglVersions.get(mruNode.data.filePath);
            return (
                mruNode.data.projectType == "lvgl" &&
                !!lvglVersion &&
                lvglVersion.startsWith(version + ".")
            );
        });
    }

    toggleSort = () => {
        this.sortAlphabetically = !this.sortAlphabetically;

        localStorage.setItem(
            "homeTabProjectsSort",
            this.sortAlphabetically ? "alphabetically" : "most-recent"
        );
    };

    onSearchChange = (
        event: any,
        lvglVersionFilter?: "8" | "9"
    ) => {
        this.searchText = $(event.target).val() as string;
        const items = lvglVersionFilter
            ? this.getMruItemsForLvglVersion(lvglVersionFilter)
            : this.allMruItems;
        this.selectedMruItem = items[0]?.data;
    };

    openProjectActions = (
        mruItem: IMruItem,
        event: React.MouseEvent<HTMLDivElement>
    ) => {
        this.selectedMruItem = mruItem;
        const rowBounds = event.currentTarget.getBoundingClientRect();
        const listBounds =
            event.currentTarget
                .closest(".EezStudio_ListContainer")
                ?.getBoundingClientRect() ?? rowBounds;

        this.projectActionsPopupPosition = {
            left: listBounds.left,
            right: listBounds.right,
            top: listBounds.top,
            bottom: listBounds.bottom,
            rowTop: rowBounds.top
        };
    };

    closeProjectActionsPopup = () => {
        this.projectActionsPopupPosition = undefined;
    };

    editProject = () => {
        if (this.selectedMruItem) {
            ipcRenderer.send("open-file", this.selectedMruItem.filePath);
        }
        this.closeProjectActionsPopup();
    };

    copyProjectPath = () => {
        if (this.selectedMruItem) {
            clipboard.writeText(this.selectedMruItem.filePath);
        }
        this.closeProjectActionsPopup();
    };

    removeFromList = () => {
        if (openProjectsStore.selectedMruItem) {
            settingsController.removeItemFromMRU(
                openProjectsStore.selectedMruItem
            );

            openProjectsStore.selectedMruItem = undefined;
        }
        this.closeProjectActionsPopup();
    };
}

const openProjectsStore = new OpenProjectsStore();

////////////////////////////////////////////////////////////////////////////////

interface ProjectsProps {
    lvglVersionFilter?: "8" | "9";
}

export const Projects = observer(
    class Projects extends React.Component<ProjectsProps> {
        componentDidMount() {
            document.addEventListener("mousedown", this.onDocumentMouseDown, true);
            document.addEventListener("keydown", this.onDocumentKeyDown, true);
        }

        componentWillUnmount() {
            document.removeEventListener("mousedown", this.onDocumentMouseDown, true);
            document.removeEventListener("keydown", this.onDocumentKeyDown, true);
        }

        onDocumentMouseDown = (event: MouseEvent) => {
            const target = event.target;
            if (
                target instanceof Element &&
                target.closest(".EezStudio_HomeTab_Projects_ProjectInfo_Popup")
            ) {
                return;
            }
            openProjectsStore.closeProjectActionsPopup();
        };

        onDocumentKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                openProjectsStore.closeProjectActionsPopup();
            }
        };

        componentDidUpdate(prevProps: ProjectsProps) {
            if (
                prevProps.lvglVersionFilter != this.props.lvglVersionFilter
            ) {
                runInAction(() => {
                    openProjectsStore.selectedMruItem = undefined;
                    openProjectsStore.closeProjectActionsPopup();
                });
            }
        }

        onContextMenu = (
            node: IListNode<IMruItem>,
            event: React.MouseEvent<HTMLDivElement>
        ) => {
            openProjectsStore.openProjectActions(node.data, event);
        };

        render() {
            const projectNodes = this.props.lvglVersionFilter
                ? openProjectsStore.getMruItemsForLvglVersion(
                      this.props.lvglVersionFilter
                  )
                : openProjectsStore.allMruItems;
            const pageTitle = this.props.lvglVersionFilter
                ? "LVGL " + this.props.lvglVersionFilter + " Projects"
                : "Recent Projects";

            return (
                <div className="EezStudio_HomeTab_Projects">
                    <div className="EezStudio_HomeTab_Projects_Header">
                        <div className="EezStudio_HomeTab_Projects_Title">
                            <strong>{pageTitle}</strong>
                            <span>
                                {this.props.lvglVersionFilter
                                    ? "Projects using LVGL " + this.props.lvglVersionFilter
                                    : "Pick up where you left off"}
                            </span>
                        </div>
                        <SearchInput
                            placeholder="Search project..."
                            searchText={openProjectsStore.searchText}
                            onClear={action(() => {
                                openProjectsStore.searchText = "";
                            })}
                            onChange={event =>
                                openProjectsStore.onSearchChange(
                                    event,
                                    this.props.lvglVersionFilter
                                )
                            }
                            onKeyDown={event =>
                                openProjectsStore.onSearchChange(
                                    event,
                                    this.props.lvglVersionFilter
                                )
                            }
                        />
                        <IconAction
                            icon={
                                openProjectsStore.sortAlphabetically
                                    ? SORT_ALPHA_ICON
                                    : SORT_RECENT_ICON
                            }
                            title={
                                openProjectsStore.sortAlphabetically
                                    ? "Sort alphabetically"
                                    : "Show most recent first"
                            }
                            onClick={openProjectsStore.toggleSort}
                        />
                    </div>
                    <div className="EezStudio_HomeTab_Projects_Body">
                        <div className="EezStudio_HomeTab_Projects_Space"></div>
                        <div className="EezStudio_HomeTab_Projects_Actions">
                            <ButtonAction
                                className="btn-primary"
                                text={"Open Project"}
                                title="Open a local DigiStudio Project"
                                icon={HOME_TAB_OPEN_ICON}
                                onClick={() => {
                                    ipcRenderer.send("open-project");
                                }}
                            />
                        </div>
                        <ListContainer tabIndex={0}>
                            {projectNodes.length == 0 ? (
                                <div className="EezStudio_HomeTab_Projects_EmptyState">
                                    <Icon icon="material:folder_open" size={28} />
                                    <strong>
                                        {this.props.lvglVersionFilter
                                            ? "No LVGL " + this.props.lvglVersionFilter + " projects found"
                                            : "No recent projects yet"}
                                    </strong>
                                    <span>
                                        Open an existing project or create a new one to get started.
                                    </span>
                                </div>
                            ) : (
                            <List
                                nodes={projectNodes}
                                renderNode={(node: IListNode<IMruItem>) => {
                                    let mruItem = node.data;

                                    const isProject =
                                        mruItem.filePath.endsWith(
                                            ".eez-project"
                                        );

                                    let extension = isProject
                                        ? ".eez-project"
                                        : ".eez-dashboard";

                                    const baseName = path.basename(
                                        mruItem.filePath,
                                        extension
                                    );

                                    return (
                                        <ListItem
                                            leftIcon={
                                                mruItem.projectType == "lvgl" ? (
                                                    <span className="EezStudio_HomeTab_ProjectVersionBadge">
                                                        {openProjectsStore.lvglVersions.get(mruItem.filePath)?.startsWith("9.")
                                                            ? "v9"
                                                            : openProjectsStore.lvglVersions.get(mruItem.filePath)?.startsWith("8.")
                                                              ? "v8"
                                                              : "LV"}
                                                    </span>
                                                ) : (
                                                    getProjectIcon(
                                                        mruItem.filePath,
                                                        mruItem.projectType,
                                                        30,
                                                        mruItem.hasFlowSupport
                                                    )
                                                )
                                            }
                                            leftIconSize={32}
                                            label={
                                                <div
                                                    className="EezStudio_HomeTab_ProjectItem"
                                                    title={mruItem.filePath}
                                                >
                                                    <div className="project-name">
                                                        <span className="fw-bolder">
                                                            {baseName}
                                                        </span>
                                                        <span>{extension}</span>
                                                    </div>
                                                    <div className="project-folder">
                                                        {path.dirname(
                                                            mruItem.filePath
                                                        )}
                                                    </div>
                                                </div>
                                            }
                                        />
                                    );
                                }}
                                selectNode={(
                                    node: IListNode<IMruItem>,
                                    event: React.MouseEvent<HTMLDivElement>
                                ) => {
                                    openProjectsStore.openProjectActions(
                                        node.data,
                                        event
                                    );
                                }}
                                onContextMenu={this.onContextMenu}
                                onDoubleClick={openProjectsStore.editProject}
                            ></List>
                            )}
                        </ListContainer>
                        <ProjectInfo />
                    </div>
                </div>
            );
        }
    }
);

export const ProjectInfo = observer(
    class ProjectInfo extends React.Component {
        private popupElement: HTMLDivElement | null = null;

        componentDidMount() {
            window.addEventListener("resize", this.updatePopupPosition);
            this.updatePopupPosition();
        }

        componentWillUnmount() {
            window.removeEventListener("resize", this.updatePopupPosition);
        }

        componentDidUpdate() {
            this.updatePopupPosition();
        }

        updatePopupPosition = () => {
            const popup = this.popupElement;
            const position = openProjectsStore.projectActionsPopupPosition;
            if (!popup || !position) {
                return;
            }

            const margin = 8;
            const availableWidth = Math.max(
                0,
                position.right - position.left - margin * 2
            );
            const availableHeight = Math.max(
                0,
                position.bottom - position.top - margin * 2
            );

            // Keep the popup completely inside the project-list panel.
            popup.style.width = `${Math.min(260, availableWidth)}px`;
            popup.style.maxWidth = `${availableWidth}px`;
            popup.style.maxHeight = `${availableHeight}px`;

            const bounds = popup.getBoundingClientRect();
            const left = position.right - bounds.width - margin;
            const top = Math.max(
                position.top + margin,
                Math.min(
                    position.rowTop,
                    position.bottom - bounds.height - margin
                )
            );

            popup.style.left = `${left}px`;
            popup.style.top = `${top}px`;
        };

        render() {
            const position = openProjectsStore.projectActionsPopupPosition;
            const selectedProject = openProjectsStore.selectedMruItem;
            const isChinese = settingsController.locale
                .toLowerCase()
                .startsWith("zh");
            if (!position || !selectedProject) {
                return null;
            }

            return ReactDOM.createPortal(
                <div
                    ref={element => (this.popupElement = element)}
                    className="EezStudio_HomeTab_Projects_ProjectInfo_Popup"
                    style={{
                        left: position.right - 268,
                        top: position.rowTop,
                        width: Math.min(
                            260,
                            Math.max(0, position.right - position.left - 16)
                        ),
                        maxHeight: Math.max(
                            0,
                            position.bottom - position.top - 16
                        )
                    }}
                    role="menu"
                    aria-label={isChinese ? "项目操作" : "Project actions"}
                >
                    <div className="EezStudio_HomeTab_Projects_ProjectInfo_Actions">
                        <ButtonAction
                            className="btn-primary"
                            text={isChinese ? "编辑项目" : "Edit Project"}
                            title={isChinese ? "编辑项目" : "Edit Project"}
                            icon="material:edit"
                            onClick={openProjectsStore.editProject}
                        />
                        <ButtonAction
                            className="btn-secondary"
                            text={isChinese ? "复制项目路径" : "Copy Project Path"}
                            title={isChinese ? "复制项目路径" : "Copy Project Path"}
                            icon="material:content_copy"
                            onClick={openProjectsStore.copyProjectPath}
                        />
                        <ButtonAction
                            className="btn-danger"
                            text={isChinese ? "从列表移除" : "Remove From List"}
                            title={isChinese ? "从列表移除" : "Remove From List"}
                            icon="material:close"
                            onClick={openProjectsStore.removeFromList}
                        />
                    </div>
                </div>,
                document.body
            );
        }
    }
);
