# SECURITY-REVIEW

任务：AI-21 独立审查授权期限、下载重放与 Main 执行边界
审查基线：IDE `e203807232d506f8123cfc504beaad3c628da008`；Java `d7f7bc84dd3f5671dd6440ee871bf17cb7bbbbca`。审查为只读；未读取凭证/context，未迁移数据库、启用正式 MCP、登录真实账号、下载真实文件或执行设备写入。

## Verdict

当前实现不应作为“授权期限已闭合、下载不可重放、Build 已在线准入”的安全验收依据。模板/BSP 下载是五分钟 bearer/HMAC URL，持有链接者在有效期内可重复 GET；模型授权表没有起止时间，服务端所有“live grant”查询只能按用户/品类状态判断。MCP Main 的每次在线决策、账号代际和项目绑定检查边界基本成立，但本次未完成真实 Java+IDE+MCP 端到端验证。

阻断发布的已证实问题：F-01（授权无有效期，High）、F-02（下载链接可重放，Medium/High，取决于资源保密等级）。其余为设计缺口或未验证风险。

## 已证实发现

### F-01：用户-品类授权没有有效期/版本化并发语义

- 证据：`DigiwiseStudio-Admin-Java/backend/sql/digiwise_user_model_grants_v5.sql:5-13` 和 `backend/sql/digiwise_model_bsp_v1.sql:14-23` 的 `digi_user_model` 仅有 `user_id, model_id, create_time`；没有 `valid_from/valid_until/revision/revoked_at`。
- 证据：`backend/ruoyi-admin/src/main/java/com/ruoyi/web/service/ide/DigiModelService.java:127-150` 授权操作整行删除再插入，且只按 `status='enabled'` 与用户活动状态判定；`accessibleModelCodes:165-172` 同样无时间条件。
- 证据：`IdeTemplateService.java:328-334` 的 `MODEL_SCOPE` 仅检查 `digi_user_model` 存在、模型 enabled，再叠加模板范围；`DigiBspService.java:46-52,58-64` 同样无授权截止时间。
- 触发：管理员需要让 A 授权在某个时刻到期，或两个管理员并发编辑同一用户的 A/B/C 授权；当前数据库无法表达到期/撤销时间和冲突版本，成功写入的最后一次删除+插入会覆盖另一人的集合。
- 影响：授权持续到人工删除/停用；无法可靠实现“到期即拒绝”、按服务端时间的 Build 阻断、撤权审计和并发冲突提示。现有 `create_time` 不是有效期。
- 最小建议（待 D-07/老板决定，不在本任务实施）：比较方案 A（`valid_from/valid_until` + row revision + 条件更新/审计，查询统一 `NOW()`）与方案 B（不可变 grant 事件/当前快照）；明确边界时区、`expires_at` 等于当前时间的拒绝规则、续期/撤权旧会话行为，并把 grant revision 纳入在线 Build/MCP decision。

### F-02：模板/BSP signed URL 在五分钟内可重放

- 证据：`IdeTemplateService.java:484-510` 每次授权只返回同一对象的 `objectStore.signedDownload(...)` 和 `expiresAt=now+300`；`DigiBspService.java:176-193` 同样返回 `storage.bspDownloadUrl(...)` 与五分钟元数据。
- 证据：本地下载验签 `DigiLocalFileStore.java:264-315`（模板）和 `275-314`（BSP）只校验 `ticket + expires + HMAC`；没有 nonce、消费记录、用户绑定或一次性使用标记。控制器 `IdeLocalTemplateFileController.java:28-51`、`IdeLocalBspFileController.java:28-52` 不要求 Authorization，也不回源重新检查 grant，只要 URL 有效即可 GET。
- 触发：已授权客户端或日志/代理/浏览器历史泄露完整 URL；攻击者在 `expires` 到期前重复请求同一 URL，或把 URL 转交其他人。对象存储签名 URL 同样通常是 bearer URL，是否一次性取决于存储供应商，当前契约没有证明不可重放。
- 影响：撤权/下架后，既有五分钟链接仍能下载；同一链接可被多次复制，无法审计到实际下载者。`Cache-Control: no-store` 只约束缓存，不撤销已经泄露的 bearer。
- 最小建议（D-03 待决）：首选 Main 持 token 向 Java 受控流式代理取 bytes/摘要，代理每次请求在线鉴权并绑定 user/resource/version；若保留签名 URL，至少缩短窗口、绑定一次性服务端票据和资源/用户/请求 ID，明确重试语义。不要以本地 SHA 校验替代下载准入；每次新 Build 仍须在线鉴权。

## 已验证的正向边界

