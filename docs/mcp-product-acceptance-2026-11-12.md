# DigiwiseStudio MCP 产品级闭环验收 — 2026-11-12

## 验收原则与结论

**状态：基础 MCP 功能和当前可自动执行的发布门禁 PASS；仍未达到“完整产品全功能验收通过”。**

所有本轮运行的真实 Electron 测试使用独立临时用户目录，无需读取用户现有账号或工程，也未清除用户 `AppData`、杀死用户 IDE 或绕过本地授权。

### 产品验收矩阵

| 范围 | 结果 | 证据 / 限制 |
| --- | --- | --- |
| 源码严格编译、Gulp 打包资源生成 | **PASS** | `npm run build-src` |
| MCP SDK / Stdio 连接、工具表和参数校验 | **PASS** | `npm run verify-mcp`；19 read / 37 write |
| 授权、会话撤销、Client 断开、token、防伪造 IPC | **PASS** | `test-main-bridge.cjs` 等回归；包含退出登录时待决授权拒绝 |
| Windows ASAR 和正式打包资源完整性 | **PASS** | `npm run pack` + `npm run verify-mcp-packaged` |
| 真正 Electron 原生授权弹窗 | **PASS** | `npm run verify-mcp-native`：拒绝/单次/会话授权、Esc、关闭、Abort、无旧窗口泄漏，7/7 |
| 完整 Electron Main 实例加载并启动 MCP | **PASS** | 独立临时 `appData` 的 `verify-mcp-isolated`；成功产生自己的 MCP Session |
| 真实空白用户目录下未登录安全边界 | **PASS** | `AUTH_REQUIRED`：读取与 `create_project` 写入拒绝；验证未生成非法工程 |
| Main/Renderer 工具版本与就绪握手 | **自动化 PASS** | Mock/IPC 测试通过；未准备好返回 `IPC_UNAVAILABLE`，不是误判连接成功 |
| 真实已登录 IDE 的工程/Flow 操作 | **历史演示通过；本轮新版未重验** | 2026-11-11 的隔离项目通过 IsTrue True/False、CallAction、SetVariable、WASM 稳定帧、Check/Build；本轮改动涉及权限/握手，不沿用旧测试宣称最新版已验收 |
| IDE 项目分配权限（bc350 可见、其他不可见） | **未完成端到端验收** | 需要使用真实后台分配的测试账号和项目权限，核对 Server/API/IDE/MCP |
| LVGL 全组件完整属性/资源生命周期 | **部分覆盖** | 源码 39 组件类、136 个专有安全字段的夹具测试；不等于当前实际 Palette 37 种真实创建、保存重开/Build 全通过 |
| Toolchain → Download/烧录、异常恢复、跨 LVGL 版本 | **未完成** | 不能算入本次发布通过范围 |

## 本轮真正修复的产品缺陷

1. **初始化误判为 MCP IPC 死锁：** Main 进程可以先启动 MCP，而 `App` 只有在迪太云认证成功后才 `loadTabs()`，从而注册 Renderer Agent。旧流程先转发请求，连续两次超时甚至撤销自己的 MCP 会话；现在 Main 通过 `digi:mcp:renderer-ready` / `renderer-probe` 与 Renderer 显式握手，加载阶段快速拒绝，不累计 IPC 超时。
2. **未登录可触达 Main 自行处理的工程创建：** 添加 `getDigiwiseAuthGuard()`，所有读写在 Main 先校验当前有效、active 的迪太云会话（包括 `create_project`）。空白配置真实 Electron 测试确认未认证的读写都被拒绝，且没有创建工程文件。
3. **会话授权可能跨登录状态延续：** 添加 auth generation；登出/重新登录必须重新批准；如果在授权弹窗打开后用户登出，仍拒绝该待决写入。测试覆盖再次登录同一用户不能继承授权。
4. **Main/Renderer 新旧 ABI 混用：** 版本升级为 `mcp-2026-11-12-r19w37-ready-auth`；Stdio Bridge 仍检查注册版本，并明确要求保存工作后完整重新启动旧进程。
5. **测试本身隔离不可靠：** Windows 上仅覆盖环境变量 `APPDATA` 无法覆盖 Electron 的 OS KnownFolder；新的 `verify-mcp-isolated` 用独立测试 Bootstrap 在应用 Main 之前 `app.setPath("appData", isolated)`，确保不会占用用户生产目录、单实例锁或账号数据；测试结束只清理自己启动的子进程与临时目录。

## 一键复现

```powershell
cd D:\代码\DigiwiseStudio
npm run verify-mcp-product
```

此命令执行：`build-src → verify-mcp → pack → verify-mcp-packaged → verify-mcp-native → verify-mcp-isolated`。最后两项是**实际 Electron**测试，不是纯 Mock。

关键证据：
- `artifacts/mcp-acceptance/mcp-approval-native-report.json`：真实原生授权七项 PASS
- `artifacts/mcp-acceptance/mcp-approval-native.png`：原生授权窗口截图
- `artifacts/mcp-acceptance/isolated-ide-acceptance.json`：独立 Main 启动、未登录授权边界 PASS
- `artifacts/mcp-acceptance/advanced-flow-XQZxWB/advanced-flow-acceptance.json`：前一次真实高级 Flow 测试（非新版本重测）

## 下一阶段验收门槛

**上线前必须补完：** 使用正式迪太云后台分配的测试账号，在独立业务工程上对账号项目可见性、MCP 项目归属、正常授权、Flow 两分支/保存重开/实际画面、Check/Build、停服重启、过期及异账号访问执行新版本 E2E。若某项目未分配，IDE UI 和 MCP 都必须拒绝读取；不能只依靠 `expectedProjectPath` 字符串比较。

实际 UI 项目目前可能仍有**此前启动的旧 Main 进程**；源码更新并不会热替换 Main。先保存用户工程并通过软件正常退出/重启，再进行新版本真实业务验收。不得在未确认用户数据状态时强制结束进程。

代码和报告保存在当前未提交工作区，未提交 Git、未改动 EmptyUI 用户工程。
