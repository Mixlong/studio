import "./fix-path";

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawn } from "child_process";
import {
    app,
    session,
    ipcMain,
    powerSaveBlocker,
    BrowserWindow,
    dialog
} from "electron";
import { autoUpdater } from "electron-updater";
import { configure } from "mobx";

require("@electron/remote/main").initialize();

import type * as HomeWindowModule from "main/home-window";
import { unloadVisa } from "instrument/connection/interfaces/visa-dll";
import { setup } from "main/setup";
import { HOME_WINDOW_URL } from "main/home-window";
import { setForceQuit } from "main/window";

// disable security warnings inside dev console
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = true as any;

configure({ enforceActions: "observed" });

const contextMenu = require("electron-context-menu");

contextMenu({
    showSaveImageAs: true
});

////////////////////////////////////////////////////////////////////////////////

app.commandLine.appendSwitch("disable-renderer-backgrounding");

// app.allowRendererProcessReuse = false;

let homeWindow: BrowserWindow;

const DEFAULT_UPDATE_BASE_URL =
    "https://bikewise.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio";

function getUpdateBaseUrl() {
    try {
        const config = JSON.parse(
            readFileSync(
                join(app.getAppPath(), "build/main/update-url.json"),
                "utf8"
            )
        );
        if (
            config &&
            typeof config.url === "string" &&
            config.url.startsWith("https://")
        ) {
            return config.url;
        }
    } catch (_error) {}

    return DEFAULT_UPDATE_BASE_URL;
}

function getUpdateUrl() {
    const updateUrl = new URL(getUpdateBaseUrl());
    let updateDirectory: string | undefined;

    if (process.platform === "darwin") {
        updateDirectory = "dist-mac";
    } else if (process.platform === "win32") {
        updateDirectory = process.arch === "ia32" ? "win-ia32" : "dist-win-x64";
    } else if (process.env.APPIMAGE) {
        updateDirectory = "dist-linux";
    }

    if (updateDirectory) {
        updateUrl.pathname = `${updateUrl.pathname.replace(/\/+$/, "")}/${updateDirectory}`;
    }

    return updateUrl.toString();
}

function installMacUpdate(updateFile: string, version: string) {
    const helperDirectory = mkdtempSync(
        join(tmpdir(), "digistudio-update-helper-")
    );
    const helperPath = join(helperDirectory, "mac-update-helper.js");
    const logDirectory = app.getPath("logs");
    const logPath = join(logDirectory, "mac-update-helper.log");
    mkdirSync(logDirectory, { recursive: true });
    copyFileSync(
        join(app.getAppPath(), "build/main/mac-update-helper.js"),
        helperPath
    );

    const payload = Buffer.from(
        JSON.stringify({
            currentPid: process.pid,
            updateZipPath: updateFile,
            appPath: resolve(app.getAppPath(), "../../.."),
            expectedBundleId: "hr.envox.eez.studio",
            expectedVersion: version,
            logPath,
            helperDirectory
        })
    ).toString("base64url");
    const helper = spawn(process.execPath, [helperPath, payload], {
        detached: true,
        stdio: "ignore",
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1"
        }
    });
    if (!helper.pid) {
        throw new Error("Unable to start macOS update helper");
    }
    helper.unref();

    setForceQuit();
    app.quit();
    setTimeout(() => app.exit(0), 1500);
}

function setupAutoUpdater() {
    if (!app.isPackaged) {
        return;
    }

    const supportsAutoUpdate =
        process.platform === "win32" ||
        process.platform === "darwin" ||
        Boolean(process.env.APPIMAGE);

    if (!supportsAutoUpdate) {
        return;
    }

    autoUpdater.setFeedURL({
        provider: "generic",
        url: getUpdateUrl()
    });
    autoUpdater.allowDowngrade = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = process.platform !== "darwin";

    autoUpdater.on("checking-for-update", () => {
        console.log(`[auto-update] Checking: ${getUpdateUrl()}`);
    });

    autoUpdater.on("update-available", info => {
        console.log(`[auto-update] Update available: ${info.version}`);
        void dialog.showMessageBox(homeWindow, {
            type: "info",
            title: "发现新版本",
            message: `DigiStudio ${info.version} 正在下载。`,
            detail: "下载完成后可以重启应用安装更新。",
            buttons: ["知道了"]
        });
    });

    autoUpdater.on("update-not-available", info => {
        console.log(`[auto-update] Up to date: ${info.version}`);
    });

    autoUpdater.on("update-downloaded", info => {
        console.log(`[auto-update] Update downloaded: ${info.version}`);
        void dialog
            .showMessageBox(homeWindow, {
                type: "info",
                title: "更新已下载",
                message: `DigiStudio ${info.version} 已准备完成。`,
                detail: "现在重启应用即可完成更新。",
                buttons: ["立即重启", "稍后"],
                defaultId: 0,
                cancelId: 1
            })
            .then(result => {
                if (result.response === 0) {
                    if (process.platform === "darwin") {
                        try {
                            installMacUpdate(info.downloadedFile, info.version);
                        } catch (error: any) {
                            console.error(
                                "[auto-update] Unable to start macOS installer:",
                                error
                            );
                            void dialog.showErrorBox(
                                "更新安装失败",
                                error?.message || String(error)
                            );
                        }
                    } else {
                        setForceQuit();
                        autoUpdater.quitAndInstall(false, true);
                    }
                }
            });
    });

    autoUpdater.on("error", error => {
        console.error("[auto-update] Update check failed:", error);
    });

    autoUpdater.checkForUpdatesAndNotify().catch(error => {
        console.error("[auto-update] Unable to check for updates:", error);
    });
}

