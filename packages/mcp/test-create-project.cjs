/* Isolated real bundled-template project creation, no changes to user files. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "digistudio-create-project-"));
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "eez-studio-shared/project-templates") {
        return {
            resolveProjectTemplateFile(relative) {
                return path.join(root, "resources", "project-templates", relative);
            }
        };
    }
    return originalLoad.apply(this, arguments);
};
let createMcpProject, validateWriteArguments;
try {
    ({ createMcpProject } = require(path.join(root, "build/mcp/create-project.js")));
    ({ validateWriteArguments } = require(path.join(root, "build/mcp/validator.js")));
} finally {
    Module._load = originalLoad;
}
const opened = [];
const window = {
    isDestroyed: () => false,
    webContents: {
        isDestroyed: () => false,
        send: (...args) => opened.push(args)
    }
};
(async () => {
    try {
        const filepath = path.join(temp, "Dashboard.eez-project");
        validateWriteArguments("create_project", {
            projectPath: filepath,
            lvglVersion: "8.4.0",
            displayWidth: 1024,
            displayHeight: 600
        });
        const created = await createMcpProject({
            projectPath: filepath,
            lvglVersion: "8.4.0",
            displayWidth: 1024,
            displayHeight: 600
        }, window);
        assert.equal(created.created, true);
        assert.equal(created.openRequested, true);
        assert.deepEqual(opened[0], ["open-project", filepath, false]);
        const content = fs.readFileSync(filepath, "utf8");
        const saved = JSON.parse(content);
        assert.equal(saved.settings.general.projectType, "lvgl");
        assert.equal(saved.settings.general.lvglVersion, "8.4.0");
        assert.equal(saved.settings.general.displayWidth, 1024);
        assert.equal(saved.settings.general.displayHeight, 600);
        assert.equal(saved.userPages[0].width, 1024);
        assert.equal(saved.userPages[0].height, 600);
        const screen = saved.userPages[0].components.find(c => c.type === "LVGLScreenWidget");
        assert.equal(screen.width, 1024);
        assert.equal(screen.height, 600);

        await assert.rejects(createMcpProject({ projectPath: filepath }, window),
            error => error.code === "INVALID_STATE");
        assert.equal(fs.readFileSync(filepath, "utf8"), content,
            "Original project file must remain byte-identical");

        const flowPath = path.join(temp, "Flow.eez-project");
        const flow = await createMcpProject({
            projectPath: flowPath,
            lvglVersion: "9.3.0",
            flowSupport: true,
            openWhenDone: false
        }, window);
        assert.equal(flow.openRequested, false);
        const savedFlow = JSON.parse(fs.readFileSync(flowPath, "utf8"));
        assert.equal(savedFlow.settings.general.lvglVersion, "9.3.0");
        assert.equal(savedFlow.settings.general.flowSupport, true);

        const missingParent = path.join(temp, "nonexistent", "Missing.eez-project");
        await assert.rejects(createMcpProject({
            projectPath: missingParent
        }, window), error => error.code === "INVALID_ARGUMENT");
        assert.equal(fs.existsSync(missingParent), false);

        const invalid = [
            { projectPath: filepath, lvglVersion: "7.0" },
            { projectPath: filepath, displayWidth: -5 },
            { projectPath: filepath, flowSupport: "yes" },
            { projectPath: filepath, unexpected: true },
            { projectPath: path.join(temp, "not-project.txt") }
        ];
        for (const args of invalid) {
            assert.throws(() => validateWriteArguments("create_project", args),
                error => error.code === "INVALID_ARGUMENT");
        }
        console.log("PASS: standalone LVGL template projects, dimensions, Flow, automatic open request, no overwrite and argument guards");
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error.stack);
    process.exitCode = 1;
});
