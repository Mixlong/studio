import "dotenv/config";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync
} from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const mode = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const releaseVersion = process.env.RELEASE_VERSION?.trim() || "patch";
const stagingRoot = path.join(projectRoot, "release-oss");
const stagingDirectory = path.join(stagingRoot, "DigiwiseStudio");

const commands = {
    all: [
        [
            "exec",
            "--",
            "electron-builder",
            "--config",
            "electron-builder-mac.yml",
            "--mac",
            "dmg",
            "zip",
            "--publish",
            "never",
            "--config.directories.output=dist-mac"
        ],
        [
            "exec",
            "--",
            "electron-builder",
            "--win",
            "--x64",
            "--publish",
            "never",
            "--config.directories.output=dist-win-x64"
        ],
        [
            "exec",
            "--",
            "electron-builder",
            "--win",
            "--ia32",
            "--publish",
            "never",
            "--config.directories.output=dist-win-ia32"
        ]
    ],
    mac: [["run", "dist-oss:darwin"]],
    win: [["run", "dist-oss:win32"]],
    "win-ia32": [["run", "dist-oss:win32-ia32"]]
};

if (!commands[mode]) {
    throw new Error("Usage: node scripts/release-oss.mjs <all|mac|win|win-ia32> [--dry-run]");
}

function run(args) {
    console.log(`$ ${npmCommand} ${args.join(" ")}`);
    if (dryRun) return;

    const result = spawnSync(npmCommand, args, {
        cwd: projectRoot,
        stdio: "inherit",
        shell: process.platform === "win32"
    });

    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

function validateMacRelease() {
    if (dryRun || (mode !== "all" && mode !== "mac")) {
        return;
    }

    if (process.platform !== "darwin") {
        throw new Error("macOS releases must be built on macOS");
    }
}

function ensureWinUsbPrebuild(arch) {
    const pkgName = `@node-usb/usb-win32-${arch}-msvc`;
    const targetDir = path.join(
        projectRoot,
        "node_modules",
        "@node-usb",
        `usb-win32-${arch}-msvc`
    );
    const nodeBinary = path.join(targetDir, `usb.win32-${arch}-msvc.node`);
    if (existsSync(nodeBinary)) {
        return;
    }

    const usbPkgPath = path.join(projectRoot, "node_modules", "usb", "package.json");
    if (!existsSync(usbPkgPath)) {
        return;
    }
    const usbPkg = JSON.parse(readFileSync(usbPkgPath, "utf8"));
    const usbVersion =
        usbPkg.optionalDependencies?.[pkgName] || usbPkg.version || "3.0.1";

    console.log(`[cross-win] Installing prebuild ${pkgName}@${usbVersion}...`);
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "digistudio-usb-win-"));
    try {
        const packRes = spawnSync(
            npmCommand,
            ["pack", `${pkgName}@${usbVersion}`, "--silent"],
            { cwd: tmpDir, encoding: "utf8", shell: process.platform === "win32" }
        );
        if (packRes.status !== 0) {
            throw new Error(
                `Failed to npm pack ${pkgName}@${usbVersion}: ${packRes.stderr || packRes.stdout}`
            );
        }
        const tarball = readdirSync(tmpDir).find(f => f.endsWith(".tgz"));
        if (!tarball) {
            throw new Error(`No .tgz produced for ${pkgName}@${usbVersion}`);
        }
        mkdirSync(targetDir, { recursive: true });
        const tarRes = spawnSync(
            "tar",
            [
                "-xzf",
                path.join(tmpDir, tarball),
                "--strip-components=1",
                "-C",
                targetDir
            ],
            { stdio: "inherit" }
        );
        if (tarRes.status !== 0) {
            throw new Error(`Failed to extract ${tarball} into ${targetDir}`);
        }
    } finally {
        rmSync(tmpDir, { recursive: true, force: true });
    }
}

function prepareWinCrossBuild() {
    if (
        dryRun ||
        process.platform === "win32" ||
        (mode !== "win" && mode !== "win-ia32" && mode !== "all")
    ) {
        return;
    }

    // Remove host-compiled native build directories so N-API prebuilds/win32-* are used.
    for (const relBuildDir of [
        "node_modules/better-sqlite3/build",
        "node_modules/@serialport/bindings-cpp/build"
    ]) {
        const fullBuildDir = path.join(projectRoot, relBuildDir);
        if (existsSync(fullBuildDir)) {
            rmSync(fullBuildDir, { recursive: true, force: true });
            console.log(`[cross-win] Removed host build dir: ${relBuildDir}`);
        }
    }

    if (mode === "win" || mode === "all") {
        ensureWinUsbPrebuild("x64");
    }
    if (mode === "win-ia32" || mode === "all") {
        ensureWinUsbPrebuild("ia32");
    }

    // Patch electron-builder NsisTarget to use pure-JS UninstallerReader on Linux
    // (same as macOS Catalina+), avoiding any dependency on Wine.
    const nsisTargetPath = path.join(
        projectRoot,
        "node_modules",
        "app-builder-lib",
        "out",
        "targets",
        "nsis",
        "NsisTarget.js"
    );
    if (existsSync(nsisTargetPath)) {
        const original = readFileSync(nsisTargetPath, "utf8");
        const updated = original.replace(
            "if ((0, macosVersion_1.isMacOsCatalina)()) {",
            'if (process.platform !== "win32") {'
        );
        if (updated !== original) {
            writeFileSync(nsisTargetPath, updated, "utf8");
            console.log(
                "[cross-win] Patched NsisTarget.js to use UninstallerReader without Wine"
            );
        }
    }
}

