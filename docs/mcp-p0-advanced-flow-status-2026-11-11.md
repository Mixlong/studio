# DigiwiseStudio MCP P0 高级 Flow 验收进展（2026-11-11）

## 目标

验证 AI 不止能编辑简单的顺序 Flow，还能在真实 LVGL 8.4.0 / WASM 运行中构造并验证以下完整业务动作：

1. 初始全局布尔变量 `DeviceReady=false`，Main 点击 CHECK → IsTrue(False) → Blocked 页面
2. Blocked 点击 RETURN → 回到 Main
3. Main 点击 ENABLE → SetVariable(DeviceReady,true)
4. Main 再点 CHECK → IsTrue(True) → CallAction(McpApprove) → SetVariable(DeviceResult,"ALLOWED") → Approved 页面
5. 保存工程与事件连接、核对两条分支 PNG 稳定帧、停止 Preview、Check/Build、核对 C/H 产物与工程未修改状态

**所有操作仅在 `artifacts/mcp-acceptance/advanced-flow-*` 下新建工程并通过正式 MCP 本地授权。测试脚本不会编辑现有 EmptyUI 工程。**

## 当前事实

| 检查 | 结果 |
| --- | --- |
| 完整 E2E 程序已新增 | PASS — `packages/mcp/test-live-flow-advanced.mjs` |
| npm 启动命令 | PASS — `npm run verify-mcp-live-advanced` |
| 源码 TypeScript / Gulp build | PASS — `npm run build-src` |
| MCP Mock/协议安全回归 | PASS — `npm run verify-mcp` |
| Windows 打包与 ASAR MCP 校验 | PASS — `npm run pack` + `npm run verify-mcp-packaged`（19 读 / 37 写） |
| 工具清单 | 19 读 + 37 写（工具数量未变化） |
| 真正的两分支 WASM 画面与 Action 调用 | **BLOCKED / 未验收** — 当前 Main Electron 进程没有可响应的编辑器主窗口，Bridge 调用 `get_current_project` 返回 `IPC_TIMEOUT`；未强制结束进程、未绕过权限 |
| 用户已有工程 | 未进行 MCP 写入测试 |

上一轮已通过的单分支 `Button.CLICKED → LVGL.changeScreen(Success)` 真实 E2E 证据不等于本轮 IsTrue/CallAction 的实际运行验收。

## AI 组件属性覆盖的具体差异

`get_mcp_capabilities.widgetAuthoring` 新增机器可读说明，与 Validator 的初始字段清单共享常量，避免文档与接口漂移。

- `add_widget` 创建时安全写入 **11 个基础字段**：`identifier`, `left`, `top`, `width`, `height`, `text`, `value`, `useStyle`, `hiddenFlag`, `clickableFlag`, `image`
- 创建后 AI 必须调用 `get_widget_schema` 读取该组件在当前 LVGL 版本下真正支持的属性，然后用 `set_widget_property` 修改已验证的标量、颜色、枚举及受控引用；局部样式使用 `set_widget_local_style`；变量绑定使用 `bind_widget_variable`
- 组件 Palette 类型动态发现，上一次真实 IDE 返回 37 种；**37 种并不等于都已通过属性/重开/构建验收**
- 仍不允许任意脚本、复杂表达式、未经验证的对象字段或不安全的文件路径。字体二进制导入、容器整树复制、全部组件属性等仍是后续工作

## 下一个真实验收步骤

用户的 DigiStudio 若正在运行或含未保存编辑，先在 GUI 内保存/正常退出，再完整 `npm start` 启动，不能只热刷新 Renderer。确认 MCP Server 已开启，且 Main/Renderer 版本一致、当前工程可响应后：

```powershell
cd D:\代码\DigiwiseStudio
npm run verify-mcp-live-advanced
```

脚本会打开独立工程。每一次写入均通过本地授权；选择本次会话授权后可连续执行。若任一步失败会记录到隔离工程下 `advanced-flow-acceptance.json`，不得将失败掩盖为 PASS。

**完成标准：** 两条不同分支确实达到 Blocked / Approved，PNG 画面连续两次稳定且显著变化；Stop 回到 idle；真实 Check/Build 成功且生成源文件；工程最后 `modified=false`。高级业务分支真实结果未出之前不能声称 P0 已完全验收。
