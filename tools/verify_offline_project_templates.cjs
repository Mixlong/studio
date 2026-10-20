"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {
    resolveProjectTemplateFile,
    getBuiltInTemplatesDirectory
} = require("../build/eez-studio-shared/project-templates.js");

const projectRoot = path.resolve(__dirname, "..");
const bundleRoot = path.join(projectRoot, "resources/project-templates");
const manifest = JSON.parse(fs.readFileSync(
    path.join(bundleRoot, "TEMPLATE-SOURCES.json"), "utf8"
));
assert.equal(manifest.upstream_license, "MIT");
assert.equal(manifest.resources.length, 13);
assert.equal(manifest.firmware_dependencies.license, "GPL-3.0");
assert.equal(manifest.firmware_dependencies.resources.length, 3);
assert.match(
    fs.readFileSync(
        path.join(bundleRoot, manifest.firmware_dependencies.license_file),
        "utf8"
    ),
    /GNU GENERAL PUBLIC LICENSE/
);
for (const resource of manifest.firmware_dependencies.resources) {
    const bytes = fs.readFileSync(path.join(bundleRoot, resource.path));
    assert.equal(bytes.length, resource.bytes);
    assert.equal(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        resource.sha256
    );
    if (resource.path.endsWith(".eez-project")) {
        assert(JSON.parse(bytes.toString("utf8")).settings?.general);
    }
}
assert.equal(manifest.additional_license.license, "SIL Open Font License 1.1");
assert.match(
    fs.readFileSync(
        path.join(bundleRoot, manifest.additional_license.file), "utf8"
    ),
    /SIL OPEN FONT LICENSE/i
);
assert.match(
    fs.readFileSync(path.join(bundleRoot, manifest.license_file), "utf8"),
    /^MIT License/
);
assert.equal(
    getBuiltInTemplatesDirectory(undefined, projectRoot),
    bundleRoot
);

let projectCount = 0;
for (const resource of manifest.resources) {
    const actual = resolveProjectTemplateFile(
        resource.path, undefined, undefined, projectRoot
    );
    const bytes = fs.readFileSync(actual);
    assert.equal(bytes.length, resource.bytes);
    assert.equal(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        resource.sha256,
        "Integrity check failed for " + resource.path
    );
    if (resource.path.endsWith(".eez-project")) {
        const content = JSON.parse(bytes.toString("utf8"));
        assert(content.settings?.general,
            "No general settings in " + resource.path);
        // Simulate the offline new-project save/reopen lifecycle.
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "digistudio-offline-project-"));
        try {
            const target = path.join(temporary, "OfflineProject.eez-project");
            content.settings.general.projectVersion = "v3";
            if (resource.path.includes("LVGL")) {
                content.settings.general.lvglVersion = "8.4.0";
            }
            fs.writeFileSync(target, JSON.stringify(content, null, 2));
            const reopened = JSON.parse(fs.readFileSync(target, "utf8"));
            assert.equal(reopened.settings.general.projectVersion, "v3");
            projectCount++;
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    }
}
assert.equal(projectCount, 11);

// A simulated installed app's external resources take precedence over source.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "digistudio-template-path-"));
try {
    const installed = path.join(temp, "appResources", "project-templates");
    const custom = path.join(temp, "custom");
    fs.mkdirSync(path.join(installed, "templates"), { recursive: true });
    fs.mkdirSync(path.join(custom, "templates"), { recursive: true });
    fs.writeFileSync(path.join(installed, "templates", "test.eez-project"), "{}");
    fs.writeFileSync(path.join(custom, "templates", "test.eez-project"), "{}");
    assert.equal(
        resolveProjectTemplateFile(
            "templates/test.eez-project",
            undefined,
            path.join(temp, "appResources"),
            projectRoot
        ),
        path.join(installed, "templates", "test.eez-project")
    );
    assert.equal(
        resolveProjectTemplateFile(
            "templates/test.eez-project", custom,
            path.join(temp, "appResources"), projectRoot
        ),
        path.join(custom, "templates", "test.eez-project")
    );
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}

for (const attack of ["../secret", "templates/../../secret", "/etc/passwd",
    "templates\\..\\secret", "C:\\secret", "templates//bad"]) {
    assert.throws(
        () => resolveProjectTemplateFile(attack, undefined, undefined, projectRoot),
        /Invalid project template resource path/
    );
}

const wizardSource = fs.readFileSync(
    path.join(projectRoot, "packages/project-editor/project/ui/Wizard.tsx"), "utf8"
);
assert.match(wizardSource, /return resolveProjectTemplateFile\(/);
assert.doesNotMatch(
    wizardSource.slice(
        wizardSource.indexOf("function getTemplatePathOrUrl("),
        wizardSource.indexOf("const SAVED_OPTIONS_VERSION")
    ),
    /productConfig\.projectTemplates\.baseUrl|simpleGit/
);

for (const installer of ["electron-builder.yml", "electron-builder-mac.yml"]) {
    const contents = fs.readFileSync(path.join(projectRoot, installer), "utf8");
    assert.match(contents,
        /from: "\.\/resources\/project-templates"\s+to: "project-templates"/
    );
}
console.log(
    "Offline templates passed: " + projectCount +
    " project templates, 1 font, MIT license and SHA-256 checks; " +
    "simulated create/reopen, installed/custom paths, path traversal protection, " +
    "offline wizard and both installer manifests."
);
