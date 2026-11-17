"use strict";
const $ = id => document.getElementById(id);
const state = { windows: [], outputDir: "", lastResult: null, busy: false };
function nowTime() { return new Date().toLocaleTimeString("zh-CN", { hour12: false }); }
function addLog(message, kind) {
  const row = document.createElement("div");
  row.className = "log-entry " + (kind || "");
  const time = document.createElement("span"); time.className = "log-time"; time.textContent = nowTime();
  const text = document.createElement("span"); text.textContent = message;
  row.append(time, text); $("log-list").prepend(row);
  while ($("log-list").children.length > 40) $("log-list").lastElementChild.remove();
}
function setBusy(value) {
  state.busy = value;
  $("analyze-button").disabled = value; $("capture-button").disabled = value;
  $("browse-target").disabled = value; $("browse-output").disabled = value;
  $("analyze-button").textContent = value ? "正在分析…" : "⌕  开始 UI 资源分析  →";
}
function setStatus(message, kind) {
  const line = $("analysis-status"); line.replaceChildren();
  const dot = document.createElement("span"); dot.className = "status-dot " + (kind || "idle");
  const text = document.createElement("span"); text.textContent = message;
  line.append(dot, text);
}
function setProgress(percent, message) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  $("progress-fill").style.width = value + "%"; $("progress-label").textContent = value + "%";
  if (message) addLog(message);
}
function renderMetrics(metrics, topColors) {
  $("metric-css").textContent = metrics.stylesheets === undefined ? "—" : metrics.stylesheets;
  $("metric-font").textContent = metrics.fonts === undefined ? "—" : metrics.fonts;
  $("metric-icon").textContent = metrics.svgIcons === undefined ? "—" : metrics.svgIcons;
  $("metric-color").textContent = metrics.colorTokens === undefined ? "—" : metrics.colorTokens;
  const swatches = $("color-swatches"); swatches.replaceChildren();
  if (!topColors || !topColors.length) {
    const empty = document.createElement("span"); empty.className = "empty-inline"; empty.textContent = "未提取到颜色候选"; swatches.append(empty); return;
  }
  topColors.slice(0, 12).forEach(item => {
    const chip = document.createElement("div"); chip.className = "swatch";
    chip.title = item.value + " · " + item.count; chip.style.background = item.value; swatches.append(chip);
  });
}
async function chooseFolder(inputId) {
  const selected = await window.digiwiseUIAnalyzer.chooseFolder($(inputId).value);
  if (selected) $(inputId).value = selected;
}
async function refreshWindows() {
  $("refresh-windows").disabled = true;
  try {
    const windows = await window.digiwiseUIAnalyzer.listWindows();
    state.windows = windows;
    const select = $("window-select"); select.replaceChildren();
    if (!windows.length) {
      const option = document.createElement("option"); option.value = ""; option.textContent = "没有检测到可见窗口";
      select.append(option); $("window-meta").textContent = "请先启动目标程序，再刷新窗口列表。"; return;
    }
    windows.forEach(item => {
      const option = document.createElement("option"); option.value = String(item.hwnd);
      option.textContent = item.title + " · " + item.processName + " · PID " + item.pid; select.append(option);
    });
    updateWindowMeta(); addLog("发现 " + windows.length + " 个可见窗口。");
  } catch (error) { addLog("窗口枚举失败：" + error.message, "muted"); }
  finally { $("refresh-windows").disabled = false; }
}
function selectedWindow() { return state.windows.find(item => String(item.hwnd) === $("window-select").value) || null; }
function updateWindowMeta() {
  const item = selectedWindow();
  $("window-meta").textContent = item ? (item.executablePath || item.processName) + " · HWND " + item.hwnd : "尚未选择运行窗口";
}
async function captureWindow() {
  const item = selectedWindow();
  if (!item) { setStatus("请先刷新并选择目标窗口。", "error"); return; }
  setBusy(true);
  try {
    addLog("正在采集窗口：" + item.title);
    const result = await window.digiwiseUIAnalyzer.captureWindow({
      pid: item.pid, hwnd: item.hwnd, outputDir: $("output-dir").value.trim() || state.outputDir
    });
    $("capture-image").src = result.screenshotDataUrl; $("capture-image").hidden = false;
    const placeholder = $("capture-preview").querySelector(".preview-placeholder"); if (placeholder) placeholder.remove();
    const count = result.accessibility ? result.accessibility.nodeCount : 0;
    const status = result.accessibility ? result.accessibility.status : "unknown";
    $("capture-note").textContent = status === "limited"
      ? "截图已保存。UIA 只返回 " + count + " 个顶层节点，目标可能使用 Chromium/Direct3D；不能据此推断内部控件不存在。"
      : "截图已保存。UI Automation 返回 " + count + " 个节点，状态：" + status + "。";
    addLog("窗口截图完成：" + result.screenshot.width + " × " + result.screenshot.height + "；UIA " + count + " 个节点。");
    if (result.accessibility && result.accessibility.limitation) addLog(result.accessibility.limitation, "muted");
    setStatus("运行窗口采集完成。", "success");
  } catch (error) { addLog("窗口采集失败：" + error.message, "muted"); setStatus("窗口采集失败，请检查窗口是否仍然打开。", "error"); }
  finally { setBusy(false); }
}
async function runAnalysis() {
  const targetDir = $("target-dir").value.trim(); const outputDir = $("output-dir").value.trim();
  if (!targetDir || !outputDir) { setStatus("请先选择目标目录和报告输出目录。", "error"); return; }
  setBusy(true); setProgress(0, "开始 UI 资源分析。"); setStatus("正在分析目标程序 UI 资源……", "running");
  $("open-output").disabled = true; $("open-report").disabled = true;
  try {
    const result = await window.digiwiseUIAnalyzer.runAnalysis({ targetDir, outputDir, runRea: $("use-rea").checked });
    state.lastResult = result; state.outputDir = result.outputDir;
    renderMetrics(result.metrics, result.topColors);
    $("report-path").textContent = result.reportPath;
    $("open-output").disabled = false; $("open-report").disabled = false;
    setProgress(100, "报告生成完成。");
    setStatus(result.rea && result.rea.success ? "UI 分析完成，REA 证据已保存。" : "UI 资源分析完成；REA 扫描未完成，请查看报告限制。", result.rea && result.rea.success ? "success" : "idle");
    addLog("报告目录：" + result.outputDir);
    if (result.rea && result.rea.success) addLog("REA Evidence：" + (result.rea.evidenceId || "已保存"));
    else if (result.rea && result.rea.error) addLog("REA 扫描提示：" + result.rea.error, "muted");
  } catch (error) { addLog("分析失败：" + error.message, "muted"); setStatus("分析失败，请查看日志。", "error"); }
  finally { setBusy(false); }
}
$("browse-target").addEventListener("click", () => chooseFolder("target-dir"));
$("browse-output").addEventListener("click", () => chooseFolder("output-dir"));
$("refresh-windows").addEventListener("click", refreshWindows);
$("window-select").addEventListener("change", updateWindowMeta);
$("capture-button").addEventListener("click", captureWindow);
$("analyze-button").addEventListener("click", runAnalysis);
$("open-output").addEventListener("click", () => state.outputDir && window.digiwiseUIAnalyzer.openPath(state.outputDir));
$("open-report").addEventListener("click", () => state.lastResult && window.digiwiseUIAnalyzer.openPath(state.lastResult.reportPath));
window.digiwiseUIAnalyzer.onProgress(payload => setProgress(payload.percent, payload.message));
(async function init() {
  try {
    const defaults = await window.digiwiseUIAnalyzer.getDefaults();
    $("app-version").textContent = "v" + (defaults.appVersion || "0.1.0");
    $("target-dir").value = defaults.targetDir || ""; $("output-dir").value = defaults.outputDir || "";
    state.outputDir = defaults.outputDir || "";
    addLog("REA UI Analyzer 已就绪。原始安装目录将保持只读。");
  } catch (error) { addLog("初始化失败：" + error.message, "muted"); }
})();