/* Account-level MCP v6 authorization, lifecycle & silent-write contract across Admin and IDE. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const candidates = [
    path.resolve(root, "../DigiwiseStudio-Admin-Java"),
    path.resolve(root, "../admin-java")
];
const base = candidates.find(candidate => fs.existsSync(path.join(candidate, "backend")));
assert.ok(base, "Admin-Java checkout not found next to studio repository");
const read = p => fs.readFileSync(path.join(base, p), "utf8");

const ui = read("frontend/src/views/digi/mcp/settings/index.vue");
const auditUi = read("frontend/src/views/digi/mcp/audit/index.vue");
const frontendApi = read("frontend/src/api/digi/mcp.js");
const admin = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/controller/ide/IdeMcpPolicyAdminController.java");
const adminSvc = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpPolicyAdminService.java");
const policy = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpPolicyService.java");
const simpleExec = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpSimpleExecutionService.java");
const ideApi = read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/controller/ide/IdeMcpPublicController.java");
const security = read("backend/ruoyi-framework/src/main/java/com/ruoyi/framework/config/SecurityConfig.java");
const jwtFilter = read("backend/ruoyi-framework/src/main/java/com/ruoyi/framework/security/filter/JwtAuthenticationTokenFilter.java");
const ddlV6 = read("backend/sql/digiwise_mcp_scope_mode_v6.sql");
const integration = fs.readFileSync(path.join(root, "packages/mcp/integration.ts"), "utf8");
const mainServer = fs.readFileSync(path.join(root, "packages/mcp/main-server.ts"), "utf8");
const ideSettings = fs.readFileSync(path.join(root, "packages/home/settings.tsx"), "utf8");
const clientApi = fs.readFileSync(path.join(root, "packages/main/digiwise-auth-api.ts"), "utf8");

// Admin UI tri-state mode & audit view
assert.ok(ui.includes("all_active_users") && ui.includes("selected_users") && ui.includes("disabled"));
assert.ok(auditUi.includes("eventType") && auditUi.includes("not_required"));
assert.ok(frontendApi.includes("/digi/mcp/policy/global"));
assert.ok(frontendApi.includes("/digi/mcp/policy/user/"));

// Admin backend RBAC, optimistic lock & tri-state policy
assert.ok(admin.includes("@ss.hasPermi('digi:mcp:settings')"));
assert.ok(adminSvc.includes("record UserUpdate(boolean enabled, long expectedRevision)"));
assert.ok(adminSvc.includes("where id=1 and revision=?"));
assert.ok(adminSvc.includes("where user_id=? and revision=?"));
assert.ok(policy.includes("all_active_users") && policy.includes("selected_users"));
assert.ok(ddlV6.includes("access_mode") && ddlV6.includes("digi_ide_mcp_lifecycle_audit"));

// Public IDE MCP endpoints & silent-write contract
assert.ok(ideApi.includes('@GetMapping("/policy")'));
assert.ok(ideApi.includes('@PostMapping("/connect")'));
assert.ok(ideApi.includes('@PostMapping("/disconnect")'));
assert.ok(ideApi.includes('@PostMapping("/authorize-simple")'));
assert.ok(ideApi.includes('@PostMapping("/audit-simple")'));
assert.ok(ideApi.includes("auth.requireUserId(authorization)"));
assert.ok(simpleExec.includes('grant.put("localConfirmationRequired", false)'));
assert.ok(simpleExec.includes('grant.put("silentExecution", true)'));
assert.ok(security.includes('"/api/ide/v1/mcp/**"'));
assert.ok(jwtFilter.includes('request.getRequestURI().startsWith("/api/ide/v1/")'));

// Studio IDE client contract: connect/disconnect, per-call authorize-simple, audit-simple, silent execution
assert.ok(clientApi.includes("getMcpPolicy"));
assert.ok(clientApi.includes("connectMcp") && clientApi.includes('"mcp/connect"'));
assert.ok(clientApi.includes("disconnectMcp") && clientApi.includes('"mcp/disconnect"'));
assert.ok(clientApi.includes("authorizeSimpleMcp") && clientApi.includes('"mcp/authorize-simple"'));
assert.ok(clientApi.includes("auditSimpleMcp") && clientApi.includes('"mcp/audit-simple"'));
assert.ok(integration.includes("api.getMcpPolicy"));
assert.ok(integration.includes("api.connectMcp"));
assert.ok(integration.includes("api.disconnectMcp"));
assert.ok(integration.includes("api.authorizeSimpleMcp"));
assert.ok(integration.includes("api.auditSimpleMcp"));
assert.ok(!integration.includes("readPreferences("), "IDE must never auto-connect MCP on startup");
assert.ok(mainServer.includes("localConfirmationRequired === false"),
    "Main server must support silent execution when backend returns localConfirmationRequired: false");
assert.ok(ideSettings.includes("if (!this.state.allowed || this.state.loading) return null;"));
console.log("PASS: MCP v6 tri-state policy, connect/disconnect, per-call authorize-simple, silent execution & sanitized audit contract");
