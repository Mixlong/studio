"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { stripTypeScriptTypes } = require("node:module");
const { resolveProjectTemplateFile } = require(
    "../build/eez-studio-shared/project-templates.js"
);
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
    path.join(root, "packages/project-editor/project/ui/Wizard.tsx"), "utf8"
);
const start = source.indexOf("    async copyBundledBB3ProjectFile() {");
const end = source.indexOf("\n    createProject = async (", start);
assert(start >= 0 && end > start);
const extracted = stripTypeScriptTypes(
    "class BB3WizardHarness {\n" + source.slice(start, end) +
    "\n}\nmodule.exports = BB3WizardHarness;",
    { mode: "transform" }
);
const sandbox = {
    module: { exports: {} },
    fs,
    path,
    resolveProjectTemplateFile
};
vm.runInNewContext(extracted, sandbox);
const Wizard = sandbox.module.exports;
const manifest = JSON.parse(fs.readFileSync(
    path.join(root, "resources/project-templates/TEMPLATE-SOURCES.json"), "utf8"
));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "digistudio-bb3-offline-"));

async function verify() {
    try {
        for (const version of ["v2", "v3"]) {
            const target = path.join(tmp, version);
            fs.mkdirSync(target);
            const wizard = new Wizard();
            wizard.projectVersion = version;
            wizard.projectFolderPath = target;
            await wizard.copyBundledBB3ProjectFile();
            const file = path.join(target, "modular-psu-firmware.eez-project");
            assert(fs.existsSync(file));
            const bytes = fs.readFileSync(file);
            const original = manifest.firmware_dependencies.resources.find(
                r => r.path.endsWith(
                    version + "/modular-psu-firmware.eez-project"
                )
            );
            assert(original, version);
            assert.equal(
                crypto.createHash("sha256").update(bytes).digest("hex"),
                original.sha256
            );
            assert(JSON.parse(bytes.toString("utf8")).settings?.general);
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    assert.doesNotMatch(
        source.slice(start, end),
        /XMLHttpRequest|fetch\(|https:\/\//
    );
    assert.match(source, /Use included BB3 firmware project/);
    assert.doesNotMatch(source, /Download from GitHub/);
    assert.match(source, /options.bb3ProjectOption == "local" \? "local" : "bundled"/);

    console.log("BB3 offline wizard passed: v2/v3 firmware copied, parsed and SHA-256 verified; no network and old settings migrated.");
}
verify().catch(err => {
    console.error(err.stack || err);
    process.exitCode = 1;
});
