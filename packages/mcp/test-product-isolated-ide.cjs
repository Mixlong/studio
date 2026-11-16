/**
 * Real standalone DigiwiseStudio IDE startup + MCP read-only acceptance.
 * It isolates APPDATA/LOCALAPPDATA and uses a previous test project in
 * artifacts/mcp-acceptance. It never modifies the user's profile or projects.
 *
 * Windows only: node packages/mcp/test-product-isolated-ide.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const artifactDir = path.join(root, "artifacts", "mcp-acceptance");
const output = path.join(artifactDir, "isolated-ide-acceptance.json");
const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const result = {
    isolated: true,
    startedAt: new Date().toISOString(),
    checks: [],
    status: "not-started"
};
const check = (name, value) => {
    result.checks.push({ name, status: "PASS", detail: value });
    console.log("PASS_ISOLATED_IDE", name, typeof value === "object" ?
        JSON.stringify(value) : value ?? "");
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Optional, pre-existing isolated demo for authenticated persistence checks.
// A fresh signed-out test does not require historical acceptance artifacts.
const savedDemo = process.argv[2] ? path.resolve(process.argv[2]) : null;

let child;
let profile;
let bootstrap;
let stderr = "", stdout = "";
async function run() {
    try {
    if (process.platform !== "win32") {
        console.log("SKIP isolated Windows full IDE test (non-Windows host)");
        result.status = "skipped-non-windows";
        return;
    }
    assert.ok(fs.existsSync(electron), "Development Electron executable missing");
    if (savedDemo) {
        assert.ok(fs.existsSync(savedDemo), "Isolated test demo missing");
        assert.ok(savedDemo.toLowerCase()
            .startsWith(path.resolve(artifactDir).toLowerCase() + path.sep),
            "Demo must remain under the MCP acceptance directory");
    }

    // Own NEW profile, separate from %APPDATA%/DigiwiseStudio.
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "digi-mcp-product-"));
    const appData = path.join(profile, "Roaming");
    const localAppData = path.join(profile, "Local");
    fs.mkdirSync(appData, { recursive: true });
    fs.mkdirSync(localAppData, { recursive: true });
    const session = path.join(appData, "DigiwiseStudio", "mcp-session.json");
    const env = {
        ...process.env,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        DIGISTUDIO_ENABLE_MCP: "1",
        DIGISTUDIO_MCP_TEST_APPDATA: appData,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
    };
    delete env.ELECTRON_RUN_AS_NODE;
    // Electron on Windows uses the OS KnownFolder for appData rather than
    // the APPDATA environment variable. Bootstrap *before* application Main
    // registers its userData path, without changing the product code.
    bootstrap = path.join(root, `.mcp-isolated-bootstrap-${process.pid}-${Date.now()}.cjs`);
    fs.writeFileSync(bootstrap, [
        'const { app } = require("electron");',
        'const fs = require("node:fs");',
        'const isolated = process.env.DIGISTUDIO_MCP_TEST_APPDATA;',
        'if (!isolated || !fs.existsSync(isolated)) throw new Error("No isolated appData");',
        'app.setPath("appData", isolated);',
        'app.on("web-contents-created", (_e, wc) => {',
        '  console.error("[ISOLATED] webContents created", wc.id);',
        '  wc.on("did-finish-load", () => {',
        '    console.error("[ISOLATED] did-finish-load", wc.id, wc.getURL().slice(0,150));',
        '    for (const ms of [1000, 7000, 18000]) setTimeout(() => {',
        '      if (wc.isDestroyed()) return;',
        '      wc.executeJavaScript("JSON.stringify({state:document.readyState,title:document.title,bodyLength:document.body?.innerText?.length||0,hasHome:!!document.querySelector(\\\"#EezStudio_Content\\\"),rootChildren:document.querySelector(\\\"#EezStudio_Content\\\")?.childElementCount||0,scripts:document.scripts.length})")',
        '        .then(x => console.error("[ISOLATED] DOM after", ms, wc.id, x))',
        '        .catch(e => console.error("[ISOLATED] DOM error", String(e.message).slice(0,180)));',
        '    }, ms);' ,
        '  });',
        '  wc.on("did-fail-load", (_event, code, description, url) =>',
        '    console.error("[ISOLATED] did-fail-load", code, description, String(url).slice(0,120)));',
        '  wc.on("render-process-gone", (_event, details) =>',
        '    console.error("[ISOLATED] renderer-exited", details?.reason));',
        '  wc.on("console-message", (...args) => {',
        '    const details = args[0];',
        '    const message = details?.message || args[2];',
        '    if (message) console.error("[ISOLATED] renderer-console", wc.id, String(message).slice(0,340));',
        '  });',
        '});',
        'require("./build/main/main.js");'
    ].join("\n"));
    child = spawn(electron, [bootstrap, ...(savedDemo ? [savedDemo] : [])], {
        cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false
    });
    result.launchPid = child.pid;
    result.profileIsolated = path.resolve(appData).toLowerCase() !==
        path.resolve(process.env.APPDATA || "").toLowerCase();
    assert.equal(result.profileIsolated, true);
    child.stdout.on("data", b => { stdout = (stdout + b.toString()).slice(-10000); });
    child.stderr.on("data", b => { stderr = (stderr + b.toString()).slice(-10000); });
    child.on("error", err => { result.launchError = err.message; });
    check("unique isolated Electron profile", {pid:child.pid});

    let metadata;
    for(let i=0;i<180;i++){
        if(child.exitCode!==null || child.signalCode) break;
        if(fs.existsSync(session)){
            try { metadata=JSON.parse(fs.readFileSync(session,"utf8")); break; }
            catch {}
        }
        await delay(350);
    }
    if(!metadata) throw new Error("Isolated IDE did not open MCP session: " +
        JSON.stringify({exit:child.exitCode, log:stderr.slice(-1200)}));
    assert.equal(metadata.pid, child.pid,
        "Isolated session must belong to spawned test process");
    assert.ok(metadata.socketPath && metadata.token);
    check("real Electron Main MCP server", { pid:metadata.pid, registryVersion:metadata.registryVersion });

    process.env.DIGISTUDIO_MCP_SESSION_FILE = session;
    const {callBridge} = await import("./bridge-client.mjs");
    let capabilities;
    let lastError;
    const bridgeFailures = [];
    for(let attempt=0;attempt<48;attempt++){
        try { capabilities=await callBridge("get_mcp_capabilities",{}); break; }
        catch(err){
            lastError=err;
            bridgeFailures.push({attempt,code:err.code||null,message:err.message.slice(0,260)});
            if (err.code === "AUTH_REQUIRED") break;
            await delay(950);
        }
    }
    result.bridgeFailures = bridgeFailures;
    if (!capabilities && lastError?.code === "AUTH_REQUIRED") {
        await assert.rejects(callBridge("get_current_project",{}),
            err => err.code === "AUTH_REQUIRED");
        const forbiddenPath = path.join(profile, "must-not-create.eez-project");
        await assert.rejects(callBridge("create_project",{
            projectPath:forbiddenPath, lvglVersion:"8.4.0",
            displayWidth:800,displayHeight:480
        }), err => err.code === "AUTH_REQUIRED");
        assert.equal(fs.existsSync(forbiddenPath),false);
        check("signed-out isolated IDE denies MCP reads and writes",{
            errorCode:"AUTH_REQUIRED", fileCreated:false
        });
        result.status="passed-real-isolated-ide-auth-boundary";
        return;
    }
    if (!capabilities) throw new Error("MCP Renderer did not respond: " +
        (lastError?.code||"") + " " + (lastError?.message||lastError));
    assert.equal(capabilities.readTools.length,19);
    assert.equal(capabilities.writeTools.length,37);
    check("real Main+Renderer MCP capabilities",{
        reads:capabilities.readTools.length,writes:capabilities.writeTools.length,
        palette:capabilities.creatableWidgetTypes.length
    });

    assert.ok(savedDemo, "Fresh isolated profile unexpectedly allowed MCP without sign-in");
    let project;
    for(let i=0;i<35;i++){
        try {
            project=await callBridge("get_current_project",{});
            if(path.resolve(project.path).toLowerCase() ===
                path.resolve(savedDemo).toLowerCase()) break;
        } catch(err){lastError=err;}
        await delay(850);
    }
    if (!project || path.resolve(project.path).toLowerCase() !==
        path.resolve(savedDemo).toLowerCase()) {
        throw new Error("Isolated project did not open automatically: " +
            (lastError?.message || JSON.stringify(project)));
    }
    assert.equal(project.modified,false);
    check("existing demo opened read-only", {
        path:project.path,lvgl:project.lvglVersion,modified:project.modified
    });
    const pages=await callBridge("list_pages");
    assert.ok(pages.pages.some(p=>p.name==="Main"));
    assert.ok(pages.pages.some(p=>p.name==="Blocked"));
    assert.ok(pages.pages.some(p=>p.name==="Approved"));
    const actions=await callBridge("list_actions");
    assert.ok(actions.actions.some(a=>a.name==="McpCheckReady"));
    check("saved pages and advanced Flow restored",{pages:pages.pages.length,actions:actions.actions.length});
    result.status="passed-real-isolated-ide-mcp-read";
} catch(err){
    result.status="failed";
    result.error=String(err?.stack||err);
    console.error("FAIL_ISOLATED_IDE", result.error);
    process.exitCode=1;
} finally {
    delete process.env.DIGISTUDIO_MCP_SESSION_FILE;
    if(typeof stdout === "string") result.stdoutTail = stdout.slice(-3000);
    if(typeof stderr === "string") result.stderrTail = stderr.slice(-5000);
    if(child && Number.isInteger(child.pid)) {
        // The tree is exclusively test-owned, verified by the unique profile.
        // Windows taskkill /T only targets that known test-spawned PID.
        const stopped=spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{
            windowsHide:true,encoding:"utf8",timeout:12000
        });
        result.cleanup={
            isolatedPid:child.pid,exitCode:stopped.status,
            details:(stopped.stdout||stopped.stderr||"").slice(0,300)
        };
        if(stopped.status!==0 && child.exitCode===null){
            console.error("WARN: Unable to close only isolated test process",result.cleanup);
            process.exitCode=1;
        }
    }
    if(bootstrap){
        try {fs.rmSync(bootstrap,{force:true});}
        catch(err){result.bootstrapCleanupError=err.message;}
    }
    if(profile){
        try {fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:250});}
        catch(err){result.profileCleanupError=err.message;}
    }
    result.finishedAt=new Date().toISOString();
    fs.mkdirSync(artifactDir,{recursive:true});
    fs.writeFileSync(output,JSON.stringify(result,null,2));
    console.log("ISOLATED_IDE_PRODUCT_REPORT",output,result.status);
}
}
void run();
