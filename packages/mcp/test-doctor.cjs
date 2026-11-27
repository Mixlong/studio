/* Offline, read-only MCP doctor regression. Does not touch real appData. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

(async () => {
    const { readSessionStatus, sessionFilePath } = await import("./doctor.mjs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-doctor-test-"));
    const filename = path.join(dir, "mcp-session.json");
    try {
        assert.equal(readSessionStatus(filename).session, "missing");
        fs.writeFileSync(filename, "{invalid");
        assert.equal(readSessionStatus(filename).session, "invalid");
        const create = (version = "mcp-2026-11-27-implementation-edit") =>
            fs.writeFileSync(filename, JSON.stringify({
                pid: 13579, registryVersion: version, token: "PRIVATE-NEVER-PRINT"
            }));
        create();
        let pidChecked = null;
        const status = readSessionStatus(filename, (pid, signal) => {
            pidChecked = [pid, signal];
        });
        assert.deepEqual(pidChecked, [13579, 0], "Doctor must only send PID signal zero");
        assert.equal(status.process, "alive");
        assert.equal(status.registryMatches, true);
        assert.ok(!JSON.stringify(status).includes("PRIVATE-NEVER-PRINT"),
            "Never return or log authentication credentials");
        const stale = readSessionStatus(filename, () => {
            const err = new Error("No process");
            err.code = "ESRCH";
            throw err;
        });
        assert.equal(stale.process, "not-running");
        create("mcp-old-registry");
        assert.equal(readSessionStatus(filename, () => {}).registryMatches, false);
        assert.equal(sessionFilePath({ DIGISTUDIO_MCP_SESSION_FILE: filename }), filename);
        console.log("PASS: read-only MCP doctor session/process/version, no process termination or credential leakage");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
