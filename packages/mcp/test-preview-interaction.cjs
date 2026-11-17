/* Native WASM preview pixel isolation + safe single-tap tests (no Electron).
 * Tests actual compiled renderer adapter functions and never touches a user project.
 */
const assert = require("node:assert/strict");
const { join } = require("node:path");
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
    if (name === "project-editor/project/project-type-traits")
        return { RuntimeType: { NONE: 0, WASM: 1, REMOTE: 2 } };
    return originalLoad.apply(this, arguments);
};
let snapshot, tap;
try {
    ({ capturePreviewSnapshot: snapshot, tapPreview: tap } = require(
        join(__dirname, "../../build/mcp/adapter/preview-interaction.js")
    ));
} finally { Module._load = originalLoad; }

const page = { name: "Demo", objID: "page-1", width: 800, height: 480, left: 0, top: 0 };
const source = {
    isConnected: true, width: 800, height: 480,
    getClientRects: () => [1],
    getBoundingClientRect: () => ({ width: 800, height: 480 }),
    getAttribute: key => key === "data-digi-mcp-preview-project-id" ? "project-1" : null
};
const runtime = {
    isRunning: true, isStopped: false, isPaused: false, isDebuggerActive: false,
    selectedPage: page, lastScreen: [0], ctx: { canvas: source },
    displayWidth: 800, displayHeight: 480, pointerEvents: []
};
const store = {
    projectTypeTraits: { runtimeType: 1 },
    project: { objID: "project-1", pages: [page] }, runtime
};
let drawn;
let responseImage = "data:image/png;base64," + "A".repeat(32);
const doc = {
    querySelectorAll: () => [source],
    createElement: name => {
        assert.equal(name, "canvas");
        return {
            getContext: kind => kind === "2d" ? { drawImage: (...args) => { drawn = args; } } : null,
            toDataURL: type => { assert.equal(type, "image/png"); return responseImage; }
        };
    }
};
const expectCode = (callback, code) => {
    assert.throws(callback, err => err.code === code);
};
(async () => {
    const frame = snapshot(store, "page-1", doc);
    assert.equal(frame.pageId, "page-1");
    assert.equal(frame.simulationVerified, true);
    assert.equal(frame.frameVerified, true);
    assert.equal(frame.capturedWidth, 800);
    assert.equal(frame.capturedHeight, 480);
    assert.equal(drawn[0], source);
    expectCode(() => snapshot(store, "stale", doc), "INVALID_STATE");
    expectCode(() => snapshot(store, "page-1", { ...doc, querySelectorAll: () => [source, source] }), "INVALID_STATE");
    expectCode(() => snapshot(store, "page-1", { ...doc, querySelectorAll: () => [{ ...source }] }), "INVALID_STATE");
    runtime.isPaused = true;
    expectCode(() => snapshot(store, "page-1", doc), "INVALID_STATE");
    runtime.isPaused = false;
    runtime.lastScreen = undefined;
    expectCode(() => snapshot(store, "page-1", doc), "INVALID_STATE");
    runtime.lastScreen = [0];
    responseImage = "data:image/png;base64," + "A".repeat(1_350_008);
    expectCode(() => snapshot(store, "page-1", doc), "LIMIT_EXCEEDED");
    responseImage = "data:image/png;base64," + "A".repeat(32);
    store.projectTypeTraits.runtimeType = 2;
    expectCode(() => snapshot(store, "page-1", doc), "INVALID_STATE");
    store.projectTypeTraits.runtimeType = 1;
    await assert.rejects(tap(store, "page-1", 800, 20, doc), e => e.code === "INVALID_ARGUMENT");
    await assert.rejects(tap(store, "wrong-page", 20, 20, doc), e => e.code === "INVALID_STATE");
    const dispatched = await tap(store, "page-1", 100, 120, doc);
    assert.equal(dispatched.dispatched, true);
    assert.equal(dispatched.actionEffectVerified, false);
    assert.equal(dispatched.currentPageId, "page-1");
    assert.deepEqual(runtime.pointerEvents, [
        { x: 100, y: 120, pressed: 1 },
        { x: 100, y: 120, pressed: 0 }
    ]);
    await assert.rejects(tap(store, "page-1", 100, 120, doc), e => e.code === "INVALID_STATE");
    console.log("PASS: native WASM preview frame ownership/cropping/limits + safe tap press/release/rate-limit");
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
