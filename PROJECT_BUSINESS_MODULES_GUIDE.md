# EEZ Studio 业务模块开发与使用指南

> 适用项目：EEZ Studio 0.29.0  
> 适用对象：Web 前端开发者、二开负责人、测试及产品人员  
> 文档目标：说明各业务模块的用途、用户操作方式、开发入口、扩展方式、风险和二开周期。

## 1. 项目概述

EEZ Studio 是一个基于 Electron 的跨平台桌面应用，主要用于：

- 设计桌面 Dashboard 和嵌入式 GUI。
- 创建并运行 EEZ Flow 低代码流程。
- 创建 LVGL 8/9 项目并生成 C/C++ 代码。
- 管理和远程控制 SCPI 或专有协议仪器。
- 通过串口、USB-TMC、以太网和 VISA 与设备通信。
- 记录仪器操作历史、波形、脚本、列表和 Notebook。
- 安装仪器扩展、项目编辑器扩展及测量函数扩展。

核心技术栈：

```text
Electron 39
React 18
TypeScript 5.6
MobX 6
Less / Bootstrap
SQLite / better-sqlite3
WebAssembly
LVGL / C / C++
```

项目不是传统的浏览器 Web 应用。React 页面运行在 Electron 渲染进程中，同时依赖 Electron 主进程、本地文件系统、SQLite 和原生硬件模块。

## 2. 总体架构

```text
packages/main
    Electron 主进程、窗口、菜单、全局设置、IPC

packages/home
    首页、标签页工作区、项目入口、仪器入口、扩展管理、设置

packages/project-editor
    项目编辑器、页面、资源、Flow、LVGL、运行时和代码生成

packages/instrument
    仪器管理、连接、终端、历史、波形、脚本、列表

packages/eez-studio-ui
    通用 UI 组件、弹窗、布局、表格、树、图表

packages/eez-studio-shared
    SQLite、扩展加载、共享服务、工具、国际化和校验

packages/shortcuts
    全局及仪器快捷方式

packages/notebook
    Notebook、历史条目收集、导入导出

packages/basic-measurements
    Min、Max、Average、FFT 等测量算法
```

主要运行链路：

```text
Electron 主进程
    -> 创建 Home 窗口
    -> Home 渲染进程加载内置和用户扩展
    -> 标签页打开 Project Editor 或 Instrument Editor
    -> Project Editor 运行 Flow/WASM 或生成 LVGL/C++ 代码
    -> Instrument Editor 通过 IPC 调用串口、USB、VISA、网络接口
```

## 3. 开发环境与启动方式

### 3.1 环境要求

- Node.js 20 或更高版本。
- npm。
- 可用的 C/C++ 原生模块编译环境。
- macOS、Windows 或 Linux 64 位系统。
- 如果开发设备通信功能，需要准备对应仪器和驱动。

项目已经在 Apple Silicon macOS、Node.js 22 环境完成安装、构建和启动验证。

### 3.2 首次安装

```bash
npm ci
npm run build
npm start
```

