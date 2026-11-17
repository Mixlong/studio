---
name: digiwise-ui-review
description: Use when changing DigiwiseStudio Electron IDE UI, theme/skin, icons, typography, sidebar, toolbar, property panels, canvas selection, localization, visual alignment, or visual regression. Do not use for storage-only backend changes.
---

# DigiwiseStudio IDE UI 一致性与视觉回归

## 基线
读取 `AGENTS.md`、已有 UI 规范、用户已批准的截图和当前真实实现。项目 UI 以已批准的 Guider 设计方向和现有统一主题变量为参考；不要把某张讨论图当作已上线规范。

## 修改前
1. 定位准确页面/控件、CSS 类、主题变量与组件层级。
2. 确认默认深色主题、英文 UI、中文/英文切换需求及相应国际化资源。
3. 列出影响的 hover/active/focus/disabled/selected 状态、尺寸/间距/字体/图标和布局约束。
4. 禁止未批准的菜单、切换器、新面板、功能或跨模块样式改动。

## 工作步骤
- 对重大界面变更先更新 `docs/features/` 的设计对照及验收标准。
- 优先复用已有设计 token 和组件，避免硬编码色值、重复 CSS 选择器及脱离设计系统的单点修正。
- 校验文本/图标水平与垂直对齐、失焦状态、对比度、按钮语义及不同窗口宽度。
- 检查画布区域与属性面板 Style 预览一致，边线不越界，暗色背景与选择蓝色符合批准基线。
- 中英文语言资源一并检查，防止仅局部翻译。
- 能启动桌面端时提供真实截图或复现实测记录；若无法启动，标记视觉验收未完成，不用静态阅读代替视觉测试。
- 将回归结果、未通过项目和相应文件更新到 docs，并附 PR。

## 交付
只说实际测试过的内容；按“页面/组件 → 原问题 → 修改 → 视觉状态/截图 → 回归结果”组织。保留现有已确认的 UI 修改。