- Main 不把 IDE token 发送给 React：`packages/main/main.ts:148-155` 注册 Main-owned auth/template IPC；`packages/main/digiwise-auth.ts:76-85,264-285` 在 Main 持有 session 并经受控 API 调用；Renderer 仅调用 `packages/home/digiwise-templates.ts:11-35` 的 IPC。
- 模板创建的本地输入有基本边界：`packages/main/digiwise-templates.ts:172-188,631-713` 校验 Windows 项目名、绝对目标路径、目标存在性和原子写入；`402-600` 拒绝绝对/盘符/`.`/`..`/控制字符、重复路径、符号链接/可执行项、加密 ZIP、超量条目/展开大小，并要求一个 `.eez-project`。这支持“路径解压负例”安全夹具，但不等于真实上传下载端到端通过。
- MCP Main 的在线准入边界在源码上较完整：`packages/mcp/central-authorization.ts:60-143` 每次工具调用在线授权、不缓存 allow，前后检查账号代际和本地 binding，校验 tool/riskGroup/参数摘要/项目指纹/版本/decision/request ID/最多 10 秒有效期；Java `IdeMcpProjectBindingService.java:199-264` 服务器保存五秒 decision，绑定项目后才 allow，并要求本地确认（非只读）。
- Java 模板公开查询确实把“品类授权”和模板指定用户范围分开：`IdeTemplateService.java:328-334`。这不是 D-07 有效期的替代品。

## 待确认/未验证风险

- 未启动 Java API、Redis、对象存储、IDE Electron，因此没有真实 401/撤权/过期/并发/重放 HTTP 证据；本报告 F-01/F-02 是静态源码已证实的契约缺口，不把历史 Mock/401 当真实链路验收。
- `DigiwiseTemplateObjectStore.java:88-142` 与 Main `packages/main/digiwise-templates.ts:465-600` 各自做 ZIP 检查；未实测供应商对象存储重定向、缓存层、Range/断点下载和 CDN 日志是否泄露完整 URL。
- 需要进一步检查所有 Build 入口是否都经过同一在线准入 gate，并证明“阻断时 PIO 启动次数为 0、旧产物不复用”；本次源码范围中未发现可直接绑定到 `build.run` 的完整 Build 执行路径。
- `packages/main/digiwise-templates.ts:191-229` 只校验服务返回的 `expiresAt` 在未来，没有上限约束，也没有把过期时间传入下载请求；若后端/代理误发长 TTL，客户端不会拒绝。建议与 F-02 同一契约测试覆盖。
- 审计日志脱敏、保留期、导出权限、下载实际使用者绑定未在本次范围内证明。

## 可复现安全负例（不需要真实凭证）

1. 静态授权期限负例：读取 `digi_user_model` 建表定义，确认不存在 `valid_until`；对同一用户授权 A 后等待任意时间，`DigiModelService.accessibleModelCodes` 的 SQL 仍只按 user/model enabled 返回 A。结论：无法由现有数据表达“到期拒绝”。
2. 本地 URL 重放负例：在启用本地存储的测试夹具中，调用 `DigiLocalFileStore.signedDownload(key)` 得到 `(ticket, expires, signature)`，连续两次 GET `/api/ide/v1/templates/local-file?...`；`verifyDownload` 每次只做 HMAC/时间/路径检查，没有消费状态，因此两次均可返回同一文件（文件存在且签名密钥已配置时）。本次未执行，因为不启动服务、不读取密钥。
3. URL 泄露转交负例：将一次授权返回的完整 `downloadUrl` 原样交给另一 HTTP 客户端，在五分钟内 GET；下载控制器不接收或检查 IDE Authorization，因此 URL 本身就是准入凭证。真实 HTTP 未执行，触发条件由 `IdeLocal*FileController` 源码成立。
4. ZIP 路径负例：对 Main 的 `validateArchivePath` 夹具输入 `../escape.eez-project`、`C:\escape.eez-project`、`/escape.eez-project`、重复大小写路径和含符号链接/可执行扩展名的条目，预期均抛 `TEMPLATE_ARCHIVE_INVALID`。本次未新增夹具；源码分支见 `packages/main/digiwise-templates.ts:402-462,494-538`。

## 后续实现切片与门槛

1. 产品/老板先决定 D-03（代理、缓存、重试）和 D-07（有效期、并发、旧会话、审计）；不能把本报告建议当批准行为。
2. CTO/后端：设计 migration、统一 live-grant predicate、乐观 revision/审计事件，并补 service/controller 负例测试。
3. Main/后端：实现下载代理或一次性票据；测试撤权后新请求拒绝、旧 URL 按方案失效、重放策略明确、Range/断点不绕过。
4. Build owner：列出全部 Build/Download 入口，证明在线授权在任何本地 PIO/副作用前发生，且授权/目标品类/BSP/项目指纹/版本一致。
5. QA/安全复测：真实 API+Redis+本地存储/对象存储测试；保存命令、退出码、HTTP 状态和不含 token/签名 URL 的证据。

