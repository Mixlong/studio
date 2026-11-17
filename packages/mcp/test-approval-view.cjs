/* Test safe, scrollable permission content without opening Electron. */
const assert = require("node:assert/strict");
const { buildMcpApprovalHtml } = require("../../build/mcp/approval-view.js");

const last = "参数结尾_必须完整可见_987654321";
const args = {
    name: `<script>alert("unsafe")</script>&\\"'`,
    path: "C:\\work\\<unsafe>\\demo.eez-project",
    detail: "A".repeat(6500) + last,
    nested: { key: "&<>", parameters: ["line1", "line2"] }
};
for (const isChinese of [true, false]) {
    const html = buildMcpApprovalHtml("create_page", args, isChinese);
    assert.ok(html.includes(last), "Full request text must be visible, not sliced to 1100 chars");
    assert.ok(!html.includes("<script>alert"), "Untrusted argument markup must be escaped");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&amp;"));
    assert.ok(html.includes("Content-Security-Policy"));
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes('class="parameters"'));
    assert.ok(html.includes("white-space: pre-wrap"));
    assert.ok(html.includes("overflow-wrap: anywhere"));
    assert.ok(html.includes("max-height: 195px; overflow: auto"));
    assert.ok(html.includes('class="footer"'));
    assert.ok(html.includes('id="approval-deny"'));
    assert.ok(html.includes('id="approval-once"'));
    assert.ok(html.includes('id="approval-session"'));
    assert.ok(html.includes('id="approval-close"'));
    assert.ok(!html.includes("text-overflow: ellipsis"),
        "This dialog must not shorten the arguments or footer");
}
const chinese = buildMcpApprovalHtml("create_project", { projectPath: "D:\\测试" }, true);
assert.ok(chinese.includes("创建独立 LVGL 工程"));
assert.ok(chinese.includes("本次会话允许"));
const english = buildMcpApprovalHtml("create_page", { name: "New" }, false);
assert.ok(english.includes('data-theme="dark"'));
const light = buildMcpApprovalHtml("create_page", {name:"New"}, false, false);
assert.ok(light.includes('data-theme="light"'));
assert.ok(light.includes('background: #fff'));
assert.ok(english.includes("Allow for this session"));
assert.ok(english.includes("Allow once"));
console.log("PASS: styled approval window escaped 6KB+ parameters, no ellipsis, scrollable details, 3 permission actions, Chinese/English");
