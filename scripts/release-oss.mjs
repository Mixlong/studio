import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    copyFileSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync
} from "node:fs";
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
        // npm.cmd is a shell command on Windows and needs shell mode here.
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

function writeUpdateManifest(targetDirectory, manifestName) {
    if (dryRun) {
        return;
    }

    const artifactFiles = readdirSync(targetDirectory, { withFileTypes: true })
        .filter(
            entry =>
                entry.isFile() &&
                /\.(?:dmg|pkg|zip|exe)$/.test(entry.name)
        )
        .map(entry => entry.name)
        .sort((left, right) => {
            const priority = fileName =>
                fileName.endsWith(".zip")
                    ? 0
                    : fileName.endsWith(".dmg")
                      ? 1
                      : 2;

            return priority(left) - priority(right) || left.localeCompare(right);
        });

    if (artifactFiles.length === 0) {
        throw new Error(`No update artifacts found in ${targetDirectory}`);
    }

    const files = artifactFiles.map(fileName => {
        const filePath = path.join(targetDirectory, fileName);
        const sha512 = createHash("sha512")
            .update(readFileSync(filePath))
            .digest("base64");

        return {
            url: fileName,
            sha512,
            size: statSync(filePath).size
        };
    });
    const primaryFile = files[0];
    const version = JSON.parse(
        readFileSync(path.join(projectRoot, "package.json"), "utf8")
    ).version;
    const lines = [
        `version: ${version}`,
        "files:",
        ...files.flatMap(file => [
            `  - url: ${file.url}`,
            `    sha512: ${file.sha512}`,
            `    size: ${file.size}`
        ]),
        `path: ${primaryFile.url}`,
        `sha512: ${primaryFile.sha512}`,
        `releaseDate: '${new Date().toISOString()}'`,
        ""
    ];

    writeFileSync(path.join(targetDirectory, manifestName), lines.join("\n"));
}

function stageRelease() {
    if (mode === "all" && !dryRun) {
        rmSync(stagingRoot, { recursive: true, force: true });
    }

    const manifests = [];
    if (mode === "all") {
        const macDirectory = path.join(stagingDirectory, "dist-mac");
        stageDirectory("dist-mac", macDirectory);
        manifests.push([macDirectory, "latest-mac.yml"]);
        const windowsDirectory = path.join(stagingDirectory, "dist-win-x64");
        stageDirectory(
            "dist-win-x64",
            windowsDirectory
        );
        manifests.push([windowsDirectory, "latest.yml"]);
        const windowsIa32Directory = path.join(stagingDirectory, "win-ia32");
        stageDirectory(
            "dist-win-ia32",
            windowsIa32Directory
        );
        manifests.push([windowsIa32Directory, "latest.yml"]);
    } else if (mode === "win-ia32") {
        const windowsIa32Directory = path.join(stagingDirectory, "win-ia32");
        stageDirectory("dist", windowsIa32Directory);
        manifests.push([windowsIa32Directory, "latest.yml"]);
    } else if (mode === "mac") {
        const macDirectory = path.join(stagingDirectory, "dist-mac");
        stageDirectory("dist", macDirectory);
        manifests.push([macDirectory, "latest-mac.yml"]);
    } else if (mode === "win") {
        const windowsDirectory = path.join(stagingDirectory, "dist-win-x64");
        stageDirectory("dist", windowsDirectory);
        manifests.push([windowsDirectory, "latest.yml"]);
    } else {
        stageDirectory("dist", stagingDirectory);
    }

    for (const [targetDirectory, manifestName] of manifests) {
        writeUpdateManifest(targetDirectory, manifestName);
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
for (const command of commands[mode]) {
    run(command);
}
stageRelease();
