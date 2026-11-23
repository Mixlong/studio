import fs from "fs";
import { ipcRenderer, shell, clipboard } from "electron";
import { dialog, getCurrentWindow } from "@electron/remote";
import { confirm } from "eez-studio-ui/dialog-electron";
import path from "path";
import React from "react";
import {
    observable,
    computed,
    action,
    runInAction,
    toJS,
    makeObservable,
    reaction
} from "mobx";
import { observer } from "mobx-react";
import classNames from "classnames";
import * as FlexLayout from "flexlayout-react";

import { app, createEmptyFile } from "eez-studio-shared/util-electron";
import {
    initInstrumentDatabase,
    InstrumentDatabase,
    instrumentDatabases
} from "eez-studio-shared/db";
import {
    getLocale,
    setLocale,
    DATE_FORMATS,
    getDateFormat,
    setDateFormat,
    TIME_FORMATS,
    getTimeFormat,
    setTimeFormat
} from "eez-studio-shared/i10n";
import { formatBytes } from "eez-studio-shared/formatBytes";
import { productConfig } from "eez-studio-shared/product-config";

import { showDialog, Dialog } from "eez-studio-ui/dialog";
import { Loader } from "eez-studio-ui/loader";
import * as notification from "eez-studio-ui/notification";
import {
    Body,
    ToolbarHeader,
    VerticalHeaderWithBody
} from "eez-studio-ui/header-with-body";

import dbVacuum from "db-services/vacuum";
import { formatDateRelative, formatDateWithLocaleAndFormat } from "eez-studio-shared/util";
import type { IMruItem } from "main/settings";
import { IconAction } from "eez-studio-ui/action";
import { Icon } from "eez-studio-ui/icon";
import { HOME_TAB_OPEN_ICON } from "project-editor/ui-components/icons";
import { FlexLayoutContainer } from "eez-studio-ui/FlexLayout";
import { homeLayoutModels } from "./home-layout-models";

////////////////////////////////////////////////////////////////////////////////

export const COMPACT_DATABASE_MESSAGE =
    "It is recommended to compact the database every 30 days.";

////////////////////////////////////////////////////////////////////////////////

const getIsDarkTheme = function () {
    return ipcRenderer.sendSync("getIsDarkTheme");
};

const setIsDarkTheme = function (value: boolean) {
    ipcRenderer.send("setIsDarkTheme", value);
};

type WorkspaceAppearance = "light" | "dark";

////////////////////////////////////////////////////////////////////////////////

const getMRU: () => IMruItem[] = function () {
    return ipcRenderer.sendSync("getMRU");
};

const setMRU = function (value: IMruItem[]) {
    ipcRenderer.send("setMRU", toJS(value));
};

ipcRenderer.on("mru-changed", async (sender: any, mru: IMruItem[]) => {
    function isMruChanged(mru1: IMruItem[], mru2: IMruItem[]) {
        if (!!mru1 != !!mru) {
            return true;
        }

        if (mru1.length != mru2.length) {
            return true;
        }
        for (let i = 0; i < mru1.length; i++) {
            if (
                mru1[i].filePath != mru2[i].filePath ||
                mru1[i].projectType != mru2[i].projectType
            ) {
                return true;
            }
        }
        return false;
    }

    if (isMruChanged(mru, settingsController.mru)) {
        runInAction(() => (settingsController.mru = mru));
    }
});

////////////////////////////////////////////////////////////////////////////////

const getShowComponentsPaletteInProjectEditor = function () {
    return ipcRenderer.sendSync("getShowComponentsPaletteInProjectEditor");
};

const setShowComponentsPaletteInProjectEditor = function (value: boolean) {
    ipcRenderer.send("setShowComponentsPaletteInProjectEditor", value);
};

////////////////////////////////////////////////////////////////////////////////

class SettingsController {
    activetLocale = getLocale();
    activeDateFormat = getDateFormat();
    activeTimeFormat = getTimeFormat();

    selectedDatabase: InstrumentDatabase | undefined;

    locale: string = getLocale();
    dateFormat: string = getDateFormat();
    timeFormat: string = getTimeFormat();
    isDarkTheme: boolean = getIsDarkTheme();
    mru: IMruItem[] = getMRU();

    pythonUseCustomPath: boolean = false;
    pythonCustomPath: string = "";

    useLocalTemplates: boolean = false;
    localTemplatesPath: string = "";

    _showComponentsPaletteInProjectEditor: boolean =
        getShowComponentsPaletteInProjectEditor();

