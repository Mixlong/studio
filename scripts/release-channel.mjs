import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseScript = path.join(projectRoot, "scripts/release-oss.mjs");
const defaultUpdateRoot =
    "https://bikewise.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio";
const allowedChannels = new Set(["dev", "stable"]);
const allowedModes = new Set(["all", "mac", "win", "win-ia32"]);
const [channel, mode = "all", ...extraArgs] = process.argv.slice(2);

if (!allowedChannels.has(channel) || !allowedModes.has(mode)) {
    throw new Error(
        "Usage: node scripts/release-channel.mjs <dev|stable> <all|mac|win|win-ia32> [--dry-run]"
    );
}

const unsupportedArgs = extraArgs.filter(arg => arg !== "--dry-run");
if (unsupportedArgs.length > 0) {
    throw new Error(`Unsupported arguments: ${unsupportedArgs.join(" ")}`);
}

const updateRoot = (
    process.env.EEZ_UPDATE_ROOT?.trim() || defaultUpdateRoot
).replace(/\/+$/, "");

if (!updateRoot.startsWith("https://")) {
    throw new Error("EEZ_UPDATE_ROOT must use HTTPS");
}

const updateUrl = `${updateRoot}/${channel}/`;
const releaseArgs = [releaseScript, mode];
if (extraArgs.includes("--dry-run")) {
    releaseArgs.push("--dry-run");
}

console.log(`[release] channel: ${channel}`);
console.log(`[release] update URL: ${updateUrl}`);

const result = spawnSync(process.execPath, releaseArgs, {
    cwd: projectRoot,
    env: {
        ...process.env,
        EEZ_UPDATE_URL: updateUrl
    },
    stdio: "inherit"
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