## 验证记录

- `git rev-parse HEAD`：IDE `e203807232d506f812c3fc504beaad3c628da008`；Java `d7f7bc84dd3f5671dd6440ee871bf17cb7bbbbca`。
- `git status --short`：两仓库均存在既有未提交/未跟踪改动；本审查未覆盖、未修改这些改动。
- `npm run build`（IDE，退出码 0）：TypeScript、Gulp release、CSS、安装配置生成均完成；构建输出明确提示未配置 production IDE API URL，因此未声称在线服务验收。
- `npm run verify-mcp`（IDE，退出码 0）：全部列出的 MCP 窗口、绑定、在线授权、Main bridge、central integration、写入确认和输入边界夹具通过；这些是本地夹具，不是 Java+Redis+对象存储端到端证明。
- Java 编译尝试：系统 `mvn -version && ... compile` 退出码 127（`mvn` 不在 PATH）；仓库附带 Maven `3.9.11/bin/mvn ... compile` 退出码 1（缺失 `org.codehaus.plexus.classworlds.launcher.Launcher`），故 Java 编译未形成通过证据。
- 本报告写入：`D:/代码/DigiwiseStudio/SECURITY-REVIEW.md`；上述证据不解除 F-01/F-02 阻断。

---

# AI-27 独立安全审查：新增品类/BSP 目录 API 与 IPC 切片

审查基线：IDE 当前工作树 `HEAD e203807232d506f8123cfc504beaad3c628da008`，包含未提交的 AI-25 目录 API/IPC 变更；没有读取凭证或 Paperclip context，没有启动真实账号、后台数据库、Java 服务或下载/烧录。范围仅覆盖 `D:/代码/DigiwiseStudio` 的新增目录 API、Main IPC 和必要调用链，不替代旧任务的全量审查或四模块验收。

## AI-27 Verdict

当前切片不能通过独立安全验收，阻断项为本地响应边界缺失（F-27-01，Medium）。Main 未把 token 暴露给 Renderer，IPC sender/frame 校验、一次注册和会话代际检查均有正向证据；但 HTTP response body、目录数组和字段字符串没有大小上限，受控 API 或被攻陷的代理可令 Main/Renderer 无界读取和保留数据，形成可复现的资源耗尽路径。AI-30 的最终隔离构建门槛已满足本次重新构建命令，但不解除该安全阻断，也不代表真实 Java/Redis/对象存储端到端通过。

## AI-27 当前复测（2026-11-19，AI-25 收口后）

本次按最新验收意见重新核对当前工作树；未读取凭证或 Paperclip context，未启动真实 Java/API/Redis/对象存储、真实账号或下载链路。

