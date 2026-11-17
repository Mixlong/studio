const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {McpCentralAuthorizationGate, CentralMcpAccessError} =
    require("../../build/mcp/central-authorization.js");
const secret = "mcpb_" + crypto.randomBytes(32).toString("base64url");
const digest = crypto.randomBytes(32).toString("hex");
const session = crypto.randomBytes(24).toString("base64url");
const path = "C:/test/BC350.eez-project";
const original = {
    bindingId: crypto.randomUUID(), bindingSecret: secret, modelId: 350,
    ownerUserId: "12", fileIdentity: "identity-v1",
    projectKey: "a".repeat(64), projectFingerprint: "b".repeat(64),
    projectRevision: 1
};
let current = {...original};
let account = {authenticated: true, userId: "12", generation: 3};
let calls = 0;
const result = () => ({
    scope: "PROJECT_BINDING",
    requestId: crypto.randomUUID(),
    decisionId: crypto.randomUUID(),
    bindingId: original.bindingId,
    modelId: 350, tool: "add_widget", permission: "project.edit",
    riskGroup: "project.edit", registryVersion: "mcp-2026-11-13-r19w37-central-stage",
    clientSessionId: session, projectFingerprint: original.projectFingerprint,
    projectRevision: 1, parameterDigest: digest, serverDecision: "allow",
    globalPolicyRevision: 2, accountPolicyRevision: 4,
    expiresAt: new Date(Date.now() + 3900).toISOString(),
    mcpExecutionAuthorized: true, localConfirmationRequired: true
});
let response = result;
const gate = new McpCentralAuthorizationGate(
    {find: () => current},
    () => account,
    async input => {
        calls++;
        assert.equal(input.tool, "add_widget");
        assert.equal(input.bindingId, original.bindingId);
        assert.equal(input.bindingSecret, secret);
        assert.equal(input.parameterDigest, digest);
        assert.equal(input.clientSessionId, session);
        assert.equal(input.projectFingerprint, original.projectFingerprint);
        assert.equal(input.projectRevision, 1);
        assert.equal(input.riskGroup, "project.edit");
        return response();
    }
);
const authorize = () => gate.authorizeProjectTool(path, "add_widget", digest, session);
const rejects = (code, promise) => assert.rejects(promise, e =>
    e instanceof CentralMcpAccessError && e.code === code);
(async () => {
    const allowed = await authorize();
    assert.equal(allowed.modelId, 350);
    assert.equal(allowed.accountPolicyRevision, 4);
    assert.equal(allowed.requestId.length, 36);
    assert.ok(!JSON.stringify(allowed).includes(secret));
    await authorize();
    assert.equal(calls, 2, "Each operation needs its own online decision");

    account = {...account, authenticated: false};
    await rejects("AUTH_REQUIRED", authorize());
    account = {...account, authenticated: true};
    current = null;
    await rejects("PROJECT_UNBOUND", authorize());
    current = {...original};

    response = async () => { account = {...account, generation: 4}; return result(); };
    await rejects("AUTH_REQUIRED", authorize());
    response = async () => { current = {...current, fileIdentity: "replaced"}; return result(); };
    await rejects("PROJECT_CHANGED", authorize());
    current = {...original};

    for (const override of [
        {modelId: 999}, {riskGroup: "project.view"},
        {parameterDigest: "c".repeat(64)}, {clientSessionId: "other_session_1234"},
        {projectFingerprint: "d".repeat(64)}, {projectRevision: 2},
        {serverDecision: "deny"}, {requestId: "not-a-uuid"},
        {expiresAt: new Date(Date.now() - 2000).toISOString()}
    ]) {
        response = () => ({...result(), ...override});
        await rejects("ACCESS_DENIED", authorize());
    }
    response = () => {throw new Error("sensitive backend error");};
    await rejects("MCP_POLICY_UNAVAILABLE", authorize());
    await rejects("ACCESS_DENIED",
        gate.authorizeProjectTool(path, "add_widget", "bad", session));
    console.log("PASS: v3 Main online authorization binds account, project fingerprint, risk group, exact parameters and session; revoke/offline/mismatch fail closed");
})().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
