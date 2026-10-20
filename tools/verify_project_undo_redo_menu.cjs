"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { stripTypeScriptTypes } = require("module");
const { makeObservable, observable, computed, action, autorun, runInAction } = require("mobx");
const root = path.resolve(__dirname, "..");
const read = file =>
    fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const untype = src => stripTypeScriptTypes(src, { mode: "transform" });
const section = (src, first, last) => {
    const start = src.indexOf(first);
    const end = src.indexOf(last, start);
    assert(start >= 0 && end > start, "Missing section: " + first);
    return src.slice(start, end);
};
const undoSource = read("packages/project-editor/store/undo-manager.ts");
const undoClass = untype(section(undoSource, "export class UndoManager", "\nexport interface ICommand").replace("export class UndoManager", "class UndoManager"));
const undoContext = { makeObservable, observable, computed, action, module: { exports: {} } };
vm.runInNewContext(undoClass + "\nmodule.exports = UndoManager;", undoContext);
const UndoManager = undoContext.module.exports;

let value = 0;
const fakeProjectStore = {
    revision: Symbol(),
    project: { enableTabs() {} },
    setModified(next) {
        const previous = this.revision;
        this.revision = next;
        return previous;
    },
    updateLastRevisionStable() {}
};
const manager = new UndoManager(fakeProjectStore);
const recorded = [];
const ipcRenderer = { send: (...args) => recorded.push(args) };
const storeSource = read("packages/project-editor/store/index.ts");
const method = untype("class Harness {\n" +
    section(storeSource, "    updateProjectWindowState() {", "\n    updateMruFilePath() {") +
    "\n}");
const storeContext = { ipcRenderer, module: { exports: {} } };
vm.runInNewContext(method + "\nmodule.exports = Harness;", storeContext);
const store = new storeContext.module.exports();
store.context = { type: "project-editor" };
store.project = { extensionDefinitions: [] };
store.undoManager = manager;
store.isModified = true;
store.runtime = undefined;
store.filePath = "/workspace/S350_GUI.eez-project";
store.isActiveProjectTab = false;
makeObservable(store, { isActiveProjectTab: observable });
const stop = autorun(() => store.updateProjectWindowState());

assert.equal(recorded.length, 0);
manager.executeCommand({ description: "Resize widget", execute() { value++; }, undo() { value--; } });
assert.equal(value, 1);
assert.equal(manager.canUndo, true);
assert.equal(recorded.length, 0);
runInAction(() => store.isActiveProjectTab = true);
assert.equal(recorded.at(-1)[0], "windowSetState");
assert.equal(recorded.at(-1)[1].undo, "Resize widget");
assert.equal(recorded.at(-1)[1].redo, null);
manager.undo();
assert.equal(value, 0);
assert.equal(manager.canUndo, false);
assert.equal(manager.canRedo, true);
assert.equal(recorded.at(-1)[1].undo, null);
assert.equal(recorded.at(-1)[1].redo, "Resize widget");
manager.redo();
assert.equal(value, 1);
assert.equal(manager.canUndo, true);
assert.equal(manager.canRedo, false);
assert.equal(recorded.at(-1)[1].redo, null);
manager.executeCommand({
    description: "",
    execute() { value++; },
    undo() { value--; }
});
assert.equal(recorded.at(-1)[1].undo, "Undo",
    "An empty command description cannot disable the native menu");
runInAction(() => store.isActiveProjectTab = false);
const lastCount = recorded.length;
manager.undo();
assert.equal(recorded.length, lastCount, "Inactive project must not override menu");
stop();

const mainMenu = read("packages/main/menu.ts");
const source = section(mainMenu, "function buildEditMenu(win:", "\nfunction buildViewMenu(");
const globalHistory = { canUndo: true, canRedo: true, undo() {}, redo() {} };
const menuContext = {
    undoManager: globalHistory,
    findWindowByBrowserWindow(window) { return window.owner; },
    enableMenuItem(items, id, enabled) { items.find(x => x.id === id).enabled = enabled; },
    module: { exports: {} }
};
vm.runInNewContext(untype(source) + "\nmodule.exports = buildEditMenu;", menuContext);
const buildEditMenu = menuContext.module.exports;
const item = (win, id) => buildEditMenu(win).submenu.find(x => x.id === id);
assert.equal(item({ activeTabType: "project", state: { undo: null, redo: null } }, "undo").enabled, false);
assert.equal(item({ activeTabType: "project", state: { undo: null, redo: null } }, "redo").enabled, false);
assert.equal(item({ activeTabType: "project", state: { undo: "Resize widget", redo: null } }, "undo").enabled, true);
assert.equal(item({ activeTabType: "project", state: { undo: null, redo: "Resize widget" } }, "redo").enabled, true);
assert.equal(item({ activeTabType: "home", state: { undo: null, redo: null } }, "undo").enabled, true);
const winSource = read("packages/main/window.ts");
assert(winSource.includes('if (window.activeTabId !== activeTabId) {') &&
    winSource.includes("window.state.undo = null;") &&
    winSource.includes("window.state.redo = null;"));
const tabUpdate = section(winSource, 'ipcMain.on("tabs-change"', '\n////////////////////////////////////////////////////////////////////////////////\n\nipcMain.on("printPDF"');
const selectedWindow = {
    activeTabId: "PROJECT_TAB_A", activeTabType: "project",
    state: { undo: "A action", redo: "A redo" }
};
const callbacks = {};
const tabHarness = {
    ipcMain: { on(event, callback) { callbacks[event] = callback; } },
    findWindowByWebContents() { return selectedWindow; },
    runInAction,
    PROJECT_TAB_ID_PREFIX: "PROJECT_TAB_",
    RUN_PROJECT_TAB_ID_PREFIX: "RUN_PROJECT_TAB_"
};
vm.runInNewContext(untype(tabUpdate), tabHarness);
function selectTab(id, others = []) {
    callbacks["tabs-change"]({ sender: {} }, [
        { id, active: true },
        ...others.map(tab => ({ id: tab, active: false }))
    ]);
}
selectTab("PROJECT_TAB_A");
assert.equal(selectedWindow.state.undo, "A action");
selectTab("PROJECT_TAB_B", ["PROJECT_TAB_A"]);
assert.equal(selectedWindow.activeTabId, "PROJECT_TAB_B");
assert.equal(selectedWindow.state.undo, null);
assert.equal(selectedWindow.state.redo, null);
selectedWindow.state.undo = "B action";
selectTab("home", ["PROJECT_TAB_A", "PROJECT_TAB_B"]);
assert.equal(selectedWindow.activeTabType, "home");
assert.equal(selectedWindow.state.undo, null);

const homeSource = read("packages/home/tabs-store.tsx");
assert(homeSource.includes("if (!projectStore || !this._active)"));
console.log("Undo/Redo test passed: active-project-only IPC, actual command undo/redo, native menu state, tab isolation.");
