/** Pure, escaped markup for the isolated native Main-owned MCP approval window. */
function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function buildMcpApprovalHtml(
    tool: string,
    args: unknown,
    isChinese: boolean,
    isDarkTheme = true
): string {
    const labels = isChinese ? {
        title: "MCP 写入授权",
        description: tool === "create_project"
            ? "外部 AI 请求创建独立 LVGL 工程，请核对以下操作与参数。"
            : "外部 AI 请求修改当前 LVGL 工程，请核对以下操作与参数。",
        tool: "请求工具",
        arguments: "请求参数",
        information: "仅允许本次只批准当前操作；本次会话允许将批准后续写入，关闭 MCP Server 后自动失效。",
        deny: "拒绝",
        once: "仅允许本次",
        session: "本次会话允许",
        close: "关闭并拒绝"
    } : {
        title: "MCP write approval",
        description: tool === "create_project"
            ? "External AI requests to create an LVGL project. Review the operation and its parameters."
            : "External AI requests to modify the active LVGL project. Review the operation and its parameters.",
        tool: "Requested tool",
        arguments: "Request parameters",
        information: "Allow once approves only this operation. Allow for this session approves later writes until MCP Server is turned off.",
        deny: "Deny",
        once: "Allow once",
        session: "Allow for this session",
        close: "Close and deny"
    };
    // No truncation: a partial JSON preview is unsafe for informed consent.
    // The private MCP bridge already caps each validated request at 64 KiB.
    const parameters = JSON.stringify(args ?? {}, null, 2) || "{}";
    return `<!doctype html>
<html lang="${isChinese ? "zh-CN" : "en"}" data-theme="${isDarkTheme ? "dark" : "light"}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"/>
<title>${escapeHtml(labels.title)}</title>
<style>
:root { color-scheme: dark; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; }
body { background: #242424; color: #e5e5e5; font-size: 13px; }
.shell { height: 100%; display: flex; flex-direction: column; min-width: 0; }
.heading {
  display: flex; align-items: center; gap: 12px; flex-shrink: 0;
  min-height: 70px; padding: 16px 22px; border-bottom: 1px solid #414141;
  -webkit-app-region: drag;
}
.shield {
  width: 36px; height: 36px; flex-shrink: 0; border: 1px solid #6d571f;
  border-radius: 5px; background: #3c331c; display: grid; place-items: center;
  color: #ffb500;
}
.title-area { min-width: 0; flex: 1; }
.title { font-size: 16px; font-weight: 600; line-height: 1.35; margin: 0; }
.subtitle { color: #a7a7a7; font-size: 11px; margin-top: 3px; }
.close {
  -webkit-app-region: no-drag; border: 0; background: transparent;
  font-size: 21px; line-height: 32px; width: 32px; height: 32px;
  color: #a4a4a4; cursor: pointer; border-radius: 4px;
}
.close:hover { background: #383838; color: #fff; }
.content { min-height: 0; overflow-y: auto; flex: 1; padding: 20px 22px 14px; }
.description { line-height: 1.65; margin: 0 0 18px; color: #dedede;
  overflow-wrap: anywhere; }
.field { margin: 0 0 15px; min-width: 0; }
.field-label { display: block; color: #a6a6a6; font-size: 12px; margin-bottom: 8px; }
.tool {
  display: inline-block; max-width: 100%; padding: 7px 10px;
  border: 1px solid #525252; border-radius: 4px; background: #303030;
  color: #ffce59; font: 12px/1.5 Consolas, "Segoe UI", monospace;
  white-space: normal; overflow-wrap: anywhere;
}
.parameters {
  border: 1px solid #454545; border-radius: 4px; background: #1c1c1c;
  color: #d0d0d0; padding: 12px 14px; margin: 0;
  font: 12px/1.65 Consolas, "Microsoft YaHei UI", monospace;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  min-width: 0; max-height: 195px; overflow: auto;
  user-select: text; -webkit-user-select: text;
}
.info { font-size: 12px; line-height: 1.65; color: #a6a6a6;
  padding: 10px 12px; background: #2c2b28; border-left: 2px solid #b98822;
  border-radius: 2px; overflow-wrap: anywhere; }
.footer { flex-shrink: 0; border-top: 1px solid #414141;
  padding: 13px 22px 17px; background: #242424; }
.footer .info { font-size: 11px; line-height: 1.6; padding: 8px 10px;
  margin-bottom: 12px; }
.actions { display: flex; align-items: center; justify-content: flex-end;
  flex-wrap: wrap; gap: 8px; }
button { font-family: inherit; font-size: 12px; font-weight: 500;
  min-height: 36px; padding: 8px 14px; border-radius: 4px;
  white-space: normal; overflow-wrap: anywhere; line-height: 1.35;
  cursor: pointer; }
button:focus-visible { outline: 2px solid #ffb500; outline-offset: 2px; }
.btn-deny { margin-right: auto; border: 1px solid #535353;
  background: #303030; color: #dedede; }
.btn-deny:hover, .btn-session:hover { background: #3d3d3d; }
.btn-session { border: 1px solid #696050; background: #34312a; color: #f0d29a; }
.btn-once { border: 1px solid #ffb500; background: #ffb500; color: #202020; }
.btn-once:hover { background: #f0a900; border-color: #f0a900; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: #555; border: 2px solid #242424; border-radius: 6px; }
::-webkit-scrollbar-track { background: transparent; }
:root[data-theme="light"] { color-scheme: light; }
[data-theme="light"] body,
[data-theme="light"] .footer { background: #fff; color: #242424; }
[data-theme="light"] .heading,
[data-theme="light"] .footer { border-color: #e3e3e3; }
[data-theme="light"] .description { color: #333; }
[data-theme="light"] .field-label,
[data-theme="light"] .subtitle { color: #666; }
[data-theme="light"] .tool { background: #f8f7f3; border-color: #ddd4c0; color: #815800; }
[data-theme="light"] .parameters { background: #f6f7f8; border-color: #dedfe2; color: #252525; }
[data-theme="light"] .info { background: #fff8ea; color: #625439; }
[data-theme="light"] .shield { background: #fff7df; color: #a57400; border-color: #f1dca4; }
[data-theme="light"] .close { color: #666; }
[data-theme="light"] .close:hover { background: #f3f3f3; color: #242424; }
[data-theme="light"] .btn-deny { background: #fff; color: #333; border-color: #c7c7c7; }
[data-theme="light"] .btn-session { background: #f7f4ed; color: #765512; border-color: #d9c9ab; }
[data-theme="light"] .btn-deny:hover,
[data-theme="light"] .btn-session:hover { background: #f1f1f1; }
</style>
</head>
<body>
<main class="shell" role="dialog" aria-modal="true" aria-labelledby="approval-title">
  <header class="heading">
    <div class="shield" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>
      </svg>
    </div>
    <div class="title-area">
      <h1 class="title" id="approval-title">${escapeHtml(labels.title)}</h1>
      <div class="subtitle">DigiwiseStudio · MCP Server</div>
    </div>
    <button type="button" class="close" id="approval-close" aria-label="${escapeHtml(labels.close)}" title="${escapeHtml(labels.close)}">×</button>
  </header>
  <div class="content">
    <p class="description">${escapeHtml(labels.description)}</p>
    <div class="field">
      <span class="field-label">${escapeHtml(labels.tool)}</span>
      <code class="tool">${escapeHtml(tool)}</code>
    </div>
    <div class="field">
      <span class="field-label">${escapeHtml(labels.arguments)}</span>
      <pre class="parameters" tabindex="0">${escapeHtml(parameters)}</pre>
    </div>
  </div>
  <footer class="footer">
    <div class="info">${escapeHtml(labels.information)}</div>
    <div class="actions">
      <button type="button" id="approval-deny" class="btn-deny">${escapeHtml(labels.deny)}</button>
      <button type="button" id="approval-session" class="btn-session">${escapeHtml(labels.session)}</button>
      <button type="button" id="approval-once" class="btn-once">${escapeHtml(labels.once)}</button>
    </div>
  </footer>
</main>
</body></html>`;
}
