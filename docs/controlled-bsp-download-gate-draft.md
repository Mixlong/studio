# AI-48 受控 BSP 下载与在线授权 Gate 草稿

状态：调查/契约草稿，未获 D-03、D-07 批准；不改变生产授权行为，不执行迁移，不启动服务。

基线与证据

- IDE 基线：当前仓库 HEAD 以本次执行时 `git rev-parse HEAD` 为准；Java 基线同样以本次执行时仓库状态为准。两个仓库均存在既有未提交/未跟踪改动，本草稿不覆盖。
- AI-20 的结论：`digi_user_model` 当前只有用户/品类关系，没有有效期、撤销时间或 revision；授权更新在 `DigiModelService.java:127-150` 采用 delete+insert 整体替换，查询在 `:165-184` 只判断用户、账号和品类 enabled。
- AI-21/SECURITY-REVIEW.md:14-29：F-01 是无有效期/并发语义，F-02 是五分钟 bearer/HMAC URL 可重放；两项仍不是已解除的安全验收问题。
- Java BSP 现状：`DigiBspService.java:39-52` 目录按 `digi_user_model` 查询，`:55-65` 重新检查用户授权后签发，`:166-193` 检查发布/启用/存储摘要后返回五分钟 URL。
- Java 入口现状：`IdeModelPublicController.java:66-73` 要求 Authorization 后调用 `publicDownload`；签名文件入口 `IdeLocalBspFileController.java:28-52` 只接收 ticket/expires/signature，不接收 Authorization，不回源检查用户或撤权。
- 本地签名现状：`DigiLocalFileStore.java:275-315` 的 BSP ticket 是可解码的存储 key，校验 HMAC、过期时间和前缀；没有 nonce、消费记录、用户绑定或 Range 处理。`Cache-Control: no-store` 不能撤销已泄露 bearer URL。
- IDE build 现状：`packages/home/build-project.ts:8-53` 直接打开工程并调用 `projectStore.build()`；本次源码证据未证明所有 Build 入口已经统一经过新的在线 BSP gate。

## 1. 未决矩阵与批准门槛

| 决策 | 选项 | 本草稿建议（不是批准） | 必须批准的行为 |
|---|---|---|---|
| D-03 下载交付 | A. Java 流式代理；B. 一次性票据后由文件端消费；C. 继续五分钟 signed URL | A：Main 以 Authorization 请求 Java，Java 每个请求在线鉴权并流式返回；可在 Main 临时文件做摘要校验。B 仅在 Redis/数据库消费原子性和 Range 续传语义明确时考虑。C 不满足撤权即时性和重放要求 | 是否允许对象存储/CDN 直出；缓存是否复用；下载失败重试是重发票据、同票据 Range，还是完整重下；带宽和保留窗口 |
| D-07 授权模型 | A. 可变快照+revision；B. 不可变事件+当前快照 | A：兼容现表增量加有效期、状态、revision，并以条件更新防止静默覆盖；审计单独追加。B 适合强审计但迁移/查询成本较高 | 起止时间、时区、到期边界、撤权和续期并发、旧会话/下载/Build 行为、审计留存和访问权限 |
| D-03 × D-07 | 授权与下载绑定方式 | 每次“签发票据”和每个 Range 请求都校验当前 grant revision；撤权后新请求拒绝。已建立的流是否自然结束必须由 D-01/D-05 明确 | 撤权是否只阻断下一 HTTP 请求，还是还要中断在途流；客户端缓存是否可作为 Build 输入 |

在 D-03/D-07 记录决定人、日期、批准引用、受影响基线版本前，本文字段只能作为候选，不能实现为默认行为。

## 2. 候选 API 契约（供批准后冻结）

### 2.1 目录接口保持不变

`GET /api/ide/v1/bsp?categoryCode=<product-category-code>` 只返回元数据，不授予下载权。保留 `modelId`、`modelCode` 和 BSP 的 `categoryCode` 兼容字段；模板接口的 `categoryCode` 仍是模板分类，不能混用。字段和大小边界以 `docs/ide-bsp-catalog-contract.md` 为准。

