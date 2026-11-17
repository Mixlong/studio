/**
 * DigiwiseStudio MCP read-only doctor. Never deletes locks, kills processes,
 * opens projects, toggles MCP, or modifies application preferences.
 *
 * npm run doctor-mcp
 * npm run doctor-mcp -- --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callBridge, EXPECTED_REGISTRY_VERSION } from "./bridge-client.mjs";

export function sessionFilePath(env = process.env) {
    if (env.DIGISTUDIO_MCP_SESSION_FILE) return env.DIGISTUDIO_MCP_SESSION_FILE;
    if (process.platform === "win32") {
        return path.join(env.APPDATA || path.join(env.USERPROFILE || "", "AppData", "Roaming"),
            "DigiwiseStudio", "mcp-session.json");
    }
    if (process.platform === "darwin") {
        return path.join(env.HOME || "", "Library", "Application Support", "DigiwiseStudio",
            "mcp-session.json");
    }
    return path.join(env.XDG_CONFIG_HOME || path.join(env.HOME || "", ".config"),
        "DigiwiseStudio", "mcp-session.json");
}

export function readSessionStatus(filename, checkPid = process.kill) {
    if (!fs.existsSync(filename)) {
        return { session: "missing", process: "unknown" };
    }
    let metadata;
    try {
        metadata = JSON.parse(fs.readFileSync(filename, "utf8"));
    } catch {
        return { session: "invalid", process: "unknown" };
    }
    const pid = Number.isSafeInteger(metadata?.pid) && metadata.pid > 0 ? metadata.pid : null;
    const registry = typeof metadata?.registryVersion === "string"
        ? metadata.registryVersion : "unknown";
    const result = {
        session: "present",
        process: "unknown",
        pid,
        registryMatches: registry === EXPECTED_REGISTRY_VERSION,
        registryVersion: registry
    };
    if (pid) {
        try {
            checkPid(pid, 0); // Signal zero checks PID existence; never terminates.
            result.process = "alive";
        } catch (err) {
            result.process = err?.code === "ESRCH" ? "not-running" : "unknown";
        }
    }
    return result;
}

export async function diagnose() {
    const session = readSessionStatus(sessionFilePath());
    const report = {
        tool: "DigiwiseStudio MCP Doctor",
        readonly: true,
        ...session,
        bridge: "not-checked",
        readTools: null,
        writeTools: null,
        errorCode: null,
        recommendation: null
    };
    if (session.session !== "present") {
        report.recommendation = "检查 IDE 是否已正常打开，并在设置中启用 MCP Server；不要手动删除用户数据目录。";
    } else if (session.process === "not-running") {
        report.bridge = "stale-main-process";
        report.recommendation = "Main 已退出，旧会话文件没有清理。先正常启动 DigiStudio 再检查；不要手动删除整个用户目录。";
    } else if (!session.registryMatches) {
        report.bridge = "version-mismatch";
        report.recommendation = "MCP Main 与当前客户端工具版本不一致。请保存工程并完整退出、重新启动 DigiStudio。";
    } else {
        try {
            const capabilities = await callBridge("get_mcp_capabilities", {});
            report.bridge = "responsive";
            report.readTools = capabilities.readTools?.length ?? null;
            report.writeTools = capabilities.writeTools?.length ?? null;
            report.recommendation = "MCP 正常响应；若要操作项目，请先选中 LVGL 工程页。";
        } catch (error) {
            report.errorCode = error?.code || "BRIDGE_ERROR";
            report.bridge = report.errorCode === "AUTH_REQUIRED"
                ? "authentication-required" : "unavailable";
            report.recommendation = report.errorCode === "AUTH_REQUIRED"
                ? "MCP Server 已启动，但当前 IDE 未登录有效的迪太云账号。请在 DigiStudio 完成登录后再连接 MCP；不要绕过登录或授权。"
                : report.errorCode === "IPC_UNAVAILABLE"
                ? "Main 仍运行，但编辑窗口隐藏、崩溃或尚未加载。请先在 IDE 显示编辑窗口；无法恢复时保存工作后正常退出并重启。"
                : report.errorCode === "IPC_TIMEOUT"
                ? "Main 存在但 Renderer 未响应。请检查未保存内容和关闭确认，正常退出重启；不建议直接删除 lockfile。"
                : "确认 DigiStudio 正常运行且 MCP Server 已启用；保存工作后再完整重启。";
        }
    }
    return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    diagnose().then(report => {
        if (process.argv.includes("--json")) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log("DigiwiseStudio MCP 只读诊断");
            console.log("会话:", report.session, "| Main:", report.process,
                "| PID:", report.pid || "-", "| 注册版本匹配:", report.registryMatches ?? "-");
            console.log("桥接:", report.bridge,
                "| 工具:", report.readTools ?? "-", "读 /", report.writeTools ?? "-", "写");
            if (report.errorCode) console.log("错误:", report.errorCode);
            console.log("建议:", report.recommendation);
        }
        if (report.bridge !== "responsive") process.exitCode = 1;
    }).catch(error => {
        console.error("MCP doctor error:", error?.message || String(error));
        process.exitCode = 1;
    });
}
