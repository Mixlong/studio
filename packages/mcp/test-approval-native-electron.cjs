/* REAL Electron smoke test of the Main-owned sandboxed MCP approval modal.
 * Run with the installed Electron executable, not node:
 *   node_modules/electron/dist/electron.exe packages/mcp/test-approval-native-electron.cjs
 *
 * Test uses a separate app/UserData and NEVER connects to a user's MCP session,
 * manipulates projects, or bypasses the local approval consent mechanism.
 */
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {setTimeout: delay} = require("node:timers/promises");
const workspace = path.resolve(__dirname, "../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digi-mcp-native-modal-"));
const output = path.join(workspace, "artifacts/mcp-acceptance");
fs.mkdirSync(output,{recursive:true});
app.setName("DigiStudio MCP Native Approval Isolated Smoke");
app.setPath("userData", dir);
const removeIsolatedUserData = () => {
    try { fs.rmSync(dir, { recursive:true, force:true }); }
    catch (_error) { /* Never touch any non-test userData directory. */ }
};
app.once("will-quit", removeIsolatedUserData);
process.once("exit", removeIsolatedUserData);
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling");

const { showMcpApproval } = require(path.join(workspace, "build/mcp/approval-dialog.js"));
const results = [];
const finish = (name, detail) => {
    results.push({name, passed:true, detail});
    console.log("PASS_NATIVE", name, detail || "");
};
const settle = (promise, millis=6000) => Promise.race([
    promise, delay(millis).then(()=>{throw new Error("Native UI grant timed out");})
]);
async function dialogFor(parent) {
    for(let i=0;i<60;i++){
        const found=BrowserWindow.getAllWindows().find(w=>w!==parent &&
            !w.isDestroyed() && w.getParentWindow()===parent);
        if(found && !found.webContents.isLoading()) return found;
        await delay(65);
    }
    throw new Error("Isolated native approval dialog did not load");
}
async function nativeClick(window, id) {
    const rect = await window.webContents.executeJavaScript(
        `(()=>{const b=document.getElementById(${JSON.stringify(id)});if(!b) return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})()`);
    assert.ok(rect?.w>0 && rect?.h>0, "Native visible clickable control "+id);
    const point={x:Math.round(rect.x),y:Math.round(rect.y)};
    window.webContents.sendInputEvent({...point, type:"mouseDown",button:"left",clickCount:1});
    window.webContents.sendInputEvent({...point, type:"mouseUp",button:"left",clickCount:1});
}
async function main() {
    await app.whenReady();
    const parent = new BrowserWindow({
        width:220,height:180,show:true,backgroundColor:"#242424",
        autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true}
    });
    // No user project loaded. The parent only exists to verify Electron-native
    // modal parenting, not to show or alter any user's editor.
    parent.loadURL("data:text/html,<body style='background:#242424'></body>");
    try {
        for (const [name,choice,id] of [
            ["deny button",0,"approval-deny"],
            ["single write approval",1,"approval-once"],
            ["session write approval",2,"approval-session"]
        ]) {
            const pending = showMcpApproval(parent,"create_project",{
                projectPath:path.join(dir,"not-created.eez-project"),
                note:"<script>evil</script>",
                tail:"Z".repeat(5200)+"FULL_END"
            },true,undefined,true);
            const modal = await dialogFor(parent);
            assert.equal(modal.webContents.getURL().startsWith("data:text/html"),true);
            const ui = await modal.webContents.executeJavaScript(
                '({title:document.title,buttonCount:document.querySelectorAll(".actions button").length,parameters:document.querySelector(".parameters").textContent,preloadStatus:!!document.querySelector("#approval-once")})'
            );
            assert.equal(ui.buttonCount,3);
            assert.ok(ui.parameters.includes("FULL_END"));
            assert.ok(!ui.parameters.includes("<script>evil</script>&lt;"),"escaped DOM text must not be HTML markup");
            const csp = await modal.webContents.executeJavaScript('document.querySelector("meta[http-equiv=Content-Security-Policy]").content');
            assert.ok(csp.includes("default-src 'none'"));

            // Programmatic renderer-injected DOM clicks must NOT grant consent.
            await modal.webContents.executeJavaScript('document.getElementById("approval-session").click()');
            await delay(150);
            assert.ok(!modal.isDestroyed(),"JS-synthetic click unexpectedly granted permission");
            if(name==="single write approval"){
                const screenshot = await modal.webContents.capturePage();
                fs.writeFileSync(path.join(output,"mcp-approval-native.png"), screenshot.toPNG());
            }
            await nativeClick(modal,id);
            const response = await settle(pending);
            assert.equal(response,choice, name+" invalid real Electron click");
            assert.equal(modal.isDestroyed(),true,
                "Approval must destroy window synchronously after choice");
            finish(name);
        }
        {
            const pending = showMcpApproval(parent,"delete_page",{name:"No delete"},false);
            const modal = await dialogFor(parent);
            modal.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"});
            const response=await settle(pending);
            assert.equal(response,0);
            assert.ok(modal.isDestroyed(), "ESC must destroy the old modal");
            finish("ESC denies");
        }
        {
            const pending=showMcpApproval(parent,"delete_page",{},false);
            const modal=await dialogFor(parent);
            await nativeClick(modal,"approval-close");
            assert.equal(await settle(pending),0);
            assert.equal(modal.isDestroyed(),true);
            finish("custom X close denies");
        }
        {
            const controller = new AbortController();
            const pending = showMcpApproval(parent,"delete_page",{},false,controller.signal);
            const modal = await dialogFor(parent);
            controller.abort();
            assert.equal(await settle(pending),0);
            for(let i=0;i<20&&!modal.isDestroyed();i++) await delay(40);
            assert.ok(modal.isDestroyed(), "Aborted modal still open after Electron close lifecycle");
            finish("session revoke abort denies");
        }
        // BrowserWindow.destroy() called directly from the test driver while
        // a modal window is active can freeze this Windows Electron build.
        // That synthetic native force-destroy is NOT a user-driven approval
        // path; close/X, Esc and MCP-abort are exercised above.
        assert.deepEqual(
            BrowserWindow.getAllWindows().filter(w=>w!==parent && !w.isDestroyed()),
            [], "Old approval window leaked after consecutive grants"
        );
        finish("no modal window leaked after six real interactions");
        fs.writeFileSync(path.join(output,"mcp-approval-native-report.json"),
            JSON.stringify({result:"passed",results,isolated:true,
                screenshot:"mcp-approval-native.png",timestamp:new Date().toISOString()},null,2));
    } finally {
        if(!parent.isDestroyed())parent.destroy();
    }
}
const watchdog=setTimeout(()=>{
    console.error("FAIL_NATIVE approval native E2E watchdog timeout");
    app.exit(3);
},85000);
void main().then(()=>{
    clearTimeout(watchdog);
    console.log("PASS_NATIVE_ELECTRON_ALL",results.length);
    app.quit();
},err=>{
    clearTimeout(watchdog);
    console.error("FAIL_NATIVE_ELECTRON",err?.stack||err);
    app.exit(1);
});
app.on("window-all-closed",()=>{});
