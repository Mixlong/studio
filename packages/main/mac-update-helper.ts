import { execFileSync, spawnSync } from "child_process";
import {
    appendFileSync,
    existsSync,
    mkdtempSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";

interface MacUpdatePayload {
    currentPid: number;
    updateZipPath: string;
    appPath: string;
    expectedBundleId: string;
    expectedVersion: string;
    logPath: string;
    relaunch?: boolean;
    helperDirectory?: string;
}

function writeLog(logPath: string, message: string) {
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

function sleep(milliseconds: number) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isProcessRunning(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: any) {
        return error?.code !== "ESRCH";
    }
}

function readPlistValue(appPath: string, key: string) {
    return execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", `Print :${key}`, join(appPath, "Contents", "Info.plist")],
        { encoding: "utf8" }
    ).trim();
}

function findExtractedApp(directory: string) {
    const appDirectories = readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.endsWith(".app"))
        .map(entry => join(directory, entry.name));

    if (appDirectories.length !== 1) {
        throw new Error(
            `Expected exactly one app in update archive, found ${appDirectories.length}`
        );
    }

    return appDirectories[0];
}

export function installMacUpdate(payload: MacUpdatePayload) {
    const updateZipPath = resolve(payload.updateZipPath);
    const appPath = resolve(payload.appPath);
    const logPath = resolve(payload.logPath);

    if (!appPath.endsWith(".app") || !existsSync(appPath)) {
        throw new Error(`Invalid current application path: ${appPath}`);
    }
    if (!updateZipPath.endsWith(".zip") || !statSync(updateZipPath).isFile()) {
        throw new Error(`Invalid update archive: ${updateZipPath}`);
    }

    writeLog(logPath, `Waiting for process ${payload.currentPid} to exit`);
    const waitDeadline = Date.now() + 60_000;
    while (isProcessRunning(payload.currentPid)) {
        if (Date.now() >= waitDeadline) {
            throw new Error(`Application process ${payload.currentPid} did not exit`);
        }
        sleep(200);
    }

    const extractionDirectory = mkdtempSync(
        join(tmpdir(), "digistudio-update-extract-")
    );
    const backupPath = join(
        dirname(appPath),
        `.${basename(appPath)}.update-backup-${process.pid}`
    );
    let oldAppMoved = false;

    try {
        writeLog(logPath, `Extracting ${updateZipPath}`);
        const extractionResult = spawnSync(
            "/usr/bin/ditto",
            ["-x", "-k", updateZipPath, extractionDirectory],
            { encoding: "utf8" }
        );
        if (extractionResult.status !== 0) {
            throw new Error(
                `Unable to extract update: ${extractionResult.stderr || extractionResult.stdout}`
            );
        }

        const extractedAppPath = findExtractedApp(extractionDirectory);
        const bundleId = readPlistValue(extractedAppPath, "CFBundleIdentifier");
        const version = readPlistValue(
            extractedAppPath,
            "CFBundleShortVersionString"
        );
        if (bundleId !== payload.expectedBundleId) {
            throw new Error(`Unexpected bundle id: ${bundleId}`);
        }
        if (version !== payload.expectedVersion) {
            throw new Error(`Unexpected update version: ${version}`);
        }
        if (existsSync(backupPath)) {
            throw new Error(`Update backup path already exists: ${backupPath}`);
        }

        writeLog(logPath, `Replacing ${appPath} with version ${version}`);
        renameSync(appPath, backupPath);
        oldAppMoved = true;

        const copyResult = spawnSync(
            "/usr/bin/ditto",
            [extractedAppPath, appPath],
            { encoding: "utf8" }
        );
        if (copyResult.status !== 0) {
            throw new Error(
                `Unable to copy update: ${copyResult.stderr || copyResult.stdout}`
            );
        }

        const installedVersion = readPlistValue(
            appPath,
            "CFBundleShortVersionString"
        );
        if (installedVersion !== payload.expectedVersion) {
            throw new Error(`Installed version verification failed: ${installedVersion}`);
        }

        rmSync(backupPath, { recursive: true, force: true });
        oldAppMoved = false;
        writeLog(logPath, `Installed DigiStudio ${installedVersion}`);

        if (payload.relaunch !== false) {
            const launchResult = spawnSync("/usr/bin/open", ["-n", appPath], {
                encoding: "utf8"
            });
            if (launchResult.status !== 0) {
                throw new Error(
                    `Unable to relaunch application: ${launchResult.stderr || launchResult.stdout}`
                );
            }
            writeLog(logPath, "Relaunched DigiStudio");
        }
    } catch (error: any) {
        writeLog(logPath, `Update failed: ${error?.stack || error}`);
        if (oldAppMoved) {
            rmSync(appPath, { recursive: true, force: true });
            renameSync(backupPath, appPath);
            writeLog(logPath, "Restored previous DigiStudio application");
        }
        throw error;
    } finally {
        rmSync(extractionDirectory, { recursive: true, force: true });
        if (payload.helperDirectory) {
            rmSync(resolve(payload.helperDirectory), {
                recursive: true,
                force: true
            });
        }
    }
}

if (require.main === module) {
    const encodedPayload = process.argv[2];
    if (!encodedPayload) {
        throw new Error("Missing macOS update payload");
    }
    installMacUpdate(
        JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
    );
}