如果 Electron 安装包从 GitHub 下载较慢，可以使用镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci
```

### 3.3 日常开发

首次开发前执行一次完整构建：

```bash
npm run build
```

监听 TypeScript：

```bash
npx tsc --project tsconfig.dev.json --watch
```

也可以使用 VS Code 默认构建任务，仓库的 `.vscode/tasks.json` 已配置 TypeScript Watch。

复制非 TypeScript 静态资源：

```bash
node node_modules/gulp-cli/bin/gulp.js debug
```

修改 Less 后重新生成样式：

```bash
npm run build-css
npm run build-dark-css
```

启动桌面应用：

```bash
npm start
```

注意：根目录的 `npm run watch` 当前只执行一次 Gulp 和 TypeScript 编译，不是真正持续监听；持续开发建议直接使用 `tsc --watch` 或 VS Code Task。

### 3.4 调试方式

VS Code 已提供以下调试配置：

- `Electron: Main`：调试主进程。
- `Electron: Renderer`：连接渲染进程。
- `Electron: All`：同时调试主进程和渲染进程。

普通 UI 问题主要调试渲染进程；窗口、菜单、文件、硬件和 IPC 问题需要同时检查主进程。

## 4. 用户数据与文件格式

### 4.1 项目文件

- `.eez-project`：EEZ Studio 可编辑项目。
- `.eez-dashboard`：构建后的 Dashboard 文件。
- `.eez-notebook`：Notebook 导入导出文件。
- 仪器扩展通常以压缩包或扩展目录形式安装。

`.eez-project` 虽然以 JSON 数据为基础，但依赖类注册、对象引用、版本迁移、撤销重做和代码生成，不能当作普通 JSON 表单直接修改。

### 4.2 用户数据目录

默认数据库：

- macOS：`~/Library/Application Support/eezstudio/storage.db`
- Linux：`~/.config/eezstudio/storage.db`
- Windows：`%appdata%/eezstudio/storage.db`

扩展目录：

- macOS：`~/Library/Application Support/eezstudio/extensions`
- Linux：`~/.config/eezstudio/extensions`
- Windows：`%appdata%/eezstudio/extensions`

主要配置常量位于：

- `packages/eez-studio-shared/conf.ts`
- `packages/main/settings.ts`
- `packages/eez-studio-shared/db.ts`

## 5. 业务模块说明

### 5.1 Electron 桌面外壳

#### 用户使用说明

桌面外壳负责应用启动、窗口、菜单、文件打开、快捷键、主题切换和应用退出。用户通常通过系统菜单执行：

- 新建或打开项目。
- 保存、另存为、撤销和重做。
- 构建项目。
- 切换标签页和主题。
- 打开仪器、Notebook、扩展和设置。

#### 开发说明

主要文件：

- `packages/main/main.ts`：主进程入口。
- `packages/main/window.ts`：BrowserWindow 创建和窗口状态。
- `packages/main/menu.ts`：系统菜单和快捷键。
- `packages/main/settings.ts`：全局设置、窗口位置和数据库路径。
- `packages/main/home-window.ts`：Home 窗口入口。

常见二开：

- 增加菜单：修改 `packages/main/menu.ts`。
- 增加主进程能力：在 `packages/main` 中注册 `ipcMain`。
- 渲染进程调用：使用 `ipcRenderer.send`、`invoke` 或事件监听。
- 修改窗口尺寸、标题和图标：修改 `packages/main/window.ts` 及安装配置。

注意事项：

- 当前窗口启用了 Node Integration，并关闭 Context Isolation 和 Web Security。
- 新增远程网页、登录页或不可信 HTML 时必须单独做安全检查。
- IPC 事件名称应集中管理，避免主进程和渲染进程字符串不一致。

### 5.2 Home 首页与标签工作区

#### 用户使用说明

应用启动后进入 Home 页面，主要入口包括：

- `Open`：打开最近项目或本地项目。
- `Create`：创建新项目。
- `Examples`：下载和打开示例。
- `Instruments`：管理仪器。
- `Extensions`：管理扩展。
- `Settings`：管理主题、数据库、模板地址等设置。

打开项目或仪器后，会在顶部标签工作区中形成独立标签页。

#### 开发说明

主要文件：

- `packages/home/main.tsx`：Home 渲染进程入口。
- `packages/home/app.tsx`：应用主布局和标签内容。
- `packages/home/home-tab.tsx`：Home 左侧功能导航。
- `packages/home/tabs-store.tsx`：标签页模型及生命周期。
- `packages/home/open-projects.tsx`：最近项目和打开项目。
- `packages/home/settings.tsx`：设置页面。

新增一个 Home 业务页面通常需要：

1. 在 `HomeTabStore.activeTab` 联合类型中增加页面 ID。
2. 在 `home-tab.tsx` 增加导航项。
3. 增加对应 React 页面组件。
4. 在内容区域增加条件渲染。
5. 如果需要持久化选中状态，调整 `SAVED_OPTIONS_VERSION`。
6. 如果需要系统菜单入口，同时修改 `packages/main/menu.ts`。

适合优先二开的功能：

- 独立业务页面。
- API 数据展示。
- 用户信息和授权状态。
- 任务列表、日志和统计页面。
- 新的设置项。

### 5.3 项目创建与项目类型

#### 用户使用说明

在 `Create` 中可以创建不同类型的项目：

| 项目类型 | 用途 |
|---|---|
| Dashboard | 创建桌面仪表盘和自动化流程 |
| Firmware | 创建嵌入式 GUI 和固件资源 |
| LVGL | 创建 LVGL 8/9 图形界面并生成代码 |
| IEXT | 创建仪器扩展定义 |
| EEZ GUI Lite | 创建轻量级嵌入式 GUI 项目 |
| Applet | 创建远程运行的应用模块 |
| Resource | 创建资源项目 |

项目向导可以从内置模板、远程模板或示例仓库创建项目。

#### 开发说明

主要文件：

- `packages/project-editor/project/ui/Wizard.tsx`：新建项目向导。
- `packages/project-editor/project/project-type-traits.ts`：项目类型能力差异。
- `packages/project-editor/project/project.tsx`：项目设置和根模型。
- `packages/project-editor/project/migrate-project.ts`：项目类型和版本迁移。

新增项目类型不是单纯增加一个选项，通常还需要处理：

- 项目模板。
- 功能开关。
- 运行时类型。
- 构建输出。
- 编辑器导航。
- 旧项目迁移。

### 5.4 Project Editor 核心编辑器

#### 用户使用说明

Project Editor 用于编辑 `.eez-project`，主要区域包括：

- 项目资源导航树。
- 页面或 Flow 编辑区。
- 属性面板。
- 组件面板。
- 输出、检查和错误信息。
- 工具栏、构建和运行按钮。
- 撤销、重做、复制、粘贴和查找引用。

#### 开发说明

主要入口：

- `packages/project-editor/project-editor-bootstrap.tsx`
- `packages/project-editor/project-editor-create.tsx`
- `packages/project-editor/project-editor-interface.tsx`
- `packages/project-editor/store/index.ts`
- `packages/project-editor/store/features.ts`
- `packages/project-editor/store/serialization.ts`
- `packages/project-editor/store/undo-manager.ts`

核心机制：

- 所有可持久化对象通过 `classInfo` 描述属性。
- 类通常需要通过 `registerClass` 注册。
- 项目功能通过 `ProjectEditorFeature` 注册到项目根模型。
- 对象更新应通过 Project Store 命令执行，以进入撤销重做历史。
- 加载旧项目时可能需要执行迁移。

新增项目模型字段时至少检查：

1. `classInfo.properties` 是否声明。
2. 默认值是否正确。
3. 属性面板是否需要显示。
4. 序列化和反序列化是否正常。
5. 撤销重做是否正常。
6. 复制粘贴是否保留数据。
7. 旧项目是否需要迁移。
8. 构建阶段是否使用该字段。

该模块属于高风险区域，不建议在没有回归项目的情况下做大范围重构。

### 5.5 项目资源与基础特性

Project Editor 内置以下项目特性：

| 特性 | 用户用途 | 主要开发入口 |
|---|---|---|
| Pages | 创建 GUI 页面 | `features/page` |
| User Widgets | 创建可复用用户控件 | `features/user-widget` |
| User Actions | 定义原生或 Flow 动作 | `features/action` |
| Variables | 全局变量、结构体和枚举 | `features/variable` |
| Styles | 样式及主题 | `features/style` |
| Fonts | 字体和字形 | `features/font` |
| Bitmaps | 图片和位图资源 | `features/bitmap` |
| Texts | 多语言文本资源 | `features/texts` |
| SCPI | SCPI 命令树和枚举 | `features/scpi` |
| Instrument Commands | 仪器命令定义 | `features/instrument-commands` |
| Shortcuts | 项目快捷方式 | `features/shortcuts` |
| MicroPython | 项目内 MicroPython 代码 | `features/micropython` |
| Readme | 关联项目说明文件 | `features/readme` |
| Changes | 项目差异和变更 | `features/changes` |

新增类似特性时，需要实现 `ProjectEditorFeature` 并加入 `packages/project-editor/store/features.ts` 的特性列表。

### 5.6 EEZ Flow 模块

#### 用户使用说明

EEZ Flow 通过拖拽组件和连接线构建逻辑流程。用户可以：

- 添加输入、输出和变量。
- 使用条件、循环、表达式和序列连接。
- 调用 HTTP、MQTT、Modbus、TCP、UDP 和串口。
- 读取或写入文件、CSV 和 JSON。
- 控制仪器。
- 在 Dashboard 中使用图表、终端、Markdown 和表格组件。
- 在模拟器中运行和调试流程。

内置动作入口位于：

```text
packages/project-editor/flow/components/actions
```

目前包含 HTTP、MQTT、Modbus、TCP、UDP、Serial、File、CSV、JSON、正则、Python、仪器命令等动作。

#### 开发说明

主要目录：

- `packages/project-editor/flow/component.tsx`：组件基础模型。
- `packages/project-editor/flow/components/actions`：动作组件。
- `packages/project-editor/flow/components/widgets`：界面组件。
- `packages/project-editor/flow/editor`：画布和交互。
- `packages/project-editor/flow/runtime`：运行时、WASM 和调试。
- `packages/project-editor/flow/expression`：表达式系统。

新增普通 Flow Action 的典型步骤：

1. 定义组件类和 `classInfo`。
2. 定义输入、输出和属性。
3. 注册组件。
4. 加入组件面板分类。
5. 实现 Dashboard/JS 运行逻辑或底层 Flow 运行时逻辑。
6. 增加错误处理和 `@Error` 输出支持。
7. 检查保存、复制、撤销和运行。
8. 补充组件帮助文档。

如果组件只在 Dashboard JavaScript 运行时执行，周期较短；如果需要修改 WASM 或 C/C++ Flow 运行时，周期会明显增加。

### 5.7 LVGL 模块

#### 用户使用说明

LVGL 项目支持：

- LVGL 8.x 和 9.x。
- Screen、Container、Button、Label、Image、Chart 等常用控件。
- 样式、状态、事件和动画。
- Encoder 和 Keyboard Group。
- 页面模拟运行。
- 生成目标工程使用的 C/C++ 代码。

主要控件位于：

```text
packages/project-editor/lvgl/widgets
```

#### 开发说明

主要文件和目录：

- `packages/project-editor/lvgl/widgets`：控件定义。
- `packages/project-editor/lvgl/style.tsx`：LVGL 样式。
- `packages/project-editor/lvgl/groups.tsx`：输入设备组。
- `packages/project-editor/lvgl/actions.tsx`：LVGL 动作。
- `packages/project-editor/lvgl/page-runtime.ts`：模拟运行。
- `packages/project-editor/lvgl/build.ts`：构建代码。
- `packages/project-editor/lvgl/to-lvgl-code.ts`：代码生成辅助。
- `packages/project-editor/lvgl/migrate.ts`：LVGL 版本迁移。

新增 LVGL 控件通常需要同时完成：

1. 控件模型和属性。
2. 组件面板注册。
3. 编辑器绘制或模拟器实例创建。
4. 事件和状态支持。
5. 样式支持。
6. LVGL 8/9 API 差异处理。
7. C/C++ 代码生成。
8. 项目保存和迁移。

这是二开中复杂度最高的区域之一。

### 5.8 仪器与设备管理

#### 用户使用说明

用户可以在 `Instruments` 中：

- 新增和配置仪器。
- 安装对应 IEXT 仪器扩展。
- 通过串口、USB-TMC、Ethernet 或 VISA 连接设备。
- 使用终端发送 SCPI 命令。
- 浏览命令树和上下文帮助。
- 查看历史操作、日历和搜索结果。
- 上传或下载设备文件。
- 使用脚本和快捷方式自动化操作。
- 查看波形、FFT 和测量结果。
- 管理设备列表和任意波形数据。

#### 开发说明

主要入口：

- `packages/instrument/instrument-object.ts`：仪器数据对象。
- `packages/instrument/instrument-extension.ts`：内置仪器扩展入口。
- `packages/instrument/window/app-store.tsx`：仪器编辑器状态。
- `packages/instrument/window/app.tsx`：仪器窗口 UI。
- `packages/instrument/connection`：连接和 IPC。
- `packages/instrument/window/terminal`：终端。
- `packages/instrument/window/history`：历史记录。
- `packages/instrument/window/waveform`：波形。
- `packages/instrument/window/lists`：设备列表和任意波形。

连接实现：

- Ethernet：`connection/interfaces/ethernet.ts`
- Serial：`connection/interfaces/serial.ts`
- USB-TMC：`connection/interfaces/usbtmc.ts`
- VISA：`connection/interfaces/visa.ts` 和 `visa-dll.ts`

新增设备功能时，优先判断需求属于：

- 仅增加 IEXT 命令和面板。
- 增加仪器页面业务功能。
- 增加新的通信协议。
- 修改底层连接和数据收发。

前两类可以较快完成；后两类必须有协议文档、真实设备和异常场景测试。

### 5.9 扩展管理

#### 用户使用说明

在 `Extensions` 页面可以查看、安装、升级、重载和卸载扩展。

扩展类型：

| 类型 | 说明 |
|---|---|
| `built-in` | 内置模块 |
| `iext` | 仪器扩展 |
| `pext` | Project Editor 扩展 |
| `measurement-functions` | 测量函数扩展 |

#### 开发说明

主要文件：

- `packages/eez-studio-shared/extensions/extension.ts`：扩展接口。
- `packages/eez-studio-shared/extensions/extensions.ts`：加载、安装和卸载。
- `packages/home/extensions-manager`：扩展管理 UI。
- `packages/eez-studio-types/index.d.ts`：扩展开发公开类型。

扩展包通过 `package.json` 中的 `eez-studio` 字段声明入口，例如：

```json
{
    "name": "example-extension",
    "version": "1.0.0",
    "eez-studio": {
        "main": "extension.js"
    }
}
```

扩展默认通过 Node.js `require` 执行，因此扩展属于受信任本地代码。增加在线扩展源时，需要考虑来源校验、SHA256、权限和供应链安全。

### 5.10 快捷方式模块

#### 用户使用说明

快捷方式可以：

- 绑定键盘按键。
- 显示在工具栏。
- 执行单条或多条仪器命令。
- 执行 JavaScript 自动化脚本。
- 按分组管理。
- 从 IEXT 导入预定义快捷方式。

#### 开发说明

主要文件：

- `packages/shortcuts/shortcuts-store.ts`
- `packages/shortcuts/groups-store.ts`
- `packages/shortcuts/shortcuts.tsx`
- `packages/shortcuts/shortcut-dialog.tsx`
- `packages/home/shortcuts.tsx`
- `packages/instrument/window/shortcuts.tsx`

快捷方式数据保存在 SQLite 中。新增字段时必须增加数据库版本迁移，不能只修改 TypeScript 接口。

### 5.11 Notebook 模块

#### 用户使用说明

Notebook 用于收集和整理仪器历史条目。用户可以：

- 创建、删除和重命名 Notebook。
- 将选中的仪器历史记录加入 Notebook。
- 查看已删除内容。
- 导入或导出 `.eez-notebook` 文件。

#### 开发说明

主要文件：

- `packages/notebook/extension.ts`：Notebook 扩展入口。
- `packages/notebook/section.tsx`：Home 页面内容。
- `packages/notebook/store.ts`：SQLite Store 和迁移。
- `packages/notebook/import.tsx`：导入。
- `packages/notebook/export.tsx`：导出。

Notebook 通过扩展的 `homeSections` 动态加入 Home 标签系统，可以作为开发其他独立业务模块的参考实现。

### 5.12 测量函数与图表

#### 用户使用说明

仪器波形支持：

- Min、Max、Peak-to-Peak。
- Average、Period、Frequency。
- FFT 和谐波分析。
- 两条波形相加或相减。
- 图表缩放、游标、坐标轴和 CSV 导出。

#### 开发说明

主要目录：

- `packages/basic-measurements`：测量算法及扩展声明。
- `packages/eez-studio-ui/chart`：通用波形图表。
- `packages/instrument/window/waveform`：仪器波形业务。

新增测量函数通常需要：

1. 新增算法脚本。
2. 在 `basic-measurements-extension.ts` 注册函数。
3. 指定参数表单和结果类型。
4. 验证空数据、大数据量、采样间隔和单位。

通用图表核心文件较大，修改前应先确认需求能否通过现有配置实现。

### 5.13 数据库、设置与共享服务

#### 用户使用说明

设置页面可以管理：

- 浅色和深色主题。
- 活动数据库及数据库导入导出。
- 日期和时间格式。
- 项目模板仓库。
- 编辑器显示选项。

#### 开发说明

主要文件：

- `packages/main/settings.ts`：主进程设置。
- `packages/home/settings.tsx`：设置 UI。
- `packages/eez-studio-shared/db.ts`：数据库连接和数据库列表。
- `packages/eez-studio-shared/store.ts`：通用 Store。
- `packages/db-services`：数据库后台服务。
- `packages/eez-studio-shared/service.ts`：跨窗口服务机制。

数据存储分为：

- Electron 用户设置文件。
- 浏览器 `localStorage`。
- SQLite 数据库。
- `.eez-project` 文件。

新增数据前应先确定其生命周期：

- 单页面临时状态：React/MobX。
- 本机 UI 偏好：`localStorage` 或设置文件。
- 可查询业务数据：SQLite。
- 随项目分发的数据：`.eez-project`。

### 5.14 构建、打包与发布

#### 用户使用说明

普通用户使用发行版，无需手动构建。开发或发布人员使用以下命令。

完整编译：

```bash
npm run build
```

启动：

```bash
npm start
```

生成当前平台发行包：

```bash
npm run dist
```

macOS Apple Silicon：

```bash
npm run dist-mac-arm64
```

macOS Intel：

```bash
npm run dist-mac-x64
```

#### 开发说明

构建组成：

1. TypeScript 编译到 `build`。
2. Gulp 复制资源并压缩 JavaScript。
3. Less 编译浅色和深色主题。
4. 复制 Flow WASM。
5. 复制 LVGL 图片转换工具。
6. 生成 Electron Builder 配置。
7. Electron Builder 打包。

主要文件：

- `package.json`
- `gulpfile.js`
- `installation/make-electron-builder-yml.ts`
- `installation/notarize*.js`
- `entitlements.mac.plist`

发布前应分别检查：

- 原生模块是否针对目标 Electron 版本重建。
- macOS 签名和公证。
- Windows 安装包和驱动权限。
- Linux USB 权限。
- 用户数据升级和数据库迁移。

## 6. 二开开发规范

### 6.1 普通 UI 功能

- 优先复用 `packages/eez-studio-ui`。
- 遵循现有 MobX Store 和 `observer` 模式。
- 不为了单个页面引入新的全局状态库。
- API 或文件操作需要判断应该放渲染进程还是主进程。

### 6.2 Project Editor 功能

- 数据修改必须进入撤销重做命令。
- 新类和新属性必须处理注册与序列化。
- 保持旧 `.eez-project` 兼容。
- 新功能应增加项目检查和错误提示。
- 涉及构建输出时，同时验证编辑器和生成代码。

### 6.3 数据库功能

- SQLite 表结构调整必须有版本迁移。
- 避免在 React render 中直接执行查询。
- 大量数据需要分页、批量查询或事务。
- 导入前验证数据库版本和文件格式。

### 6.4 硬件功能

- 必须提供协议文档和真实设备。
- 需要覆盖断线、超时、半包、重连和异常响应。
- 不在 UI 线程中执行长时间阻塞操作。
- 明确 Windows、macOS 和 Linux 的驱动差异。

### 6.5 安全要求

- 不直接渲染来自网络的未清洗 HTML。
- 不从不可信地址加载可执行扩展。
- 不在渲染进程保存明文密钥。
- 新增在线能力时重新评估 Electron 安全配置。

## 7. 二开难度分级

| 等级 | 功能类型 | 典型改动 |
|---|---|---|
| L1 | 纯 UI | 文案、主题、Logo、布局、菜单 |
| L2 | 普通业务 | 页面、表单、列表、API、图表 |
| L3 | 桌面能力 | IPC、文件、SQLite、系统功能 |
| L4 | 编辑器能力 | 项目资源、属性面板、Flow 组件 |
| L5 | 底层能力 | LVGL 代码生成、WASM、硬件协议 |

风险从低到高主要由以下因素决定：

- 是否修改 `.eez-project` 数据结构。
- 是否需要旧项目兼容。
- 是否进入撤销重做和复制粘贴系统。
- 是否修改 WASM 或 C/C++ 生成代码。
- 是否依赖真实硬件。
- 是否需要跨平台打包发布。

## 8. 快速迭代二开周期

以下周期按照当前合作方式估算：

- 需求和验收标准由业务负责人快速确认。
- 开发、代码检索、构建和问题修复由 AI 辅助完成。
- 优先在当前 macOS 环境交付可演示版本。
- 可演示版本通过后，再补稳定性和跨平台验证。
- 首期不进行无关架构重构和大规模依赖升级。

| 功能范围 | 可演示版本 | 稳定版本 |
|---|---:|---:|
| Logo、主题、菜单、文案 | 0.5～1 天 | 1～2 天 |
| 独立页面、表单、列表 | 1～2 天 | 2～4 天 |
| API 接入和数据展示 | 1～3 天 | 3～5 天 |
| SQLite、本地文件功能 | 2～3 天 | 3～6 天 |
| Electron IPC、系统能力 | 2～4 天 | 4～7 天 |
| 仪器管理页面功能 | 3～5 天 | 5～10 天 |
| 新增普通 Flow 组件 | 3～7 天 | 1～2 周 |
| 新增 LVGL 控件 | 5～10 天 | 2～3 周 |
| 新设备或通信协议 | 1～2 周 | 2～4 周 |

整体周期参考：

| 二开规模 | 周期 |
|---|---:|
| 小型：品牌修改 + 1～2 个普通页面 | 3～7 个工作日 |
| 普通一期：多个页面 + API/SQLite | 1～2 周 |
| 中型：业务模块 + Electron 能力 + 打包 | 2～4 周 |
| 核心型：Flow/LVGL/设备协议 | 3～6 周 |

周期不包含以下不可控等待时间：

- 需求反复调整。
- UI 设计稿未确定。
- API 或设备协议未提供。
- 真实设备不到位。
- 第三方账号、证书和签名审批。

## 9. 推荐协作流程

每个功能按以下节奏执行：

1. 业务负责人描述目标和用户操作流程。
2. 明确输入、输出、异常情况和验收标准。
3. 开发前确认修改模块、风险和可演示时间。
4. 先交付最小可演示版本。
5. 业务负责人当天反馈。
6. 完善边界、错误处理和持久化。
7. 执行构建和相关业务回归。
8. 汇总修改文件、验证结果和遗留风险。

需求建议使用以下模板：

```markdown
## 功能名称

