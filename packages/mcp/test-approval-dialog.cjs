/* Security checks for isolated MCP approval BrowserWindow.
 * Mocks native Electron; never opens an editor or grants real permissions.
 */
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const path = require("node:path");
const ipcMain = new EventEmitter();
const dialogs = [];

class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.webContents = new EventEmitter();
        this.webContents.mainFrame = { id: 12 };
        this.webContents.isDestroyed = () => this.destroyed;
        this.webContents.setWindowOpenHandler = handler => this.openHandler = handler;
        this.destroyed = false;
        dialogs.push(this);
    }
    isDestroyed() { return this.destroyed; }
    show() { this.shown = true; }
    close() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit("closed");
    }
    destroy() { this.close(); }
    async loadURL(url) {
        this.html = decodeURIComponent(url.split(",")[1]);
        setImmediate(() => this.webContents.emit("did-finish-load"));
    }
}
const original = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "electron") return { BrowserWindow: FakeBrowserWindow, ipcMain };
    return original.apply(this, arguments);
};
let showMcpApproval;
try {
    ({ showMcpApproval } = require(
        path.join(__dirname, "../../build/mcp/approval-dialog.js")
    ));
} finally { Module._load = original; }

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const parent = new EventEmitter();
parent.webContents = new EventEmitter();
parent.webContents.isDestroyed = () => false;
parent.isDestroyed = () => false;
const channel = "digistudio:mcp:approval-choice";

(async () => {
    let result = showMcpApproval(parent, "create_page", { name:"Safe" }, true);
    let modal = dialogs.at(-1);
    await delay(15);
    assert.equal(modal.shown, true);
    assert.equal(modal.options.parent, parent);
    assert.equal(modal.options.modal, true);
    assert.equal(modal.options.webPreferences.nodeIntegration, false);
    assert.equal(modal.options.webPreferences.contextIsolation, true);
    assert.equal(modal.options.webPreferences.sandbox, true);
    assert.ok(modal.options.webPreferences.preload.endsWith("approval-preload.js"));
    assert.equal(modal.openHandler({url:"https://example.com"}).action, "deny");
    let blocked = false;
    modal.webContents.emit("will-navigate", {preventDefault(){blocked = true;}});
    assert.ok(blocked);

    let settled = false;
    result.then(() => { settled = true; });
    ipcMain.emit(channel, {
        sender: parent.webContents, senderFrame: parent.webContents.mainFrame
    }, 2);
    await delay(10);
    assert.equal(settled, false, "Main's project renderer must not grant permissions");
    ipcMain.emit(channel, {
        sender: modal.webContents, senderFrame: { id: 99 }
    }, 2);
    await delay(10);
    assert.equal(settled, false, "Only the modal's Main frame may grant permission");
    ipcMain.emit(channel, {
        sender: modal.webContents, senderFrame: modal.webContents.mainFrame
    }, "session");
    await delay(10);
    assert.equal(settled, false, "Only integer permission values are valid");

    ipcMain.emit(channel, {
        sender: modal.webContents, senderFrame: modal.webContents.mainFrame
    }, 1);
    assert.equal(await result, 1);
    assert.equal(modal.destroyed, true);
    assert.equal(ipcMain.listenerCount(channel), 0);

    result = showMcpApproval(parent, "create_page", {name:"Closed"}, false);
    modal = dialogs.at(-1);
    modal.close();
    assert.equal(await result, 0, "Closing modal must deny by default");

    const ctrl = new AbortController();
    result = showMcpApproval(parent, "create_page", {}, true, ctrl.signal);
    modal = dialogs.at(-1);
    ctrl.abort();
    assert.equal(await result, 0, "Stopping MCP must revoke pending approval");
    assert.equal(modal.destroyed, true);

    const previousDialogs = dialogs.length;
    assert.equal(await showMcpApproval(parent,"delete_page",{},true,ctrl.signal),0);
    assert.equal(dialogs.length, previousDialogs);

    console.log("PASS: isolated modal security, anti-spoofed IPC, close/abort DENY, sandbox, navigation lockdown");
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
