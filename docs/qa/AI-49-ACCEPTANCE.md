# AI-49 独立验收报告：BSP 版本选择 UI 切片

日期：2026-11-19（CST）
任务：AI-49
依赖：AI-47（BSP 版本选择与下载状态 UI）
仓库：D:/代码/DigiwiseStudio

## 1. 独立范围与结论

本次按任务描述仅验收 UI/Renderer/Main IPC 的目录契约；目录显示不等于 BSP 下载或 Build 通过。覆盖目标为成功、空目录、错误、账号切换/退出、超长字段拒绝、token 不出 Renderer，并执行专项测试、tsc、npm run build。

独立 verdict：PASS（本切片范围内）。

本轮针对 D-BUILD-049 串行复核：`build/project-editor/lvgl/widgets/Arc.js` 已存在；完整 `npm run build` 退出码 0，随后 UI 专项、Main 专项、TypeScript 和 diff 检查均退出码 0。AI-47 的 Renderer UI 状态、版本选择、下载禁用边界和 token 隔离证据保持通过。

未修改实现；仅更新本验收报告，保留既有用户/并发改动。

## 2. 实际命令证据

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `node tools/verify_bsp_catalog_ui.cjs` | 0 | `BSP catalog UI tests passed`；格式化和错误映射夹具通过 |
| `node tools/verify_bsp_catalog.cjs` | 0 | `catalog API tests passed`；覆盖 Main API mock、空数组、非法 categoryCode、畸形/超长响应、字段投影、网络失败、401、IPC sender/frame、重复注册、session generation 变化 |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false` | 0 | 无输出，TypeScript 检查通过 |
| `npm run build` | 0 | clean-build、TypeScript、gulp release/minify、CSS、LVGL image converter 和安装配置生成全部完成；Arc.js 已存在 |
| `git diff --check` | 0 | 无空白错误 |
| `git status --short` | 0 | 保留并发/用户改动；测试未回滚源码 |

执行期间没有读取凭证、context 或真实账号；没有启动 Java、登录、下载 BSP、PIO/真实 Build、设备或安装流程。

## 3. 需求映射

状态定义：PASS 表示该项有本轮源码/夹具证据；FAIL 表示验收门槛失败；未覆盖表示未执行真实环境。

| 验收项 | 结果 | 证据/缺口 |
|---|---|---|
| 目录成功返回 | PASS（Main mock + UI IPC） | Main 专项退出 0；UI wrapper 调用 typed IPC |
| 空目录 | PASS（Main mock + UI 源码） | Main 夹具断言空数组；UI 渲染 empty 状态 |
| 错误显示 | PASS（UI 源码） | ErrorPanel、错误码映射、Retry 和 error state 存在；未执行真实服务 |
| 账号切换/退出 | PASS（UI 源码 + IPC mock） | 未登录态可见；accountId 触发清理/重载；requestId 隔离过期响应；Main generation/认证失效夹具通过 |
| 版本选择与字段展示 | PASS（UI 源码） | 分类/版本 listbox、selectedVersionId、版本/文件名/大小/日期/SHA-256 详情存在 |
| 下载按钮明确禁用 | PASS（UI 源码） | 选中版本详情按钮 disabled，标题说明下载未实现 |
| 超长字段拒绝 | PASS（Main mock） | 1 MiB 响应、201 条、超长字段、超大文件/摘要负例通过；未覆盖 UI 截断 |
| token 不出 Renderer | PASS（源码级） | Home wrapper 只返回 DigiwiseIpcResult；UI 与 wrapper 源码不含 token；未执行打包 Renderer 抓取 |
| Main IPC sender/frame | PASS（mock） | handler、重复注册、错误 sender/frame 夹具通过 |
| TypeScript/build 门槛 | PASS | tsc 和 `npm run build` 均退出 0；复核前确认 `build/project-editor/lvgl/widgets/Arc.js` 存在 |
| Java API/真实账号/真实目录 | 未覆盖 | 本任务范围和环境没有真实服务/账号 |
| BSP 下载/项目关联/Build/设备 | 未覆盖（范围外） | 目录显示不等于下载或 Build 成功 |

## 4. 缺陷与交接

D-UI-049（已复测关闭）：前次缺失的 BSP Renderer UI 已出现在 `packages/home/digiwise-bsp-catalog-ui.tsx`，并接入 `home-tab.tsx`；本轮 UI/源码验收证据通过。

D-BUILD-049（已复测关闭）：前次构建阻塞已解除。复核前确认 `build/project-editor/lvgl/widgets/Arc.js` 存在；在稳定工作区执行 `npm run build` 退出码 0，gulp minify 完成。

触发条件：在 `D:/代码/DigiwiseStudio` 执行 `npm run build`。

复测预期：clean-build、TypeScript、gulp release、CSS 和安装配置生成全部完成并退出 0。

复测实际：全部完成并退出 0；未再复现 Arc.js ENOENT。

影响：D-BUILD-049 不再阻塞 AI-49 本切片放行。

## 5. 未覆盖项

- 真实 Java Public API、真实 HTTP 401/403/400/422/404/429 与服务器端过滤。
- 真实登录、授权、撤权、账号切换和退出。
- 真实 BSP 目录数据、下载、SHA 校验、项目关联、PIO/工具链 Build、设备烧录。
- Electron 运行时 UI 自动化、截图/trace；当前环境未提供可用浏览器自动化入口，本报告不编造 Playwright/Allure 证据。
- Renderer 打包运行时的 token 扫描；当前仅有源码级边界证据。

## 6. 放行建议

本切片放行：UI/Renderer/IPC 目标、TypeScript 和完整构建门槛本轮均通过，D-UI-049 与 D-BUILD-049 已复测关闭。真实 Java、账号、下载、Build、设备仍保持未覆盖，不得将本报告解释为这些真实链路已通过。
