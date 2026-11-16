const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"../..");
const base=path.resolve(root,"../DigiwiseStudio-Admin-Java");
const read=p=>fs.readFileSync(path.join(base,p),"utf8");
const admin=read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/controller/ide/IdeMcpPolicyAdminController.java");
const svc=read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpPolicyAdminService.java");
const policy=read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpPolicyService.java");
const auth=read("backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpModelAccessService.java");
const migration=read("backend/sql/digiwise_mcp_policy_v1.sql");
const menu=read("backend/sql/digiwise_mcp_settings_menu_v1.sql");
const ui=read("frontend/src/views/digi/mcp/settings/index.vue");
const api=read("frontend/src/api/digi/mcp.js");
for(const key of ["/global","/user/{userId}","/accounts"])
    assert.ok(admin.includes(`"${key}"`),"Missing admin route "+key);
assert.ok(admin.includes("@ss.hasPermi('digi:mcp:settings')"),
    "Admin API must enforce RuoYi admin JWT permission");
assert.ok(!admin.includes("permitAll"), "Admin policy routes cannot be anonymous");
for(const path of ["/digi/mcp/policy/global","/digi/mcp/policy/accounts",
    "/digi/mcp/policy/user/"])
    assert.ok(api.includes(path),"Missing frontend API "+path);
assert.ok(ui.includes("DigiPageLayout") && ui.includes("DigiPanel"));
assert.ok(ui.includes("尚未接入 IDE Main"), "UI must not pretend partial policy has live enforcement");
assert.ok(menu.includes("DO NOT APPLY UNTIL IDE Main"));
assert.ok(menu.includes("COALESCE(@digi_mcp_main_enforcement_verified,0)=1"),
    "Unverified MCP runtime may not expose an apparently effective admin switch");
assert.ok(migration.includes("SELECT 1, 0, 1"),"Default global MCP must remain off");
assert.ok(svc.includes("revision=revision+1"),"Every policy change must increment revision");
assert.ok(svc.includes("where id=1 and revision=?"),"Global policy must be optimistically locked");
assert.ok(svc.includes("where user_id=? and revision=?"),"Account policy must be optimistically locked");
assert.ok(policy.includes("digi_ide_mcp_control") && policy.includes("digi_ide_mcp_policy"));
assert.ok(auth.includes("models.accessibleModels(userId)"));
assert.ok(!auth.includes("IdeRoleService") && !auth.includes("digi_ide_user_role"));
console.log("PASS: admin JWT/global/account MCP policy + optimistic locks + real Vue API + staged menu safety, direct V5 model grants");
