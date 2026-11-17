"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const asar = require("@electron/asar");

function timestamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function normalizeArchivePath(value) { return String(value).replace(/^[/\\]+/, "").replace(/\\/g, "/"); }
function increment(map, key) {
  const value = String(key || "").trim();
  if (value) map.set(value, (map.get(value) || 0) + 1);
}
function topValues(map, limit) {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit).map(pair => ({ value: pair[0], count: pair[1] }));
}
function parseCss(css) {
  const maps = {
    colors: new Map(), fontFamilies: new Map(), fontSizes: new Map(), spacing: new Map(),
    radii: new Map(), shadows: new Map(), customProperties: new Map()
  };
  const colorRegex = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{1,100}\)|hsla?\([^)]{1,100}\)/g;
  for (const match of css.matchAll(colorRegex)) {
    const value = match[0].toLowerCase();
    if (value.startsWith("#") && ![4, 5, 7, 9].includes(value.length)) continue;
    increment(maps.colors, value);
  }
  for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) increment(maps.fontFamilies, match[1].replace(/\s+/g, " ").trim());
  for (const match of css.matchAll(/font-size\s*:\s*([^;}]+)/gi)) increment(maps.fontSizes, match[1].replace(/\s+/g, " ").trim());
  for (const match of css.matchAll(/(padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/gi)) {
    increment(maps.spacing, match[1].toLowerCase() + ": " + match[2].replace(/\s+/g, " ").trim());
  }
  for (const match of css.matchAll(/border-radius\s*:\s*([^;}]+)/gi)) increment(maps.radii, match[1].replace(/\s+/g, " ").trim());
  for (const match of css.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)) increment(maps.shadows, match[1].replace(/\s+/g, " ").trim());
  for (const match of css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)/g)) {
    increment(maps.customProperties, match[1] + ": " + match[2].replace(/\s+/g, " ").trim());
  }
  return {
    ruleBlocks: (css.match(/\{/g) || []).length,
    colors: topValues(maps.colors, 40),
    fontFamilies: topValues(maps.fontFamilies, 30),
    fontSizes: topValues(maps.fontSizes, 30),
    spacing: topValues(maps.spacing, 40),
    borderRadii: topValues(maps.radii, 30),
    shadows: topValues(maps.shadows, 20),
    customProperties: topValues(maps.customProperties, 80)
  };
}
function readAsarFile(archivePath, normalizedPath) {
  return asar.extractFile(archivePath, normalizedPath.split("/").join(path.sep));
}
function getAsarSize(archivePath, normalizedPath) {
  try { return Number(asar.statFile(archivePath, normalizedPath.split("/").join(path.sep)).size || 0); }
  catch { return 0; }
}
function isWithin(target, base) {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function runPowerShell(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath, ...args
    ], { windowsHide: true, cwd: path.resolve(__dirname, "..") });
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
function listMarkdown(items, max) {
  if (!items || !items.length) return "- 未提取到可确认的条目";
  return items.slice(0, max).map(item => "- " + item.value + "（" + item.count + " 次）").join("\n");
}
function createMarkdown(report) {
  const lines = [];
  lines.push("# " + report.target.productName + " UI 逆向分析报告", "");
  lines.push("- 分析时间：" + report.generatedAt);
  lines.push("- 目标目录：" + report.target.directory);
  lines.push("- 运行时：" + report.target.runtime);
  lines.push("- 分析工具：REA " + (report.rea.version || "未确认") + " + Digiwise UI Analyzer");
  lines.push("- 分析原则：只提取 UI 资源与视觉证据，不移植业务逻辑。", "");
  lines.push("## 分析摘要", "");
  lines.push("- ASAR 文件：" + (report.assets.archivePath ? "已发现" : "未发现"));
  lines.push("- CSS 样式表：" + report.assets.stylesheets.length);
  lines.push("- HTML 入口：" + report.assets.htmlFiles.length);
  lines.push("- 字体文件：" + report.assets.fonts.length);
  lines.push("- SVG 图标：" + report.assets.svgIcons.count);
  lines.push("- 图片资源：" + report.assets.images.count);
  lines.push("- CSS 规则块：" + report.designTokens.ruleBlocks, "");
  lines.push("## 颜色候选", "", listMarkdown(report.designTokens.colors, 24), "");
  lines.push("## 字体候选", "", listMarkdown(report.designTokens.fontFamilies, 20), "");
  lines.push("## 字号候选", "", listMarkdown(report.designTokens.fontSizes, 20), "");
  lines.push("## 间距候选", "", listMarkdown(report.designTokens.spacing, 24), "");
  lines.push("## 圆角候选", "", listMarkdown(report.designTokens.borderRadii, 16), "");
  lines.push("## 阴影候选", "", listMarkdown(report.designTokens.shadows, 12), "");
  lines.push("## 字体资源", "");
  lines.push(report.assets.fonts.length
    ? report.assets.fonts.slice(0, 80).map(item => "- " + item.path + "（" + item.bytes + " bytes）").join("\n")
    : "- 未发现字体文件", "");
  lines.push("## UI 样式表", "");
  lines.push(report.assets.stylesheets.length
    ? report.assets.stylesheets.map(item => "- " + item.path + "（" + item.bytes + " bytes）").join("\n")
    : "- 未发现可提取的样式表", "");
  lines.push("## 运行窗口观察", "");
  if (report.runtimeCapture) {
    lines.push("- 窗口标题：" + (report.runtimeCapture.process && report.runtimeCapture.process.title || "未读取"));
    lines.push("- 窗口尺寸：" + (report.runtimeCapture.window && report.runtimeCapture.window.bounds.width || 0) + " × " + (report.runtimeCapture.window && report.runtimeCapture.window.bounds.height || 0));
    lines.push("- 截图：" + (report.runtimeCapture.screenshotPath || "未捕获"));
    lines.push("- UIA 节点：" + ((report.runtimeCapture.accessibility && report.runtimeCapture.accessibility.nodeCount) || 0));
    lines.push("- UIA 状态：" + ((report.runtimeCapture.accessibility && report.runtimeCapture.accessibility.status) || "未采集"));
  } else {
    lines.push("- 尚未采集运行窗口；可在工具中选择窗口并执行截图采集。");
  }
  lines.push("", "## REA 证据", "");
  if (report.rea.success) {
    lines.push("- Evidence ID：" + (report.rea.evidenceId || "未返回"));
    lines.push("- 扫描条目：" + (report.rea.coverage && report.rea.coverage.entries_examined || "未知"));
    lines.push("- 已探测文件：" + (report.rea.coverage && report.rea.coverage.files_probed || "未知"));
    lines.push("- 覆盖状态：" + (report.rea.coverage && report.rea.coverage.status || "未知"));
    lines.push("- 完整证据：" + (report.rea.evidencePath || ""));
  } else {
    lines.push("- REA 扫描未完成：" + (report.rea.error || "未执行"));
  }
  lines.push("", "## 证据边界与限制", "");
  lines.push("- 本报告是 UI 资源与视觉线索的静态整理，不代表完整复刻目标程序。");
  lines.push("- CSS 中出现的颜色、字号和间距是候选值；频次不等于实际屏幕使用频率。");
  lines.push("- Electron/Chromium 窗口可能只暴露顶层 UI Automation 节点，不能据此断言内部控件不存在。");
  lines.push("- 本工具不执行目标应用的业务操作，不分析项目数据结构、代码生成、SDK、Build / Download 或业务流程。");
  lines.push("- 原始安装目录保持只读；所有报告、截图和选取的 UI 样式副本写入输出目录。", "");
  lines.push("## 文件", "");
  lines.push("- JSON 报告：" + report.output.jsonPath);
  lines.push("- Markdown 报告：" + report.output.markdownPath);
  lines.push("- UI 资源目录：" + report.output.resourcesDir, "");
  return lines.join("\n");
}

