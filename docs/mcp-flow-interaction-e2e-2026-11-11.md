# DigiwiseStudio MCP — AI 全流程真实运行验收（2026-11-11）

## 验收范围

本报告针对 DigiwiseStudio 本地 Electron IDE、MCP 19 个读取 + 37 个写入工具，以及 LVGL 8.4.0 / WASM 运行环境。

**结果：所测基本交互闭环 PASS。** 不是整个 MCP 的 100% 功能覆盖。未测试的能力详见下方边界。

### 可重复执行的真实测试

```powershell
cd D:\代码\DigiwiseStudio
npm run verify-mcp-live-flow
```

该命令调用 `packages/mcp/test-live-flow-navigation.mjs`，每次在 `artifacts/mcp-acceptance/flow-click-*` 下新建独立 LVGL 工程，不覆盖已有项目；所有写入遵守 DigiwiseStudio 本地 MCP 授权。不得加入无 UI、无授权的自动 CI。

最近一次成功工程：

`artifacts/mcp-acceptance/flow-click-xWSBKL/Flow_Click_MCP.eez-project`

报告与画面：

- `artifacts/mcp-acceptance/flow-click-xWSBKL/acceptance.json`
- `artifacts/mcp-acceptance/flow-click-xWSBKL/before.png`
- `artifacts/mcp-acceptance/flow-click-xWSBKL/after.png`
- `artifacts/mcp-acceptance/flow-click-xWSBKL/src/ui/`：Build 产物

## 验收检查点

| 序号 | 端到端动作 | 真实结果 |
| --- | --- | --- |
| 1 | MCP 在独立目录创建 LVGL 8.4.0 Flow 工程并由 IDE 加载 | PASS |
| 2 | MCP 创建 Success 页面及 SUCCESS 标签、Main 页面 Button | PASS |
| 3 | MCP 创建 Start → LVGL changeScreen(Success) → End Flow 节点及连线 | PASS |
| 4 | 将 Button CLICKED 事件绑定到现有 Action | PASS |
| 5 | MCP 保存，读取磁盘 .eez-project 的页面、按钮、事件和 Action | PASS |
| 6 | 授权启动原生 WASM 预览，获取 Main 800×480 PNG | PASS |
| 7 | `preview_tap` 坐标 (400,375)，实际 Runtime 报告 Success 页面 | PASS |
| 8 | 连续读取 Success PNG，等待稳定后核对画面 | PASS；明显变化像素 4.392%，连续 2 帧 SHA-256 相同 |
| 9 | 停止预览，Runtime 状态 idle | PASS |
| 10 | `start_project_check` → `get_project_check_status` | PASS；0 error / 0 warning |
| 11 | `start_project_build` → `get_project_build_status` | PASS；0 error / 0 warning |
| 12 | 确认 screens.c/screens.h/actions.h/ui.c/ui.h 真实存在 | PASS |
| 13 | 回读 active project 为同一独立工程，modified=false、runMode=false | PASS |

### 本轮发现并解决的误判

首轮 E2E 在运行页刚从 Main 切换成 Success 后立即截图，虽然 `get_preview_status.selectedPage` 已是 Success、PNG 哈希也变了，但实际图像仍是 Main 画面，变化只来自 Button 按压样式。延迟采样显示约 350ms 后 Success 页面才完成并稳定绘制。

现在专用验收脚本要求 **目标页 Runtime 状态正确 + 演示工程明显变化像素 >=3% + 连续两次 PNG SHA-256 相同** 才算视觉验证通过。3% 是本演示工程的可控测试阈值，不是通用视觉比较标准。MCP 的 `frameVerified` 仅说明当前 WASM framebuffer 可读取，不意味着页面过渡完成。

### 不影响用户工程的边界

- 全部写入及交互只针对 `artifacts/mcp-acceptance/` 下新创建的演示工程。
- 不关闭/强制结束用户 IDE；遵守客户端本地写入授权。
- 单次示例结束后停止 WASM，最新测试项目未出现未保存修改。
- 早先一个历史验收工程曾观察到 `modified=true`，原因未完全定位；新建的上述 E2E 工程重复测试未复现。保留针对异常修改状态的失败检查，不声称该问题全局彻底解决。

## 尚待真实验收或实现

IsTrue 条件分支、CallAction 调用链、变量动态更新、复杂 Flow 表达式、跨 LVGL 版本的真实运行回归；拖拽、多点触摸、键盘、模拟器运行日志、通用自动视觉差异比较；Toolchain、固件下载/烧录及其恢复策略。这些仍需后续专门验收，不应合并算入本次 PASS。
