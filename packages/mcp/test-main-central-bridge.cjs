/* Real local-socket Main integration: staged central backend authorization.
 * No real user project, account, or database involved. All files in temp.
 */
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {mkdtempSync, readFileSync, existsSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join} = require("node:path");
const Module = require("node:module");

const dir = mkdtempSync(join(tmpdir(),"digi-mcp-central-main-"));
const pageA = join(dir,"BC350.eez-project");
const pageB = join(dir,"OTHER.eez-project");
let activePath = pageA;
const app = new EventEmitter();
app.getPath = p => p==="userData"?dir:undefined;
const ipcMain = new EventEmitter();
let generation=5,authenticated=true,approved="deny",prompts=0;
let writeCount=0,readCount=0,probes=0,centralChecks=0;
let online=true,discoverable=true;
let overrideDecision=null;
let resolveApproval=null;
const dialog = async (_window,tool,args,isChinese,signal) => {
    prompts++;
    if (approved==="defer") {
        return new Promise(resolve => {
            resolveApproval=resolve;
            signal.addEventListener("abort",()=>resolve(0),{once:true});
        });
    }
    return approved==="session"?2:approved==="allow"?1:0;
};
const webContents=new EventEmitter();
webContents.mainFrame={id:2};
webContents.isDestroyed=()=>false;
webContents.isCrashed=()=>false;
webContents.isLoadingMainFrame=()=>false;
webContents.send=(channel,req)=>{
    if(channel==="digi:mcp:renderer-probe")return;
    assert.equal(channel,"digi:mcp:request");
    let output;
    if(req.tool==="get_current_project") {
        probes++;
        output={path:activePath,modified:false};
    }else if(req.authorizedProjectPath &&
            req.authorizedProjectPath!==activePath) {
        output=null;
    }else {
        assert.ok(req.authorizedProjectPath ||
            req.tool==="get_mcp_capabilities",
            "Non-discovery tool must contain Main-authorized project");
        if(req.tool==="get_mcp_capabilities")readCount++;
        else if(req.tool==="create_page")writeCount++;
        else readCount++;
        output={tool:req.tool,accepted:true};
    }
    setImmediate(()=>ipcMain.emit("digi:mcp:response",{
        sender:webContents,senderFrame:webContents.mainFrame
    },output?{id:req.id,ok:true,result:output}:
        {id:req.id,ok:false,error:{code:"PROJECT_CHANGED",message:"Project switched"}}));
};
const win=new EventEmitter();
win.webContents=webContents;
win.isDestroyed=()=>false;
win.isVisible=()=>true;
const original=Module._load;
Module._load=function(request,parent,isMain){
    if(request==="electron")return{app,ipcMain};
    if(request==="main/digiwise-auth")return{
        getDigiwiseAuthGuard:()=>({authenticated,generation})
    };
    if(request==="main/settings")return{
        getLocale:()=> "en",settings:{isDarkTheme:true}
    };
    if(request==="./approval-dialog")return{showMcpApproval:dialog};
    if(request==="./create-project")return{
        createMcpProject:async()=>{throw new Error("Central create must never run");}
    };
    return original.apply(this,arguments);
};
let startMcpServer,stopMcpServer;
try{({startMcpServer,stopMcpServer}=require("../../build/mcp/main-server.js"));}
finally{Module._load=original;}
const policy={
    authorizeDiscovery:async()=>{
        if(!discoverable)throw new Error("Global MCP disabled");
    },
    authorizeProjectTool:async(path,tool)=>{
        centralChecks++;
        if(!online)throw new Error("Policy denied or backend down");
        assert.equal(path,activePath,"Main must get path from active renderer tab");
        if(overrideDecision) return overrideDecision(path,tool);
        const bindingId=path===pageA?"binding-A":"binding-B";
        return {
            bindingId,modelId:path===pageA?350:999,
            globalPolicyRevision:2,accountPolicyRevision:7,
            accountGeneration:generation
        };
    }
};
(async()=>{
    const {callBridge}=await import("./bridge-client.mjs");
    process.env.DIGISTUDIO_MCP_SESSION_FILE=join(dir,"mcp-session.json");
    const write=()=>callBridge("create_page",{
        expectedProjectPath:activePath,name:"NewPage"
    });
    try {
        assert.equal(await startMcpServer(win,policy),true);
        assert.ok(existsSync(process.env.DIGISTUDIO_MCP_SESSION_FILE));
        ipcMain.emit("digi:mcp:renderer-ready",{
            sender:webContents,senderFrame:webContents.mainFrame
        },"mcp-2026-11-13-r19w37-central-stage");
        discoverable=false;
        await assert.rejects(callBridge("get_mcp_capabilities",{}),
            e=>e.code==="MCP_POLICY_UNAVAILABLE");
        assert.equal(readCount,0);
        discoverable=true;
        await callBridge("get_mcp_capabilities",{});
        assert.equal(readCount,1);
        online=false;
        await assert.rejects(callBridge("list_pages",{}),
            e=>e.code==="MCP_POLICY_UNAVAILABLE");
        assert.equal(readCount,1,"No project reads while backend is down");
        online=true;
        await callBridge("list_pages",{});
        assert.equal(readCount,2);
        assert.equal(centralChecks,2);
        assert.ok(probes>=2,"Main must privately probe actual selected project");

        approved="deny";
        await assert.rejects(write(),e=>e.code==="WRITE_REJECTED");
        assert.equal(writeCount,0);
        approved="session";
        await write();
        assert.equal(writeCount,1);
        const promptAfterSession=prompts;
        approved="deny";
        await write();
        assert.equal(prompts,promptAfterSession,
            "Same account/project/tool/version may reuse consent after fresh online check");
        assert.equal(writeCount,2);

        activePath=pageB;
        await assert.rejects(write(),e=>e.code==="WRITE_REJECTED");
        assert.equal(prompts,promptAfterSession+1,
            "Switching project invalidates session consent scope");
        assert.equal(writeCount,2);
        activePath=pageA;
        await assert.rejects(write(),e=>e.code==="WRITE_REJECTED");
        assert.equal(prompts,promptAfterSession+2,
            "Returning to a previously authorized project must require new consent");
        online=false;
        await assert.rejects(write(),e=>e.code==="MCP_POLICY_UNAVAILABLE");
        assert.equal(writeCount,2,"Backend revoke must stop a granted session write");
        online=true;
        await assert.rejects(callBridge("create_project",{
            projectPath:join(dir,"unauthorized.eez-project")
        }),e=>e.code==="PROJECT_UNBOUND");
        assert.equal(writeCount,2);

        // Native confirmation may be long, server decision must be rechecked
        // after clicking, preventing revoke-during-prompt race.
        activePath=pageB;approved="defer";resolveApproval=null;
        const awaiting=write();
        const deadline=Date.now()+3000;
        while(!resolveApproval) {
            if(Date.now()>deadline) throw new Error("Approval prompt not shown");
            await new Promise(r=>setTimeout(r,20));
        }
        online=false;
        resolveApproval(1);
        await assert.rejects(awaiting,e=>e.code==="MCP_POLICY_UNAVAILABLE");
        assert.equal(writeCount,2);
        online=true;
        authenticated=false;
        await assert.rejects(callBridge("list_pages",{}),
            e=>e.code==="AUTH_REQUIRED");
        console.log("PASS: staged Main socket online auth: discovery, private active-path probe, offline fail-closed, scoped consent, project switch, revoked-during-dialog, unbound create");
    } finally {
        stopMcpServer();
        delete process.env.DIGISTUDIO_MCP_SESSION_FILE;
        rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:150});
    }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