- `node tools/verify_bsp_catalog.cjs`：退出码 0，输出 `catalog API tests passed`；覆盖当前源码的成功/空目录、非法 categoryCode 不发请求、unsafe integer、错误 envelope、网络失败、401、字段投影、sender/frame、重复注册、退出和代际变化夹具。
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`：退出码 0。
- `npm run build`：退出码 0；完成 clean-build、TypeScript、Gulp release、CSS、LVGL 复制及安装配置生成。构建输出仅提示未配置 production IDE API URL，不是构建失败。
- `git diff --check`：退出码 0。

复测未解除 F-27-01：当前 `packages/main/digiwise-auth-api.ts:180` 仍直接调用 `response.text()`，目录校验 `:538-570` 仍没有响应字节、数组条数、字符串长度或 `fileSize` 上限。该缺陷属于最终源码切片的静态可复现边界问题；专项夹具通过不能替代超限响应负例。AI-30 隔离构建门槛已由本次 fresh `npm run build` 重新证实，但安全 verdict 仍为阻断。

## AI-27 已证实发现

### F-27-01：目录 HTTP 响应及字段缺少大小边界（Medium，阻断）

- 证据：`packages/main/digiwise-auth-api.ts:153-180` 先对任意 HTTP body 调用 `response.text()`，没有 `Content-Length` 上限、流式读取上限或超时；`packages/main/digiwise-auth-api.ts:538-570` 仅检查 `Array.isArray`、非空字符串、整数类型，没有目录条数、字符串长度、`fileSize` 上限、摘要格式或时间格式边界。
- 触发：登录用户访问 `/categories` 或 `/bsp` 时，API、反向代理或被控制的开发 API 返回极大的 JSON body，或返回数量/字段长度远超产品目录预期的合法 JSON。Main 会完整读取、解析、遍历并通过 IPC 返回；没有凭证即可在本地夹具复现该边界缺口，不需要真实服务。
- 影响：Main 进程内存/CPU 消耗、Renderer IPC 复制和 UI 卡顿/崩溃；攻击者若能影响 API/代理响应可造成拒绝服务。当前校验并不能把“类型正确”当作“资源安全”。
- 建议：在 `request` 层用 Content-Length 快速拒绝并以 capped stream reader 限制总字节数；对 categories/BSP 分别限制最大条数和每个字段长度，`fileSize` 与 `sha256` 按后端契约（例如固定 64 个十六进制字符）校验，拒绝未知/超量字段或至少限制总对象大小；增加超限负例和边界值测试。错误只返回固定 `PUBLIC_API_INVALID_RESPONSE`，不记录响应内容。

### F-27-02：目录模型字段的语义约束弱于书面契约（Low，非单独阻断）

- 证据：`packages/main/digiwise-auth-api.ts:540-546,559-565` 对 `productType` 只要求 safe integer（包括负数），对 `sha256` 只要求非空字符串，对 `publishedAt` 只要求任意字符串，对所有名称/文件名/编码没有长度上限；`docs/ide-bsp-catalog-contract.md:8-16` 只描述了部分正/安全整数约束。
- 触发：API 返回语义非法但类型合法的目录记录；当前 IPC 仍会把它交给 Renderer。该问题不能直接绕过后端 SQL，因为 Java 控制器使用 `@RequestParam` 与参数化查询，但会削弱下游选择、展示和后续下载准入的防御纵深。
- 影响：恶意/错误目录数据可能造成 UI 注入前置条件、异常超长展示或把不可信摘要误当完整性值。当前切片没有下载实现，因此未声称存在下载越权。
- 建议：与 Java 契约统一字段长度、允许字符集、时间格式、`sha256` 规范和产品类型取值；Renderer 只使用结构化文本节点，后续下载仍需 Main 持 token 的独立在线授权，不得以目录数据作为准入。

## 已验证的正向边界

- `packages/main/digiwise-bsp-catalog.ts:12-20` 比较事件 sender、当前 home window 的 `webContents` 以及 `mainFrame`，拒绝其他窗口和子 frame；`registerDigiwiseBspCatalogIpc` 使用模块级标志避免重复 `ipcMain.handle` 注册。
- `packages/main/digiwise-bsp-catalog.ts:22-30` 在请求前后读取 Main-only auth guard，账号退出、过期、禁用或 auth generation 变化时不返回在途结果；`packages/main/digiwise-auth-api.ts:553-558` 用 `URLSearchParams` 编码 categoryCode，并在发送前执行格式校验，未发现 categoryCode 注入路径。
- `packages/main/digiwise-auth-api.ts:538-550,559-570` 做了数组/对象/安全整数/字符串类型校验并映射白名单字段；未发现把服务返回的额外 `secret` 字段转发给 Renderer 的路径。
- `packages/main/main.ts:148-155,163-174` 的注册链保持 token 在 Main；新增 `packages/home/digiwise-bsp-catalog.ts` 只发送 IPC channel 和业务参数，不接触 token 或自由 URL。

## 可复现安全负例与实际验证

1. `node tools/verify_bsp_catalog.cjs`：退出码 `0`，夹具实际覆盖非字符串/空值/注入样式 categoryCode 不发 HTTP、超 JS safe integer、错误 envelope、网络不可用、401、额外 secret 字段剥离、sender/frame 拒绝、退出/代际变化和重复注册。该命令未启动真实 API。
2. 静态无界读取负例：查看 `packages/main/digiwise-auth-api.ts:153-180` 可复现地确认所有响应先进入 `response.text()`，且源码没有 body cap；查看 `:538-570` 可确认合法 JSON 数量/字段长度没有上限。因此该负例不需要读取凭证或发送真实网络请求，本次未用超大 body 实测，以免产生无必要的资源压力。
3. `npm run build`：退出码 `0`；`tsc`、Gulp release、CSS 和 Windows LVGL copy 完成，最后提示未配置 production IDE API URL。该构建证实当前工作树可编译，不是在线 API/隔离构建的替代品。
4. `git diff --check`：退出码 `0`；未发现当前工作树空白错误。

## 未验证项与后续交接

- 未运行 Java/MariaDB/Redis/对象存储，也未执行真实 401、撤权、账号切换、HTTP 超时或响应超限链路；没有把本地夹具结果写成真实端到端通过。
- CTO/后端此前需修复 F-27-01；本次复测已核对修复候选并由最终复测章节记录解除结果。
- 历史复测结论曾因旧草稿无界响应而阻断；本次最终复测以当前工作树为准，F-27-01/F-27-02 的状态见下节。F-01/F-02 属于 SECURITY-REVIEW 原有范围，未在 AI-27 重做或解除。

## AI-27 最终复测（AI-46 修复候选，2026-11-19）

本节仅记录本次对当前工作树最终源码的独立复测；未修改实现、未读取凭证或 Paperclip context，未启动真实 Java/API/Redis/对象存储、真实账号或下载链路。

### Verdict

当前 AI-27 目录 API/IPC 切片通过本次静态与本地专项安全复测；F-27-01（响应/目录资源边界）解除，F-27-02（字段语义边界）解除，不再以这两个问题阻断本切片。该结论不扩展到真实后端链路，也不解除本报告前文 AI-21 的 F-01/F-02。

### 复测证据

- `node tools/verify_bsp_catalog.cjs`：退出码 `0`，输出 `catalog API tests passed`。当前夹具覆盖 body 超过 1 MiB、无界数组（201 条）、字符串超过 256/512、`fileSize` 超过 4 GiB、非法 `sha256`、非法 `publishedAt`、非法 `productType`、safe-integer、字段投影、sender/frame、重复注册、退出/代际变化、网络失败、401 和 categoryCode 本地拒绝。
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`：退出码 `0`。
- `npm run build`：退出码 `0`；clean-build、TypeScript、Gulp release、CSS、LVGL 复制及安装配置生成均完成。输出仅提示未配置 production IDE API URL，未作为在线服务通过证据。
- `git diff --check`：退出码 `0`。

