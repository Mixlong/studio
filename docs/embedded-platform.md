# 嵌入式平台模块使用说明

本模块对应需求第五章 5.1～5.5，配置保存在工程的 `embeddedPlatform` 节点。它提供 Studio 侧的统一配置和命令适配层；具体 BSP、工具链和下载器参数仍由目标板工程提供。

## 5.1 现有功能完善

- 组件面板支持按 Widget/Action 隐藏不常用组件。组件类名加入 `Component Visibility` 后，Palette 和新增组件对话框都会过滤它。
- 原有 PropertyGrid 继续负责控件属性编辑；LVGL 额外暴露 `ProjectEditor.getLVGLWidgetPropertyInterface` 和 `ProjectEditor.updateLVGLWidgetProperty`，供插件或自定义面板读取、修改属性。
- 编辑器、仿真和调试模式使用独立的内容实例切换，模式返回时强制重建布局，避免残留白屏。

## 5.2 资源管理

`Resource Storage` 可启用统一的 ROM、External Flash XIP、External Flash non-XIP 三态。

- 图片资源会按工程中的 Bitmap 顺序自动布局，并生成 `image-manifest.json` 和 `image-data.h`。ROM 生成 `image-data.c` 内嵌 C 数组；XIP 生成带 `Image XIP section attribute` 的 C 数组；non-XIP 额外生成 `image.bin`。XIP/non-XIP 需要在 `Resource Storage` 中配置图片基地址、分区大小和对齐值。
- 字体 ROM 生成 C 源码；non-XIP 生成 BIN；LVGL 9 的 XIP 生成 `eez_get_xip_font_data` 钩子并调用 `lv_binfont_create_from_buffer`。
- 音频资源保存在项目 `audio/` 文件夹。WAV 可直接打包或转成 8/16-bit signed/unsigned PCM；MP3 通过 Python 转换脚本输出 RAW PCM。Build 生成音频镜像和 `audio-manifest.json`，其中记录 Flash 地址、长度、格式和布局。

图片构建产物中的资源记录包含名称、宽高、色深、数据长度、相对偏移和绝对 Flash 地址。图片数据本身不改变原有 Bitmap 的颜色格式转换逻辑，直接使用 Studio 构建时得到的像素数据。

## 5.3 通讯协议

`Protocol Center` 支持：

- 本地协议列表筛选；
- 按电池、控制器等分类切换协议子标签；
- 配置云端 Endpoint 后搜索云端协议；
- 导入本地或云端协议到项目 `protocol/` 文件夹；
- 勾选参与构建，点击同步生成协议资源清单。

云端接口约定返回数组，或 `{ "items": [...] }` / `{ "protocols": [...] }`；每项至少包含 `name`、`category`、`downloadUrl`（也接受 `url` 或 `fileUrl`）。

## 5.4 交叉编译

在 `Embedded Platform` 页签配置 BSP 信息、CMakeLists、Toolchain、Python 脚本和输出目录。默认输出目录为 `build`，与第 5.7 节 WebSocket `build.dst` 的 `./build` 约定一致；也可以在面板中改成其他相对目录。`Build Firmware` 窗口执行：

1. 调用现有 EEZ 资源构建；
2. 同步构建输出中的图片、字体产物以及项目 `audio/`、`protocol/` 文件，并生成包含四类资源清单的 `embedded-resources.json`、`embedded-resources.cmake` 和可被 Makefile include 的 `embedded-resources.mk`；
3. 若配置 Python 脚本，执行 `python script --project <dir> --output <dir>`；否则执行 `cmake -S/-B` 和 `cmake --build`；
4. 在 Output 面板显示命令、日志和百分比，并支持停止。

已有 CMakeLists 或 Makefile 会在标记区间内自动更新资源清单引用，手工修改标记外内容不会被覆盖。

## 5.5 固件下载

`Download Firmware` 窗口支持 JLink、STLink、DPlink：

- Detect 检查配置的外部命令；
- 可选择 BIN/HEX/ELF，未选择时自动查找输出目录中的 `firmware.*` 或 `app.*`；
- 地址偏移支持十进制或十六进制；
- 自定义参数支持 `{firmware}`、`{offset}`、`{target}`、`{interface}`、`{speed}`、`{output}` 占位符；
- 下载过程输出到 Output 面板，并可停止。

默认命令参数只是通用适配器。量产使用前必须按 BSP 核对芯片型号、接口、探针驱动、固件格式和地址布局。

