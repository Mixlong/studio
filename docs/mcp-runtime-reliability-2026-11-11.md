# DigiwiseStudio MCP 本地运行稳定性修复与验收（2026-11-11）

## 背景及已观察现象

本地曾发生 Windows Chromium `process_singleton_win.cc:446`，`Lock file can not be created! Error code: 32`，随后确认旧 Electron Main 进程仍在，但没有可见主窗口；MCP `get_current_project` 与 `get_preview_status` 连续返回 `IPC_TIMEOUT`。已有进程使用 `%APPDATA%\\DigiwiseStudio` 的用户数据目录，不能在运行时直接清除其锁文件。

**注意：** 此错误说明目录或锁被占用，并不自动证明数据损坏；也不应绕过保存确认强制关闭用户的 IDE。

## 本轮源码修复

1. `packages/main/window.ts`：主窗口仅在**其他独立可见窗口**存在时才允许 hideOnClose，否则走现有 beforeClose → readyToClose 保存确认路径。避免仅因窗口列表含隐藏窗口而隐藏最后一个编辑窗口。
2. `packages/main/home-window.ts`：传入临时 `showHidden` 等参数时，不再使用 `Object.assign(HOME_WINDOW_PARAMS, params)` 改写全局默认对象。
3. `packages/mcp/main-server.ts`：
   - 窗口已销毁、隐藏、Renderer 崩溃或主框架正在加载时，MCP 直接返回 `IPC_UNAVAILABLE`，避免每次请求等待完整 IPC 超时时长。
   - Electron 窗口 `closed`、WebContents `destroyed` 或 `render-process-gone` 时停止本地 MCP Server，撤销会话写入授权并按 token 校验清理自己的会话文件。
   - 连续两次 Renderer 请求超时会关闭无效 MCP 会话；一旦有合法响应就将超时计数归零。不会退出 IDE 或删除任何工程。
4. `packages/mcp/doctor.mjs`：新增 `npm run doctor-mcp`，只读检查会话文件、Main PID 存活（signal=0）、工具注册版本以及只读 `get_mcp_capabilities` 是否可响应。**不会调用 taskkill、删除锁文件或暴露 MCP token**；可用 `npm run doctor-mcp -- --json` 输出结构化结果。

## 自动化检查

- `npm run build-src`：通过。
- `npm run verify-mcp`：通过，包含新建 `test-window-lifecycle.cjs`、`test-doctor.cjs` 与扩展 `test-main-bridge.cjs` 的 Renderer crash、窗口关闭、隐藏窗口快速拒绝测试。
- `npm run pack && npm run verify-mcp-packaged`：Windows 打包及 ASAR 字节完整性校验通过；MCP 工具仍为 19 read / 37 write。
- `npm run doctor-mcp -- --json`：最后一次诊断得到 `session=present`, `process=alive`, `registryMatches=true`, `bridge=responsive`，工具 19 read / 37 write。后续只读调用 `get_current_project` 返回 `NO_ACTIVE_PROJECT`，说明当时 IDE 主窗口可响应，但用户未选中 LVGL 工程。

## 仍需真实 UI 验收

1. 当前已启动的 Main 进程不等于已经加载本轮修复后的代码。先保存所有现有工程，再**正常退出应用并从更新后的构建启动**，不要仅刷新 Renderer。
2. 打开 IDE、关闭最后一个可见窗口，确认正常走保存提示并结束主进程；再次执行 `npm start` 不再遇到隐藏主窗口占用 singleton 锁。
3. 对同一项目确认 MCP 开关、`get_mcp_capabilities`、切换工程、异常 Renderer 停止等回归。
4. P0 高级 Flow（IsTrue/CallAction/变量联动）真实双分支验收仍单独以独立工程执行，不能把本轮稳定性自动化测试等同于高级 Flow 功能通过。

代码保持在现有未提交工作区，不修改用户的 EmptyUI 工程、不强制终止任何进程。