### 当前源码核对

- `packages/main/digiwise-auth-api.ts:76-125,248-253`：先校验 `Content-Length`，再以 reader 按 1 MiB 总字节数读取；无 `Content-Length` 时同样受观察字节上限约束；超限统一抛 `PUBLIC_API_INVALID_RESPONSE`，不把响应内容写入错误。
- `packages/main/digiwise-auth-api.ts:612-649`：categories/BSP 分别限制 200 条；字段长度、正/safe integer、`fileSize <= 4 GiB`、64 位小写 SHA-256、`publishedAt` 格式/可解析性均有拒绝分支；返回值为白名单投影。
- IPC 层和 Main-only session 边界未见回归：`packages/main/digiwise-bsp-catalog.ts:12-38` 保留 sender/frame、注册一次、请求前后 auth generation 检查；Renderer 仅调用固定 IPC channel。

### 统一错误码核对与未覆盖项

- 超限、目录结构/字段越界和成功 envelope 缺失 `data` 均映射为 `PUBLIC_API_INVALID_RESPONSE`；本地 categoryCode 拒绝为 `INVALID_REQUEST`；网络失败为 `PUBLIC_API_UNAVAILABLE`；401 为 `AUTH_REQUIRED`。专项命令已实际验证这些夹具。
- 未启动真实 Java/API/Redis/对象存储/账号，未验证真实撤权、账号切换、HTTP 超时、代理分块传输和后端字段实际取值；因此不声称端到端通过。
- 既有报告中的 F-01/F-02 不属于本切片复审范围，仍按原报告保留。

# AI-50 独立安全复审：BSP 版本选择 UI 切片（2026-11-19）

审查范围：AI-47 的 Renderer UI、Main IPC 与 BSP 目录数据流；不替代 AI-21 对授权有效期/下载重放的审查。复审基于当前工作树的 `packages/home/digiwise-bsp-catalog-ui.tsx`、`packages/home/digiwise-bsp-catalog.ts`、`packages/main/digiwise-bsp-catalog.ts` 及相关共享类型；不修改实现。

## 最终 Verdict

PASS（本切片静态/UI边界）：未发现 Renderer 接触 token 或自由 URL、HTML 注入、错误原文展示或绕过 Main 的下载调用。下载功能仍明确未实现，因此本结论不等于下载链路验收，也不解除 AI-21 对有效期/重放的审查。

## 已核实的 PASS

