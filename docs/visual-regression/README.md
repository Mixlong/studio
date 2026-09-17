# 原版 vs 最新版界面对比交付物

本目录是 `lvgl-web-demo` 项目的视觉回归对比资料，入口文件为 **[report.html](./report.html)**。

## 查阅方式

直接用浏览器打开 `report.html` 即可离线查看。报告不引用 CDN 或外部字体，图片、样式和脚本都在本目录内。点击截图可以在新标签页查看原始尺寸，使用顶部筛选框可以按场景或改动类别定位。

目录结构：

```text
docs/visual-regression/
├── report.html                 # 可交互的离线报告（主交付物）
├── change-inventory.md         # 改动清单、源码映射和验证记录
└── assets/
    ├── original/               # 基线截图
    ├── latest/                 # 最新版截图
    ├── annotated/              # 报告中的标注使用 HTML 覆盖层渲染
    └── comparison/             # 预留给后续像素 diff 产物
```

## 采集基线

- 项目：`/Users/dragons/eez-projects/examples/lvgl-web-demo/lvgl-web-demo.eez-project`
- 原版基线：`18b446f88b14f1691b162147d71ac9e93718fe95`
- 采集日期：`2026-09-02`
- 采集窗口：约 1200 CSS px 宽、DPR 2
- 原版隔离工作树：`/tmp/studio-visual-original-20260902`
- 截图主尺寸：2400×1688；少数临时采集图为 2400×1744，报告已排除

## 解读说明

1. 报告中的“原版”是基于指定 Git 基线启动的应用截图，“最新版”是当前工作区构建后的应用截图。
2. 原版和最新版的 Electron 窗口可视高度略有差异，截图适合做结构和视觉改动核对，不应直接作为严格像素级 diff 的唯一依据。
3. 采集过程中部分最新版截图停留在 `Embedded Platform` 内容页，仅活动栏悬浮提示不同；报告按文件名和可见 UI 状态保留这些证据，并在场景说明中标注。
4. `original/right-.png`、`original/undefined.png`、`original/right-*` 的长尺寸变体，以及 `latest/editor-overview.png` 和带空格的旧组件面板文件属于采集临时文件，未纳入主配对。

## 标注图例

- 红框：最新版中观察到的改动区域
- 红色圆标：该区域在当前场景的编号
- “原版无独立截图”：该页面或面板在原版没有同名独立截图，不能把缺失证据当作功能不存在

源码与功能的逐项映射见 **[change-inventory.md](./change-inventory.md)**。
