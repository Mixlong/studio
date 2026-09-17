# 视觉改动清单

> 范围：`lvgl-web-demo` 编辑器界面。以下结论来自原版/最新版截图与当前工作区源码的交叉核对。

## 结论摘要

| 类别 | 结果 | 主要证据 |
| --- | --- | --- |
| 图标系统 | Material Symbols Outlined 已接入并覆盖通用控件和流程动作 | `packages/eez-studio-ui/icon.tsx`、`packages/eez-studio-ui/_stylesheets/material-symbols.css`、`packages/project-editor/flow/components/component-icons.ts` |
| 编辑器布局 | 左侧旧式多面板改为 Activity Bar，右侧面板收敛为 Auxiliary Bar，并增加折叠控制 | `packages/project-editor/store/layout-models.tsx`、`packages/project-editor/project/ui/ProjectEditor.tsx`、`packages/eez-studio-ui/_stylesheets/project-editor.less` |
| 导航与资源 | 新增 Embedded Platform、Audio 导航入口及对应选择/跳转逻辑 | `packages/project-editor/features/embedded-platform/`、`packages/project-editor/features/audio/`、`packages/project-editor/project/ui/NavigationComponentFactory.tsx` |
| 组件/动作面板 | Components Palette 的控件和动作图标统一映射到 Material Symbols | `packages/project-editor/flow/editor/ComponentsPalette.tsx`、`packages/project-editor/flow/components/component-icons.ts` |
| 品牌与文案 | Home、工具栏、资源面板标题和帮助提示的层级、间距与文案有调整 | `packages/home/*.tsx`、`packages/project-editor/project/ui/Toolbar.tsx`、`packages/project-editor/store/layout-models.tsx` |

## A. 图标系统迁移

| 改动点 | 视觉表现 | 源码位置 | 状态 |
| --- | --- | --- | --- |
| 字体接入 | 图标由旧 Material Icons 字形切换为本地 Material Symbols Outlined | `packages/eez-studio-ui/_stylesheets/material-symbols.css`、`packages/eez-studio-ui/_stylesheets/MaterialSymbolsOutlined.ttf` | 已实现 |
| 通用渲染器 | `material:*` 引用统一渲染为 `material-symbols-outlined`，保留旧别名兼容 | `packages/eez-studio-ui/icon.tsx` | 已实现 |
| 控件图标 | LVGL、Dashboard、Embedded 等控件使用语义化符号 | `packages/project-editor/flow/components/component-icons.ts` | 已实现 |
| 流程动作 | Start、End、Delay、Loop、Audio、Settings 等动作使用统一符号 | `packages/project-editor/flow/components/component-icons.ts` | 已实现 |
| 覆盖检查 | 标准控件和流程动作映射覆盖率 `124/124` | 映射检查记录 | 已通过 |

## B. 布局与导航

| 改动点 | 原版 | 最新版 | 对比场景 |
| --- | --- | --- | --- |
| 左侧导航 | Pages、Widgets Structure、Variables 等面板纵向堆叠在左侧 | 收敛为窄 Activity Bar，使用图标切换面板 | `home`、`pages`、`user-widgets`、`widgets-structure`、`variables` |
| 右侧导航 | Styles、Fonts、Bitmaps、Themes、Groups、Breakpoints 以竖排文字标签显示 | 使用图标化 Auxiliary Bar，悬浮时显示 tooltip | `right-styles`、`right-fonts`、`right-bitmaps`、`right-themes`、`right-groups`、`right-breakpoints` |
| 工具栏 | 旧式图标尺寸和间隔较松，部分使用旧字形 | 顶部工具栏统一线性 Material Symbols，间距和状态色重排 | 所有 paired 场景 |
| 面板折叠 | 没有 IDE 风格的侧栏折叠操作 | 左右侧栏顶部增加折叠控制，布局状态可保持 | `home`、`right-properties` |
| 工具提示 | 面板名称主要直接显示在面板标题 | 活动栏支持 hover tooltip，减少常驻文字 | `pages`、`user-widgets`、`actions`、`widgets-structure`、`variables`、各 `right-*` 场景 |

## C. 新增页面与能力

### Embedded Platform

- 新增页面标题、Target Board 表单、Build Firmware 和 Download Firmware 操作区。
- 新增 Workspaces、Target、Protocols、Resources、Connection、Components 六项导航。
- 新增构建工具、资源文件、协议和 WebSocket/云端协议支持。
- 主要源码：`packages/project-editor/features/embedded-platform/`。
- 截图证据：`assets/latest/embedded-platform.png`；原版无同名独立页面截图。

### Audio

- 新增 Audio 导航对象、Audio Resource 跳转和 Preview / Flash Layout 工作区模型。
- 新增音频构建与资源处理逻辑。
- 主要源码：`packages/project-editor/features/audio/`、`packages/project-editor/project/ui/NavigationComponentFactory.tsx`、`packages/project-editor/store/layout-models.tsx`。
- 当前截图集没有稳定的 Audio 页面截图，报告将其列为源码已实现、视觉证据待补采的能力。

## D. 样式与文案

- `packages/eez-studio-ui/_stylesheets/project-editor.less`：Activity Bar、Auxiliary Bar、面板宽度、选中态、tooltip 和折叠按钮样式。
- `packages/eez-studio-ui/_stylesheets/app.less`、`home.less`：全局间距、颜色层级、Home 头部和工具栏视觉调整。
- `packages/project-editor/project/ui/Toolbar.tsx`：顶部操作区的图标、按钮和状态呈现调整。
- `packages/project-editor/project/ui/SettingsNavigation.tsx`：设置导航与新活动栏模型对接。
- `packages/home/home-tab.tsx`、`packages/home/app.tsx`：Home 页面结构和空状态/项目入口呈现调整。

## E. 验证记录

以下命令已在当前工作区通过：

```text
npx tsc --noEmit --pretty false
npm run build-css
npm run build-dark-css
npm run build-src
```

视觉报告仍有两个采集限制：截图视口高度不完全一致；最新版部分截图来自同一 `Embedded Platform` 内容页的不同活动栏悬浮状态。因此报告把“结构性改动”和“截图采集差异”分开描述。
