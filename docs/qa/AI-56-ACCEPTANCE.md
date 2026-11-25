# AI-56 四模块真实 Web/E2E 验收与 IDE 业务闭环复测

日期：2026-11-19（CST）
任务：AI-56
仓库：D:/代码/DigiwiseStudio
IDE HEAD：e203807232d506f8123cfc504beaad3c628da008
产品版本：0.0.13
运行环境：Windows 11；Node v22.23.4；npm 10.9.9；TypeScript 7.0.2

## 1. 独立验收结论

结论：BLOCKED，不能签收四模块真实 Web/E2E 或 IDE 业务闭环。

本次环境没有可用 Egolite、Playwright、Chromium/Chrome 命令，也没有可用的真实 Java Public API/隔离测试账号、模板/BSP 资源、PIO 工具链、设备或安装包环境。按任务要求，未使用 mock、源码存在或既有历史报告冒充真实业务通过；未执行登录、授权变更、受控下载、Build Gate、MCP 真实撤权、安装启动或设备流程。

另发现一项可复现回归：`DigiwisePublicApi` 改为读取 `Response.body.getReader()` 后，现有集成测试中的 fetch double 仍只提供 `text()`，导致 `verify-java-rollout`、`verify-ide-changelog`、`verify-mcp` 在真实业务前置模拟阶段均以 `PUBLIC_API_INVALID_RESPONSE / response-read-failed` 失败。该失败已记录为 D-AI56-001，需由后端/IDE API 负责人修复并复测。

## 2. 环境与证据

| 项目 | 结果 | 证据 |
|---|---|---|
| Egolite | BLOCKED | `command -v egolite` 无输出；未找到可执行文件 |
| 浏览器自动化 | BLOCKED | `command -v playwright`、`chromium`、`google-chrome` 均无输出 |
| 真实 IDE/Java 服务 | BLOCKED | 未发现可供本任务使用的 Web/Electron 测试实例；仅有 Paperclip API 端口 127.0.0.1:3101 |
| 真实账号/资源 | BLOCKED | 未提供测试账号、授权矩阵、后台资源、BSP 样本或安装包；未读取凭证 |
| 生产/后台写入 | NOT EXECUTED | 未启动 Java/MariaDB/Redis，未修改数据库、账号或授权 |
| 截图/网络/trace | NOT AVAILABLE | 无可用浏览器/Egolite，未编造截图、网络记录或 Playwright/Allure 报告 |

## 3. 本次实际命令