function stageDirectory(sourceDirectory, targetDirectory) {
    const publishableFile = /^(latest(?:-mac|-linux)?\.yml|.+\.(?:dmg|pkg|zip|exe|AppImage|deb|rpm|snap|blockmap))$/;
    const sourcePath = path.join(projectRoot, sourceDirectory);

    if (dryRun) {
        console.log(`stage ${sourceDirectory}/ -> ${path.relative(projectRoot, targetDirectory)}/`);
        return;
    }

    const files = readdirSync(sourcePath, { withFileTypes: true })
        .filter(entry => entry.isFile() && publishableFile.test(entry.name));

    if (files.length === 0) {
        throw new Error(`No publishable files found in ${sourceDirectory}`);
    }

    mkdirSync(targetDirectory, { recursive: true });
    for (const file of files) {
        copyFileSync(
            path.join(sourcePath, file.name),
            path.join(targetDirectory, file.name)
        );
    }
}

function writeUpdateMetadata(
    targetDirectory,
    metadataFileName,
    artifactPattern,
    primaryPattern
) {
    if (dryRun) {
        console.log(
            `metadata ${metadataFileName} <- ${path.relative(projectRoot, targetDirectory)}/`
        );
        return;
    }

    const artifacts = readdirSync(targetDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && artifactPattern.test(entry.name))
        .map(entry => {
            const filePath = path.join(targetDirectory, entry.name);
            return {
                name: entry.name,
                sha512: createHash("sha512")
                    .update(readFileSync(filePath))
                    .digest("base64"),
                size: statSync(filePath).size
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name));

    if (artifacts.length === 0) {
        throw new Error(`No update artifacts found in ${targetDirectory}`);
    }

    const primaryArtifact =
        artifacts.find(artifact => primaryPattern.test(artifact.name)) ||
        artifacts[0];
    const releaseDate = new Date().toISOString();
    const version = JSON.parse(
        readFileSync(path.join(projectRoot, "package.json"), "utf8")
    ).version;
    const lines = [
        `version: ${version}`,
        "files:",
        ...artifacts.flatMap(artifact => [
            `  - url: ${artifact.name}`,
            `    sha512: ${artifact.sha512}`,
            `    size: ${artifact.size}`
        ]),
        `path: ${primaryArtifact.name}`,
        `sha512: ${primaryArtifact.sha512}`,
        `releaseDate: '${releaseDate}'`
    ];

    writeFileSync(
        path.join(targetDirectory, metadataFileName),
        `${lines.join("\n")}\n`
    );
    console.log(
        `generated ${path.relative(projectRoot, path.join(targetDirectory, metadataFileName))}`
    );
}

function stageRelease() {
    if (!dryRun) {
        rmSync(stagingRoot, { recursive: true, force: true });
    }

    if (mode === "all") {
        stageDirectory("dist-mac", path.join(stagingDirectory, "dist-mac"));
        stageDirectory(
            "dist-win-x64",
            path.join(stagingDirectory, "dist-win-x64")
        );
        stageDirectory(
            "dist-win-ia32",
            path.join(stagingDirectory, "win-ia32")
        );
        writeUpdateMetadata(
            path.join(stagingDirectory, "dist-mac"),
            "latest-mac.yml",
            /\.(?:dmg|zip)$/,
            /\.zip$/
        );
        writeUpdateMetadata(
            path.join(stagingDirectory, "dist-win-x64"),
            "latest.yml",
            /\.exe$/,
            /\.exe$/
        );
    } else if (mode === "win-ia32") {
        stageDirectory("dist", path.join(stagingDirectory, "win-ia32"));
        writeUpdateMetadata(
            path.join(stagingDirectory, "win-ia32"),
            "latest.yml",
            /\.exe$/,
            /\.exe$/
        );
    } else if (mode === "mac") {
        const targetDirectory = path.join(stagingDirectory, "dist-mac");
        stageDirectory("dist", targetDirectory);
        writeUpdateMetadata(
            targetDirectory,
            "latest-mac.yml",
            /\.(?:dmg|zip)$/,
            /\.zip$/
        );
    } else if (mode === "win") {
        const targetDirectory = path.join(stagingDirectory, "dist-win-x64");
        stageDirectory("dist", targetDirectory);
        writeUpdateMetadata(
            targetDirectory,
            "latest.yml",
            /\.exe$/,
            /\.exe$/
        );
    } else {
        stageDirectory("dist", stagingDirectory);
    }
}

validateMacRelease();
run(["version", releaseVersion, "--no-git-tag-version"]);
if (mode === "all") {
    if (!dryRun) {
        for (const directory of ["dist-mac", "dist-win-x64", "dist-win-ia32"]) {
            rmSync(path.join(projectRoot, directory), {
                recursive: true,
                force: true
            });
        }
    }
} else {
    run(["run", "clean-dist"]);
}
run(["run", "build"]);
prepareWinCrossBuild();
for (const command of commands[mode]) {
    run(command);
}
stageRelease();
