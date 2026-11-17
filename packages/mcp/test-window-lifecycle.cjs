/* Windows lifecycle safety regression for DigiwiseStudio home/editor windows.
 * No GUI, no user project, no process termination.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { shouldHideWindowOnClose } = require(
    path.join(__dirname, "../../build/main/window-lifecycle.js")
);
assert.equal(shouldHideWindowOnClose(true, false, 0), false,
    "A hidden auxiliary window must not hide the LAST visible editor window");
assert.equal(shouldHideWindowOnClose(true, false, 1), true,
    "Home may hide when another visible editor exists");
assert.equal(shouldHideWindowOnClose(false, false, 1), false,
    "Non-hide-on-close window still follows native close");
assert.equal(shouldHideWindowOnClose(true, true, 2), false,
    "Explicit application quit must never turn into hidden windows");

const home = fs.readFileSync(path.join(__dirname, "../main/home-window.ts"), "utf8");
assert.ok(home.includes("openWindow({ ...HOME_WINDOW_PARAMS, ...params })"),
    "A temporary hidden/build window may not mutate shared Home defaults");
assert.ok(!home.includes("Object.assign(HOME_WINDOW_PARAMS, params)"));

const win = fs.readFileSync(path.join(__dirname, "../main/window.ts"), "utf8");
assert.ok(win.includes("shouldHideWindowOnClose("));
assert.ok(win.includes("entry.browserWindow.isVisible()"),
    "Only actual visible windows should prevent the editor's normal save/quit handshake");
console.log("PASS: last visible editor can close safely, transient home defaults preserved");
