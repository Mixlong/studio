# DigiwiseStudio MCP — WASM 预览帧与受控点击验收（2026-11-11）

## 本轮范围
本轮在原有 **18 个读取 / 36 个写入** MCP 工具基础上新增：
- `get_preview_snapshot({pageId})`：从当前活动、真正运行中的 WASM Runtime 所绑定的 LVGL Canvas 读取 PNG，最多 1024px/边、135 万 base64 字符。必须先调用 `get_preview_status` 获取 `selectedPageId`。不允许截图桌面、用户账号、设置面板、其他项目、Docker 模拟器或不可见 Canvas。
- `preview_tap({expectedProjectPath,pageId,x,y})`：经 DigiwiseStudio 本地写入授权后，仅向当前项目 WASM Runtime 的原生 pointerEvents 队列发送一次按下和松开；坐标限定在当前运行页面内；设置 300ms 防连点。不会对 OS 桌面注入鼠标或执行脚本。
- `get_preview_status` 增加 `selectedPageId` 和 `previewFrameAvailable`。一次 tap 返回 `dispatched=true` 只表示输入进入原生队列，**不等于某个按钮事件或业务逻辑已经执行成功**，仍要读取新的一帧并比较。

## 真实环境验收边界
- **已通过的上一阶段**：2026-11-11 独立演示工程的 WASM start→running→stop→idle 和 LVGL 编辑画布 800×480 PNG；本轮不重新冒充。
- **本轮已通过**：TypeScript 编译、MCP 协议工具注册，Native Runtime DOM 所有权、旧 pageId、非 WASM、隐藏/重复 Canvas、图片大小、非法坐标、按下/松开及点击限速的自动化回归。模拟桥接已确认两种截图均作为 MCP `image/png` 内容块返回。Windows 重新打包后，打包版 MCP 19 读/37 写注册通过。
- **打包风险发现与保护**：第一次 Windows 打包的 ASAR 中，部分 MCP 脚本字节内容与 build 文件不一致，导致打包 Stdio 入口 SyntaxError；单独重新打包后恢复，并在加入主进程/客户端版本握手后再次完整打包，`verify-mcp-packaged` PASS。已强化 `test-packaged.cjs` 逐字节核对 Stdio 入口、Bridge、Protocol、Renderer Agent 和预览交互模块，避免发布时仅检查文件存在而漏掉坏包。此现象的精确并发/打包根因尚未确认。
- **新旧进程混用问题与修复**：当前 IDE 的 Renderer 热更新后会显示新能力清单（19 读/37 写），但 Main 进程仍是旧版，调用 `get_preview_snapshot` 实际返回 `INVALID_ARGUMENT`。已在 Main 写入的 `mcp-session.json` 新增 `registryVersion=mcp-2026-11-11-r19w37`，Stdio Bridge 逐请求校验，缺失或不一致时立即报“完整重启 IDE”，杜绝假可用；真实验证旧 Main 已被拦截。对应模拟 Main/Bridge 回归已通过。
- **本轮真实 IDE 结果（已完成）**：旧 Main 正常退出后，在新版 IDE 的独立工程中真实读取并验证 `get_preview_snapshot`、`preview_tap`。进一步新建 `flow-click-0U44vr/Flow_Click_MCP.eez-project`，由 MCP 创建 Button、Success 页、Flow Action 和 CLICKED 事件绑定，保存后启动 WASM 点击，运行页切换到 Success；等待两次稳定 PNG 后实际画面变化 **4.392%**，并看到 `SUCCESS` 文字。随后 stop→idle，工程 modified=false。接着 Check 和 Build 均成功（0 错误、0 警告），生成 screens.c/screens.h/actions.h/ui.c/ui.h。
- **真实 E2E 测试脚本**：`npm run verify-mcp-live-flow`，每次新建独立 LVGL 工程并通过本地授权完成创建、事件绑定、保存、启动、点击、稳定 PNG 对比、停止、Check/Build 和工程未修改确认。完整证据：`artifacts/mcp-acceptance/flow-click-0U44vr/acceptance.json`、`before.png`、`after.png`。另有只验证输入队列的 `node packages/mcp/test-live-preview-interaction.mjs --execute`，它不代表业务事件已触发。
- **提前截图误判已纳入防护**：第一次按按钮后，Runtime 已报告 Success，但立刻取得的 PNG 仍是 Main + 按下色。诊断采样在页面状态变化后的约 350ms 起呈现稳定 Success，明显变化像素 4.392%。验收脚本现要求目标页画面变化 >=3% 且连续两帧 PNG SHA-256 一致，不再以 `selectedPage` 或单帧 Hash 判定成功。此像素阈值仅用于受控演示工程，不能普遍用于所有界面。

## 仍缺少
多指触摸、拖拽/滑动、键盘模拟、运行日志、复杂 IsTrue/CallAction/变量数据流的真实执行验收、通用视觉差异规则、Docker 模拟器的画面与交互、Toolchain/Download 和跨 LVGL 版本实际验证。不能因为工具注册或者单元测试成功便宣称 AI 全流程完成。
