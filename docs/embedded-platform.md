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

云端接口约定返回数组，或 `{ "items": [...] }` / `{ "protocols": [...] }`。每项需要提供 `name` 或 `title`，`category` 可选（缺省为 `Uncategorized`），并需要提供 `downloadUrl`、`url` 或 `fileUrl` 之一作为下载地址。Studio 会把这些字段归一化为 `name`、`category`、`downloadUrl`。

## 5.4 交叉编译

在 `Embedded Platform` 页签配置 BSP 信息、CMakeLists、Toolchain、CMake 配置文件、Python 脚本和输出目录。默认输出目录为 `build`，与本节本地 CLI 的约定一致。启用 WebSocket 后，Build Firmware 窗口改为维护 Middleware 服务器上的工程路径，不再要求在本机选择 `.py` 文件。

1. 本地模式调用现有 EEZ 资源构建并同步资源清单；
2. WebSocket 模式直接向 Middleware 发送 `cmake`，再发送 `build`，工程和构建目录均使用远端表单中的服务器路径；
3. 在 Output 面板显示命令、日志和百分比，并支持停止本地进程。

已有 CMakeLists 或 Makefile 会在标记区间内自动更新资源清单引用，手工修改标记外内容不会被覆盖。

## 5.5 固件下载

`Download Firmware` 窗口在本地模式支持 JLink、STLink、DPlink：

- Detect 检查配置的外部命令；
- 可选择 BIN/HEX/ELF，未选择时自动查找输出目录中的 `firmware.*` 或 `app.*`；
- 地址偏移支持十进制或十六进制；
- 自定义参数支持 `{firmware}`、`{offset}`、`{target}`、`{interface}`、`{pack}`、`{script}`、`{frequency}`、`{speed}`、`{output}` 占位符；其中 `{speed}` 仅保留给本地 CLI 兼容路径。
- 下载过程输出到 Output 面板，并可停止。

默认命令参数只是通用适配器。量产使用前必须按 BSP 核对芯片型号、接口、探针驱动、固件格式和地址布局。

## 5.6 WebSocket 命令适配

`Middleware WebSocket` 面板用于启用 Studio 与中间件之间的 WebSocket 通道，默认启用。关闭时沿用本地 Python/CMake、下载器 CLI 适配；启用后，Build、Detect/Download 和 Resource Transform 会发送本节定义的 JSON 命令。启用后，构建和下载窗口只显示远端工程、远端构建目录、远端配置文件和远端固件路径，不打开本地文件选择器。

WebSocket 地址按环境分开保存：

- `Local / Debug`：默认 `ws://192.168.124.144:8765`，对应当前调试机 WiFi IPv4 地址；端口 `8765` 是当前默认假设，如 Middleware 使用其他端口需在面板中修改；
- `Production`：单独填写正式环境地址，默认留空，切换到 Production 前必须配置；
- 当前只有选中的环境地址会被使用，切换环境不会覆盖另一套地址。

项目中的 `embeddedPlatform.websocket` 字段为：`enabled`、`environment`、`localEndpoint`、`productionEndpoint` 和 `connectTimeoutMs`。连接超时默认 5000 ms，最小允许值为 100 ms。

启用远端模式后，路径保存在 `embeddedPlatform.remote`：`remote.build.projectDirectory` 对应 `cmake.output_dir` 和 `build.src`，`remote.build.configFile` 对应 `cmake.config_file`，`remote.build.outputDirectory` 对应 `build.dst`；`remote.download.firmwarePath` 对应 `download.firmware`，其余下载字段直接对应 `target`、`pack`、`script`、`frequency` 和 `addr`。这些值不经过本机文件系统检查。

当前 DigiRide 工程已预置同事提供的 MH2457 远端参数：项目目录为 `D:/__PRJ__/S350_EEZ`，CMake 配置为 `D:/__PRJ__/S350_EEZ/cmake_config_MH2457.py`，构建目录为 `D:/__PRJ__/S350_EEZ/build`，目标为 `mh2457`，频率为 `500000`，固件为 `D:/__PRJ__/S350_EEZ/build/HMI_MH2457.bin`，地址偏移为 `0x08001000`。这些是 Middleware 服务器路径，不是本机路径。

当前发送的命令结构为：

