# DigiwiseStudio MCP P0 工程绑定与在线授权（2026-11-13）

## 结论与上线状态

已完成 **Java 端 P0 权限策略/绑定凭证 API**、**IDE Main 的绑定存储与在线授权判定模块**及自动化契约/隔离测试。

**状态更新（2026-11-13 后续）：** IDE Main 已新增可选的在线授权执行拦截，且通过本地 Socket 受控测试；但只允许未打包开发环境显式设置 `DIGISTUDIO_MCP_CENTRAL_STAGE=1` 时使用。正式发布仍未开启，实际 Java/MySQL 联调、工程受控新建与本地绑定、保存身份刷新、完整项目切换通知、异步任务撤权均未完成。**不能**宣称生产中的旧 MCP 已受后台开关强制约束；最新详见 `docs/mcp-central-enforcement-stage-2026-11-13.md`。

## 纠正之前的架构偏差

Java 后台的 `sql/digiwise_user_model_grants_v5.sql` 明确废弃了 IDE 角色；实际项目授权以 `digi_user_model` + 当前用户、型号是否启用为唯一来源。先前 P0 验证引用已废弃的 `digi_ide_user_role`、`digi_model_ide_role`，会误拒绝合法账号。

现在分成两个独立层次：

1. **IDE 项目范围**：`sys_user`、`digi_user_model`、`digi_model`，不重建第二套项目授权。
2. **MCP 使用策略**：新增独立 `digi_ide_mcp_control`（全局）与 `digi_ide_mcp_policy`（每账号），读取/编辑/构建分别开关，默认全部关闭，未知工具拒绝。**数据库迁移不会自动授权任何用户。**

## Java 后台新增

Java 仓库：`D:\代码\DigiwiseStudio-Admin-Java\backend`

SQL 文件（**未执行**）：
- `sql/digiwise_mcp_policy_v1.sql`
- `sql/digiwise_mcp_project_binding_v2.sql`

Java Service：
- `IdeMcpPolicyService.java`：每请求从 DB 重新读取全局与账号策略，不缓存正向授权
- `IdeMcpModelAccessService.java`：56 工具到 3 组权限的确切映射 + V5 直接用户型号授权
- `IdeMcpProjectBindingService.java`：服务端签发随机 256-bit 凭证，数据库仅存 SHA-256 摘要；在线授权每次复核当前用户、型号、MCP 策略、绑定状态；绑定撤销后拒绝

Java Controller：`IdeMcpPublicController.java`，以下均必须使用 **IDE Bearer**，不能使用管理员 JWT；Spring Security 仅对这些 POST 路径放行 HTTP 层，仍在 Controller 验证。

| Endpoint | 含义 |
|---|---|
| `POST /api/ide/v1/mcp/check-model-access` | 型号项目/工具策略预检；永远不是执行授权 |
| `POST /api/ide/v1/mcp/issue-project-binding` | 受控新工程创建前由 Main 申请绑定凭证 |
| `POST /api/ide/v1/mcp/authorize-tool` | 按绑定 ID、密钥和当前工具重新在线授权；决策有效期 5s |
| `POST /api/ide/v1/mcp/revoke-project-binding` | 撤销创建失败或用户解除绑定后的凭证 |

`issue-project-binding` 会返回一个高熵凭证；它仅证明账号在**该型号**拥有权限，**不证明本地任意文件天然属于该型号**。因此，不得把该接口直接暴露给 MCP 客户端作为“给已有工程绑定”的万能方法；后续必须通过 IDE Main 的受控创建流，在文件创建成功后把凭证与文件做本地加密关联。

## IDE 侧新增但尚未激活的模块

- `packages/main/digiwise-auth-api.ts`：签发/授权/撤销的 IDE Bearer 客户端，校验 JSON 响应和短有效期，拒绝绑定 ID/型号不一致等伪造结果
- `packages/mcp/project-binding-store.ts`：OS 加密的 Main-only 本地文件绑定信息，关联账号 ID、服务端绑定 ID、真实路径哈希与文件标识；默认不信任 `.eez-project` 内的型号/项目 ID。复制文件、更换账号、替换文件、修改加密记录、没有系统加密，均拒绝使用旧绑定
- `packages/mcp/central-authorization.ts`：可独立测试的逐操作 Java 决策复核、账号/工程两次检查、过期和断网拒绝模块；**目前未接入 MCP Main 的真实工具分发路径**
- `project-binding-store.ts` 的 `refreshAfterAuthorizedSave` 用于未来在通过服务器授权的 `save_project` 成功后同步刷新原文件身份；其调用点尚未实现，不能手动用来“解锁”未授权文件

特别注意 Windows Node.js 的 `stat.ino=0` 问题。模块在没有 inode 时使用文件创建时间作为后备身份证据；这只是一项防止普通文件复制/替换误用的检测，**不是对拥有本机文件系统和 DPAPI 权限的攻击者进行加密式来源证明**。

## 下一阶段必须完成的整条执行链

1. 管理后台策略发布（默认关闭、指定用户显式开启）、测试库安全迁移，不能写死开发用户放行
2. 新建项目时在 IDE 显式选择当前账号被授予的后台型号 ID（BSP 仍在 Build 选择）；用户确认创建后由 Main 申请 Java 绑定，创建新文件并写入 OS 加密映射；失败尽量撤销服务端孤儿绑定
3. 每次 MCP 工具调用：Main 内部从当前真实 Editor Tab 获取选中的工程路径（不是客户端传入的路径），取 Main 加密绑定，向 Java 在线 `authorize-tool`，核验绑定/账号/型号/工具/策略/有效期，写入还要本地确认并于确认后重新校验
4. Main → Renderer IPC 带上已经授权的工程身份，Renderer 在具体执行前再次确认活跃 ProjectStore 的相同文件身份。工程切换、未保存工程、复制、文件替换、撤权、断网均拒绝；对 `save_project` 成功后原身份变化必须做受控刷新
5. 新工具、灰度策略、回滚、异步 Check/Build 均需授权和结果审计，撤权不应继续启动下一阶段写入
6. 真实集成验收：测试账号仅分配 BC350、另一个未授权型号、只读与构建权限不同的账号、撤权与断网、复制/篡改项目、OS 重启、保存重开；必须实际 Java + MySQL + IDE + MCP Inspector/Codex

## 已通过与尚缺失的证据

- Maven `-pl ruoyi-admin -am -DskipTests compile`：通过
- IDE TypeScript `tsc`：通过
- `npm run verify-mcp-java-model-contract`：56 工具对齐、V5 权限方案、策略默认拒绝、Java 项目绑定 API 与文件契约：通过
- `npm run verify-mcp`：已有 MCP 回归和新增绑定存储、在线鉴权模块隔离测试：通过
- 本地 Windows 测试确认文件复制、替换、账号切换、加密破坏、无系统加密拒绝：通过
- **数据库迁移、真实已登录 Java/IDE 联调、运行时所有 56 工具拦截、真实撤权效果：未完成**

切勿从“编译成功”推断成“当前运行的 IDE 已经采用新权限策略”。当前用户的 IDE 旧 Main 实例及 Java 数据库均未动，没有修改业务工程或提交 Git。
