/* User-desktop-only native Electron MCP authorization acceptance runner.
 * Child app uses its OWN mkdtemp userData and has no access to the user's IDE
 * or active LVGL project; never kill or restart the user application.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const electronExecutable = require("electron");
const smokeScript = path.join(__dirname, "test-approval-native-electron.cjs");
const reportFile = path.join(root, "artifacts", "mcp-acceptance",
    "mcp-approval-native-report.json");
try { fs.rmSync(reportFile, {force:true}); }
catch (error) { console.error("Cannot reset native test report:",error.message); process.exit(2); }

const child = spawn(electronExecutable, [smokeScript], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env }
});
let timedOut = false;
let exited = false;
const watchdog = setTimeout(() => {
    if (exited) return;
    timedOut = true;
    console.error("FAIL: Isolated native MCP approval test exceeded 60 seconds");
    child.kill(); // ONLY the isolated test process started above.
}, 60000);
child.once("error", error => {
    if (exited) return;
    exited = true;
    clearTimeout(watchdog);
    console.error("FAIL: Unable to start isolated Electron approval test:",error.message);
    process.exitCode = 1;
});
child.once("exit", (code, signal) => {
    if (exited) return;
    exited = true;
    clearTimeout(watchdog);
    if (timedOut || code !== 0 || signal) {
        console.error("FAIL: Native MCP approval test failed", {code, signal, timedOut});
        process.exitCode = 1;
        return;
    }
    try {
        const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
        const required = [
            "deny button", "single write approval", "session write approval",
            "ESC denies", "custom X close denies",
            "session revoke abort denies",
            "no modal window leaked after six real interactions"
        ];
        const done = new Set(report.results?.filter(x=>x.passed).map(x=>x.name));
        for(const name of required) {
            if(!done.has(name)) throw new Error("Missing native approval check: "+name);
        }
        if(report.result!=="passed" || report.isolated!==true) {
            throw new Error("Native test did not report isolated PASS");
        }
        console.log("PASS: Native Electron MCP authorization product gate, "+
            required.length+" checks, screenshot and JSON report saved");
    } catch(error) {
        console.error("FAIL: Native MCP test result not verified:",error.message);
        process.exitCode = 1;
    }
});
