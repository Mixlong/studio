"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { resolveProjectTemplateFile } = require(
    "../build/eez-studio-shared/project-templates.js"
);

const root = path.resolve(__dirname, "..");
const wizardSource = fs.readFileSync(
    path.join(root, "packages/project-editor/project/ui/Wizard.tsx"), "utf8"
);
const start = wizardSource.indexOf("function getTemplatePathOrUrl(");
const end = wizardSource.indexOf("const SAVED_OPTIONS_VERSION", start);
assert(start > 0 && end > start);
const extracted = stripTypeScriptTypes(
    wizardSource.slice(start, end) +
        "\nmodule.exports = { getTemplatePathOrUrl, loadTemplateFile };",
    { mode: "transform" }
);
const settingsController = {
    useLocalTemplates: false,
    localTemplatesPath: ""
};
let attemptedNetwork = 0;
const sandbox = {
    module: { exports: {} },
    settingsController,
    resolveProjectTemplateFile,
    fs,
    readJsObjectFromFile: async filename => JSON.parse(
        await fs.promises.readFile(filename, "utf8")
    ),
    fetchUrlOrReadFromCache: async () => {
        attemptedNetwork++;
        throw Error("Unexpected network access");
    }
};
vm.runInNewContext(extracted, sandbox);
const wizard = sandbox.module.exports;

async function main() {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(root, "resources/project-templates/TEMPLATE-SOURCES.json"),
        "utf8"
    ));
    for (const asset of manifest.resources.filter(x =>
        x.path.endsWith(".eez-project")
    )) {
        const location = wizard.getTemplatePathOrUrl(asset.path);
        assert.equal(
            location,
            path.join(root, "resources/project-templates", asset.path)
        );
        const project = await wizard.loadTemplateFile(location, "json");
        assert(project.settings?.general);
    }
    const missing = path.join(os.tmpdir(), "missing-template-file.eez-project");
    await assert.rejects(
        () => wizard.loadTemplateFile(missing, "json"),
        /Local project template not found/
    );
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "digistudio-override-"));
    try {
        const customFile = path.join(temp, "templates", "dashboard.eez-project");
        fs.mkdirSync(path.dirname(customFile), { recursive: true });
        fs.writeFileSync(customFile,
            '{"settings":{"general":{"projectType":"custom"}}}');
        settingsController.useLocalTemplates = true;
        settingsController.localTemplatesPath = temp;
        const location = wizard.getTemplatePathOrUrl("templates/dashboard.eez-project");
        assert.equal(location, customFile);
        const project = await wizard.loadTemplateFile(location, "json");
        assert.equal(project.settings.general.projectType, "custom");
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
    assert.equal(attemptedNetwork, 0);
    console.log("New Project wizard passed: 11 bundled templates loaded without network, custom template override and missing-file diagnostics.");
}
main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
