# DigiwiseStudio MCP 中央权限受控接入验收（2026-11-13）

## 交付状态：开发受控模式已连通，正式发布仍被阻断

本轮将 Java 在线授权模块真实接入 Electron Main 的 MCP Socket 分发路径，采用 **显式受控启用**：

- 仅当未打包的开发 IDE 使用环境变量 `DIGISTUDIO_MCP_CENTRAL_STAGE=1` 时接入新的强制校验；
- 正式打包应用保持原 MCP 本地确认行为；这不代表 Java 后台的 MCP 开关已能管理旧客户端。
- **不能执行** `sql/digiwise_mcp_settings_menu_v1.sql` 的正式切换，因为真实 Java/MySQL、可信新工程绑定、长期任务撤权、全项目切换事件的联合验收仍不完整。

已新增代码：

- `packages/mcp/main-server.ts`：可选 `McpCentralExecutionPolicy`，从实际 Renderer Tab 内部探测 `get_current_project`（探测结果不外发 MCP），按工具请求 Java 在线鉴权后才传给 Renderer；创建新工程在中央模式下先拒绝，待 Main 受控新建与后台绑定向导接通。
- `packages/mcp/renderer-agent.ts`：执行前核实 Main 所授权的真实工程路径仍与当前活动 ProjectStore 一致，否则 `PROJECT_CHANGED`；不使用客户端声称的 `expectedProjectPath` 充当身份。
- `packages/mcp/integration.ts`：受控模式接入 Main-only `getDigiwiseAuthGuard` / `safeStorage` / IDE Bearer Java API；打包版不启用尚未验收的中央模式。
- `packages/main/digiwise-auth.ts`：Main-only 登录 Guard 返回账号 ID 和登录代次，不向 MCP 客户端返回登录密钥。
- `packages/mcp/protocol.ts`：内部 Renderer 请求增加 `authorizedProjectPath`；Main/Renderer/Stdio 与 Java API 版本一起升级为 `mcp-2026-11-13-r19w37-central-stage`，阻止老 Main 和新 Renderer 的授权协议混用。
- `packages/mcp/project-binding-store.ts` + `central-authorization.ts`：加密存储账号+绑定+文件身份及在线判定；默认拒绝未绑定、替换文件、账号切换、撤权和断网。
- `packages/mcp/test-main-central-bridge.cjs`：真实 Main 本地 Socket 协议模拟，检查发现工具拒绝、只读路径校验、断网、授权后的工具执行、跨工程授权隔离、退回旧工程需重新确认、撤权发生在授权弹窗打开期间、中央模式下未绑定的新建工程拒绝。
- `packages/mcp/test-central-integration.cjs`：验证非打包开发环境 opt-in、打包版不自动声称中央强制授权、Java Bearer 仅留在 Main。

## 当前架构关键安全边界

### 仍未完成的必要工作

1. **受控创建工程**：必须让用户从当前账号已授权的型号列表中明确选择 `digi_model.id`，由 IDE Main 申请服务端绑定凭证并在创建成功后加密保存。MCP 客户端不能自行提交 `projectId` 或文件路径作为授权依据。此工作尚未完成，所以受控模式中的 `create_project` 会拒绝。
2. **文件保存/重开**：受控绑定的 `refreshAfterAuthorizedSave` 尚未接入实际保存成功回调；工程原地安全保存时需要校验同一 FileStore 的合法替换，不能随意刷新文件身份。
3. **项目切换的完整检测**：当前 Main 在下一次 MCP 请求检测到项目变化时撤销旧会话写入许可；若用户在两次请求之间切走又切回来，尚无编辑器切换事件的主动失效保证，正式启用前必须补此事件。这一点不能拿当前测试冒充完全闭环。
4. **权限更新与异步执行**：Java 每次在线请求读最新策略，但开始后的异步 Check/Build 需要在重要执行点复核撤权。
5. **数据库/API 真联调**：全局/账号策略、绑定表 SQL 未执行；Java `18080` 未验证在线，后台无专用 BC350 测试账号及越权账号实测。即使 Java 编译和模拟测试通过，也不能认定撤权已经控制真实运行中的 IDE。
6. **生产激活和管理后台 UI 浏览器验收**：管理策略页面为代码、Vite 构建 PASS，没有在已登录后台真实浏览器完成交互验收；菜单迁移强制要求 `@digi_mcp_main_enforcement_verified=1` 才变更原规划页面。未完成 1-5 前不得设置此标志。

### 已经取得的实际自动化证据

- Java Maven `-pl ruoyi-admin -am -DskipTests compile`：通过
- Admin Vue `npm run build:prod`：通过
- IDE `npm run verify-mcp-java-model-contract`：56 工具权限范围、v5 直接授权、默认关闭的 MCP 策略、SQL/接口契约通过
- IDE `npm run verify-mcp`：通过，含中央 Main Socket 和入口 opt-in 测试、加密绑定 store、原生授权/UI/协议及全部其他既有 MCP 回归
- IDE `npm run verify-mcp-product`：通过，包含 Windows Electron 打包资源、原生授权 7/7、独立 Electron 未登录阻断
- 项目级授权仅通过隔离 Mock/契约测试；**不是** Java + MySQL + 真实用户工程端到端测试

当前开发/正式运行的旧 DigiStudio Main 未强制关闭或热替换。要测试受控模式，必须使用**隔离用户目录的独立开发实例**；不能在正常业务 IDE 直接加环境变量使用未迁移的 Java 策略。旧 MCP 19 读/37 写工具数不变，但协议版本已更新，全面加载新代码需要保存工程后正常完整重启。

## 发布结论

P0 控制面、后台 UI、Main 执行拦截的受控代码与测试基础已经建立；**完整后端策略 → 可信工程绑定 → 真实授权 → 工程执行 → 异步撤权 → 审计**链条尚未通过联调。

未经该真实闭环验收，不得标注为“已上线”、“后台 MCP 总开关已生效”或“BC350 越权完全阻止”。
