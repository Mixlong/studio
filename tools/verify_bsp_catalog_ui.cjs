const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const sourcePath = path.join(__dirname, "../packages/home/digiwise-bsp-catalog-ui.tsx");
const source = fs.readFileSync(sourcePath, "utf8");
const pureFunctions = source.slice(source.indexOf("export function formatBspFileSize"), source.indexOf("function ErrorPanel"));
const stripped = Module.stripTypeScriptTypes(pureFunctions)
    .replace(/export function/g, "function")
    + "\nmodule.exports = { formatBspFileSize, formatCatalogDate, catalogErrorMessage };\n";
const testModule = new Module("bsp-catalog-ui-test", module);
testModule._compile(stripped, sourcePath);
const { formatBspFileSize, formatCatalogDate, catalogErrorMessage } = testModule.exports;

assert.equal(formatBspFileSize(0), "0 B");
assert.equal(formatBspFileSize(1536), "1.5 KB");
assert.equal(formatBspFileSize(4 * 1024 * 1024), "4 MB");
assert.equal(formatCatalogDate(null, true), "未发布");
assert.equal(formatCatalogDate("2026-11-19 08:30:00", false), "2026-11-19 08:30");
assert.equal(catalogErrorMessage({ code: "AUTH_REQUIRED", message: "private" }, true), "请先登录或重新登录");
assert.equal(catalogErrorMessage({ code: "PUBLIC_API_UNAVAILABLE", message: "private" }, false), "Catalog service is unavailable");
assert.equal(catalogErrorMessage({ code: "UNKNOWN", message: "private" }, false), "Unable to load the BSP catalog");
console.log("BSP catalog UI tests passed");