- `test`：`{ "command": "test", "msg": "..." }`
- `log`：中间件返回 `{ "command": "log", "data": "..." }` 时写入 Output 面板，并识别日志中的百分比进度；
- `cmake`：`{ "command": "cmake", "output_dir": "<remote-project>", "config_file": "<remote-project>/config_xxx.py" }`；用于让 Middleware 根据目标板配置准备 CMake 工程；
- `build`：包含 `src`、`dst`；
- `download`：包含 `target`、`pack`、`script`、`frequency`、`firmware`、`addr`；`firmware` 是 Middleware 服务器上的固件路径，不是本机路径；`frequency` 为 Hz 字符串，例如 `"500000"` 表示 500 kHz；
- `transform`：包含 `type`、`model`，其中 `type` 为 `picture`、`font` 或 `audio`，`model` 为 `rom`、`romxip` 或 `flashnormal`。

发送前会校验本节要求的字段，JSON 解析和传输失败会显示在 Output 面板。对于远端构建，Studio 会等待 Middleware 日志报告 `cmake` 阶段完成后再发送 `build`，并等待 `build` 阶段完成；Middleware 需要返回包含阶段名称和成功/失败标记的结束日志，例如 `cmake completed`、`build completed` 或 `OK 成功生成 ... CMakeLists.txt`。外部 Middleware 仍未提供请求 ID、结构化执行完成响应、错误码和停止命令，WebSocket 模式下的 Stop 目前不能真正取消远端任务。

要闭环实现完成、失败和停止，建议由后端确认并实现下面的契约：

- Studio 给 `build`、`download`、`transform`、`test` 命令增加唯一 `id`；日志回传 `{ "command": "log", "id": "...", "data": "...", "progress": 0 }`，其中 `progress` 为可选的 0～100 数字。
- Middleware 在任务结束时回传 `{ "command": "result", "id": "...", "state": "completed" | "failed" | "stopped" }`；失败时增加 `errorCode` 和 `errorMessage`。
- Studio 取消任务时发送 `{ "command": "stop", "id": "..." }`；Middleware 回传 `state: "stopped"`，无法停止时回传 `state: "failed"` 及错误信息。
- `id` 应贯穿日志、结果和停止请求，避免多个工程或多个任务的消息串线。

这组字段是待确认的后端接口，不应在未与 Middleware 开发方确认前直接视为已完成能力。

## 验证边界

源码和样式构建可以在没有硬件的环境完成；真实 CMake 编译需要目标 BSP/工具链，真实烧录需要安装对应下载器 CLI 并连接目标板。当前实现没有假设某个 MCU 或厂商命令格式。

## 完整 P1 本机 Demo

仓库提供了一个仅用于开发验证的本机 Middleware：`tools/embedded/demo-middleware.js`。它不执行真实烧录，但会按本节接收 `test`、`transform`、`cmake`、`build`、`download`，回传 `log` 进度，并在 `./build/firmware.bin` 生成一个演示固件。

在 Studio 工程目录对应的终端启动（把 `<project-dir>` 换成已保存的 Studio 工程目录）：

```bash
npm run demo-middleware -- --root "<project-dir>"
```

本机 Demo 时，Studio 的 Local / Debug 地址填 `ws://127.0.0.1:8765`。然后在 `Protocol Center` 导入 `tools/embedded/demo-assets/demo-protocol.json`，确认工程下出现 `protocol/demo-protocol.json`（或重名后的文件），在远端构建设置中填入 Demo 根目录、配置文件、构建目录和固件路径，再依次点击 `Detect`、`Transform`、`Start Remote Build` 和 `Download Remotely`。`npm run verify-demo-middleware` 可在不打开 UI 的情况下自动验证同一条命令闭环。

该 Demo 只证明 Studio 与当前第 5.6 协议的命令提交和日志交互；要验证真实编译器、探针、任务完成回执和目标板，仍需接入已确认新契约的 Middleware，并使用真实 BSP、固件和下载参数。

当前 `download` 协议表示“让 Middleware 使用服务器上的固件执行烧录”，不表示把固件或工程文件回传到 Studio 当前目录。若产品还需要“远端构建完成后把目录/固件下载回本机”，需要 Middleware 另行提供文件传输契约，不能用现有 `download.firmware` 字段推断。