### 使用场景

### 用户操作流程

### 页面或交互参考

### 输入与输出

### 异常情况

### 数据保存方式

### 是否涉及设备/API

### 验收标准

### 目标平台
```

## 10. 基础回归清单

普通改动至少检查：

- 应用能够启动。
- Home 页面导航正常。
- 标签页打开、切换和关闭正常。
- 设置修改后能够保存。
- 浅色和深色主题显示正常。
- 完整 `npm run build` 通过。

Project Editor 改动额外检查：

- 新建项目。
- 打开旧项目。
- 保存和重新打开。
- 撤销和重做。
- 复制和粘贴。
- 项目检查。
- 模拟运行。
- 构建输出。

仪器改动额外检查：

- 连接和断开。
- 超时和失败提示。
- 命令发送与响应。
- 历史记录。
- 应用退出时连接释放。
- 无设备情况下不导致应用崩溃。

## 11. 当前工程风险

### 自动化测试不足

仓库当前没有常规单元测试和集成测试脚本，核心功能主要依赖构建检查与人工回归。

### Electron 安全配置较宽松

Node Integration、Remote 和 Web Security 配置使本地开发方便，但新增在线内容时风险较高。

### 原生模块

SQLite、串口、USB 和 VISA 依赖 Electron 原生模块，升级 Electron 或 Node 后可能需要重新适配。

### 超长核心文件

部分 Project Editor、Flow、LVGL 和图表文件达到数千行，修改前必须先追踪注册、运行时和构建链路。

### 依赖安全告警

当前依赖树存在上游安全告警。依赖升级应单独安排，不建议直接执行破坏性 `npm audit fix --force`。

### GPL v3

EEZ Studio 桌面应用采用 GPL v3。对修改版本进行对外分发前，应确认对应的源码披露和许可证义务。项目生成代码有单独说明，必要时应由法务确认。

## 12. 关键代码索引

| 目标 | 文件或目录 |
|---|---|
| Electron 入口 | `packages/main/main.ts` |
| 窗口管理 | `packages/main/window.ts` |
| 系统菜单 | `packages/main/menu.ts` |
| Home 入口 | `packages/home/main.tsx` |
| Home 导航 | `packages/home/home-tab.tsx` |
| 标签页系统 | `packages/home/tabs-store.tsx` |
| 全局设置 | `packages/home/settings.tsx`、`packages/main/settings.ts` |
| 项目编辑器初始化 | `packages/project-editor/project-editor-create.tsx` |
| 项目 Store | `packages/project-editor/store/index.ts` |
| 序列化 | `packages/project-editor/store/serialization.ts` |
| 撤销重做 | `packages/project-editor/store/undo-manager.ts` |
| 项目特性 | `packages/project-editor/store/features.ts` |
| Flow 组件 | `packages/project-editor/flow/components` |
| Flow 运行时 | `packages/project-editor/flow/runtime` |
| LVGL 控件 | `packages/project-editor/lvgl/widgets` |
| LVGL 构建 | `packages/project-editor/lvgl/build.ts` |
| 仪器连接 | `packages/instrument/connection` |
| 仪器界面 | `packages/instrument/window` |
| 扩展系统 | `packages/eez-studio-shared/extensions` |
| SQLite | `packages/eez-studio-shared/db.ts` |
| 通用 UI | `packages/eez-studio-ui` |
| 快捷方式 | `packages/shortcuts` |
| Notebook | `packages/notebook` |
| 测量函数 | `packages/basic-measurements` |
| 构建命令 | `package.json` |
| 打包配置生成 | `installation/make-electron-builder-yml.ts` |

---

本文档作为后续二开的基础手册。每完成一个新业务模块，应同步补充其用户操作、开发入口、数据结构、验收方式和实际开发周期。
