"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("digiwiseUIAnalyzer", {
  getDefaults: () => ipcRenderer.invoke("app:defaults"),
  chooseFolder: currentPath => ipcRenderer.invoke("dialog:choose-folder", currentPath),
  listWindows: () => ipcRenderer.invoke("windows:list"),
  runAnalysis: payload => ipcRenderer.invoke("analysis:run", payload),
  captureWindow: payload => ipcRenderer.invoke("capture:run", payload),
  openPath: targetPath => ipcRenderer.invoke("path:open", targetPath),
  onProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("analysis:progress", listener);
    return () => ipcRenderer.removeListener("analysis:progress", listener);
  }
});