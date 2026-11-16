const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {McpCentralAuthorizationGate,CentralMcpAccessError}=
    require("../../build/mcp/central-authorization.js");
const secret="mcpb_"+crypto.randomBytes(32).toString("base64url");
const original={bindingId:crypto.randomUUID(),bindingSecret:secret,modelId:350,
    ownerUserId:"12",fileIdentity:"identity-v1",projectKey:"hash"};
let current={...original};
let account={authenticated:true,userId:"12",generation:3};
let calls=0;
const result=()=>({
    scope:"PROJECT_BINDING",decisionId:crypto.randomUUID(),bindingId:original.bindingId,
    modelId:350,tool:"add_widget",permission:"project.edit",
    globalPolicyRevision:2,accountPolicyRevision:4,
    expiresAt:new Date(Date.now()+3900).toISOString(),mcpExecutionAuthorized:true
});
let response=result;
const gate=new McpCentralAuthorizationGate(
    {find:()=>current},
    ()=>account,
    async ({tool,bindingId,bindingSecret})=>{
        calls++;assert.equal(tool,"add_widget");
        assert.equal(bindingId,original.bindingId);
        assert.equal(bindingSecret,secret);
        return response();
    }
);
const rejects=(code,p)=>assert.rejects(p,e=>
    e instanceof CentralMcpAccessError && e.code===code);
(async()=>{
    const r=await gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget");
    assert.equal(r.modelId,350);
    assert.equal(r.accountPolicyRevision,4);
    assert.ok(!JSON.stringify(r).includes(secret),
        "Online decision returned to Main must never contain bindingSecret");
    assert.equal(calls,1);
    await gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget");
    assert.equal(calls,2,"Each operation requires a fresh backend decision");
    account={...account,authenticated:false};
    await rejects("AUTH_REQUIRED",
        gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget"));
    account={...account,authenticated:true};
    current=null;
    await rejects("PROJECT_UNBOUND",
        gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget"));
    current={...original};
    response=async()=>{account={...account,generation:4};return result();};
    await rejects("AUTH_REQUIRED",
        gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget"));
    response=async()=>{current={...current,fileIdentity:"file-replaced"};return result();};
    await rejects("PROJECT_CHANGED",
        gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget"));
    current={...original};
    response=()=>({...result(),modelId:999});
    await rejects("ACCESS_DENIED",
        gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget"));
    response=()=>({...result(),expiresAt:new Date(Date.now()-2000).toISOString()});
    await rejects("ACCESS_DENIED",
        gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget"));
    response=()=>{throw new Error("sensitive backend error");};
    await rejects("MCP_POLICY_UNAVAILABLE",
        gate.authorizeProjectTool("C:/test/BC350.eez-project","add_widget"));
    console.log("PASS: Online MCP gate rejects unknown/replaced project, login change, stale decision, wrong model and offline backend; no credential leak");
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