| 命令 | 退出码 | 关键结果 |
|---|---:|---|
| `node tools/verify_bsp_catalog.cjs` | 0 | `catalog API tests passed`；仅 Main API mock/契约夹具 |
| `node tools/verify_bsp_catalog_ui.cjs` | 0 | `BSP catalog UI tests passed`；仅纯函数/UI 夹具 |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false` | 0 | TypeScript 检查通过 |
| `npm run build` | 0 | clean-build、tsc、gulp release/minify、CSS、LVGL converter、安装配置生成完成 |
| `npm run verify-update-discovery` | 0 | `update discovery checks passed`；仅更新发现 mock |
| `npm run verify-java-rollout` | 1 | `DigiwisePublicApiError`；code=`PUBLIC_API_INVALID_RESPONSE`，requestId=`response-read-failed`，见 D-AI56-001 |
| `npm run verify-ide-changelog` | 1 | 同一 `response-read-failed`，见 D-AI56-001 |
| `npm run verify-mcp` | 1 | 前置 PASS 后在 `test-project-binding-api.cjs` 处同一 `response-read-failed`，见 D-AI56-001 |
| `git diff --check` | 0 | 无空白错误；提示既有 LF/CRLF 转换警告 |

可复运行目录：`D:/代码/DigiwiseStudio`

## 4. 验收矩阵

状态定义：PASS 仅表示本次实际命令对应的本地夹具/构建门槛；未执行不代表通过。

| 需求 | 结果 | 本次证据/缺口 |
|---|---|---|
| 用户登录、退出、恢复、停用、改名、撤权、有效期、并发 | 未执行/阻塞 | 无真实 Web/Egolite、账号和后台；不得以 401 mock 代替 |
| 模板/BSP 目录与版本选择 | 有限 PASS（本地夹具）/真实未执行 | `verify_bsp_catalog*` 和完整 build 通过；真实目录、权限过滤、服务器端 401/403/404/429 未执行 |
| 受控下载成功 | 未执行/阻塞 | 无真实 BSP、下载会话、文件摘要或网络证据 |
| 受控下载拒绝分支 | 未执行/阻塞 | 无真实账号/撤权/过期/下架/target mismatch/断网环境 |
| 项目关联与来源/目标隔离 | 未执行/阻塞 | 无真实模板/BSP 工程与重开证据 |
| Build Gate | 未执行/阻塞 | 无 PIO/工具链；未证明 gate deny 时 PIO 启动次数为 0 |
| MCP 策略变化与绑定撤销 | 本地夹具链被 D-AI56-001 阻断；真实未执行 | 未有 Java 实时策略、真实工程绑定、撤权后的读写/构建请求证据 |
| MCP 越权读写/构建拒绝与审计 | 未执行/阻塞 | 无真实后台、账号和运行 IDE；未产生可回读审计链 |
| 更新：版本检查→下载→校验→安装 | 本地契约有限 PASS；真实未执行 | `verify-update-discovery` 通过；无正式安装包、签名/哈希、安装环境 |
| 新版本启动与后台事件 | 未执行/阻塞 | 未安装/启动新版本，未回读 `install_success` 后台事件 |
| 更新失败恢复 | 未执行/阻塞 | 无隔离安装/回滚环境 |
| 桌面安装 | 未执行/阻塞 | 需要正式安装包和隔离安装机 |
| PIO | 未执行/阻塞 | 需要 PlatformIO、目标工具链和代表工程 |
| 烧录/设备 E2E | 未执行/阻塞 | 需要代表设备、驱动、刷机工具和人工确认流程 |

## 5. 缺陷与复测记录

### D-AI56-001：Public API response reader 与既有 fetch double 不兼容

- 严重程度：P1（阻断当前集成回归；真实生产影响待真实 Response 验证）
- 负责人：后端工程师 / IDE API 负责人
- 触发条件：运行 `npm run verify-java-rollout`、`npm run verify-ide-changelog` 或 `npm run verify-mcp`
- 步骤：
  1. 在 `D:/代码/DigiwiseStudio` 执行 `npm run build`。
  2. 执行上述任一验证命令。
  3. 观察 `DigiwisePublicApi.request` 失败。
- 预期：测试 fetch double 返回 JSON 后，API 客户端解析成功，继续验证 rollout/changelog/MCP 契约。
- 实际：`DigiwisePublicApiError: The Digiwise IDE Public API response could not be read`；`status=502`、`code=PUBLIC_API_INVALID_RESPONSE`、`requestId=response-read-failed`。
- 定位证据：`packages/main/digiwise-auth-api.ts:86-126` 的 `readCappedResponseText` 直接使用 `response.headers.get` 与 `response.body.getReader()`；`tools/verify_java_rollout_integration.cjs:121-124`、`tools/verify_ide_changelog.cjs:45-51` 及 `packages/mcp/test-project-binding-api.cjs` 的 fake fetch 仅返回 `text()`，没有 `headers/body`。
- 影响：集成回归链在 API 解析阶段中止，无法据此验收更新、MCP 绑定或四模块闭环。
- 修复建议：统一测试 double 与 Response 契约；或在 API reader 保留兼容的 `response.text()` fallback，同时继续对真实 Response 做 1 MiB 上限校验。修复后必须重新运行上述三个命令并记录退出码。
- 本次复测：未关闭；修复前重复执行失败。

## 6. 需要后续交接

1. 交付/运维提供 Egolite 或等效受控 Web/E2E 工具、隔离 IDE 实例、Java Public API 地址和启动说明。
2. 产品/后台提供不含凭证的测试账号矩阵说明：有效、停用、撤权、到期前/到期时/到期后、无权品类、并发更新账号及审计读取角色。
3. 后端提供真实模板/BSP 版本、SHA-256、下架/损坏样本和可恢复的授权变更环境。
4. IDE/交付提供 PIO 工具链、代表工程、正式 Windows 安装包、安装失败/回滚环境；设备烧录另行标记专用环境。
5. D-AI56-001 修复后，按本文件矩阵顺序执行：登录→模板/BSP→下载拒绝分支→项目关联→Build Gate→MCP 撤权/审计→更新安装启动→失败恢复。

在以上前置提供前，本任务保持 BLOCKED；不得将本报告中的本地夹具 PASS 解读为真实业务放行。
