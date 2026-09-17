const fs = require("fs");
const path = require("path");

const target = process.argv[2]; // 'win' or 'mac'
const dir = path.join(__dirname, "../node_modules/better-sqlite3/build/Release");
const targetFile = path.join(dir, "better_sqlite3.node");
const winFile = path.join(dir, "better_sqlite3.node.win32-x64");
const macFile = path.join(dir, "better_sqlite3.node.darwin-arm64");

if (target === "win") {
    if (fs.existsSync(winFile)) {
        if (!fs.existsSync(macFile) && fs.existsSync(targetFile)) {
            fs.copyFileSync(targetFile, macFile);
        }
        fs.copyFileSync(winFile, targetFile);
        console.log("[dist-win] Switched better_sqlite3.node to Windows x64 PE32+ binary");
    }
} else if (target === "mac") {
    if (fs.existsSync(macFile)) {
        fs.copyFileSync(macFile, targetFile);
        console.log("[dist-win] Restored better_sqlite3.node to macOS arm64 Mach-O binary");
    }
}
