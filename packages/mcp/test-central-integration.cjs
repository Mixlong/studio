/* Real compiled integration wiring, mocked Electron main -- no user profile/files.
 * Proves central policy is opt-in developer staging only; packaged IDE cannot
 * silently claim backend enforcement before project provisioning is shipped.
 */
const assert=require("node:assert/strict");
const Module=require("node:module");
const {EventEmitter}=require("node:events");
const {mkdtempSync,rmSync}=require("node:fs");
const {tmpdir}=require("node:os");
const path=require("node:path");
const filename=path.resolve(__dirname,"../../build/mcp/integration.js");
const dir=mkdtempSync(path.join(tmpdir(),"mcp-staged-wiring-"));
const original=Module._load;
let starts=[], apiCalls=[];
const ipcMain={
    handlers:new Map(),
    handle(ch,fn){this.handlers.set(ch,fn);},
    removeHandler(ch){this.handlers.delete(ch);}
};
const electron={
    app: {getPath:()=>dir,isPackaged:false},
    BrowserWindow:class {},
    ipcMain,
    safeStorage:{
        isEncryptionAvailable:()=>true,
        encryptString:v=>Buffer.from(v),
        decryptString:v=>v.toString()
    }
};
class BindingStore {
    constructor(root,codec){
        assert.equal(root,dir);
        assert.equal(codec.isAvailable(),true);
    }
}
class AuthGate {
    constructor(store,getAccount,online){
        assert.ok(store instanceof BindingStore);
        this.getAccount=getAccount;
        this.online=online;
    }
    async authorizeProjectTool(projectPath,tool){
        assert.equal(projectPath,"C:/test/BC350.eez-project");
        assert.equal(tool,"add_widget");
        const result=await this.online({
            tool,bindingId:"dev-test-binding",bindingSecret:"SHOULD_NOT_LEAK"
        });
        assert.equal(result.tool,"add_widget");
        assert.equal(this.getAccount().userId,"321");
        return {bindingId:"dev-test-binding",modelId:350,
            globalPolicyRevision:1,accountPolicyRevision:2,accountGeneration:9};
    }
}
const api={
    async checkMcpModelAccess(token,payload){
        apiCalls.push({name:"discovery",token,payload});
        return {scope:"DISCOVERY_ONLY",mcpUseGranted:true,
            projectBindingVerified:false,mcpExecutionAuthorized:false};
    },
    async authorizeMcpTool(token,payload){
        apiCalls.push({name:"authorize",token,payload});
        return {tool:payload.tool};
    }
};
Module._load=function(request,parent,isMain){
    if(request==="electron")return electron;
    if(request==="./main-server")return {
        startMcpServer:async (_win,policy)=>{starts.push(policy);return true;},
        stopMcpServer:()=>{},
        isMcpServerRunning:()=>true
    };
    if(request==="./codex-import")return{addDigiStudioToCodex:()=>({})};
    if(request==="./project-binding-store")return{McpProjectBindingStore:BindingStore};
    if(request==="./central-authorization")return{McpCentralAuthorizationGate:AuthGate};
    if(request==="main/digiwise-auth")return {
        getDigiwiseAuthGuard:()=>({authenticated:true,userId:"321",generation:9}),
        callDigiwisePublicApiWithSession:async fn=>({ok:true,data:await fn(api,"ide_MAIN_ONLY")})
    };
    return original.apply(this,arguments);
};
const oldDev=process.env.DIGISTUDIO_ENABLE_MCP;
const oldStage=process.env.DIGISTUDIO_MCP_CENTRAL_STAGE;
process.env.DIGISTUDIO_ENABLE_MCP="1";
(async()=>{
    for(const [packaged,stage,expected] of [
        [false,"1",true],[true,"1",false],[false,"0",false]
    ]){
        ipcMain.handlers.clear();
        delete require.cache[filename];
        electron.app.isPackaged=packaged;
        process.env.DIGISTUDIO_MCP_CENTRAL_STAGE=stage;
        const mod=require(filename);
        const window=new EventEmitter();
        window.webContents=new EventEmitter();
        window.isDestroyed=()=>false;
        window.webContents.isDestroyed=()=>false;
        await mod.registerMcpIntegration(window);
        const policy=starts.at(-1);
        assert.equal(!!policy,expected,
            "Central enforcement staging must be explicit and unavailable in packaged mode");
        if(expected){
            await policy.authorizeDiscovery();
            await policy.authorizeProjectTool("C:/test/BC350.eez-project","add_widget");
        }
        window.webContents.emit("destroyed");
    }
    assert.equal(apiCalls.length,2);
    assert.equal(apiCalls[0].token,"ide_MAIN_ONLY");
    assert.equal(apiCalls[1].token,"ide_MAIN_ONLY");
    assert.equal(apiCalls[0].payload.modelId,null);
    console.log("PASS: Main IDE integration stage opt-in, packaged mode never auto-enforced, Main-only IDE Bearer online authorization");
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;})
.finally(()=>{
    Module._load=original;
    if(oldDev===undefined)delete process.env.DIGISTUDIO_ENABLE_MCP;
    else process.env.DIGISTUDIO_ENABLE_MCP=oldDev;
    if(oldStage===undefined)delete process.env.DIGISTUDIO_MCP_CENTRAL_STAGE;
    else process.env.DIGISTUDIO_MCP_CENTRAL_STAGE=oldStage;
    rmSync(dir,{recursive:true,force:true});
});