- Renderer 隔离：`packages/home/digiwise-bsp-catalog.ts:5-10` 只调用固定 IPC channel，未接收/拼接 token、HTTP URL 或自由 URL；UI 文件同样无 token、URL、`shell.openExternal`、`innerHTML` 或 `dangerouslySetInnerHTML`。
- IPC sender/frame 与会话代际：`packages/main/digiwise-bsp-catalog.ts:12-38` 校验当前 home window、main frame、窗口未销毁，并在请求前后检查 authenticated 和 auth generation；模块级 `registered` 防止重复注册。既有目录夹具覆盖这些负例。
- UI 竞态：`packages/home/digiwise-bsp-catalog-ui.tsx:93-151` 以递增 `requestId` 让旧的品类/版本响应失效；账号/登录状态变化时先递增代际并清空旧数据，未见 late result 回写旧选择的路径。Main 层同时拒绝会话代际变化后的结果。
- 错误脱敏：`packages/home/digiwise-bsp-catalog-ui.tsx:44-60,64-72` 只按固定 `error.code` 映射用户文案，不渲染 `error.message`/`requestId`；`packages/main/digiwise-auth.ts:230-245` 对未知异常使用固定消息。当前 Main 返回的 API 错误也为受控错误码/消息。
- 目录数据注入：`packages/home/digiwise-bsp-catalog-ui.tsx:184-235` 使用 React 文本节点渲染目录字段，没有 HTML 字符串拼接；Main API `packages/main/digiwise-auth-api.ts:612-649` 对字段长度、类型、文件大小、摘要、时间和条数做边界校验并白名单投影。
- 下载边界：UI `packages/home/digiwise-bsp-catalog-ui.tsx:236-238` 的下载按钮明确 `disabled` 且无 click handler；当前树没有 BSP download IPC、URL 生成或 Renderer 直连下载路径。就“不能绕过授权发起下载”而言为 PASS；实际下载授权、资源绑定、重定向/Range 与文件落盘仍未覆盖。

## 未覆盖 / 剩余风险

- 未启动真实 Java API、Redis、对象存储、真实账号或 Electron Renderer；未验证真实 401、撤权、超时、代理分块传输及后端实际字段，因此不声称端到端通过。
- `tools/verify_bsp_catalog_ui.cjs` 当前覆盖纯格式化/日期/错误码映射，不是 React 组件级竞态或恶意字符串渲染夹具；上述竞态与注入结论来自源码核对，后续应补充组件测试。
- UI 的 IPC Promise 没有显式 `.catch`；若 `ipcRenderer.invoke` 在 handler 异常时 reject，可能留下未处理 rejection/加载态。当前受控 Main handler路径返回 `DigiwiseIpcResult`，未将其判定为本次安全阻断，但建议后续以统一 catch 映射为 `PUBLIC_API_UNAVAILABLE`。
- 下载仍未实现；实现下载时必须新增受控 Main IPC、在线授权和资源/版本绑定，禁止把后端 URL 交给 Renderer 或直接使用自由 URL。

## 可复现验证

1. `node tools/verify_bsp_catalog_ui.cjs`：退出码 `0`，输出 `BSP catalog UI tests passed`。
2. `node tools/verify_bsp_catalog.cjs`：退出码 `0`，输出 `catalog API tests passed`；覆盖响应/字段边界、投影、categoryCode 校验、sender/frame、重复注册和会话代际负例。
3. `node node_modules/typescript/bin/tsc --noEmit --pretty false`：退出码 `0`。
4. `npm run build`：退出码 `0`；构建完成，日志仅提示未配置 production IDE API URL，未作为在线服务通过证据。
5. `git diff --check`：退出码 `0`。
6. 静态负例：对 UI 与 IPC 文件搜索 `accessToken|token|https?://|dangerouslySetInnerHTML|innerHTML|openExternal|shell.` 无命中；UI wiring 命中 `home-tab.tsx:38,407-410,479`。

## 交接

- AI-47 可解除本切片 UI 安全门槛，但需保留“真实服务/下载未覆盖”标记。AI-21 的有效期和 URL 重放结论继续有效；未来实现下载前先补受控 Main 下载协议及组件级竞态、恶意目录文本和错误脱敏测试。

# AI-57 独立安全放行复核：授权、下载重放、Build 与执行边界

审查基线：IDE `e203807232d506f8123cfc504beaad3c628da008`；Java 工作树基线 `d7f7bc84dd3f5671dd6440ee871bf17cb7bbbbca`。Java 工作树存在大量未提交修改；本复核读取了当前工作树源码，但未把未提交状态伪装成可发布 SHA。未读取凭证/context，未登录真实账号，未启动 Java/MariaDB/Redis/对象存储，不执行设备写入。

## Verdict：拒绝安全放行

当前实现不能作为“授权已闭合、下载不可重放、Build/PIO 已在线准入、MCP 审计完整”的发布依据。已证实的阻断项如下：

### F-57-01（High，阻断）：MCP 在线 Java 项目绑定在生产集成路径被本地 account-only fallback 绕过

证据：`packages/home/settings` 通过 `packages/mcp/integration.ts:99-133` 构造实际传入 `startMcpServer` 的 `centralExecutionPolicy`。该实现的 `authorizeProjectTool` 只调用 `currentGrant()`（`integration.ts:105-106`），自行生成 `bindingId=account:<userId>`、`modelId=0`、项目路径 SHA、`projectRevision=0`（`integration.ts:115-125`），没有调用 `DigiwisePublicApi.authorizeMcpExecution`，也没有读取/验证 `McpProjectBindingStore`。