## 5.6 第 5.7 节 WebSocket 命令适配

`Middleware WebSocket` 面板用于启用 Studio 与中间件之间的 WebSocket 通道。默认关闭，关闭时沿用本地 Python/CMake、下载器 CLI 适配；启用后，Build、Detect/Download 和 Resource Transform 会发送第 5.7 节定义的 JSON 命令。

WebSocket 地址按环境分开保存：

- `Local / Debug`：默认 `ws://192.168.124.144:8765`，对应当前调试机 WiFi IPv4 地址；端口 `8765` 是当前默认假设，如 Middleware 使用其他端口需在面板中修改；
- `Production`：单独填写正式环境地址，默认留空，切换到 Production 前必须配置；
- 当前只有选中的环境地址会被使用，切换环境不会覆盖另一套地址。

当前发送的命令结构为：

- `test`：`{ "command": "test", "msg": "..." }`
- `log`：中间件返回 `{ "command": "log", "data": "..." }` 时写入 Output 面板，并识别日志中的百分比进度；
- `build`：包含 `src`、`dst`；
- `download`：包含 `interface`、`target`、`speed`、`firmware`、`addr`；
- `transform`：包含 `type`、`model`。

发送前会校验第 5.7 节要求的字段，JSON 解析和传输失败会显示在 Output 面板。当前文档没有规定请求 ID、执行完成响应、错误码和停止命令，因此这一版将“发送成功”作为 Studio 侧命令提交成功；Middleware 的实际执行过程通过 `log` 消息回传。待中间件补充响应契约后，再增加请求级状态和取消操作。

## 验证边界

源码和样式构建可以在没有硬件的环境完成；真实 CMake 编译需要目标 BSP/工具链，真实烧录需要安装对应下载器 CLI 并连接目标板。当前实现没有假设某个 MCU 或厂商命令格式。

## 完整 P1 本机 Demo

仓库提供了一个仅用于开发验证的本机 Middleware：`tools/embedded/demo-middleware.js`。它不执行真实烧录，但会按第 5.7 节接收 `test`、`transform`、`build`、`download`，回传 `log` 进度，并在 `./build/firmware.bin` 生成一个演示固件。

在 Studio 工程目录对应的终端启动（把 `<project-dir>` 换成已保存的 Studio 工程目录）：

```bash
npm run demo-middleware -- --root "<project-dir>"
```

本机 Demo 时，Studio 的 Local / Debug 地址填 `ws://127.0.0.1:8765`。然后在 `Protocol Center` 导入 `tools/embedded/demo-assets/demo-protocol.json`，确认工程下出现 `protocol/demo-protocol.json`（或重名后的文件），再依次点击 `Detect`、`Transform`、`Start Build` 和 `Download`。下载时选择 `<project-dir>/build/firmware.bin`；日志中的 0/50/100% 会更新 Studio 进度条。`npm run verify-demo-middleware` 可在不打开 UI 的情况下自动验证同一条闭环。

该 Demo 只证明 Studio 与第 5.7 协议的完整交互；要验证真实编译器、探针和目标板，仍需把地址切回 Windows Middleware，并使用真实 BSP、固件和下载参数。

## 完整 P1 本机 Demo

仓库提供了一个仅用于开发验证的本机 Middleware：`tools/embedded/demo-middleware.js`。它不执行真实烧录，但会按第 5.7 节接收 `test`、`transform`、`build`、`download`，回传 `log` 进度，并在 `./build/firmware.bin` 生成一个演示固件。

在 Studio 工程目录对应的终端启动（把 `<project-dir>` 换成已保存的 Studio 工程目录）：

```bash
npm run demo-middleware -- --root "<project-dir>"
```

本机 Demo 时，Studio 的 Local / Debug 地址填 `ws://127.0.0.1:8765`。然后在 `Protocol Center` 导入 `tools/embedded/demo-assets/demo-protocol.json`，确认工程下出现 `protocol/demo-protocol.json`（或重名后的文件），再依次点击 `Detect`、`Transform`、`Start Build` 和 `Download`。下载时选择 `<project-dir>/build/firmware.bin`；日志中的 0/50/100% 会更新 Studio 进度条。`npm run verify-demo-middleware` 可在不打开 UI 的情况下自动验证同一条闭环。

该 Demo 只证明 Studio 与第 5.7 协议的完整交互；要验证真实编译器、探针和目标板，仍需把地址切回 Windows Middleware，并使用真实 BSP、固件和下载参数。
