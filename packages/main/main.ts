import "./fix-path";

import { copyFileSync, mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawn } from "child_process";
import {
    app,
    session,
    ipcMain,
    powerSaveBlocker,
    BrowserWindow
} from "electron";
import { setupDigiwiseReleaseUpdater } from "main/digiwise-release-updater";

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

// Isolate npm start and packaged builds before Electron resolves userData.
app.setName("DigiwiseStudio");
app.setPath("userData", join(app.getPath("appData"), "DigiwiseStudio"));
if (process.platform === "win32") {
    app.setAppUserModelId("com.digiwise.studio");
}

app.commandLine.appendSwitch("disable-renderer-backgrounding");

// app.allowRendererProcessReuse = false;

let homeWindow: BrowserWindow;

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
            expectedBundleId: "com.digiwise.studio",
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
            console.log(
                "[startup] DigiwiseStudio is already running; focusing the existing window."
            );
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

    // CLIENT-001 connects to the configured local/hosted Public API. The
    // access token remains in the main process and is never sent to React.
    const { registerDigiwiseAuthIpc } = await import("main/digiwise-auth");
    await registerDigiwiseAuthIpc();
    const { registerDigiwiseTemplateIpc } = await import(
        "main/digiwise-templates"
    );
    registerDigiwiseTemplateIpc();

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

    const { registerDigiwiseBspCatalogIpc } = await import(
        "main/digiwise-bsp-catalog"
    );
    registerDigiwiseBspCatalogIpc(() => homeWindow);

    const { registerDigiwiseToolchainIpc } = await import(
        "main/digiwise-toolchain-manager"
    );
    registerDigiwiseToolchainIpc(() => homeWindow);

    const { registerDigiwiseBuildIpc } = await import(
        "main/digiwise-build-engine"
    );
    registerDigiwiseBuildIpc(() => homeWindow);

    const { registerDigiwiseDownloadIpc } = await import(
        "main/digiwise-download-manager"
    );
    registerDigiwiseDownloadIpc(() => homeWindow);

    // MCP settings are registered here; the read-only bridge remains off
    // unless explicitly enabled in Settings or by the developer environment.
    if (!buildProjectFilePath) {
        void import("mcp/integration")
            .then(module => module.registerMcpIntegration(homeWindow))
            .catch(error => console.error("[mcp] Integration failed:", error));
    }

    if (!buildProjectFilePath) {
        setupDigiwiseReleaseUpdater(homeWindow, installMacUpdate, setForceQuit);
    }
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