    constructor() {
        this.pythonUseCustomPath =
            window.localStorage.getItem("pythonUseCustomPath") == "1"
                ? true
                : false;
        this.pythonCustomPath =
            window.localStorage.getItem("pythonCustomPath") ?? "";

        this.useLocalTemplates =
            window.localStorage.getItem("useLocalTemplates") == "1"
                ? true
                : false;
        this.localTemplatesPath =
            window.localStorage.getItem("localTemplatesPath") ?? "";

        this.selectedDatabase = instrumentDatabases.activeDatabase;

        makeObservable(this, {
            selectedDatabase: observable,
            locale: observable,
            dateFormat: observable,
            timeFormat: observable,
            isDarkTheme: observable,
            appearance: computed,
            selectAppearance: action.bound,
            mru: observable,
            restartRequired: computed,
            onLocaleChange: action.bound,
            onDateFormatChanged: action.bound,
            onTimeFormatChanged: action.bound,
            switchTheme: action.bound,
            removeItemFromMRU: action,
            pythonUseCustomPath: observable,
            pythonCustomPath: observable,
            useLocalTemplates: observable,
            localTemplatesPath: observable
        });

        this.onThemeSwitched();

        reaction(
            () => ({
                setCustomPath: this.pythonUseCustomPath,
                customPythonPath: this.pythonCustomPath
            }),
            ({ setCustomPath, customPythonPath }) => {
                window.localStorage.setItem(
                    "pythonUseCustomPath",
                    setCustomPath ? "1" : "0"
                );
                window.localStorage.setItem(
                    "pythonCustomPath",
                    customPythonPath
                );
            }
        );

        reaction(
            () => ({
                useLocalTemplates: this.useLocalTemplates,
                localTemplatesPath: this.localTemplatesPath
            }),
            ({ useLocalTemplates, localTemplatesPath }) => {
                window.localStorage.setItem(
                    "useLocalTemplates",
                    useLocalTemplates ? "1" : "0"
                );
                window.localStorage.setItem(
                    "localTemplatesPath",
                    localTemplatesPath
                );
            }
        );
    }

    get restartRequired() {
        const activeDatabase = instrumentDatabases.activeDatabase;
        const runningDatabasePath = instrumentDatabases.activeDatabasePath;
        const selectedDatabasePath = activeDatabase?.filePath;

        // An empty database list means no database switch is pending. The app
        // can still be using its fallback database path in that situation.
        // Compare resolved paths to avoid false positives from slash/case
        // differences on Windows.
        const databaseRestartRequired =
            !!selectedDatabasePath &&
            !!runningDatabasePath &&
            (process.platform === "win32"
                ? path.resolve(selectedDatabasePath).toLowerCase() !==
                  path.resolve(runningDatabasePath).toLowerCase()
                : path.resolve(selectedDatabasePath) !==
                  path.resolve(runningDatabasePath));

        return (
            databaseRestartRequired ||
            this.locale !== this.activetLocale ||
            this.dateFormat !== this.activeDateFormat ||
            this.timeFormat !== this.activeTimeFormat
        );
    }

    onLocaleChange(value: string) {
        this.locale = value;
        setLocale(value);
    }

    onDateFormatChanged(value: string) {
        this.dateFormat = value;
        setDateFormat(value);
    }

    onTimeFormatChanged(value: string) {
        this.timeFormat = value;
        setTimeFormat(value);
    }

    onThemeSwitchedTimeout: any;

    get appearance(): WorkspaceAppearance {
        return this.isDarkTheme ? "dark" : "light";
    }

    // One source of truth for the persisted appearance preset. The main
    // process keeps the preexisting isDarkTheme setting for compatibility.
    selectAppearance(value: WorkspaceAppearance) {
        if (
            this.onThemeSwitchedTimeout ||
            !["light", "dark"].includes(value)
        ) {
            return;
        }

        const dark = value === "dark";
        if (this.isDarkTheme === dark) return;

        // Appearance changes colors only. The editor uses one shared Guider
        // workspace layout in both light and dark modes.
        this.isDarkTheme = dark;
        setIsDarkTheme(dark);
        this.onThemeSwitched();
    }

    // Ctrl+Shift+T switches the color theme without changing editor layout.
    switchTheme(value: boolean) {
        if (this.onThemeSwitchedTimeout) return;
        this.isDarkTheme = value;
        setIsDarkTheme(value);
        this.onThemeSwitched();
    }

    onThemeSwitched() {
        const content = document.getElementById(
            "EezStudio_Content"
        ) as HTMLDivElement;
        content.style.opacity = "0";

        const body = document.querySelector("#EezStudio_Content>.EezStudio_HeaderWithBody>.EezStudio_Body");
        if (body && body instanceof HTMLDivElement && body.style) {
            body.style.display = "none";
        }

        const mainLinkElement = document.getElementById(
            "main-css"
        ) as HTMLLinkElement;

        const flexlayoutLinkElement = document.getElementById(
            "flexlayout-css"
        ) as HTMLLinkElement;

        // Keep one workspace layout for both color themes.
        document.documentElement.setAttribute("data-workspace-skin", "guider");

        if (this.isDarkTheme) {
            document.body.parentElement?.setAttribute("data-bs-theme", "dark");

            mainLinkElement.href =
                "../eez-studio-ui/_stylesheets/main-dark.css";

            flexlayoutLinkElement.href =
                "../../node_modules/flexlayout-react/style/dark.css";
        } else {
            document.body.parentElement?.setAttribute("data-bs-theme", "light");

            mainLinkElement.href = "../eez-studio-ui/_stylesheets/main.css";

            flexlayoutLinkElement.href =
                "../../node_modules/flexlayout-react/style/light.css";
        }

        this.onThemeSwitchedTimeout = setTimeout(() => {
            if (body && body instanceof HTMLDivElement && body.style) {
                body.style.display = "flex";
            }

            this.onThemeSwitchedTimeout = undefined;
            content.style.opacity = "";
        }, 50);
    }

    removeItemFromMRU(mruItem: IMruItem) {
        const i = this.mru.indexOf(mruItem);
        if (i != -1) {
            this.mru.splice(i, 1);
            setMRU(this.mru);
        }
    }

