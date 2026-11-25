# AI-26 独立验收报告：品类/BSP 目录 API 与 IPC

日期：2026-11-19（CST）
任务：AI-26
被测实现：AI-25；隔离构建门槛：AI-30
仓库：D:/代码/DigiwiseStudio
被测 SHA（执行前）：e203807232d506f8123cfc504beaad3c628da008

## 1. 范围与隔离

本次只验收 Main API、共享类型、Home IPC 代理和 Main IPC 注册/鉴权边界，不验收 BSP 下载、资源关联、Build、烧录或四模块真实业务流程。

未读取凭证、context 或真实账号；未修改后台数据库、安装/烧录、提交、推送或发布。真实后台环境未提供，因此所有网络/账号相关项均明确标为未覆盖，不能以 Mock 结果替代真实业务 PASS。

执行前工作区已有实现任务变更及文档/工具未跟踪文件；未覆盖或回滚这些用户/并发改动。执行前后均检查 git status。

## 2. 版本与实际命令证据

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `node --version` | 0 | v22.23.4 |
| `npm --version` | 0 | 10.9.9 |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false` | 0 | 无输出，TypeScript 检查通过 |
| `node tools/verify_bsp_catalog.cjs` | 0 | `catalog API tests passed`；Node 输出 ExperimentalWarning（不影响退出码） |
| `npm run build` | 0 | 完成 clean-build、tsc、gulp release、CSS、安装配置生成；最终无错误 |
| `git diff --check` | 0 | 无空白错误 |
| `git status --short` | 0 | 保留并发/用户改动；无测试执行期间源码回滚 |

`npm run build` 是本次 AI-30 最终隔离构建证据。构建过程中的关键输出：`Finished 'release' after 12 s`、`No production IDE API URL: packaged login and grey updates will remain disabled`。最后一行是环境配置提示，不是构建失败。

专项测试使用 `tools/verify_bsp_catalog.cjs` 直接读取当前源码：脚本加载 `packages/main/digiwise-auth-api.ts`，并读取/编译当前 `packages/main/digiwise-bsp-catalog.ts`；没有读取 `build/` 作为测试对象。构建前已重新运行专项测试和 tsc，构建后以 `npm run build` 完成最终门槛。

## 3. 覆盖矩阵与结果

状态：PASS = 有当前源码/夹具证据；FAIL = 复现缺陷；未覆盖 = 本地证据不足或真实前置未提供。

| 项目 | 结果 | 证据与复现步骤 |
|---|---|---|
| 目录成功返回 | PASS（Mock/源码） | 运行 `node tools/verify_bsp_catalog.cjs`；`listCategories` 返回字段投影与 BSP 空数组均通过。真实后台未执行。 |
| 空目录 | PASS（Mock） | 脚本将 BSP 响应置为空数组，断言 `[]`；真实授权账号的空目录未覆盖。 |
| 401/撤权 | PASS（Mock/源码） | 脚本构造 HTTP 401 并断言 `AUTH_REQUIRED,status=401`；真实登录、撤权后请求未执行。 |
| 403/400/422/404/429 映射 | 未覆盖（本专项夹具） | `docs/ide-bsp-catalog-contract.md` 记录映射，Main 公共 API 有通用映射；专项脚本未逐一构造这些 HTTP 响应，不能宣称运行通过。 |
| 畸形 data | PASS（Mock） | 脚本分别构造 unsafe `id` 和对象响应，断言 `PUBLIC_API_INVALID_RESPONSE`；字段类型校验在当前源码执行。 |
| 失败重试/网络失败 | PASS（Mock 限定） | 脚本构造 transport throw，断言 `PUBLIC_API_UNAVAILABLE`；未覆盖真实重试策略，因为该切片没有自动重试契约。 |
| categoryCode 编码/边界 | PASS（Mock/源码） | `AB-1` 作为 query 参数断言 URL 为 `bsp?categoryCode=AB-1`；非法空串、单字符、`AB&x=1`、null、数字均在本地校验并断言不发请求。Java 端规则同为 `[A-Za-z0-9][A-Za-z0-9._-]{1,63}`。未执行真实 HTTP 服务器端 URL 解码验证。 |
| 模型别名兼容 | 未覆盖（源码证据） | Java `IdeModelPublicController` 的 `@GetMapping({"/models", "/categories"})` 可见于 `D:/代码/DigiwiseStudio-Admin-Java/backend/ruoyi-admin/src/main/java/com/ruoyi/web/controller/ide/IdeModelPublicController.java:43-49`。本次未启动 Java 服务，未对两个真实 HTTP 路径分别请求。 |
| `modelId`/`modelCode` 独立 | PASS（Mock） | BSP fixture 使用 `modelId:42`、`modelCode:'AB'`，断言 `modelId` 保留为数字；没有把数字 ID 转成字符串。 |
| 敏感字段不外泄 | PASS（Mock/源码） | fixture 增加 `secret:'do-not-expose'`，断言返回对象的 `secret` 为 undefined；access token 只作为 Main API 入参，未投影给 Home/Renderer。 |
| 账号切换与在途响应隔离 | PASS（Mock/源码） | IPC 夹具覆盖 generation 改变和认证状态在请求中途失效，均断言 `AUTH_REQUIRED`；resolver 切换到新窗口后，当前窗口 sender 校验和成功返回均执行。未接入两个真实账号并发请求。 |
| IPC 重复注册 | PASS（Mock/源码） | 连续调用 `registerDigiwiseBspCatalogIpc` 两次，断言 handler 数量仍为 2；重复注册没有抛错或覆盖。 |
| IPC sender/frame 越权 | PASS（Mock/源码） | 错误 sender 和错误 `senderFrame` 均断言抛出 `Unauthorized BSP catalog request`。 |
| 真实目录读取/下载/关联/Build | 未覆盖（范围外/无环境） | 当前切片只有读目录 API/IPC；没有执行 BSP 下载、关联项目、工具链构建或设备流程。 |
| 最终隔离构建 | PASS | `npm run build` 退出码 0；满足 AI-30 旧草稿构建失败后的重新验证门槛。 |

## 4. 源码/Mock/真实环境证据边界

源码证据：
- `packages/main/digiwise-auth-api.ts` 增加 `listCategories`、`listBspVersions`，对字段、safe integer、categoryCode 和返回投影做校验。
- `packages/main/digiwise-bsp-catalog.ts` 注册两个 Main IPC handler，检查当前 Home window、sender/frame，使用 auth generation 防止在途账号切换污染。
- `packages/home/digiwise-bsp-catalog.ts` 仅暴露 IPC typed wrapper。
- `packages/eez-studio-shared/digiwise-bsp-catalog.ts` 定义目录 DTO。
- `packages/main/main.ts` 在 ready 阶段注册目录 IPC。

Mock/夹具证据：
- `tools/verify_bsp_catalog.cjs` 覆盖成功、空、输入边界、畸形响应、network throw、401、字段投影、sender/frame、重复注册、session generation 改变和账号失效。
- Mock 不能证明真实 JWT、后台权限、真实数据、模型别名 HTTP 路由或服务器端过滤。

真实环境证据：
- 本次无真实 Java 服务、登录账号、授权/撤权操作或生产/后台数据库访问；因此真实 401/撤权、403、账号切换、目录内容和服务器端 categoryCode 解码均未覆盖。

## 5. 缺陷与复测

本次未复现可判定为实现缺陷的 FAIL。AI-30 要求的旧草稿构建失败门槛已重新执行，当前 `npm run build` 退出码为 0。

未覆盖项不作为缺陷结案：真实后台服务和隔离账号/资源未提供。建议后续在 Java 服务可用后补测：
1. 同一账号有授权/无授权/撤权后的 categories 与 bsp 请求，逐项核对 401/403 与数据隔离；
2. `/models` 与 `/categories` 两个别名真实请求；
3. 两个隔离账号并发发起目录请求，在途切换账号，确认旧响应不会落到新账号 UI；
4. 合法编码边界（2、64 字符）以及服务端拒绝非法 categoryCode；
5. 对 400、404、429 和网络恢复场景补充真实/HTTP harness 证据。

## 6. 独立结论

有限范围结论：PASS（当前源码级专项验收 + Mock/IPC 边界 + TypeScript + AI-30 最终隔离构建）。

真实业务结论：未覆盖，不签收真实后台目录授权、撤权、模型别名或账号切换业务 PASS；本报告不把目录可读等同于 BSP 下载、资源关联或 Build 完成。

复现入口：在 `D:/代码/DigiwiseStudio` 执行 `node tools/verify_bsp_catalog.cjs`；完整构建执行 `npm run build`。

## 7. AI-46 修后独立复测附录

针对最新评论要求，本轮仅核对当前最终源码及 AI-46 修复候选，不修改实现、不扩大真实环境范围。当前工作区仍保留并发/用户改动；当前 HEAD：`e203807232d506f8123cfc504beaad3c628da008`。

复测命令与实际结果：

| 命令 | 退出码 | 关键结果 |
|---|---:|---|
| `node tools/verify_bsp_catalog.cjs` | 0 | `catalog API tests passed`；含 1 MiB body 超量负例、目录 201 条超量负例、字段超长负例、`fileSize` 超过 4 GiB、非法 `sha256`、非法 `publishedAt`、非法 `productType` |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false` | 0 | 无输出，TypeScript 检查通过 |
| `git diff --check` | 0 | 无空白错误 |

源码核读确认：Main HTTP reader 在声明长度或实际流读取超过 1 MiB 时拒绝；categories/BSP 分别限制 200 条；目录字符串、BSP `fileName`、`fileSize`、`sha256`、`publishedAt` 和正数 `productType` 均有校验；不把响应内容写入错误。专项夹具中的上述负例均以 `PUBLIC_API_INVALID_RESPONSE` 拒绝。

AI-46 提供的最终隔离构建证据保留为构建门槛依据；本轮按最新评论要求未重复执行 `npm run build`，因此不将本轮描述为新的构建执行。真实 Java/API、账号/授权撤权、真实 403/400/404/429、下载/关联/Build/设备流程仍未覆盖。

本轮复测结论：修后有限范围 PASS；未发现可复现实现 FAIL。真实业务结论仍为未覆盖。