对照后端：`IdeMcpProjectBindingService.java:203-220` 要求项目指纹、`projectRevision >= 1`、活动 binding 和 `requireTrustedProject`；`authorize` 后端会写入带 binding/session/参数摘要/策略 revision 的 decision。实际 IDE 集成没有进入这条路径，因而 MCP 请求只要账号级 `mcp/policy` 通过，就能继续到 Renderer/Main 工具执行。`integration.ts:128-132` 的 `auditExecution` 也仅 `console.info`，不会调用 Java 审计接口。

触发：登录具备 MCP account grant 的账号，开启 MCP，选择任意保存的 `.eez-project`，调用 `start_project_build` 或写工具。Main Server 的 `main-server.ts:378-380` 仍认为本地 policy 已授权，随后在 `:482-512` 发给 Renderer。该路径不需要后端 project binding confirmation，也不要求 `projectRevision >= 1`。

影响：用户/模型/项目绑定边界被降级为账号级；撤权、项目替换、后端 decision deny 和 Java 审计无法覆盖该实际执行路径。模型级 `modelId=0` 也使授权对象失去真实品类绑定。

修复放行条件：生产集成必须使用真实 `McpCentralAuthorizationGate` + `authorizeMcpExecution` + 加密本地 binding store；删除 account-only allow fallback，或仅保留明确隔离的开发夹具且默认不可启用。每次工具调用、账号代际变化、项目 fingerprint/revision 变化和撤权都必须由 Java decision 再验证；审计必须回写 Java 并读回确认。

### F-57-02（High，阻断）：Build 入口未统一经过在线 BSP/项目授权 gate，命令行入口接受自由路径并直接 build

证据：`packages/home/build-project.ts:8-18,45` 接受 `filePath`、直接 `openFile(filePath)` 后 `projectStore.build()`；函数前没有 BSP download-session、模型/版本/摘要校验或在线授权。`packages/home/tabs-store.tsx:547-555` 的普通 IDE Build 同样直接调用 `projectStore.build()`。`packages/project-editor/mcp/adapter/check-tasks.ts:180-184` 和 `packages/project-editor/flow/runtime/remote-runtime.ts:123-126` 也直接触发 build。

命令行边界：`packages/main/main.ts:95-100` 从 `--build-project` 读取任意字符串，`:164-168` 创建隐藏窗口，`:213-223` 原样发送 `build-project`；未见 Main-owned canonical path、项目绑定、目标品类或授权 ticket 校验。`packages/home/main.tsx:134-138` 直接把事件参数传给 `buildProject`。

触发：使用 `--build-project` 指向任意存在的 `.eez-project`，或在普通 UI/运行时/MCP adapter build 路径触发 `projectStore.build()`。在当前源码证据中，未发现所有这些入口先执行在线 BSP gate；因此无法证明授权拒绝时 PIO/工具链启动次数为零，也无法证明旧产物不被复用。

影响：Build/PIO 的执行边界不受统一授权控制；未经当前 BSP/模型授权的本地项目可能进入构建，命令行路径还扩大了受信任输入范围。该结论是源码已证实的覆盖缺口，不等同于已证明任意路径可执行任意命令。

修复放行条件：把 gate 放在唯一的 Main/ProjectStore build orchestration 之前，覆盖 UI、CLI、MCP、检查、运行时和 Docker/PIO 分支；gate deny、账号切换、撤权、目标不一致、下载失败或摘要不匹配时 PIO 启动次数必须为 0，临时文件/缓存和旧成功产物不得作为本次授权替代。CLI 路径需由 Main 规范化并关联已确认项目，不接受 Renderer 或外部 MCP 的自由路径作为权威。

### F-57-03（High，阻断延续）：BSP 下载票据可在有效期内重放，且下载下一请求不重新授权

证据：Java `DigiBspService.java:55-65,176-193` 在用户授权检查后返回五分钟 URL；`DigiLocalFileStore.java:275-315` 的 BSP ticket 只校验 key 前缀、时间窗口和 HMAC；没有 nonce、消费状态、用户/resource/version/session 绑定或一次性消费。`IdeLocalBspFileController.java:28-52` 只接收 ticket/expires/signature，不要求 Authorization，不回源检查 grant/revision，也未实现 Range 语义。

触发：复制一次 `/api/ide/v1/bsp/local-file?...` 完整 URL，在五分钟内由同一或其他 HTTP 客户端重复 GET。签名和文件存在时两次请求都可通过；撤权或下架只影响后续签发，不使已泄露 bearer URL 失效。

影响：重放、转交和撤权后的旧窗口下载无法绑定到实际用户或请求；审计不能证明真实消费方。`Cache-Control: no-store` 不能撤销已泄露 URL。

