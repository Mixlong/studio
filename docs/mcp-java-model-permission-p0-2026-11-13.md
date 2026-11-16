# DigiwiseStudio MCP P0：后台型号项目权限校验（2026-11-13）

**更正说明（同日后续开发）：此文档记录的是早期版本。实际后台已采用 V5 `digi_user_model` 直接授权，旧 IDE 角色表已废弃，本文涉及 `digi_ide_user_role`、`digi_ide_role_permission` 的判断不再适用。最新实现与部署状态以 `docs/mcp-project-binding-p0-2026-11-13.md` 为准；本文件保留作为差异审计记录。**

## 当前实施状态

**已实施：Java 账号/型号/角色的权限交集检查 + IDE API 类型契约 + 跨仓库工具清单回归。**

**未实施：真实本地工程与后台项目的可信绑定、最终执行授权、灰度策略管理、操作审计、Java/IDE 实机联调。当前接口的响应明确是“不能执行”，避免把型号权限检查误当作完整 MCP 放行。**

### 现有数据关系（复用，不新建第二套项目权限）

- `sys_user`：当前 IDE 账号须启用，未删除，账号类型与角色一致
- `digi_user_model`：账号须被分配目标型号项目
- `digi_model`：目标项目须处于 `enabled`
- `digi_ide_user_role` + `digi_ide_role`：账号须具有有效 IDE 角色
- `digi_model_ide_role`：该 IDE 角色须覆盖**同一个目标项目**，不能把其他型号上的角色权限拿来使用
- `digi_ide_role_permission`：同一项目的角色须允许 `mcp.use` 和目标操作要求的权限

这是两个相互独立的交集：账号拥有目标项目；账号拥有对该目标项目的 MCP/读/写/构建角色权限。

### 已新增 Java 接口（测试/内部联调用，不是最终执行许可）

`POST /api/ide/v1/mcp/check-model-access`

- 使用 IDE 专用 `Authorization: Bearer ide_...`；HTTP 层只对该路径透传，Controller 通过 `IdeAuthService.requireUserId` 校验。管理员 JWT 不可代替 IDE 令牌。
- 请求 `{ "registryVersion": "mcp-2026-11-12-r19w37-ready-auth", "tool": "add_widget", "modelId": 350 }`。其中 350 **只是示例数字，不代表 BC350 在数据库里的实际 ID**。
- 工具名必须属于与 IDE 完全一致的 56 个工具。未来新增工具未登记之前拒绝；MCP 注册版本不一致返回 `REGISTRY_MISMATCH`。
- 读取工具要求 `project.view`；编辑工具要求 `project.edit`；Check / Build 要求 `build.run`。所有工具均要求 `mcp.use`。
- `get_mcp_capabilities` 仅在已拥有有效 `mcp.use` 角色时允许返回发现级预检结果，不公开项目内容，也不给执行授权。
- 校验通过的项目级工具返回 `modelAccessGranted=true`、`scope=MODEL_ONLY`、`projectBindingVerified=false`、`mcpExecutionAuthorized=false`、`nextRequirement=TRUSTED_PROJECT_BINDING`。
- 不存在、未授权、禁用的型号项目返回拒绝；未知工具、缺少 `modelId` 和空请求也拒绝。

成功响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "requestId": "server-generated-request-id",
  "data": {
    "scope": "MODEL_ONLY",
    "modelId": 350,
    "tool": "add_widget",
    "permission": "project.edit",
    "modelAccessGranted": true,
    "projectBindingVerified": false,
    "mcpExecutionAuthorized": false,
    "nextRequirement": "TRUSTED_PROJECT_BINDING",
    "decisionId": "server-generated-decision-id"
  }
}
```

这**不是**执行授权 Token。任何 IDE 或 AI 客户端不得根据 `modelAccessGranted=true` 执行工程修改。

### 主要修改文件

Java 后台仓库 `D:\代码\DigiwiseStudio-Admin-Java\backend`：
- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/ide/IdeMcpPublicController.java`
- `ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpModelAccessService.java`
- `ruoyi-framework/src/main/java/com/ruoyi/framework/config/SecurityConfig.java`：仅补充该 IDE Bearer 路径；内部必须仍认证

IDE 仓库 `D:\代码\DigiwiseStudio`：
- `packages/eez-studio-shared/digiwise-mcp-model-access.ts`
- `packages/main/digiwise-auth-api.ts`：新增 `checkMcpModelAccess()`，并验证返回必须显式声明未完成工程绑定
- `packages/mcp/test-java-model-contract.cjs`
- `npm run verify-mcp-java-model-contract`

### 下一阶段（未实施，严格禁止假称已完成）

1. **可信工程绑定**：模板下载验签及空工程受控选择项目型号；由 IDE Main 发起绑定，后台生成绑定 ID。绑定保存在受保护的 IDE 本地目录，而非可编辑的 `.eez-project` JSON 字段。
2. **服务端最终授权**：后台按 IDE 会话、可信绑定、同一型号项目角色、工具以及新策略版本生成短期、不可跨项目复用的决策；必须存在项目绑定才允许，不再使用本阶段 `check-model-access` 作为执行许可。
3. **Main 执行拦截**：所有 56 工具的读取与写入都校验有效授权；已有本地确认继续保留。工程切换、角色变更、登录切换、策略回滚、服务器拒绝必须使当前许可失效。
4. **失败安全**：断网、绑定过期、账号停用、角色撤销、错误项目、未知工具、新旧 Manifest 混用均拒绝新受控操作。对运行中的 Check/Build 在实际执行节点复核并记录结果。
5. **验收**：准备后台测试账号 A（仅授权 BC350）和未授权型号，以及绑定的隔离 `.eez-project`；验证读取/修改/Build、跨型号、伪造路径、撤权、断网、关闭/重启、后台审计。不得用 Mockito 或前端假数据代替真实后端授权联调。

### 本轮验证

- Java Maven `-pl ruoyi-admin -am -DskipTests compile`：通过
- IDE `npm run build-src`：通过
- `npm run verify-mcp-java-model-contract`：通过（56 工具逐项映射、权限交集、API 响应拒绝假权限/未知模型）
- `npm run verify-mcp`：通过
- 尚未启动新版 Java 后台，也没有修改数据库、现有后台账号、已授权项目或用户业务工程；不能宣称真实 BC350 授权/撤权闭环已验收。