app.on("ready", async function () {
    let buildProjectFilePath;
    const buildProjectArgIndex = process.argv.indexOf("--build-project");
    if (buildProjectArgIndex != -1) {
        if (buildProjectArgIndex + 1 < process.argv.length) {
            buildProjectFilePath = process.argv[buildProjectArgIndex + 1];
        }
    }

    if (!buildProjectFilePath) {
        var gotTheLock = app.requestSingleInstanceLock();
        if (!gotTheLock) {
            app.quit();
            return;
        }
    }

    app.on("second-instance", function (event, commandLine, workingDirectory) {
        if (commandLine.includes("--reload-project")) {
            console.log("[reload-project] second-instance triggered, commandLine:", commandLine);
            const { reloadProject } =
                require("main/home-window") as typeof HomeWindowModule;
            console.log("[reload-project] calling reloadProject()");
            reloadProject();
            return;
        }
        console.log("[second-instance] commandLine:", commandLine);
        const { bringHomeWindowToFocus } =
            require("main/home-window") as typeof HomeWindowModule;
        bringHomeWindowToFocus();
        const { openFile } = require("main/menu");
        openFile(commandLine[commandLine.length - 1]);
    });

    // start with:
    // react devtools: npm start devToolsExtension="C:\Users\mvladic\AppData\Local\Google\Chrome\User Data\Default\Extensions\fmkadmapgofadopljbjfkapdkoienihi\4.10.1_0"
    // mobx devtools: npm start devToolsExtension="C:\Users\mvladic\AppData\Local\Google\Chrome\User Data\Default\Extensions\pfgnfdagidkfgccljigdamigbcnndkod\0.9.26_0"
    if (
        process.argv.length > 2 &&
        process.argv[2].startsWith("devToolsExtension=")
    ) {
        await app.whenReady();
        await session.defaultSession.loadExtension(
            process.argv[2].substr("devToolsExtension=".length),
            { allowFileAccess: true }
        );
    }

    const { loadSettings } = await import("main/settings");
    await loadSettings();

    await setup();

    await import("instrument/connection/interfaces/serial-ports-main");

    require("eez-studio-shared/service");

    const { openHomeWindow } = await import("main/home-window");
    if (buildProjectFilePath) {
        homeWindow = openHomeWindow({
            url: HOME_WINDOW_URL + "?build-project=1",
            showHidden: true
        });
    } else {
        homeWindow = openHomeWindow();
    }

    await import("main/menu");

    setupAutoUpdater();
});

// Quit when all windows are closed.
app.on("window-all-closed", function () {
    app.quit();
});

app.on("quit", function () {
    const { closeConnections } =
        require("instrument/connection/connection-main") as typeof import("instrument/connection/connection-main");

    closeConnections();

    unloadVisa();
});

app.on("will-finish-launching", async function () {
    app.on("open-file", async function (event, path) {
        event.preventDefault();
        const { openFile } = require("main/menu");
        openFile(path);
    });
});

ipcMain.once("open-command-line-project", async function () {
    const buildProjectArgIndex = process.argv.indexOf("--build-project");
    if (buildProjectArgIndex == -1) {
        const filePath = process.argv[process.argv.length - 1];
        const { openFile } = require("main/menu");
        openFile(filePath);
    } else {
        if (buildProjectArgIndex + 1 < process.argv.length) {
            const buildProjectFilePath = process.argv[buildProjectArgIndex + 1];
            homeWindow.webContents.send("build-project", buildProjectFilePath);
        }
    }
});

ipcMain.on("on-build-project-message", function (event, message) {
    if (message) {
        console.log(message);
    } else {
        app.quit();
    }
});

let powerSaveBlockerId: number | undefined = undefined;
ipcMain.on("preventAppSuspension", (event: any, on: boolean) => {
    if (on) {
        if (powerSaveBlockerId == undefined) {
            powerSaveBlockerId = powerSaveBlocker.start(
                "prevent-app-suspension"
            );
        }
    } else {
        if (powerSaveBlockerId != undefined) {
            powerSaveBlocker.stop(powerSaveBlockerId);
            powerSaveBlockerId = undefined;
        }
    }
});

process.on("warning", e => console.warn(e.stack));
