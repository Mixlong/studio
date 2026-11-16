/* Cross-repository MCP model permission contract. Run only in dev workspace
 * with DigiwiseStudio-Admin-Java checked out as sibling, never against user data.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const root = path.resolve(__dirname, "../..");
const java = path.resolve(root, "../DigiwiseStudio-Admin-Java/backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpModelAccessService.java");
const controller = path.resolve(root, "../DigiwiseStudio-Admin-Java/backend/ruoyi-admin/src/main/java/com/ruoyi/web/controller/ide/IdeMcpPublicController.java");
const securityConfig = path.resolve(root, "../DigiwiseStudio-Admin-Java/backend/ruoyi-framework/src/main/java/com/ruoyi/framework/config/SecurityConfig.java");
const policyServiceFile = path.resolve(root, "../DigiwiseStudio-Admin-Java/backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpPolicyService.java");
const migration = path.resolve(root, "../DigiwiseStudio-Admin-Java/backend/sql/digiwise_mcp_policy_v1.sql");
const grantMigration = path.resolve(root, "../DigiwiseStudio-Admin-Java/backend/sql/digiwise_user_model_grants_v5.sql");
const bindingServiceFile = path.resolve(root, "../DigiwiseStudio-Admin-Java/backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/IdeMcpProjectBindingService.java");
const bindingMigration = path.resolve(root, "../DigiwiseStudio-Admin-Java/backend/sql/digiwise_mcp_project_binding_v2.sql");
assert.ok(fs.existsSync(java) && fs.existsSync(controller),
    "Requires the sibling Java IDE backend checkout");
const src = fs.readFileSync(java, "utf8");
const api = fs.readFileSync(controller, "utf8");
const security = fs.readFileSync(securityConfig, "utf8");
const policyService = fs.readFileSync(policyServiceFile, "utf8");
const ddl = fs.readFileSync(migration, "utf8");
const v5 = fs.readFileSync(grantMigration, "utf8");
const bindingService = fs.readFileSync(bindingServiceFile, "utf8");
const bindingDdl = fs.readFileSync(bindingMigration, "utf8");
const {MCP_READ_TOOLS, MCP_WRITE_TOOLS, MCP_TOOL_REGISTRY_VERSION} =
    require("../../build/mcp/protocol.js");
assert.ok(src.includes(MCP_TOOL_REGISTRY_VERSION),
    "IDE/Java MCP registry version drift");
const groups = {};
for (const key of ["READ", "BUILD", "EDIT"]) {
    const match = src.match(new RegExp("private static final Set<String> " +
        key + " = Set\\.of\\(([\\s\\S]*?)\\);"));
    assert.ok(match, "Missing Java tool set: " + key);
    groups[key] = [...match[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]);
}
const javaTools = [...groups.READ, ...groups.BUILD, ...groups.EDIT];
const clientTools = [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS];
assert.equal(javaTools.length, 56);
assert.equal(new Set(javaTools).size, 56, "Overlapping Java tool permission groups");
assert.deepEqual(groups.READ.slice().sort(), MCP_READ_TOOLS.slice().sort());
assert.deepEqual([...groups.BUILD, ...groups.EDIT].sort(), MCP_WRITE_TOOLS.slice().sort());
assert.deepEqual(javaTools.slice().sort(), clientTools.slice().sort());
assert.ok(src.includes('policy.requireAllowed('));
assert.ok(src.includes('if (tool == null || tool.isBlank())'), "Reject null tool names");
assert.ok(src.includes('models.accessibleModels(userId)'));
assert.ok(!src.includes("IdeRoleService") && !src.includes("digi_ide_user_role"),
    "V5 direct model grants must never query retired IDE roles");
assert.ok(v5.includes("without IDE roles") && v5.includes("digi_user_model"));
assert.ok(policyService.includes("digi_ide_mcp_control") &&
    policyService.includes("digi_ide_mcp_policy"));
assert.ok(ddl.includes("enabled TINYINT NOT NULL DEFAULT 0"));
assert.ok(ddl.includes("SELECT 1, 0, 1"), "Global MCP must default disabled");
assert.ok(policyService.includes('"TOOL_DISABLED"'));
assert.ok(bindingDdl.includes("digi_ide_mcp_project_binding"));
assert.ok(bindingDdl.includes("secret_hash CHAR(64)"));
assert.ok(bindingService.includes("MessageDigest.isEqual("));
assert.ok(bindingService.includes("modelAccess.checkModelAccess(userId"));
assert.ok(bindingService.includes('status=\'active\''));
assert.ok(bindingService.includes('status=\'revoked\''));
for (const route of ["issue-project-binding", "authorize-tool", "revoke-project-binding"]) {
    assert.ok(api.includes(`@PostMapping("/${route}")`), "Missing controller route: " + route);
    assert.ok(security.includes(`"/api/ide/v1/mcp/${route}"`),
        "Missing IDE Bearer route allowlist: " + route);
}
assert.ok(src.includes('result.put("projectBindingVerified", false)'));
assert.ok(src.includes('result.put("mcpExecutionAuthorized", false)'));
assert.ok(api.includes('auth.requireUserId(authorization)'));
assert.ok(api.includes('@PostMapping("/check-model-access")'));
assert.ok(security.includes('"/api/ide/v1/mcp/check-model-access"'),
    "Dedicated IDE Bearer endpoint must be reachable without admin JWT");
assert.ok(api.includes('auth.requireUserId(authorization)'),
    "PermitAll route must authenticate IDE Bearer inside the controller");

const {DigiwisePublicApi} = require("../../build/main/digiwise-auth-api.js");
let calls = [];
const makeClient = responder => new DigiwisePublicApi(
    "http://127.0.0.1:18080/api/ide/v1",
    async (url, init) => {
        calls.push({url, init});
        const {status=200, data, code="OK"} = responder(url,init);
        return {
            status, ok: status>=200 && status<300,
            text: async () => JSON.stringify({
                code, requestId: "model-contract-test", message: "test", data
            })
        };
    }
);
(async () => {
    const input = {
        registryVersion: MCP_TOOL_REGISTRY_VERSION,
        tool: "add_widget", modelId: 350
    };
    const scope = {
        scope: "MODEL_ONLY", modelId: 350, tool: "add_widget",
        permission: "project.edit", modelAccessGranted: true,
        mcpExecutionAuthorized: false, projectBindingVerified: false,
        nextRequirement: "TRUSTED_PROJECT_BINDING",
        decisionId: "unit-test"
    };
    const client = makeClient(() => ({data:scope}));
    const result = await client.checkMcpModelAccess("ide_TEST_TOKEN", input);
    assert.equal(result.scope, "MODEL_ONLY");
    assert.equal(result.mcpExecutionAuthorized, false);
    assert.equal(calls[0].url, "http://127.0.0.1:18080/api/ide/v1/mcp/check-model-access");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer ide_TEST_TOKEN");
    assert.deepEqual(JSON.parse(calls[0].init.body),input);

    const untrusted = makeClient(() => ({data:{...scope, mcpExecutionAuthorized:true}}));
    await assert.rejects(untrusted.checkMcpModelAccess("ide_TEST_TOKEN",input),
        error => error.code === "PUBLIC_API_INVALID_RESPONSE");
    const fakeBinding = makeClient(() => ({data:{...scope,projectBindingVerified:true}}));
    await assert.rejects(fakeBinding.checkMcpModelAccess("ide_TEST_TOKEN",input),
        error => error.code === "PUBLIC_API_INVALID_RESPONSE");
    const wrongModel = makeClient(() => ({data:{...scope, modelId:999}}));
    await assert.rejects(wrongModel.checkMcpModelAccess("ide_TEST_TOKEN",input),
        error => error.code === "PUBLIC_API_INVALID_RESPONSE");
    const denied = makeClient(() => ({
        status:403, code:"MODEL_ACCESS_DENIED", data:null
    }));
    await assert.rejects(denied.checkMcpModelAccess("ide_TEST_TOKEN",input),
        error => error.code === "MODEL_ACCESS_DENIED" && error.status === 403);

    console.log("PASS: Java/IDE exact 56 MCP tools, V5 direct user-model grants, default-deny account/global policy, binding API and 403 rejection");
})().catch(error => { console.error(error.stack || error);process.exitCode=1; });