    addDatabase(filePath: string, isActive: boolean) {
        instrumentDatabases.addDatabase(filePath, isActive);

        runInAction(() => {
            this.selectedDatabase = instrumentDatabases.databases.find(
                database => database.filePath == filePath
            );
        });
    }

    createNewDatabase = async () => {
        let defaultPath = window.localStorage.getItem("lastDatabaseSavePath");

        const result = await dialog.showSaveDialog(getCurrentWindow(), {
            filters: [
                { name: isChineseLocale() ? "数据库文件" : "DB files", extensions: ["db"] },
                { name: isChineseLocale() ? "所有文件" : "All Files", extensions: ["*"] }
            ],
            defaultPath: defaultPath ?? undefined
        });

        const filePath = result.filePath;

        if (filePath) {
            try {
                createEmptyFile(filePath);

                await initInstrumentDatabase(filePath);

                const onFinish = action((isActive: boolean) => {
                    this.addDatabase(filePath, isActive);

                    window.localStorage.setItem(
                        "lastDatabaseSavePath",
                        path.dirname(filePath)
                    );

                    if (isActive) {
                        this.askForRestart();
                    }
                });

                confirm(
                    isChineseLocale() ? "是否将此数据库设为当前数据库？" : "Do you want to make this database active?",
                    undefined,
                    () => onFinish(true),
                    () => onFinish(false)
                );
            } catch (error: any) {
                notification.error(error.toString());
            }
        }
    };

    openDatabase = async () => {
        let defaultPath = window.localStorage.getItem("lastDatabaseOpenPath");

        const result = await dialog.showOpenDialog(getCurrentWindow(), {
            properties: ["openFile"],
            filters: [
                { name: isChineseLocale() ? "数据库文件" : "DB files", extensions: ["db"] },
                { name: isChineseLocale() ? "所有文件" : "All Files", extensions: ["*"] }
            ],
            defaultPath: defaultPath ?? undefined
        });

        const filePaths = result.filePaths;

        if (filePaths && filePaths[0]) {
            const filePath = filePaths[0];

            const onFinish = action((isActive: boolean) => {
                this.addDatabase(filePath, isActive);

                window.localStorage.setItem(
                    "lastDatabaseOpenPath",
                    path.dirname(filePath)
                );

                if (isActive) {
                    this.askForRestart();
                }
            });

            confirm(
                isChineseLocale() ? "是否将此数据库设为当前数据库？" : "Do you want to make this database active?",
                undefined,
                () => onFinish(true),
                () => onFinish(false)
            );
        }
    };

    askForRestart = () => {
        if (
            instrumentDatabases.activeDatabase &&
            instrumentDatabases.activeDatabase.filePath !=
                instrumentDatabases.activeDatabasePath
        ) {
            confirm(
                isChineseLocale() ? "是否重新启动应用程序？" : "Do you want to restart the application?",
                isChineseLocale() ? "需要重新启动以完成新数据库的启用。" : "Restart is required to finish activation of new database.",
                this.restart
            );
        }
    };

    restart = () => {
        app.relaunch();
        app.exit();
    };

    setAsActiveDatabase = action(() => {
        if (this.selectedDatabase) {
            instrumentDatabases.setAsActiveDatabase(this.selectedDatabase);

            this.askForRestart();
        }
    });

    deleteDatabase = () => {
        if (this.selectedDatabase) {
            instrumentDatabases.removeDatabase(this.selectedDatabase);
        }
    };

    showDatabasePathInFolder = () => {
        if (this.selectedDatabase) {
            shell.showItemInFolder(this.selectedDatabase.filePath);
        }
    };

    compactDatabase = () => {
        if (!this.selectedDatabase) {
            return;
        }
        showDialog(<CompactDatabaseDialog database={this.selectedDatabase} />);
    };

    get showComponentsPaletteInProjectEditor() {
        return this._showComponentsPaletteInProjectEditor;
    }

    set showComponentsPaletteInProjectEditor(value: boolean) {
        this._showComponentsPaletteInProjectEditor = value;
        setShowComponentsPaletteInProjectEditor(value);
    }
}

export const settingsController = new SettingsController();

ipcRenderer.on("locale-changed", (_event: any, locale: string) => {
    if (typeof locale === "string" && locale) {
        runInAction(() => {
            settingsController.locale = locale;
        });
    }
});

const isChineseLocale = () =>
    settingsController.locale.toLowerCase().startsWith("zh");

const formatSettingsRelativeDate = (date: Date | number | string) => {
    const value = formatDateRelative(date);
    if (!isChineseLocale()) return value;
    if (value === "a few seconds ago") return "几秒前";
    const match = /^(\d+) (minute|hour|day|week|month|year)s? ago$/.exec(value);
    if (!match) return value;
    const units: { [key: string]: string } = {
        minute: "分钟", hour: "小时", day: "天",
        week: "周", month: "个月", year: "年"
    };
    return match[1] + units[match[2]] + "前";
}

////////////////////////////////////////////////////////////////////////////////

