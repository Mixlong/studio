/// <reference path="./globals.d.ts"/>
import "bootstrap";
import { ipcRenderer } from "electron";
import React from "react";
import { createRoot } from "react-dom/client";
import { configure } from "mobx";
import { observer } from "mobx-react";

import {
    loadExtensions
} from "eez-studio-shared/extensions/extensions";
import { getNodeModuleFolders } from "eez-studio-shared/extensions/yarn";

import * as notification from "eez-studio-ui/notification";
import { showAboutBox } from "eez-studio-ui/about-box";

import type * as ImportInstrumentDefinitionModule from "instrument/import-instrument-definition";

import { digiwiseAuthController } from "home/digiwise-account";
import { ProjectEditorTab, tabs } from "home/tabs-store";
import { settingsController } from "home/settings";
import { App } from "home/app";
import { openProject } from "home/tabs-store";
import { productConfig } from "eez-studio-shared/product-config";

import { LineMarkers } from "project-editor/flow/connection-line/ConnectionLineComponent";

import "home/settings";
import { extensionsCatalog } from "./extensions-manager/catalog";
import { buildProject } from "home/build-project";
import { layoutModels } from "eez-studio-ui/side-dock";

configure({ enforceActions: "observed", useProxies: "always" });

const pendingProjectOpens: Array<{ filePath: string; runMode: boolean }> = [];

function openProjectWhenAuthenticated(filePath: string, runMode: boolean) {
    if (!digiwiseAuthController.authState.authenticated || !tabs) {
        pendingProjectOpens.push({ filePath, runMode });
        return;
    }

    openProject(filePath, runMode);
}

function flushPendingProjectOpens() {
    if (!digiwiseAuthController.authState.authenticated || !tabs) {
        return;
    }

    while (pendingProjectOpens.length > 0) {
        const pending = pendingProjectOpens.shift()!;
        openProject(pending.filePath, pending.runMode);
    }
}

window.addEventListener(
    "digiwise-app-authenticated",
    flushPendingProjectOpens
);

// make sure we store all the values waiting to be stored inside blur event handler
function blurAll() {
    var tmp = document.createElement("input");
    document.body.appendChild(tmp);
    tmp.focus();
    document.body.removeChild(tmp);
}

async function beforeAppClose() {
    blurAll();

    // Reload/close may arrive before loadTabs() finishes initialization.
    // In that case there are no project tabs to ask for close approval.
    for (const tab of tabs?.tabs ?? []) {
        if (tab.beforeAppClose) {
            if (!(await tab.beforeAppClose())) {
                return false;
            }
        }
    }

    const {
        destroyExtensions
    } = require("eez-studio-shared/extensions/extensions");
    destroyExtensions();

    layoutModels.saveToLocalStorage();

    return true;
}

ipcRenderer.on("beforeClose", async () => {
    if (await beforeAppClose()) {
        ipcRenderer.send("readyToClose");
    }
});

ipcRenderer.on("reload", async () => {
    if (await beforeAppClose()) {
        ipcRenderer.send("reload");
    }
});

ipcRenderer.on("switch-theme", async () => {
    settingsController.switchTheme(!settingsController.isDarkTheme);
});

ipcRenderer.on(
    "importInstrumentDefinitionFile",
    (sender: any, filePath: string) => {
        if (!digiwiseAuthController.authState.authenticated) {
            return;
        }
        const { importInstrumentDefinition } =
            require("instrument/import-instrument-definition") as typeof ImportInstrumentDefinitionModule;
        importInstrumentDefinition(filePath);
    }
);

ipcRenderer.on("show-about-box", async () => {
    showAboutBox();
});

ipcRenderer.on(
    "open-project",
    async (sender: any, filePath: any, runMode: boolean) => {
        if (typeof filePath === "string") {
            openProjectWhenAuthenticated(filePath, !!runMode);
        }
    }
);

ipcRenderer.on(
    "build-project",
    async (sender: any, filePath: any, runMode: boolean) => {
        buildProject(filePath);
    }
);

ipcRenderer.on("load-debug-info", async (sender: any, filePath: any) => {
    if (!digiwiseAuthController.authState.authenticated) {
        return;
    }
    try {
        let tab = tabs.activeTab;
        if (tab instanceof ProjectEditorTab) {
            tab.loadDebugInfo(filePath);
        }
    } catch (err) {
        console.error(err);
    }
});

ipcRenderer.on("save-debug-info", () => {
    if (!digiwiseAuthController.authState.authenticated) {
        return;
    }
    try {
        let tab = tabs.activeTab;
        if (tab instanceof ProjectEditorTab) {
            tab.saveDebugInfo();
        }
    } catch (err) {
        console.error(err);
    }
});

ipcRenderer.on("new-project", async (sender: any, filePath: any) => {
    if (!digiwiseAuthController.authState.authenticated) {
        return;
    }
    const { showNewProjectWizard } = await import(
        "project-editor/project/ui/Wizard"
    );
    showNewProjectWizard();
});

ipcRenderer.on("add-instrument", async (sender: any, filePath: any) => {
    if (!digiwiseAuthController.authState.authenticated) {
        return;
    }
    const { showAddInstrumentDialog } = await import(
        "instrument/add-instrument-dialog"
    );

    const { defaultInstrumentsStore } = await import("home/instruments");

    showAddInstrumentDialog(instrumentId => {
        setTimeout(() => {
            defaultInstrumentsStore.selectedInstrumentId = instrumentId;
        }, 100);
    });
});

const Main = observer(
    class Main extends React.Component<{ children: React.ReactNode }> {
        render() {
            return (
                <>
                    {this.props.children}
                    {notification.container}
                </>
            );
        }
    }
);

async function main() {
    const params = new URLSearchParams(location.search);
    const buildProject = params.get("build-project") === "1";

    let nodeModuleFolders: string[];
    try {
        nodeModuleFolders = await getNodeModuleFolders();
    } catch (err) {
        console.info(`Failed to get node module folders.`);
        nodeModuleFolders = [];
    }

    await loadExtensions(nodeModuleFolders);

    if (productConfig.extensionsCatalog.enabled) {
        extensionsCatalog.load();
    }

    if (!buildProject) {
        const root = createRoot(document.getElementById("EezStudio_Content")!);
        root.render(
            <Main>
                <App />
                <LineMarkers />
            </Main>
        );
    } else {
        // The hidden build helper has no interactive IDE session or login UI.
        ipcRenderer.send("open-command-line-project");
    }
}

main();

// setTimeout(() => {
//     require("eez-studio-shared/module-stat");
// }, 1000);
