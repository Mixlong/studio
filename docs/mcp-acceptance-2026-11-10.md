# DigiwiseStudio MCP 真实验收记录（2026-11-10）

**结论：真实 MCP 授权→工程编辑→Check→Build→保存重开的主要 E2E 链路通过；GUI Canvas/Properties 视觉验证与尚未实现的 Preview/Download/Toolchain 仍不可标记 100% 完成。**

**2026-11-10 授权设计变更：** 用户明确确认 MCP Server 开启即允许 AI 提交读写请求，写入仍必须经本地弹窗确认。已删除独立的 Allow AI edits 复选框及对应 IPC，正式安全机制变为每次弹窗/本次会话授权。已通过正常关闭和重新启动软件加载新授权逻辑，独立工程的首次写入经本地弹窗批准后正式运行成功。

本次验收只使用 DigiwiseStudio 的正式 MCP 通道和独立演示工程，不通过修改进程内存、调用未授权 IPC 或篡改安全设置来代替用户的本地写入授权。Git 工作区原有未提交修改均保留。

## 环境与证据

| 验收层级 | 结果 | 实际证据 |
|---|---|---|
| 旧 IDE 安全关闭 | PASS | 通过窗口关闭请求，项目保存/取消关闭流程保留；旧进程自然退出，未强制 kill |
| 新 IDE 启动 | PASS | 通过项目 Electron executable 正常重新启动 |
| 真实 MCP 只读连接 | PASS | `npm run verify-mcp-live`，16 read / 34 write tools，37 registered/palette widgets；实际页面/事件/资源/属性 Schema 读取通过 |
| 编译和单元/模拟回归 | PASS | 最终修复版 `npm run build-src` + `npm run verify-mcp`，8 组测试通过；新断言检查全部 16 读/34 写的超时分类 |
| Windows 打包 | PASS | `npm run pack`，生成 `dist/win-unpacked/DigiwiseStudio.exe` |
| 打包版 MCP 初始化 | PASS | 修复授权等待超时后重新 `npm run pack && npm run verify-mcp-packaged`，ASAR 资源/依赖及 stdio MCP 协议初始化通过 |
| E2E 验收程序静态/只读预检查 | PASS | `node --check packages/mcp/test-live-e2e.mjs` 和 `node packages/mcp/test-live-e2e.mjs` |
| 真实 MCP 新建独立工程 | PASS | 新版 IDE 开启 MCP 后直接弹窗确认；`node packages/mcp/test-live-e2e.mjs --execute` 创建独立 LVGL+Flow 工程，退出码 0 |
| 真正写入/回读/Undo/Redo | PASS | 验收报告 `36/36 PASS`，涵盖页面、组件、样式、变量、Flow 节点/连线、事件、Bitmap、复制/移动及 Undo/Redo |
| 真实 Editor Check / LVGL Build 产物 | PASS | IDE 异步 Check 与 Build 均成功，独立工程 `src/ui` 生成 19 个文件，包括 `.c`/`.h`/`eez-flow.cpp` |
| 保存退出重开后模型一致性 | PASS | 正常退出 IDE，使用演示 `.eez-project` 路径重新打开；`test-live-reopen.mjs` 9/9 PASS，页面、组件、变量、Action 图、Style、Bitmap 和文件均保留 |
| Properties / Canvas / Preview 可见一致性 | NOT VERIFIED | 当前 MCP 不含可独立证明 UI 视觉一致性的接口，未声称通过 |
| Preview / Download / Toolchain 端到端 | NOT IMPLEMENTED | 既有 MCP 能力缺口，不得伪造结果 |

## 验收中发现并修复的问题

**正式 E2E 验收证据路径：** `artifacts/mcp-acceptance/run-20261110_080438-n8mWSj/acceptance-report.json`、同目录 `reopen-report.json` 与 `MCP_Acceptance.eez-project`。原有用户工程未作测试写入；完整操作均由本地授权的 MCP 通道触发。

**MCP 写入超时配置过旧：** 原 `bridge-client.mjs` 只把少量旧工具当成长耗时写入；新增工具遇到首次用户授权时可能在 8.5 秒内被客户端断开。已改为以注册的 16 个只读工具为短超时名单，所有其他请求按写入最长 195 秒等待；`test-bridge.cjs` 会根据实际注册的 16 read/34 write 工具逐项断言超时策略。修复后全部回归和 Windows 重新打包验收再次通过。

## 如何复验（已执行通过）

保存当前工程后正常重启 DigiwiseStudio，使新版 MCP 生效。在 **Settings → Integrations → MCP Server** 中只需启用 MCP Server（不再有第二个写入开关）。首次 AI 写入时在本地弹窗选择「仅允许本次」或「本次会话允许」（仅当前 IDE 进程有效）；拒绝则不执行写入。不要使用任何绕过授权机制的脚本。

本轮已经经本地授权完成下述真实验证。需要再次复验时，从 `D:\\代码\\DigiwiseStudio` 执行：

```powershell
node packages/mcp/test-live-e2e.mjs --execute
```

脚本会在 `artifacts/mcp-acceptance/run-<时间戳>/` 创建**全新独立工程**，不会改动预先打开的 `EmptyUI.eez-project`。真实流程覆盖：创建 Flow LVGL 项目 → 新增页面 → Label/Button → Style → 全局变量绑定 → Start/SetVariable/Delay/End Flow 编排 → 事件绑定 → 组件复制/Undo/Redo → 跨页移动 → Bitmap 导入 → 保存 → JSON 回读 → Check → Build → 核对源代码文件。若活动工程发生变化则立即停止写入。

本轮已经完成正常关闭并使用项目路径重新打开。之后如需再次核验，先确认独立演示工程是当前活动工程，再执行：

```powershell
node packages/mcp/test-live-reopen.mjs "D:\\代码\\DigiwiseStudio\\artifacts\\mcp-acceptance\\run-...\\MCP_Acceptance.eez-project"
```

第二阶段读取页面/组件/Style/Bitmap/变量/Action 节点与连线并核对生成文件。GUI 的实际 Canvas/Properties 以及 Preview/Download 仍须独立验收；即使以上脚本全部 PASS 也不能替代视觉或设备验收。

## 交付/冻结门禁

- **禁止**因工具注册成功、测试 mock 成功或 Windows 打包成功就将 DigiwiseStudio 的 AI 全开发流程标成完全完成。
- **安全优先**：服务关闭时不可写；服务开启后只允许提交写入请求，实际写入必须经本地单次或会话授权；不跨工程写入、对象身份校验、保存检查及 Undo/Redo 机制必须始终保持。
- **发布前**：必须获得真实项目写入/保存/重新打开/Check/Build 以及 UI 视觉对照的证据；未实现的 Preview/Download/Toolchain 工作流不得作为已验收功能。