const CompactDatabaseDialog = observer(
    class CompactDatabaseDialog extends React.Component<{
        database: InstrumentDatabase;
    }> {
        sizeBefore: number;
        sizeAfter: number | undefined;
        sizeReduced: number | undefined;

        constructor(props: any) {
            super(props);

            makeObservable(this, {
                sizeBefore: observable,
                sizeAfter: observable,
                sizeReduced: observable
            });

            this.sizeBefore = fs.statSync(this.props.database.filePath).size;
        }

        async componentDidMount() {
            try {
                await dbVacuum();

                runInAction(() => {
                    this.props.database.timeOfLastDatabaseCompactOperation =
                        Date.now();
                });

                runInAction(() => {
                    var fs = require("fs");

                    this.sizeAfter = fs.statSync(
                        this.props.database.filePath
                    ).size;

                    this.props.database.databaseSize = this.sizeAfter!;

                    this.sizeReduced =
                        (100 * (this.sizeBefore - this.sizeAfter!)) /
                        this.sizeBefore;
                    if (this.sizeReduced < 1) {
                        this.sizeReduced =
                            Math.round(100 * this.sizeReduced) / 100;
                    } else if (this.sizeReduced < 10) {
                        this.sizeReduced =
                            Math.round(10 * this.sizeReduced) / 10;
                    } else {
                        this.sizeReduced = Math.round(this.sizeReduced);
                    }
                });
            } catch (err: any) {
                notification.error(err);
            }
        }

        render() {
            const isChinese = isChineseLocale();
            return (
                <Dialog
                    open={true}
                    title={isChinese ? "正在整理数据库" : "Compacting Database"}
                    size="small"
                    cancelButtonText={isChinese ? "关闭" : "Close"}
                    cancelDisabled={this.sizeAfter === undefined}
                >
                    <table className="EezStudio_CompactDatabaseDialogTable">
                        <tbody>
                            <tr>
                                <td>{isChinese ? "整理前大小" : "Size before"}</td>
                                <td>{formatBytes(this.sizeBefore)}</td>
                            </tr>
                            <tr>
                                <td>{isChinese ? "整理后大小" : "Size after"}</td>
                                <td>
                                    {this.sizeAfter !== undefined ? (
                                        formatBytes(this.sizeAfter)
                                    ) : (
                                        <Loader style={{ margin: 0 }} />
                                    )}
                                </td>
                            </tr>
                            {this.sizeReduced !== undefined && (
                                <tr>
                                    <td>{isChinese ? "减少空间" : "Size reduced by "}</td>
                                    <td>
                                        {formatBytes(
                                            this.sizeBefore - this.sizeAfter!
                                        )}{" "}
                                        {isChinese ? "或" : "or"} {this.sizeReduced}%
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </Dialog>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const DatabaseListItem = observer(
    class DbPathListItem extends React.Component<{
        database: InstrumentDatabase;
        isSelected: boolean;
        onSelect: () => void;
    }> {
        render() {
            const { database, isSelected, onSelect } = this.props;
            const isChinese = isChineseLocale();

            const className = classNames({
                selected: isSelected
            });

            return (
                <tr className={className} onClick={onSelect}>
                    <td
                        style={{
                            fontWeight: database.isActive ? "bold" : "normal"
                        }}
                    >
                        {database.isActive && (
                            <Icon icon="material:star" size={13} className="me-1 text-warning" />
                        )}
                        {path.parse(database.filePath).name}
                        {database.isActive && (
                            <span className="badge bg-warning text-dark ms-2" style={{ fontSize: "10px", padding: "2px 6px" }}>
                                {isChinese ? "当前" : "ACTIVE"}
                            </span>
                        )}
                    </td>
                </tr>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const SelectedDatabaseDetails = observer(
    class SelectedDatabaseDetails extends React.Component {
        render() {
            const isChinese = isChineseLocale();
            const selectedDatabase = settingsController.selectedDatabase;
            if (!selectedDatabase) {
                return (
                    <div className="EezStudio_Settings_Database_Details d-flex align-items-center justify-content-center h-100 text-muted">
                        {isChinese ? "请从左侧列表选择一个数据库" : "Select a database from the list"}
                    </div>
                );
            }

            return (
                <div className="EezStudio_Settings_Database_Details">
                    <div className="d-flex align-items-center justify-content-between mb-3">
                        <div className="d-flex align-items-center gap-2">
                            <span style={{ fontSize: "15px", fontWeight: "bold" }}>
                                {path.parse(selectedDatabase.filePath).name}
                            </span>
                            {selectedDatabase.isActive ? (
                                <span className="badge bg-warning text-dark d-inline-flex align-items-center" style={{ fontSize: "11px", padding: "3px 8px" }}>
                                    <Icon icon="material:star" size={13} className="me-1" />
                                    <span>{isChinese ? "当前活跃数据库" : "Active Database"}</span>
                                </span>
                            ) : (
                                <button
                                    className="btn btn-warning btn-sm"
                                    onClick={settingsController.setAsActiveDatabase}
                                >
                                    {isChinese ? "设为当前数据库" : "Set as Active"}
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="mb-3">
                        <label
                            htmlFor="EezStudio_ProjectEditorScrapbook_ItemDetails_Description"
                            className="form-label"
                            style={{ fontSize: "12px", color: "var(--digi-secondary-text, #aaa)" }}
                        >
                            {isChinese ? "数据库描述备注：" : "Description:"}
                        </label>
                        <textarea
                            className="form-control"
                            id="EezStudio_ProjectEditorScrapbook_ItemDetails_Description"
                            rows={3}
                            placeholder={isChinese ? "添加关于此数据库的说明..." : "Add notes about this database..."}
                            value={selectedDatabase.description}
                            onChange={action(event => {
                                selectedDatabase.description =
                                    event.target.value;
                            })}
                            onBlur={() => selectedDatabase.storeDescription()}
                        ></textarea>
                    </div>

                    <div className="mb-3">
                        <label className="form-label" style={{ fontSize: "12px", color: "var(--digi-secondary-text, #aaa)" }}>
                            {isChinese ? "数据库物理路径：" : "File Path:"}
                        </label>
                        <div className="settings-db-path-box">
                            {selectedDatabase.filePath}
                        </div>

                        <div className="mt-2 d-flex gap-2">
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm d-inline-flex align-items-center"
                                onClick={
                                    settingsController.showDatabasePathInFolder
                                }
                            >
                                <Icon icon="material:folder_open" size={14} className="me-1" />
                                <span>{isChinese ? "在文件夹中显示" : "Show in Folder"}</span>
                            </button>

                            <button
                                type="button"
                                className="btn btn-secondary btn-sm d-inline-flex align-items-center"
                                onClick={() => {
                                    clipboard.writeText(selectedDatabase.filePath);
                                    notification.info(isChinese ? "已复制数据库路径到剪贴板" : "Copied path to clipboard");
                                }}
                            >
                                <Icon icon="material:content_copy" size={14} className="me-1" />
                                <span>{isChinese ? "复制路径" : "Copy Path"}</span>
                            </button>
                        </div>
                    </div>

                    <div
                        className={classNames("settings-db-compact-box", {
                            databaseCompactIsAdvisable:
                                selectedDatabase.isCompactDatabaseAdvisable
                        })}
                    >
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <div>
                                <span style={{ fontSize: "12px", color: "var(--digi-secondary-text, #aaa)" }}>
                                    {isChinese ? "数据库当前体积：" : "Database size: "}
                                </span>
                                <strong style={{ color: "var(--digi-accent, #ffb500)", fontSize: "13px" }}>
                                    {formatBytes(selectedDatabase.databaseSize)}
                                </strong>
                            </div>
                            <button
                                type="button"
                                className="btn btn-outline-warning btn-sm d-inline-flex align-items-center"
                                onClick={settingsController.compactDatabase}
                            >
                                <Icon icon="material:cleaning_services" size={14} className="me-1" />
                                <span>{isChinese ? "整理与碎片压缩 (VACUUM)" : "Compact Database"}</span>
                            </button>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--digi-secondary-text, #888)" }}>
                            {isChinese ? "上次整理时间：" : "Last compacted: "}
                            {formatSettingsRelativeDate(
                                selectedDatabase.timeOfLastDatabaseCompactOperation
                            )}
                        </div>
                        {selectedDatabase.isCompactDatabaseAdvisable && (
                            <div className="mt-2 text-warning d-flex align-items-center" style={{ fontSize: "12px" }}>
                                <Icon icon="material:warning" size={14} className="me-1 text-warning" />
                                <span>{isChinese ? "建议每 30 天整理一次数据库以提升读写性能并释放磁盘空间。" : COMPACT_DATABASE_MESSAGE}</span>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const DatatabaseList = observer(
    class DatatabaseList extends React.Component {
        ref = React.createRef<HTMLDivElement>();

        componentDidMount() {
            this.ensureSelectedVisible();
        }

        componentDidUpdate() {
            this.ensureSelectedVisible();
        }

        ensureSelectedVisible() {
            const selected = this.ref.current?.querySelector(".selected");
            if (selected) {
                selected.scrollIntoView({ block: "nearest" });
            }
        }

        render() {
            const isChinese = isChineseLocale();
            return (
                <VerticalHeaderWithBody className="EezStudio_Settings_Databases_List">
                    <ToolbarHeader>
                        <IconAction
                            icon="material:add"
                            title={isChinese ? "新建数据库" : "Create a new database"}
                            onClick={settingsController.createNewDatabase}
                        />
                        <IconAction
                            icon={HOME_TAB_OPEN_ICON}
                            title={isChinese ? "打开现有数据库" : "Open an existing database"}
                            onClick={settingsController.openDatabase}
                        />
                        <IconAction
                            icon="material:delete"
                            title={isChinese ? "删除数据库" : "Delete a database"}
                            onClick={settingsController.deleteDatabase}
                            enabled={
                                settingsController.selectedDatabase &&
                                !settingsController.selectedDatabase.isActive
                            }
                        />
                    </ToolbarHeader>
                    <Body>
                        <div
                            className="EezStudio_Settings_Databases_List_Body"
                            ref={this.ref}
                        >
                            <table>
                                <tbody>
                                    {instrumentDatabases.databases.map(
                                        database => (
                                            <DatabaseListItem
                                                key={database.filePath}
                                                database={database}
                                                isSelected={
                                                    database.filePath ==
                                                    settingsController
                                                        .selectedDatabase
                                                        ?.filePath
                                                }
                                                onSelect={action(
                                                    action(() => {
                                                        settingsController.selectedDatabase =
                                                            database;
                                                    })
                                                )}
                                            />
                                        )
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Body>
                </VerticalHeaderWithBody>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const Databases = observer(
    class Databases extends React.Component {
        factory(node: FlexLayout.TabNode) {
            var component = node.getComponent();

            if (component === "list") {
                return <DatatabaseList />;
            }

            if (component === "details") {
                return <SelectedDatabaseDetails />;
            }

            return null;
        }

        render() {
            return (
                <div className="EezStudio_Settings_Databases">
                    <FlexLayoutContainer
                        model={homeLayoutModels.databaseSettings}
                        factory={this.factory}
                    />
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const PythonSettings = observer(
    class PythonSettings extends React.Component {
        constructor(props: any) {
            super(props);

            const { PythonShell } =
                require("python-shell") as typeof import("python-shell");

            PythonShell.runString(
                "import sys;print(sys.executable)",
                undefined,
                action((err, output) => {
                    if (err) {
                        console.log(err);
                        this.pythonPathError = true;
                    } else if (!output) {
                        this.pythonPathError = true;
                    } else {
                        this.pythonPath = output[0];
                    }
                })
            );

            makeObservable(this, {
                pythonPath: observable,
                pythonPathError: observable
            });
        }

        pythonPath: string = "";
        pythonPathError: boolean = false;

        browseCustomPath = async () => {
            const result = await dialog.showOpenDialog(getCurrentWindow(), {
                properties: ["openFile"],
                filters: [
                    { name: "Python Executable", extensions: ["exe", "bin", ""] }
                ]
            });
            if (result.filePaths && result.filePaths[0]) {
                runInAction(() => {
                    settingsController.pythonCustomPath = result.filePaths[0];
                });
            }
        };

        render() {
            const isChinese = isChineseLocale();
            return (
                <div className="settings-field-group">
                    <div className="settings-field-header">
                        <span className="settings-field-title">Python 3</span>
                        <span className={classNames("settings-status-badge", this.pythonPathError ? "badge-danger" : "badge-success")}>
                            {this.pythonPathError ? (isChinese ? "未检测到" : "Not Found") : (isChinese ? "已就绪" : "Ready")}
                        </span>
                    </div>
                    <div className="settings-readonly-box" title={this.pythonPath || ""}>
                        <span className="box-label">{isChinese ? "默认解释器: " : "Default: "}</span>
                        <span className="box-val">{this.pythonPathError ? (isChinese ? "未检测到系统 Python" : "Python not found") : this.pythonPath}</span>
                    </div>
                    <label className="settings-switch-label">
                        <input
                            type="checkbox"
                            checked={settingsController.pythonUseCustomPath}
                            onChange={action((e: React.ChangeEvent<HTMLInputElement>) => {
                                settingsController.pythonUseCustomPath = e.target.checked;
                            })}
                        />
                        <span>{isChinese ? "使用自定义 Python 路径" : "Use custom Python path"}</span>
                    </label>
                    {settingsController.pythonUseCustomPath && (
                        <div className="settings-input-with-button">
                            <input
                                type="text"
                                className="settings-text-input"
                                placeholder={isChinese ? "选择或输入 python.exe 路径..." : "Select python.exe path..."}
                                value={settingsController.pythonCustomPath}
                                onChange={action((e: React.ChangeEvent<HTMLInputElement>) => {
                                    settingsController.pythonCustomPath = e.target.value;
                                })}
                            />
                            <button
                                type="button"
                                className="settings-action-btn"
                                onClick={this.browseCustomPath}
                            >
                                {isChinese ? "浏览..." : "Browse..."}
                            </button>
                        </div>
                    )}
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

const TemplateSettings = observer(
    class TemplateSettings extends React.Component {
        browseDirectory = async () => {
            const result = await dialog.showOpenDialog(getCurrentWindow(), {
                properties: ["openDirectory"]
            });
            if (result.filePaths && result.filePaths[0]) {
                runInAction(() => {
                    settingsController.localTemplatesPath = result.filePaths[0];
                });
            }
        };

        render() {
            const isChinese = isChineseLocale();
            const repoUrl = productConfig.projectTemplates?.repositoryUrl;

            return (
                <div className="settings-field-group">
                    <div className="settings-field-header">
                        <span className="settings-field-title">{isChinese ? "项目模板库" : "Project Templates"}</span>
                        {repoUrl && (
                            <a
                                href="#"
                                className="settings-link-action"
                                onClick={e => {
                                    e.preventDefault();
                                    shell.openExternal(repoUrl);
                                }}
                            >
                                {isChinese ? "官方模板库 ↗" : "Official Repo ↗"}
                            </a>
                        )}
                    </div>
                    <label className="settings-switch-label">
                        <input
                            type="checkbox"
                            checked={settingsController.useLocalTemplates}
                            onChange={action((e: React.ChangeEvent<HTMLInputElement>) => {
                                settingsController.useLocalTemplates = e.target.checked;
                            })}
                        />
                        <span>{isChinese ? "使用自定义本地模板目录" : "Use custom templates folder"}</span>
                    </label>
                    {settingsController.useLocalTemplates && (
                        <div className="settings-input-with-button">
                            <input
                                type="text"
                                className="settings-text-input"
                                placeholder={isChinese ? "选择自定义模板目录..." : "Select templates folder..."}
                                value={settingsController.localTemplatesPath}
                                onChange={action((e: React.ChangeEvent<HTMLInputElement>) => {
                                    settingsController.localTemplatesPath = e.target.value;
                                })}
                            />
                            <button
                                type="button"
                                className="settings-action-btn"
                                onClick={this.browseDirectory}
                            >
                                {isChinese ? "浏览..." : "Browse..."}
                            </button>
                        </div>
                    )}
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////

interface McpSettingsState {
    allowed: boolean;
    enabled: boolean;
    loading: boolean;
    busy: boolean;
    message: string;
    error: boolean;
}

/** This entire control is hidden unless Java grants MCP to the signed-in IDE account. */
class McpSettings extends React.Component<{}, McpSettingsState> {
    state: McpSettingsState = {
        allowed: false,
        enabled: false,
        loading: true,
        busy: false,
        message: "",
        error: false
    };

    private mounted = false;

    private refreshPermission = () => {
        void ipcRenderer.invoke("digistudio:mcp:status").then(
            (status: { enabled: boolean; allowed: boolean }) => {
                if (this.mounted) this.setState({
                    allowed: status.allowed === true,
                    enabled: status.allowed === true && status.enabled === true,
                    loading: false,
                    error: false
                });
            },
            () => {
                if (this.mounted) this.setState({
                    allowed: false, enabled: false, loading: false
                });
            }
        );
    };

    componentDidMount() {
        this.mounted = true;
        this.refreshPermission();
        ipcRenderer.on("digistudio:mcp:policy-changed", this.refreshPermission);
    }

    componentWillUnmount() {
        this.mounted = false;
        ipcRenderer.removeListener("digistudio:mcp:policy-changed", this.refreshPermission);
    }

    setEnabled = async (enabled: boolean) => {
        if (this.state.busy || this.state.loading || !this.state.allowed) return;
        this.setState({ busy: true, message: "", error: false });
        try {
            const status: { enabled: boolean; allowed: boolean } = await ipcRenderer.invoke(
                "digistudio:mcp:toggle", enabled);
            if (this.mounted) this.setState({
                enabled: status.enabled,
                allowed: status.allowed,
                message: isChineseLocale()
                    ? status.enabled
                        ? "MCP 已接入；每次调用实时校验权限，已开放工具静默执行。"
                        : "MCP 已断开"
                    : status.enabled
                        ? "MCP connected; each call verifies live permission and allowed tools run silently."
                        : "MCP disconnected"
            });
        } catch (_error) {
            if (this.mounted) this.setState({
                error: true,
                message: isChineseLocale() ? "MCP 操作失败，请检查账号授权或网络。" :
                    "MCP operation failed; check account permission or network."
            });
        } finally {
            if (this.mounted) this.setState({ busy: false });
            this.refreshPermission();
        }
    };

    addToCodex = async () => {
        if (this.state.busy || !this.state.enabled || !this.state.allowed) return;
        this.setState({ busy: true, message: "", error: false });
        try {
            const result: { alreadyInstalled: boolean; configPath: string } =
                await ipcRenderer.invoke("digistudio:mcp:install-codex");
            if (this.mounted) this.setState({
                message: isChineseLocale()
                    ? result.alreadyInstalled ? "Codex 中已有 DigiStudio MCP 配置" :
                        "已添加至 Codex，请重新打开 Codex。"
                    : result.alreadyInstalled ? "DigiStudio MCP is already in Codex." :
                        "Added to Codex. Restart Codex."
            });
        } catch (_error) {
            if (this.mounted) this.setState({
                error: true,
                message: isChineseLocale() ? "添加 Codex 配置失败" : "Could not configure Codex"
            });
        } finally {
            if (this.mounted) this.setState({ busy: false });
        }
    };

    render() {
        if (!this.state.allowed || this.state.loading) return null;
        const isChinese = isChineseLocale();
        const { enabled, busy, message, error } = this.state;
        return (
            <div className="settings-card">
                <div className="settings-card-header">
                    <Icon icon="material:extension" size={20} className="settings-card-icon" />
                    <h4 className="settings-card-title">{isChinese ? "集成" : "Integrations"}</h4>
                </div>
                <div className="settings-card-body">
                    <div className="settings-field-group">
                <div className="settings-field-header">
                    <span className="settings-field-title">MCP Server</span>
                    <span className={classNames(
                        "settings-status-badge",
                        enabled ? "badge-success" : "badge-danger"
                    )}>
                        {enabled ? (isChinese ? "已接入" : "Connected") :
                            (isChinese ? "未接入" : "Disconnected")}
                    </span>
                </div>
                <label className="settings-switch-label">
                    <input type="checkbox" checked={enabled} disabled={busy}
                        onChange={event => void this.setEnabled(event.target.checked)} />
                    <span>{isChinese ? "接入 MCP 服务" : "Connect MCP server"}</span>
                </label>
                <div className="settings-input-with-button">
                    <button type="button" className="settings-action-btn"
                        disabled={!enabled || busy} onClick={this.addToCodex}>
                        {isChinese ? "一键添加到 Codex" : "Add to Codex"}
                    </button>
                </div>
                <p className="settings-mcp-hint">
                    {isChinese
                        ? "账号授权仅提供接入资格，不会自动连接。主动接入后每次工具调用均实时校验权限，已开放编辑/删除/保存工具静默执行；退出或切换账号自动断开。"
                        : "Authorization grants eligibility only and never auto-connects. Once connected, each tool call verifies live permission and allowed edit/delete/save tools run silently; sign-out or account switch disconnects immediately."}
                </p>
                {message && (
                    <p className={classNames("settings-mcp-feedback", { "is-error": error })} role="status">
                        {message}
                    </p>
                )}
                    </div>
                </div>
            </div>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export const Settings = observer(
    class Settings extends React.Component {
        render() {
            const isChinese = isChineseLocale();
            const appearanceOptions: { value: WorkspaceAppearance; zh: string; en: string }[] = [
                { value: "dark", zh: "深色", en: "Dark" },
                { value: "light", zh: "明亮", en: "Light" }
            ];

            return (
                <div className="EezStudio_HomeSettingsBody EezStudio_HomeSettingsBody--guider">
                    <div className="EezStudio_GuiderSettingsDashboard">
                        {/* Left column */}
                        <div className="settings-column settings-column--left">
                            {/* Card 1: 常规与外观 */}
                            <div className="settings-card">
                                <div className="settings-card-header">
                                    <Icon icon="material:palette" size={20} className="settings-card-icon" />
                                    <h4 className="settings-card-title">{isChinese ? "常规与外观" : "General & Appearance"}</h4>
                                </div>
                                <div className="settings-card-body">
                                    {/* Language */}
                                    <div className="settings-field-group">
                                        <label className="settings-field-title">{isChinese ? "界面语言" : "Interface Language"}</label>
                                        <div className="settings-pill-tabs" role="radiogroup">
                                            <button
                                                type="button"
                                                className={classNames("settings-pill-tab", { active: !isChinese })}
                                                onClick={() => settingsController.onLocaleChange("en")}
                                            >
                                                English
                                            </button>
                                            <button
                                                type="button"
                                                className={classNames("settings-pill-tab", { active: isChinese })}
                                                onClick={() => settingsController.onLocaleChange("zh-CN")}
                                            >
                                                简体中文
                                            </button>
                                        </div>
                                    </div>

                                    {/* Theme */}
                                    <div className="settings-field-group">
                                        <label className="settings-field-title">{isChinese ? "色彩主题" : "Color Theme"}</label>
                                        <div className="settings-pill-tabs" role="radiogroup">
                                            {appearanceOptions.map(option => (
                                                <button
                                                    type="button"
                                                    key={option.value}
                                                    className={classNames("settings-pill-tab", { active: settingsController.appearance === option.value })}
                                                    onClick={() => settingsController.selectAppearance(option.value)}
                                                >
                                                    {isChinese ? option.zh : option.en}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Date and Time Formats */}
                                    <div className="settings-field-group">
                                        <label className="settings-field-title">{isChinese ? "区域与时间格式" : "Regional Formats"}</label>
                                        <div className="settings-formats-row">
                                            <div className="settings-select-wrapper">
                                                <span className="settings-select-caption">{isChinese ? "日期格式" : "Date Format"}</span>
                                                <select
                                                    className="settings-custom-select"
                                                    value={settingsController.dateFormat}
                                                    onChange={e => settingsController.onDateFormatChanged(e.target.value)}
                                                >
                                                    {DATE_FORMATS.map(dateFormat => (
                                                        <option key={dateFormat.format} value={dateFormat.format}>
                                                            {formatDateWithLocaleAndFormat(new Date(), settingsController.locale, dateFormat.format)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="settings-select-wrapper">
                                                <span className="settings-select-caption">{isChinese ? "时间格式" : "Time Format"}</span>
                                                <select
                                                    className="settings-custom-select"
                                                    value={settingsController.timeFormat}
                                                    onChange={e => settingsController.onTimeFormatChanged(e.target.value)}
                                                >
                                                    {TIME_FORMATS.map(timeFormat => (
                                                        <option key={timeFormat.format} value={timeFormat.format}>
                                                            {formatDateWithLocaleAndFormat(new Date(), settingsController.locale, timeFormat.format)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Card 2: 环境与扩展 */}
                            <div className="settings-card">
                                <div className="settings-card-header">
                                    <Icon icon="material:build" size={20} className="settings-card-icon" />
                                    <h4 className="settings-card-title">{isChinese ? "开发环境与模板" : "Environment & Templates"}</h4>
                                </div>
                                <div className="settings-card-body">
                                    <PythonSettings />
                                    <div className="settings-card-divider" />
                                    <TemplateSettings />
                                </div>
                            </div>

                            {/* Only an authorized IDE account sees the MCP integration card. */}
                            <McpSettings />
                        </div>

                        {/* Right column */}
                        <div className="settings-column settings-column--right">
                            <div className="settings-card settings-card--database">
                                <div className="settings-card-header">
                                    <div className="settings-card-header-left">
                                        <Icon icon="material:storage" size={22} className="settings-card-icon" />
                                        <div>
                                            <h4 className="settings-card-title">{isChinese ? "系统与仪器数据库" : "Databases & Storage"}</h4>
                                            <p className="settings-card-desc">
                                                {isChinese
                                                    ? "管理用于存储设备通信会话、配置记录及离线数据的 SQLite 数据库"
                                                    : "Manage SQLite databases for instrumentation sessions, logs and offline data"}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="settings-card-body settings-card-body--database">
                                    <Databases />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Restart banner */}
                    {settingsController.restartRequired && (
                        <div className="settings-restart-banner">
                            <div className="restart-text">
                                <Icon icon="material:warning" size={20} className="restart-icon" />
                                <span>{isChinese ? "部分设置已修改，需要重新启动 DigiStudio 才能完全生效。" : "Some settings have changed. Please restart DigiStudio to take effect."}</span>
                            </div>
                            <button className="restart-btn" onClick={settingsController.restart}>
                                {isChinese ? "立即重启 DigiStudio" : "Restart DigiStudio Now"}
                            </button>
                        </div>
                    )}
                </div>
            );
        }
    }
);

////////////////////////////////////////////////////////////////////////////////