async function analyzeTarget(options) {
  const targetDir = options.targetDir;
  const outputDir = options.outputDir;
  const onProgress = options.onProgress || function () {};
  const runRea = options.runRea !== false;
  if (process.platform !== "win32") throw new Error("当前第一版仅支持 Windows。");
  const resolvedTarget = path.resolve(targetDir);
  if (!fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isDirectory()) throw new Error("目标安装目录不存在或不是文件夹。");
  const resolvedOutput = path.resolve(outputDir);
  if (isWithin(resolvedOutput, resolvedTarget)) throw new Error("报告输出目录不能放在目标安装目录内部，以确保原安装目录保持只读。");

  const runDir = path.join(resolvedOutput, "GUI-Guider-" + timestamp());
  const evidenceDir = path.join(runDir, "evidence");
  const resourcesDir = path.join(runDir, "ui-resources");
  const screenshotsDir = path.join(runDir, "screenshots");
  [evidenceDir, resourcesDir, screenshotsDir].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  const archivePath = path.join(resolvedTarget, "resources", "app.asar");

  const report = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    scope: { mode: "ui-only", businessLogicAnalyzed: false, targetModified: false, targetExecuted: false },
    target: { directory: resolvedTarget, productName: path.basename(resolvedTarget), runtime: "Windows desktop application" },
    rea: { success: false, version: "6.8.0", error: null },
    assets: {
      archivePath: fs.existsSync(archivePath) ? archivePath : null, archiveEntries: 0,
      stylesheets: [], htmlFiles: [], fonts: [],
      svgIcons: { count: 0, examples: [] }, images: { count: 0, examples: [] }
    },
    designTokens: { ruleBlocks: 0, colors: [], fontFamilies: [], fontSizes: [], spacing: [], borderRadii: [], shadows: [], customProperties: [] },
    runtimeCapture: null,
    output: {}
  };

  onProgress({ stage: "scan", percent: 8, message: "检查目标目录与 Electron ASAR 文件……" });
  if (fs.existsSync(archivePath)) {
    const entries = asar.listPackage(archivePath).map(normalizeArchivePath);
    report.assets.archiveEntries = entries.length;
    const cssEntries = entries.filter(rel =>
      /\.css$/i.test(rel) && !/(^|\/)node_modules\//i.test(rel) &&
      (/(^|\/)build\/static\/css\//i.test(rel) || /(^|\/)(styles?|css)\//i.test(rel))
    );
    const htmlEntries = entries.filter(rel =>
      /\.html?$/i.test(rel) && !/(^|\/)node_modules\//i.test(rel) &&
      (/(^|\/)build\/index\.html$/i.test(rel) || /(^|\/)(index|home|welcome)\.html?$/i.test(rel))
    );
    const fontEntries = entries.filter(rel =>
      /\.(woff2?|ttf|otf)$/i.test(rel) && !/(^|\/)node_modules\//i.test(rel) &&
      /(^|\/)(static\/media|fonts?)\//i.test(rel)
    );
    const svgEntries = entries.filter(rel =>
      /\.svg$/i.test(rel) && !/(^|\/)node_modules\//i.test(rel) && /(^|\/)build\/static\/media\//i.test(rel)
    );
    const imageEntries = entries.filter(rel =>
      /\.(png|jpe?g|webp|gif|ico)$/i.test(rel) && !/(^|\/)node_modules\//i.test(rel) && /(^|\/)build\/static\/media\//i.test(rel)
    );

    const cssDir = path.join(resourcesDir, "styles");
    fs.mkdirSync(cssDir, { recursive: true });
    const tokenMaps = {
      colors: new Map(), fontFamilies: new Map(), fontSizes: new Map(), spacing: new Map(),
      radii: new Map(), shadows: new Map(), customProperties: new Map()
    };
    const cssStats = [];
    let ruleBlocks = 0;
    let cssBytes = 0;
    for (let index = 0; index < cssEntries.length; index++) {
      const rel = cssEntries[index];
      onProgress({
        stage: "styles",
        percent: 12 + Math.round((index / Math.max(cssEntries.length, 1)) * 32),
        message: "读取 UI 样式表 " + (index + 1) + "/" + cssEntries.length + "：" + path.posix.basename(rel)
      });
      const bytes = getAsarSize(archivePath, rel);
      if (bytes > 8 * 1024 * 1024 || cssBytes + bytes > 16 * 1024 * 1024) continue;
      let buffer;
      try { buffer = readAsarFile(archivePath, rel); } catch { continue; }
      const stats = parseCss(buffer.toString("utf8"));
      cssBytes += buffer.length;
      ruleBlocks += stats.ruleBlocks;
      const pairs = [
        ["colors", "colors"], ["fontFamilies", "fontFamilies"], ["fontSizes", "fontSizes"],
        ["spacing", "spacing"], ["borderRadii", "radii"], ["shadows", "shadows"],
        ["customProperties", "customProperties"]
      ];
      for (const pair of pairs) {
        for (const item of stats[pair[0]]) {
          const map = tokenMaps[pair[1]];
          map.set(item.value, (map.get(item.value) || 0) + item.count);
        }
      }
      const outName = String(index + 1).padStart(2, "0") + "-" + path.posix.basename(rel);
      const outPath = path.join(cssDir, outName);
      fs.writeFileSync(outPath, buffer);
      cssStats.push({ path: rel, bytes: buffer.length, extractedPath: outPath });
    }
    report.assets.stylesheets = cssStats;
    report.assets.htmlFiles = htmlEntries.map(rel => ({ path: rel, bytes: getAsarSize(archivePath, rel) }));
    report.assets.fonts = fontEntries.map(rel => ({
      path: rel, bytes: getAsarSize(archivePath, rel), extension: path.posix.extname(rel).toLowerCase()
    }));
    report.assets.svgIcons = { count: svgEntries.length, examples: svgEntries.slice(0, 100).map(rel => ({ path: rel, bytes: getAsarSize(archivePath, rel) })) };
    report.assets.images = { count: imageEntries.length, examples: imageEntries.slice(0, 100).map(rel => ({ path: rel, bytes: getAsarSize(archivePath, rel) })) };
    report.designTokens = {
      ruleBlocks,
      colors: topValues(tokenMaps.colors, 40),
      fontFamilies: topValues(tokenMaps.fontFamilies, 30),
      fontSizes: topValues(tokenMaps.fontSizes, 30),
      spacing: topValues(tokenMaps.spacing, 40),
      borderRadii: topValues(tokenMaps.radii, 30),
      shadows: topValues(tokenMaps.shadows, 20),
      customProperties: topValues(tokenMaps.customProperties, 80)
    };
    const htmlEntry = htmlEntries.find(rel => /(^|\/)build\/index\.html$/i.test(rel));
    if (htmlEntry) {
      try {
        const html = readAsarFile(archivePath, htmlEntry);
        const htmlPath = path.join(resourcesDir, "index.html");
        fs.writeFileSync(htmlPath, html);
        report.assets.htmlEntryExtracted = htmlPath;
      } catch (error) { report.assets.htmlExtractError = error.message; }
    }
  } else {
    report.assets.archiveWarning = "未找到 resources/app.asar；仍可使用 REA 目录扫描与运行窗口截图。";
  }

  onProgress({ stage: "rea", percent: 52, message: "调用 REA 扫描安装目录，生成只读文件证据……" });
  if (runRea) {
    try {
      const evidencePath = path.join(evidenceDir, "rea-desktop-application-evidence.json");
      const summaryPath = path.join(evidenceDir, "rea-desktop-application-summary.json");
      const scriptPath = path.join(__dirname, "..", "scripts", "inspect-rea.ps1");
      const raw = await runPowerShell(scriptPath, [resolvedTarget, evidencePath, summaryPath]);
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      const data = parsed && parsed.data || {};
      const summary = data.summary || data;
      const normalized = summary.normalized_result || data.normalized_result || {};
      const summaryMetrics = normalized.summary || {};
      report.rea = {
        success: !!(parsed && parsed.ok !== false && fs.existsSync(evidencePath)),
        version: "6.8.0",
        evidenceId: summary.evidence_id || data.evidence_id || null,
        parentEvidenceId: normalized.parent_evidence_id || null,
        coverage: summaryMetrics.source_coverage || normalized.coverage || null,
        availableCounts: summaryMetrics.available_counts || null,
        limitations: summary.limitations || data.limitations || [],
        evidencePath,
        summaryPath
      };
    } catch (error) {
      report.rea = { success: false, version: "6.8.0", error: error.message };
    }
  } else {
    report.rea = { success: false, version: "6.8.0", error: "用户关闭了 REA 目录扫描。" };
  }

  onProgress({ stage: "report", percent: 88, message: "整理 UI 设计候选值并生成报告……" });
  report.output = {
    directory: runDir, resourcesDir, screenshotsDir,
    jsonPath: path.join(runDir, "ui-analysis.json"),
    markdownPath: path.join(runDir, "ui-analysis.md")
  };
  fs.writeFileSync(report.output.jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(report.output.markdownPath, createMarkdown(report), "utf8");
  onProgress({ stage: "done", percent: 100, message: "UI 资源分析完成。" });
  return {
    success: true,
    reportPath: report.output.markdownPath,
    jsonPath: report.output.jsonPath,
    outputDir: runDir,
    metrics: {
      archiveEntries: report.assets.archiveEntries,
      stylesheets: report.assets.stylesheets.length,
      fonts: report.assets.fonts.length,
      svgIcons: report.assets.svgIcons.count,
      images: report.assets.images.count,
      colorTokens: report.designTokens.colors.length,
      fontSizes: report.designTokens.fontSizes.length,
      reaSuccess: report.rea.success
    },
    topColors: report.designTokens.colors.slice(0, 8),
    rea: report.rea,
    report
  };
}
function attachRuntimeCapture(report, capture) {
  const screenshotPath = path.join(report.output.screenshotsDir, "target-window.png");
  fs.copyFileSync(capture.screenshotPath, screenshotPath);
  const cleanCapture = JSON.parse(JSON.stringify(capture));
  delete cleanCapture.screenshotDataUrl;
  cleanCapture.screenshotPath = screenshotPath;
  report.runtimeCapture = cleanCapture;
  fs.writeFileSync(report.output.jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(report.output.markdownPath, createMarkdown(report), "utf8");
  return { screenshotPath, reportPath: report.output.markdownPath, jsonPath: report.output.jsonPath };
}
module.exports = { analyzeTarget, attachRuntimeCapture };