修复放行条件：按已写入 `docs/controlled-bsp-download-gate-draft.md` 的批准后契约实现 Main→Java 受控流式代理或具备原子消费/明确 Range 语义的一次性 session。每个完整/Range 请求重新校验当前 grant、BSP 版本/摘要和 grant revision；缓存、重定向、Range 不得绕过授权；失败重试必须新 session 或有明确幂等审计。

### F-57-04（High，阻断延续）：授权没有有效期、撤权时间和并发 revision

证据：Java `DigiModelService.java:127-150,165-184` 的 `digi_user_model` 仍采用整集合 delete+insert；查询只判断用户有效、模型 enabled。当前授权表缺少 `valid_from/valid_until/revoked_at/revision`，因此不能表达服务端到期边界、撤权时间或 stale writer 冲突。BSP `DigiBspService.java:46-52,58-64` 复用该关系。

触发：并发管理员更新同一用户授权集合，后写入者静默覆盖前者；或要求某时刻自动到期。现有 schema/SQL 没有可执行的条件更新和时间 predicate。

影响：授权持续到人工删除/停用，无法可靠阻断新 Download/Build/MCP 请求，也无法提供并发冲突审计。已有 MCP decision 的五秒 TTL 和 policy revision 不能替代用户-品类 grant 的有效期/revision。

修复放行条件：统一 live-grant predicate 使用服务端时间，明确 `valid_until == now` 拒绝；授权写入采用条件 revision 更新并返回冲突；将 grant revision 纳入下载 session、Build gate 和 MCP decision；撤权后的新请求行为须有隔离端到端证据。

## 已确认的正向边界

- `packages/main/digiwise-bsp-catalog.ts:12-38` 校验 IPC sender/frame，并在请求前后检查 auth generation；Renderer BSP UI 当前没有下载 handler，避免了当前切片直接绕过 Main 发起下载。
- `packages/main/digiwise-auth-api.ts:86-125,248-290,612-649` 对 API body、目录条数、字段长度、文件大小和 SHA-256 做了边界校验；这是目录防御，不是下载授权。
- `packages/mcp/main-server.ts:132-156,211-265` 有 socket/token/size/frame 边界，`main-server.ts:446-475` 在写确认后再次检查账号代际；这些局部边界不能抵消 F-57-01 的实际 policy fallback。
- `BspArchiveValidator.java:21-67` 拒绝 ZIP 路径穿越、重复路径、CRC 错误和展开大小/条目超限；这是上传验证，不证明下载/Build gate 闭合。

## 实际验证与负向结果

- `node tools/verify_bsp_catalog.cjs`：退出码 0，目录响应/字段边界及 IPC sender/frame 负例通过。
- `node tools/verify_bsp_catalog_ui.cjs`：退出码 0，UI 格式化/错误映射夹具通过。
- `npm run verify-mcp`：退出码 1。失败于 `packages/mcp/test-project-binding-api.cjs:36`，构建产物 `build/main/digiwise-auth-api.js` 抛出 `PUBLIC_API_INVALID_RESPONSE`（响应读取路径）。因此不能把 MCP 专项套件记为全通过；这也是当前工作树的回归/测试夹具不兼容信号，需修复后重新执行完整套件。
- `git diff --check`：退出码 0。
- `npm run build`：退出码 0；TypeScript、Gulp、CSS、LVGL 复制和安装配置生成完成。输出提示未配置 production IDE API URL，因此这不是生产在线服务验收证据。
- Java Maven/真实 API、MariaDB/Redis、对象存储、账号切换、撤权、Range、重复 GET、PIO 零启动和安装包失败恢复：未执行；禁止用静态夹具替代这些证据。

## 复测条件与交接

1. 修复并删除 F-57-01 的 account-only fallback，证明实际启动路径调用 Java online decision 和 Java audit；新增“无 project binding / revision=0 / model mismatch”负例。
2. 将所有 Build/PIO/下载器入口集中到 gate，新增 gate-deny 的 PIO spawn-count=0、缓存不复用、旧产物不冒充成功和 CLI 路径边界测试。
3. 冻结并实施 D-03/D-07：下载 session/Range/重试/撤权下一请求、grant valid time/revision/并发规则；补真实 HTTP 两次 GET、撤权后 GET、Range、多 Range、缓存/重定向测试。
4. 修复 `npm run verify-mcp` 当前失败后，运行 `npm run verify-mcp`、`npm run build`、Java 隔离编译和真实 API+存储链路；保存不含 token、完整签名 URL、对象 key 或工程正文的证据。
5. 只有上述证据齐全、阻断项复测解除后，才能重新给出安全放行结论。

