/* Diagnostic: real WASM page-transition frame stability, isolated demo only.
 * No project edits; requires standard local approval for preview start/tap/stop.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callBridge } from "./bridge-client.mjs";
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const base = path.resolve("artifacts/mcp-acceptance/flow-click-cZQrNV");
const expectedPath = path.join(base, "Flow_Click_MCP.eez-project");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const getStatus = async () => await callBridge("get_preview_status", {});
const png = async pageId => {
    const frame = await callBridge("get_preview_snapshot", { pageId });
    const bytes = Buffer.from(frame.pngBase64, "base64");
    return { frame, bytes, pixels: PNG.sync.read(bytes) };
};
const sha = x => createHash("sha256").update(x).digest("hex").slice(0,12);
const diff = (a,b) => {
    if(a.width!==b.width || a.height!==b.height)throw new Error("different PNG dimensions");
    let changes=0, score=0;
    for(let i=0;i<a.data.length;i+=4){
        const d=Math.abs(a.data[i]-b.data[i])+
            Math.abs(a.data[i+1]-b.data[i+1])+
            Math.abs(a.data[i+2]-b.data[i+2]);
        if(d>72){changes++;}
        score+=d;
    }
    return { changedPercent: Number((100*changes/(a.width*a.height)).toFixed(3)),
        meanRgbDelta: Number((score/(a.width*a.height*3)).toFixed(3)) };
};
let started = false;
const report = { projectPath:expectedPath, frames:[] };
try{
    const current=await callBridge("get_current_project",{});
    assert.equal(path.resolve(current.path).toLowerCase(),expectedPath.toLowerCase());
    assert.equal(current.modified,false);
    assert.ok(existsSync(expectedPath));
    const startedResult=await callBridge("start_preview",{expectedProjectPath:expectedPath});
    started=!!startedResult.requested;
    assert.ok(started);
    let s;
    for(let i=0;i<48;i++){
        s=await getStatus();
        if(s.state==="running"&&s.selectedPage==="Main"&&s.selectedPageId)break;
        await delay(250);
    }
    assert.equal(s.selectedPage,"Main");
    const before=await png(s.selectedPageId);
    writeFileSync(path.join(base,"transition-before.png"),before.bytes);
    const tapped=await callBridge("preview_tap",{
        expectedProjectPath:expectedPath,pageId:s.selectedPageId,x:400,y:375
    });
    report.tap=tapped;
    for(const ms of [0,150,350,700,1200,2000]){
        if(ms) await delay(ms ===150 ? 150 : ms-[0,150,350,700,1200,2000][[0,150,350,700,1200,2000].indexOf(ms)-1]);
        const status=await getStatus();
        const frame=await png(status.selectedPageId);
        const delta=diff(before.pixels,frame.pixels);
        const filename=`transition-after-${ms}.png`;
        writeFileSync(path.join(base,filename),frame.bytes);
        report.frames.push({ afterMs:ms, page:status.selectedPage,
            hash:sha(frame.bytes), ...delta, file:filename });
    }
    report.result="captured";
    console.log("FLOW_FRAME_TRANSITION_DIAGNOSTIC",JSON.stringify(report));
} catch(error){
    report.result="failed";report.error=String(error?.message||error);
    process.exitCode=1;
    console.error("FLOW_FRAME_DIAGNOSTIC_ERROR",report.error);
} finally{
    if(started)try{
        await callBridge("stop_preview",{expectedProjectPath:expectedPath});
    }catch(e){console.error("STOP_ERROR",e.message);process.exitCode=1;}
    try{report.modifiedAfter=(await callBridge("get_current_project",{})).modified;}
    catch(e){report.afterError=e.message;}
    writeFileSync(path.join(base,"frame-transition-diagnostic.json"),
        JSON.stringify(report,null,2));
}
