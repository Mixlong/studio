"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { analyzeTarget, attachRuntimeCapture } = require("./src/analyzer.cjs");

const APP_ROOT = __dirname;
const DEFAULT_TARGET = "C:\\NXP\\GUI-Guider-1.10.1-GA";
const DEFAULT_OUTPUT = path.join(app.getPath("documents"), "DigiwiseUIAnalyzer");
let mainWindow;
let lastAnalysisResult = null;

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("analysis:progress", payload);
}
function runPowerShell(scriptName, args) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(APP_ROOT, "scripts", scriptName);
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath, ...(args || []).map(String)
    ], { windowsHide: true, cwd: APP_ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) reject(new Error((stderr || stdout || ("PowerShell exited " + code)).trim()));
      else resolve(stdout.trim());
    });
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 820, minWidth: 960, minHeight: 680,
    backgroundColor: "#101923", title: "Digiwise UI Analyzer", autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_ROOT, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    fs.appendFileSync(path.join(APP_ROOT, "dev.log"), "did-fail-load " + code + " " + description + " " + url + "\n");
  });
  mainWindow.webContents.on("did-finish-load", () => {
    fs.appendFileSync(path.join(APP_ROOT, "dev.log"), "did-finish-load " + mainWindow.webContents.getURL() + "\n");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    fs.appendFileSync(path.join(APP_ROOT, "dev.log"), "render-process-gone " + JSON.stringify(details) + "\n");
  });
  mainWindow.loadFile(path.join(APP_ROOT, "index.html")).catch(error => {
    fs.appendFileSync(path.join(APP_ROOT, "dev.log"), "loadFile error " + error.stack + "\n");
  });
}
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

ipcMain.handle("app:defaults", () => ({
  targetDir: fs.existsSync(DEFAULT_TARGET) ? DEFAULT_TARGET : "",
  outputDir: DEFAULT_OUTPUT,
  appVersion: app.getVersion()
}));
ipcMain.handle("dialog:choose-folder", async (_event, currentPath) => {
  const result = await dialog.showOpenDialog({
    defaultPath: currentPath || app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("windows:list", async () => {
  const raw = await runPowerShell("list-windows.ps1", []);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
});
ipcMain.handle("analysis:run", async (_event, payload) => {
  const targetDir = String(payload && payload.targetDir || "").trim();
  const outputDir = String(payload && payload.outputDir || "").trim();
  if (!targetDir || !outputDir) throw new Error("请选择目标安装目录和报告输出目录。");
  lastAnalysisResult = await analyzeTarget({
    targetDir, outputDir, onProgress: sendProgress,
    runRea: !(payload && payload.runRea === false)
  });
  return lastAnalysisResult;
});
ipcMain.handle("capture:run", async (_event, payload) => {
  const pid = Number(payload && payload.pid);
  const hwnd = Number(payload && payload.hwnd);
  const outputDir = String(payload && payload.outputDir || DEFAULT_OUTPUT).trim();
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isSafeInteger(hwnd) || hwnd <= 0) {
    throw new Error("请先选择一个具有可见主窗口的目标进程。");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const captureDir = path.join(outputDir, "window-capture-" + stamp);
  fs.mkdirSync(captureDir, { recursive: true });
  const raw = await runPowerShell("capture-window.ps1", [
    "-ProcessId", pid, "-WindowHandle", hwnd, "-OutputDir", captureDir, "-MaxNodes", 1200
  ]);
  const capture = JSON.parse(raw);
  if (!capture.screenshotPath || !fs.existsSync(capture.screenshotPath)) throw new Error("窗口截图未生成。");
  if (lastAnalysisResult && lastAnalysisResult.report) {
    const attached = attachRuntimeCapture(lastAnalysisResult.report, capture);
    capture.reportUpdated = attached;
  }
  const image = fs.readFileSync(capture.screenshotPath);
  capture.screenshotDataUrl = "data:image/png;base64," + image.toString("base64");
  return capture;
});
ipcMain.handle("path:open", async (_event, targetPath) => {
  const result = await shell.openPath(String(targetPath || ""));
  if (result) throw new Error(result);
  return true;
});