### 2.2 受控下载准备/票据

建议新增：

`POST /api/ide/v1/bsp/{bspId}/download-session`

请求头：

- `Authorization: Bearer <IDE session>`（仅 Main 持有，Renderer 不接触）
- `X-Request-Id: <UUID>`，缺失则服务端生成并在响应返回
- `Idempotency-Key: <opaque client request id>`，只用于一次下载会话创建，不作为授权凭证

请求体（字段显式，不依赖默认值）：

```json
{
  "modelId": 123,
  "modelCode": "BC351",
  "projectId": "main-local-project-id-or-null",
  "projectFingerprint": "sha256-or-null",
  "purpose": "build"
}
```

服务端必须把 URL path 的 bspId 作为权威对象 ID；body 中 modelId/modelCode 只用于一致性校验，任一不一致返回 `409 TARGET_MISMATCH`。`purpose` 当前只允许 `build` 或 `template` 中经批准的值，不接受任意字符串。

成功 `200`：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "downloadSessionId": "uuid",
    "bspId": 123,
    "modelId": 456,
    "modelCode": "BC351",
    "version": "v1.2.3",
    "fileName": "BC351-v1.2.3.zip",
    "fileSize": 123456,
    "sha256": "64 lowercase hex chars",
    "grantRevision": 17,
    "expiresAt": "server ISO-8601 timestamp",
    "rangeMode": "full-or-explicit-resumable",
    "maxChunkBytes": 8388608
  }
}
```

错误分类：`401 AUTH_REQUIRED`（会话无效）；`403 ACCESS_DENIED`（无当前有效授权、账号停用、品类停用或策略拒绝）；`404 BSP_NOT_FOUND`（不存在/未发布）；`409 TARGET_MISMATCH` 或 `BSP_INTEGRITY_FAILED`；`410 DOWNLOAD_SESSION_EXPIRED`；`422 INVALID_REQUEST`；`429 RATE_LIMITED`；`5xx DOWNLOAD_UNAVAILABLE`。错误响应不含 token、签名 URL、对象存储 key 或工程正文。

### 2.3 下载字节接口（D-03 选择代理后）

`GET /api/ide/v1/bsp/{bspId}/download-session/{downloadSessionId}/content`

- 每个请求仍要求 Authorization；Main 不把响应 URL 交给 Renderer。
- 服务端校验 session 未过期、bspId/session 绑定、账号当前有效 grant、grantRevision、BSP 仍 published/enabled、对象摘要/大小记录。
- 默认仅允许完整响应：`200`, `Content-Length`, `Content-Range` 不出现。
- 若批准断点：只接受单一合法 `Range: bytes=start-end`，拒绝多 Range、无界 suffix、越界、与 session 的 chunk 约束不符；首个请求返回 `206`，`Content-Range` 必须与实际字节一致。每个 Range 请求重新在线鉴权，不得只依赖首个请求。
- `If-Range`、压缩传输和 CDN 缓存不得绕过授权；响应 `Cache-Control: no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`。
- 重试语义必须冻结：推荐新 session 重试；若允许同 session 重试，服务端必须对已读范围幂等且审计为同一 downloadSessionId，不得把“重放”误报为新授权。
- 不支持 Range 时对 Range 请求返回 `416` 或经批准的固定错误，不静默退回整个文件。

## 3. Migration 草稿（不执行）

以下是兼容方向，不是可直接上线 SQL。正式迁移需按 Java 实际 schema、索引命名和 MariaDB 版本生成 forward/backward 脚本，并先在影子库验证。

```sql
-- v_next_forward.sql（草稿）
ALTER TABLE digi_user_model
  ADD COLUMN valid_from DATETIME(3) NULL,
  ADD COLUMN valid_until DATETIME(3) NULL,
  ADD COLUMN grant_status VARCHAR(16) NOT NULL DEFAULT 'active',
  ADD COLUMN revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN revoked_at DATETIME(3) NULL,
  ADD COLUMN updated_by BIGINT NULL,
  ADD COLUMN updated_at DATETIME(3) NULL;

