# DigiwiseStudio MCP 画布与 WASM 预览验收（2026-11-11）

## 结论与边界

**已通过：** 新版 Electron IDE 实际运行中的独立演示工程，MCP 可以通过标准 Stdio 协议获取编辑器活动 LVGL Canvas PNG；能经本地写入确认启动原生 WASM Runtime、查询实际运行状态，再停止并恢复编辑器画布。源码/模拟自动化和 Windows 打包 MCP 协议测试同时通过。

**未完成：** 运行中模拟器画面的帧读取、模拟点击/触摸、自动视觉差异评分、完整 Docker Simulator、Toolchain/设备识别/Download。不能把编辑画布的 PNG 作为 WASM 实时运行画面或物理设备验收证据。

## 真实运行证据

测试工程：`artifacts/mcp-acceptance/run-20261110_080438-n8mWSj/MCP_Acceptance.eez-project`（用户现有项目未做写入测试）。

| 测试步骤 | 结果 | 证据 |
| --- | --- | --- |
| 正常关闭并重新启动新版 IDE | PASS | 旧主窗口通过 CloseMainWindow 自然退出；新 IDE 加载隔离测试工程 |
| MCP 能力发现 | PASS | 18 read / 36 write，原生 Preview API 与 Canvas API 已注册 |
| LVGL 画布截图 | PASS | `get_active_page` → `get_canvas_snapshot({pageId})`，Page=Main，PNG=800×480，10633 bytes |
| 图像范围保护 | PASS（模拟回归） | 旧页面 ID、其他工程、多个可见 Canvas、Run Mode、PNG 超限均被拒绝 |
| MCP Stdio 图片内容 | PASS | MCP Content 含 `image/png` 图像块及独立元数据；真实 Stdio→Bridge→Renderer 全链验证 |
| 画面/组件树对应 | PASS | 画面中央呈现 “Hello, world!”；`list_widgets(Main)` 中的 LVGLLabelWidget 为 x=356,y=232,w=89,h=16 |
| 启动预览 | PASS | `start_preview` 返回 `requested=true`，mode=wasm；通过本地授权 |
| 预览实际运行 | PASS | `get_preview_status` 返回 `state=running`，`selectedPage=Main`，`error=null` |
| 停止预览 | PASS | `stop_preview` 返回 `stopped=true`，轮询后 `state=idle` |
| 返回编辑器 | PASS | 仍能抓取 800×480 编辑画布 PNG，工程 `modified=false` |
| 自动化构建/回归 | PASS | `npm run build-src`、`npm run verify-mcp`（包含 Stdio 图像协议） |
| Windows 打包协议 | PASS | 最终版本 `npm run pack && npm run verify-mcp-packaged` 均退出码 0；ASAR 与打包版 MCP 18 read / 36 write 注册完整 |

PNG：`artifacts/mcp-acceptance/canvas-v2-stdio-live.png`  
Stdio 真实验收结构化报告：`artifacts/mcp-acceptance/canvas-v2-stdio-live-report.json`  
命令：`node packages/mcp/test-live-canvas.cjs`（实际运行中，只读）

## 产品使用步骤

1. 用户开启 **Settings → Integrations → MCP Server**，不需要第二个写入开关。
2. AI 调用 `get_current_project` 确认实际工程，使用 `get_active_page` 获取活动 `pageId`。
3. AI 调用 `get_canvas_snapshot({pageId})` 获得当前 LVGL **编辑画布** PNG，结合 `list_widgets` 与 `get_widget_schema` 分析实际视觉与属性差异。
4. 工程保存且本地用户授权之后，AI 才可调用 `start_preview({expectedProjectPath})`；持续调用 `get_preview_status()` 确认真正的运行/错误状态。
5. AI 调用 `stop_preview({expectedProjectPath})`，确认回到 idle，然后才能继续编辑。
6. 预览运行期间一律拒绝其他 MCP 工程写操作，不会通过任意脚本或系统屏幕截图绕过安全保护。

**风险说明：** 预览状态 `running` 表示本地 Runtime 正在运行，不证明某个 Flow 事件被真实触发。后续必须增加受限的运行画面读取与事件交互才能完成 AI 自动视觉功能验收。
