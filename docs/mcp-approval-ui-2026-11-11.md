# DigiwiseStudio MCP 写入授权弹窗 UI 优化验收（2026-11-11）

## 本轮改动

将 `packages/mcp/main-server.ts` 中旧的 Windows/Electron 原生 `dialog.showMessageBox` 写入授权，替换为 Main 进程所有的独立安全模态窗口：

- `packages/mcp/approval-dialog.ts`：真正的 Electron modal BrowserWindow，禁用 Node Integration、启用 Context Isolation/Sandbox、禁止窗口打开与页面跳转。使用唯一受控的主帧 IPC 传递三种选择。
- `packages/mcp/approval-preload.ts`：只为四个本地受信按钮（拒绝、仅本次、会话允许、关闭）与 Esc 键发送固定的许可数字；不开放通用 API。
- `packages/mcp/approval-view.ts`：隔离、HTML 转义的 UI 结构和深浅两套主题；采用 DigiwiseStudio/GUI Guider 风格的低圆角、深灰底、#ffb500 金色强调、统一字体和留白。
- 工具名与**完整请求参数**单独显示。原来 `JSON.stringify(args).slice(0, 1100)` 的强制截断已取消，JSON 区域使用 `white-space: pre-wrap; overflow-wrap:anywhere` 及可滚动查看，不用 CSS 省略号。
- “仅允许本次”和“本次会话允许”的权限范围说明固定在底部按钮上方；拒绝/仅本次/会话允许三个按钮始终可见。
- 设置页 `home-guider-settings.less` 的 Python 路径只读文本以前使用 `white-space:nowrap; text-overflow:ellipsis`，现在改为多行自动换行，防止只显示路径前缀。

权限规则**没有放宽**：默认拒绝；窗体关闭、Esc、Main/WebContents 关闭或崩溃、MCP Server 停止都拒绝；写入通过本地显式选择授权。会话授权只在该 MCP Server 会话有效，关闭即撤销。主工程 Renderer 不能伪造模态窗口主帧 IPC。

## 验证

| 项目 | 结果 |
|---|---|
| 超过 6500 字符的模拟参数 | PASS；参数结尾完整保留，未截断 |
| HTML 注入字符串转义、内容安全策略 | PASS |
| 深浅色布局与中英文按钮 | PASS |
| 三按钮、关闭、Esc/Abort 的默认拒绝 | PASS；隔离窗口单元测试 |
| 阻止非模态 WebContents、错误帧、非法权限值伪造授权 | PASS |
| `npm run verify-mcp` | PASS；原 19 read / 37 write 工具安全回归 |
| TypeScript 及样式构建 | PASS；由于工作区另一处未用函数导致严格 `build-src` 失败，本轮使用 `npx tsc --noUnusedLocals false` + Gulp release 编译验证，未改用户其它模块 |
| `npm run pack` 与 `npm run verify-mcp-packaged` | PASS，检查 ASAR 内新增 `approval-dialog.js`、`approval-preload.js`、`approval-view.js` 存在且字节一致 |
| 620×530 深色主题视觉渲染 | PASS；Microsoft Edge headless 静态界面检查，提示、长路径与按钮均可见 |
| 真实 DigiStudio 新 Main 程序显示及实际授权交互 | **待真实手工验收**；当前运行中的 IDE 在源码更新前启动，不强制关闭 |

## 预览位置与验收方式

静态 UI 预览：
`D:\代码\DigiwiseStudio\artifacts\mcp-acceptance\approval-dialog-preview.png`

正式程序重新加载新版 Main 后，在独立 `artifacts/mcp-acceptance` 演示工程发起一次 MCP 写入请求，确认弹出的是新版模态窗口、长参数可滚动、关闭/Esc 默认拒绝、三种许可语义和会话撤销正常。在用户当前工程未保存时，不得擅自退出或强制结束 IDE。

其他工作区导航/文件名中仍有为紧凑列表保留的 `text-overflow:ellipsis`；这次不做全局覆盖以免影响导航布局，只针对授权弹窗和设置页完整信息字段处理。