CREATE INDEX ix_user_model_live
  ON digi_user_model(user_id, model_id, grant_status, valid_from, valid_until, revision);

CREATE TABLE digi_ide_download_audit (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  request_id VARCHAR(64) NOT NULL,
  download_session_id CHAR(36) NULL,
  user_id BIGINT NOT NULL,
  bsp_id BIGINT NOT NULL,
  model_id BIGINT NOT NULL,
  model_code VARCHAR(64) NOT NULL,
  bsp_version VARCHAR(64) NOT NULL,
  grant_revision BIGINT NOT NULL,
  action VARCHAR(32) NOT NULL,
  result_code VARCHAR(64) NOT NULL,
  range_start BIGINT NULL,
  range_end BIGINT NULL,
  bytes_sent BIGINT NOT NULL DEFAULT 0,
  client_platform VARCHAR(32) NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX ix_download_audit_request(request_id),
  INDEX ix_download_audit_user_time(user_id, created_at),
  INDEX ix_download_audit_bsp_time(bsp_id, created_at)
);
```

兼容规则（待 D-07）：

1. 旧行回填为 `grant_status='active'`, `valid_from=NULL`, `valid_until=NULL` 只能表示“历史上无期限”，不能伪造一个产品期限；是否允许旧行继续使用必须由批准的兼容开关决定。
2. 统一 predicate 候选为：账号 active、品类 enabled、`grant_status='active'`、`valid_from IS NULL OR valid_from <= server_now`、`valid_until IS NULL OR server_now < valid_until`。`valid_until == server_now` 明确拒绝；时间由服务端数据库/时钟决定。
3. 写授权先读取 revision，使用 `WHERE user_id=? AND model_id=? AND revision=?` 条件更新；集合写入不能继续无条件 delete+insert。冲突返回 `409 GRANT_REVISION_CONFLICT`，不静默合并或覆盖。
4. 迁移期间旧查询必须由统一 service predicate 包装，不能只给 BSP 加条件而漏掉模板、重开、MCP、Build 或目录。
5. 回退只允许停止新字段写入、切回兼容读取并保留新增列/审计数据；在证明新旧 predicate 一致前，不允许直接 DROP 列或删除审计表。若 D-07 选择旧行不再有效，需单独数据修复/人工重授权，不以回退掩盖授权扩大。

## 4. Gate 与执行顺序

1. Main 从当前真实工程/目标选择构造 request，禁止使用 Renderer 传入的自由路径、modelCode 或 BSP URL 作为权威。
2. Main 调用 `download-session`，核对响应中的 bspId/modelId/modelCode/version/fileSize/sha256 与当前选择；任何不一致立即终止。
3. 在创建 PIO/编译副作用前获取并下载到唯一临时目录；以流式方式限制总字节数，实际大小和 SHA-256 必须匹配，失败删除临时文件。
4. 每次新 Build 都重新建立在线 session；本地已校验缓存不能替代新授权。缓存复用是否允许由 D-03 单独冻结，且至少重新在线授权并比较摘要/版本。
5. gate 拒绝、摘要不匹配、撤权/过期、断网或 session 失效时，PIO 启动次数必须为零；不复用旧成功产物作为本次成功。
6. 下载完成只表示 `download_verified`，不表示 Build/设备写入成功。Build、设备写入、失败和取消必须分别审计。

## 5. 审计字段最小集

每次签发、Range/完整下载请求、拒绝、完成、摘要失败、撤权命中记录：`requestId`、`downloadSessionId`（如有）、`userId`/稳定账号 ID、`bspId`、`modelId`、`modelCode`、BSP version、grant revision、server timestamp、action、resultCode、HTTP status、range start/end、bytes sent、client platform/version、release/build correlation ID。记录 `sha256` 可以脱敏后存摘要前 16 字符，产品若要完整追溯需另行批准。

禁止写入：Authorization/token、绑定密钥、完整 signed URL、对象存储 key、项目正文、完整本地路径、ZIP 内容。审计查看/导出必须按 D-07 冻结角色、字段、留存期、删除和访问审计。

## 6. 可执行测试设计（批准后实施）

| 编号 | 场景 | 断言 |
|---|---|---|
| T01 | 有效用户/品类/BSP，完整下载 | 200；大小/SHA-256 相符；审计串起 request/session；Renderer 无凭证/URL |
| T02 | 无授权用户直调目录、session、content | 目录不泄露受限 BSP；session/content 为 403 或统一批准错误；PIO 未启动 |
| T03 | 品类停用、BSP 下架 | 新目录不返回；已有 session 的下一 content 请求按 D-03/D-05 决定且有明确证据；不以 no-store 代替撤权 |
| T04 | `valid_from` 前、`valid_until` 等于/晚于服务端 now | 前者拒绝；等于 now 拒绝；晚于 now 允许；客户端时钟偏移不改变结论 |
| T05 | 撤权后新 session 与旧 session | 新 session 必须拒绝；旧 session 行为按批准的 D-03/D-05 测试，不得默认“自然允许五分钟” |
| T06 | 重放相同 session/content | 按方案：一次性票据第二次拒绝，或同 session 受限重试只允许批准 Range 且审计可解释；不得无界重复下载 |
| T07 | Range | 合法单 Range 206；多 Range/越界/负值/suffix 按契约拒绝；每个 Range 都重新授权；摘要最终一致 |
| T08 | target mismatch | path/body modelId/modelCode/BSP 选择不一致为 409；服务端不签发、不返回字节 |
| T09 | 并发授权更新 | stale revision 返回 409；另一管理员新增授权不被静默删除；最终查询可回读 |
| T10 | 断网/超时/响应截断/大小超限 | 删除临时文件；不进入 PIO；固定错误不含敏感值；重试遵循 session 规则 |
| T11 | 缓存命中 | 缓存文件存在但新 Build 仍调用在线 gate；撤权/版本/摘要不匹配不使用旧缓存 |
| T12 | Build 副作用顺序 | 对所有 Build 入口注入 gate deny，验证 PIO/工具链启动次数为 0；成功 gate 后才允许本地构建 |
| T13 | 账号切换/会话代际变化 | 在下载前后切换账号，旧响应丢弃；不得把旧账号字节交给新账号工程 |
| T14 | 审计脱敏 | 日志和审计不含 token、密钥、完整 URL、对象 key、工程正文/完整路径；支持角色只能读批准字段 |

真实验收依赖 Java + MariaDB/Redis（若方案采用）+ 本地/对象存储 + IDE Main；静态夹具和 TypeScript build 不能替代这些链路。

## 7. 当前阻断项与交接

- 阻断 1（产品）：D-03 未决定代理、一次性票据、缓存和重试/Range 语义。
- 阻断 2（产品/安全）：D-07 未决定起止时间、到期边界、续期/撤权并发、旧 session、审计留存和导出权限。
- 阻断 3（架构）：未证明所有 Build/Download 入口统一经过 gate；`build-project.ts:45` 仍是直接 `projectStore.build()` 的调用证据。
- 阻断 4（环境）：本任务不得启动生产服务、读取凭证、写数据库；真实 HTTP、撤权、Range、重放和 PIO 零启动只能在批准后的隔离验收环境完成。

批准后的建议切片：B01 迁移/统一 live-grant predicate（后端）；B02 Java 代理/session/Range 与审计；B03 Main gate、临时文件与所有 Build 入口；B04 QA/安全隔离端到端；B05 运维回滚和观测。每片都要保留兼容读路径、明确回退命令和真实验证证据。
