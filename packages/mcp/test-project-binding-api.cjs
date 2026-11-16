/* Authenticated MCP binding API response validation. No real backend request. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {DigiwisePublicApi} = require("../../build/main/digiwise-auth-api.js");

const bindingId=crypto.randomUUID();
const bindingSecret="mcpb_"+crypto.randomBytes(32).toString("base64url");
const issued={
    bindingId, bindingSecret, modelId:350,
    mcpExecutionAuthorized:false,nextRequirement:"MAIN_LOCAL_FILE_BINDING"
};
const authorized={
    scope:"PROJECT_BINDING", bindingId, decisionId:crypto.randomUUID(),
    modelId:350, tool:"add_widget",permission:"project.edit",
    globalPolicyRevision:1,accountPolicyRevision:12,
    expiresAt:new Date(Date.now()+4200).toISOString(),
    mcpExecutionAuthorized:true
};
const calls=[];
const create=(responder)=>new DigiwisePublicApi("http://127.0.0.1:18080/api/ide/v1",
    async (url,init)=>{
        calls.push({url,init});
        const {status=200,code="OK",data} = responder(url,init);
        return {
            ok: status>=200 && status<300, status,
            text:async()=>JSON.stringify({
                code,message:"test",requestId:"test-mcp-binding",data
            })
        };
    });
(async()=>{
    const client=create(url=>({
        data:url.endsWith("issue-project-binding")?issued:
             url.endsWith("authorize-tool")?authorized:{revoked:true}
    }));
    const result=await client.issueMcpProjectBinding("ide_TEST",
        {registryVersion:"v-test",modelId:350});
    assert.equal(result.bindingId,bindingId);
    assert.equal(result.mcpExecutionAuthorized,false);
    assert.equal(calls[0].init.headers.Authorization,"Bearer ide_TEST");
    assert.equal(calls[0].init.method,"POST");
    const decision=await client.authorizeMcpTool("ide_TEST",
        {registryVersion:"v-test",tool:"add_widget",bindingId,bindingSecret});
    assert.equal(decision.scope,"PROJECT_BINDING");
    assert.equal(decision.mcpExecutionAuthorized,true);
    assert.equal((await client.revokeMcpBinding("ide_TEST",
        {bindingId,bindingSecret})).revoked,true);

    const wrongBinding=create(()=>({data:{...issued,bindingId:"forged"}}));
    await assert.rejects(wrongBinding.issueMcpProjectBinding("ide_TEST",
        {registryVersion:"v-test",modelId:350}),
        e=>e.code==="PUBLIC_API_INVALID_RESPONSE");
    const premature=create(()=>({data:{...issued,mcpExecutionAuthorized:true}}));
    await assert.rejects(premature.issueMcpProjectBinding("ide_TEST",
        {registryVersion:"v-test",modelId:350}),
        e=>e.code==="PUBLIC_API_INVALID_RESPONSE");
    const tamper=create(()=>({data:{...authorized,bindingId:"other"}}));
    await assert.rejects(tamper.authorizeMcpTool("ide_TEST",
        {registryVersion:"v-test",tool:"add_widget",bindingId,bindingSecret}),
        e=>e.code==="PUBLIC_API_INVALID_RESPONSE");
    const expired=create(()=>({data:{...authorized,
        expiresAt:new Date(Date.now()-1000).toISOString()}}));
    await assert.rejects(expired.authorizeMcpTool("ide_TEST",
        {registryVersion:"v-test",tool:"add_widget",bindingId,bindingSecret}),
        e=>e.code==="PUBLIC_API_INVALID_RESPONSE");
    const denied=create(()=>({status:403,code:"MCP_DISABLED",data:null}));
    await assert.rejects(denied.authorizeMcpTool("ide_TEST",
        {registryVersion:"v-test",tool:"add_widget",bindingId,bindingSecret}),
        e=>e.code==="MCP_DISABLED");
    console.log("PASS: MCP binding issue/revoke/authorize, IDE Bearer, response spoof/expiry/model mismatch and backend denial");
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
