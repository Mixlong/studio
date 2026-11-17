/* Account-only MCP authorization contract across the Admin and IDE checkouts. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const base = path.resolve(root, "../DigiwiseStudio-Admin-Java");
const read = p => fs.readFileSync(path.join(base, p), "utf8");

const ui = read("frontend/src/views/digi/mcp/settings/index.vue");
const frontendApi = read("frontend/src/api/digi/mcp.js");
const admin = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/controller/ide/IdeMcpPolicyAdminController.java");
const adminSvc = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpPolicyAdminService.java");
const policy = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpPolicyService.java");
const ideApi = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/controller/ide/IdeMcpPublicController.java");
const security = read("backend/ruoyi-framework/src/main/java/com/ruoyi/framework/config/SecurityConfig.java");
const jwtFilter = read("backend/ruoyi-framework/src/main/java/com/ruoyi/framework/security/filter/JwtAuthenticationTokenFilter.java");
const ddl = read("backend/sql/digiwise_mcp_policy_v1.sql");
const integration = fs.readFileSync(path.join(root, "packages/mcp/integration.ts"), "utf8");
const ideSettings = fs.readFileSync(path.join(root, "packages/home/settings.tsx"), "utf8");

assert.ok(ui.includes("全局通用") && ui.includes("指定账号"));
for(const stale of ["工程绑定", "工具规则", "型号 ID", "allowBuild", "allowEdit", "allowRead"])
    assert.ok(!ui.includes(stale), "Simple admin UI must not expose " + stale);
assert.ok(ui.includes("DigiPageLayout") && ui.includes("DigiPanel"));
assert.ok(ui.includes("size=\"small\""));
assert.ok(frontendApi.includes("/digi/mcp/policy/global"));
assert.ok(frontendApi.includes("/digi/mcp/policy/user/"));
for(const oldApi of ["getMcpToolPolicies", "updateMcpToolPolicy", "getMcpProjectBindings", "revokeMcpProjectBinding"])
    assert.ok(!frontendApi.includes(oldApi), "Old admin API remains: " + oldApi);
assert.ok(!admin.includes('"/user/{userId}/tools"') && !admin.includes('"/user/{userId}/bindings"'),
    "Old MCP tool and binding policy endpoints should be removed");
assert.ok(admin.includes("@ss.hasPermi('digi:mcp:settings')"));
assert.ok(admin.includes("@Log(title = \"IDE MCP全局策略\""));
assert.ok(admin.includes("@Log(title = \"IDE MCP账号策略\""));
assert.ok(adminSvc.includes("record UserUpdate(boolean enabled, long expectedRevision)"));
assert.ok(adminSvc.includes("coalesce(p.enabled,0) as mcpEnabled"));
assert.ok(adminSvc.includes("where id=1 and revision=?"));
assert.ok(adminSvc.includes("where user_id=? and revision=?"));
assert.ok(policy.includes("if (!global && !individual)"));
assert.ok(policy.includes('result.put("authorized", global || individual)'));
assert.ok(policy.includes('result.put("authorizationMode"'));
assert.ok(ddl.includes("SELECT 1, 0, 1"), "Global scope must default off");
assert.ok(ideApi.includes('@GetMapping("/policy")'));
assert.ok(ideApi.includes('@PostMapping("/authorize-simple")'));
assert.ok(ideApi.includes('@PostMapping("/audit-simple")'));
assert.ok(ideApi.includes("policies.requireAllowed(userId, riskGroup, false)"));
assert.ok(ideApi.includes("auth.requireUserId(authorization)"));
assert.ok(security.includes('"/api/ide/v1/mcp/**"'));
assert.ok(jwtFilter.includes('request.getRequestURI().startsWith("/api/ide/v1/")'));
assert.ok(integration.includes("api.getMcpPolicy"));
assert.ok(!integration.includes("api.authorizeSimpleMcp") &&
    !integration.includes("api.auditSimpleMcp"),
    "Authorized MCP tools must not make a Java request per call");
const clientApi = fs.readFileSync(path.join(root, "packages/main/digiwise-auth-api.ts"), "utf8");
assert.ok(clientApi.includes("getMcpPolicy"),
    "IDE must have an account policy query at startup");
// Legacy helper methods can remain for compatibility; Main must not invoke them.
assert.ok(integration.includes("sessionGrant") && integration.includes("currentGrant()"),
    "Main must keep an in-memory account grant scoped to IDE login");
assert.ok(ui.includes("IDE 启动 MCP 时检查账号授权"),
    "Admin UI must accurately describe startup-only grant");
assert.ok(!integration.includes("createBoundProject") && !integration.includes("McpProjectBindingStore"));
assert.ok(!integration.includes("DIGISTUDIO_MCP_CENTRAL_STAGE"));
assert.ok(ideSettings.includes("if (!this.state.allowed || this.state.loading) return null;"));
assert.ok(!ideSettings.includes("已授权型号 ID") && !ideSettings.includes("创建并绑定新工程"));
console.log("PASS: global OR account MCP permission, simple Admin page, JWT/opaque-Bearer separation and IDE-only authorized switch");
