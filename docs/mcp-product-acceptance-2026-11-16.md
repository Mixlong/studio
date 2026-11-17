# DigiwiseStudio IDE MCP 发布门禁与实际运行验收（2026-11-16）

## 本轮结论

**本机 Windows MCP 发布自动化门禁 PASS；真实登录账号与授权型号工程的全链路 E2E 仍未完成，不能宣布 IDE MCP 全功能验收通过。**

本轮不修改正式 MCP 全局开关、不操作现有用户工程、不取用已有 IDE 凭据。真实 Electron 测试启动独立临时配置，退出时仅结束测试自行启动的进程。

## 本轮新增真实运行与完整发布门禁证据

从 `D:\代码\DigiwiseStudio` 运行：

```powershell
npm run verify-mcp-product
```

**2026-11-16 再次完整执行：Exit 0 / PASS。** 该命令顺序执行：

| 流程 | 结果 | 证据范围 |
| --- | --- | --- |
| `build-src`：TypeScript/Gulp 与必要资源 | **PASS** | 当前源码编译、构建 |
| `verify-mcp`：20 个 MCP 脚本 | **PASS** | 19 读/37 写工具注册、验证、工具执行与模拟在线授权等 |
| `pack` | **PASS** | 新建 Windows `dist/win-unpacked`，不签名、不发布 |
| `verify-mcp-packaged` | **PASS** | ASAR 文件完整性与 **真正打包后 exe 的 Stdio MCP SDK 协议初始化** |
| `verify-mcp-native` | **PASS，7/7** | 真正 Electron 原生授权 UI 的拒绝、一次允许、本次会话允许、Esc、窗口关闭、会话撤销、弹窗资源清理 |
| `verify-mcp-isolated` | **PASS** | 真实 Electron Main 启动、本机 MCP session、空白账号下读写均返回 `AUTH_REQUIRED`，未创建禁止的工程文件 |
| 进程清理复查 | **PASS，0 残留测试 PID** | 仅终止测试进程；避免误识别父 PID |

最近一轮隔离启动的真实 Main 成功启动本地 MCP 服务、会话注册表为 `mcp-2026-11-13-r19w37-central-stage`。无 IDE 登录的 `get_current_project` 读取与外部 `create_project` 写入均被拒绝，测试目标文件未生成。

**修复的测试可靠性缺陷**：`packages/mcp/test-product-isolated-ide.cjs` 此前仅凭 Windows `taskkill /T` 的退出码判断清理成功，实际可能在子进程竞争退出时返回 255；首次加强检查时还误把输出中括号里的父 PID 算进被清理进程。现改为每行只提取被终止的首个 PID，并逐一核对该测试创建的 PID 已退出；修复后单独隔离测试及完整一键门禁均通过。

关键输出：
- `artifacts/mcp-acceptance/mcp-approval-native-report.json`
- `artifacts/mcp-acceptance/mcp-approval-native.png`
- `artifacts/mcp-acceptance/isolated-ide-acceptance.json`
- `dist/win-unpacked/DigiwiseStudio.exe`（测试生成的未签名 Windows 解包程序）
- 本验收文件：`docs/mcp-product-acceptance-2026-11-16.md`

## 仍未验收、不能算作 PASS 的真实业务矩阵

| 用例 | 当前状态 | 完成条件 |
| --- | --- | --- |
| 已登录 IDE + 后台账号 MCP 权限 | 未验收 | 使用独立测试 IDE 账号，核对全局/账号/型号授权三层生效 |
| IDE 设置里手工创建并可信绑定全新 LVGL 工程 | 未验收 | Java 签发、Main 本地指纹、Java 确认及工程保存一致 |
| 已授权项目真实工具读/写/保存 | 未验收 | MCP 客户端经 Stdio 接入新版 IDE，实测读、人工同意写、保存和重开 |
| Check / Build 与生成物 | 未验收 | 同一可丢弃工程真实执行 Check/Build 并核对产物 |
| 后台撤权 / 禁用账号即时生效 | 未验收 | 操作前、确认弹窗期间、下一次工具请求分别验证拒绝及审计 |
| 断网 / 账号切换 / 复制工程 / 过期 | 未验收 | 在线失败安全拒绝、旧同意不复用、跨身份/工程不可重放 |
| 审计从 IDE 真实执行写入 Java 与后台显示 | 未验收 | 账号/工程/工具/请求 ID/执行结果一致，失败场景也有记录 |
| 已安装发行版本真实登录运行 | 未验收 | 新版正式安装版、账号与 Java 一起联测，不能用开发版模拟通过 |
| 实际 Palette 全组件与 LVGL 版本覆盖 | 部分覆盖 | 真实逐项创建、属性设置、保存重开与构建，不以代码单测代替 |

测试账号、项目和正式验证环境准备完毕后按上述顺序执行，测试完成后撤销测试绑定并保持全局 MCP 正式状态关闭。未授权打开真实用户工程、动生产策略或借默认管理员账号测真实写入。

## 不包含在 MCP 支持范围内

仪器烧录、固件下载、SCPI 编程和工具链远程编译不属于 MCP 对外工具集，不能以“未验收”假定功能存在。现有读/写主要针对 LVGL 编辑器和 Check/Build。

**发布判断：自动化发布门禁 PASS；全功能产品级上线验收待真实账号与绑定工程 E2E。**
