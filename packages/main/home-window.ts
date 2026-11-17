import { openWindow, findWindowByParams, IWindowParams } from "main/window";

export const HOME_WINDOW_URL = "home/index.html";

const HOME_WINDOW_PARAMS: IWindowParams = {
    url: HOME_WINDOW_URL,
    hideOnClose: true,
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760
};

export function openHomeWindow(params?: Partial<IWindowParams>) {
    // Do not mutate shared defaults for temporary hidden/build windows.
    return openWindow({ ...HOME_WINDOW_PARAMS, ...params });
}

export function bringHomeWindowToFocus() {
    const homeWindow = findWindowByParams(HOME_WINDOW_PARAMS);
    if (homeWindow && !homeWindow.browserWindow.isDestroyed()) {
        const browserWindow = homeWindow.browserWindow;
        // A second npm start must reveal an already-running IDE window.
        if (browserWindow.isMinimized()) {
            browserWindow.restore();
        }
        browserWindow.show();
        browserWindow.focus();
        if (process.platform === "win32") {
            browserWindow.moveTop();
        }
    } else {
        const browserWindow = openHomeWindow();
        browserWindow.focus();
    }
}

export function reloadProject() {
    let homeWindow = findWindowByParams(HOME_WINDOW_PARAMS);
    console.log("[reload-project] homeWindow found:", !!homeWindow);
    if (homeWindow) {
        console.log("[reload-project] sending IPC reload-project to renderer");
        homeWindow.browserWindow.webContents.send("reload-project");
    }
}

export function importInstrumentDefinitionFile(filePath: string) {
    let homeWindow = findWindowByParams(HOME_WINDOW_PARAMS);
    if (homeWindow) {
        homeWindow.browserWindow.webContents.send(
            "importInstrumentDefinitionFile",
            filePath
        );
    }
}
