# DigiwiseStudio 后台与 OSS 整体技术架构方案

- 文档编号：ARCH-PLATFORM-001
- 版本：v1.1（架构草案；文件面选型更新）
- 日期：2026-11-10
- 状态：Node + SFTPGo + OSS 首选方案已认可；PoC、许可证及实现待验证
- 涉及：DigiwiseStudio Desktop / Digiwise Admin / Digiwise Cloud API / SFTPGo / PostgreSQL / Redis / 阿里云 OSS / 云效 Flow

## 1. 背景和边界

DigiwiseStudio 基于 EEZ Studio 进行桌面 IDE 开发，包含 LVGL 工程编辑、本地 Build、MCP 扩展和 Electron 自动更新。计划增加统一云服务，为个人和企业客户提供各自的工作空间及云文件存储，并供内部团队管理软件发行、资源、客户、授权及容量。

**已确认产品边界：**

1. 面向个人开发者和企业组织，使用**同一个桌面 IDE、同一个账号体系**。
2. **仅内部团队使用 Web 管理后台**，个人和企业客户均无需独立 Web 门户。
3. 一个个人账号可以同时拥有自己的个人空间，并加入多个企业空间。
4. 每个空间独立计算存储容量；企业成员共享企业配额，但按成员和项目权限访问文件。
5. **客户端绝不直接访问 OSS**：不获取 OSS AccessKey/STS/预签名 URL，也不调用公开 OSS 文件地址；文件上传下载由 SFTPGo 服务端中转。
6. IDE 本地编辑、本地工程、本地 Build 不应因云服务故障而停止工作。
7. 继续复用现有阿里云云效与 OSS 发布链路，先不重做 CI 平台。

**非目标（本期不实施）**：企业 Web 门户、实时多人协同编辑、默认全盘自动同步、云端固件编译、支付系统、自动创建完整组件市场。

## 2. 总体架构（v1.1：SFTPGo 文件面）

首选架构已确定为 **Node.js 业务控制面 + SFTPGo 文件服务面 + 阿里云 OSS 私有对象存储**；该选型目前处于 PoC / 许可证评审阶段，详细决策见 [ADR-0001](../adr/0001-sftpgo-file-plane.md)。

```mermaid
flowchart TB
    USER[个人/企业用户] --> IDE[DigiwiseStudio Desktop]
    OPS[内部团队] --> ADMIN[Digiwise Admin]
    IDE -->|HTTPS 业务接口| NODE[Digiwise Cloud API / Node.js]
    ADMIN --> NODE
    NODE -->|内网 Admin API：创建账号/组/目录/配额| SFTP[SFTPGo 文件服务]
    IDE -->|HTTPS 用户文件 API / 可选 SFTP、WebDAV| SFTP
    NODE --> BIZDB[(Digiwise PostgreSQL 业务库)]
    SFTP --> SDB[(SFTPGo Data Provider / 独立 schema)]
    SFTP -->|S3 兼容接口 / 服务端 RAM| OSS[(阿里云 OSS Private)]
    CI[云效 Flow] -->|不可变构建产物| REL[(发行/资源 OSS Bucket)]
```

客户端到 SFTPGo 的文件流量可以使用外部 HTTPS 反向代理的 `/files/*` 路由，但**不进入 Node.js 业务进程**。Node 只管理业务，不传输文件字节；SFTPGo Admin API 永不对客户开放。SFTPGo WebClient 不是客户门户，本期不开放；SFTP/WebDAV 按需开放，不默认启用全部协议。

### 2.1 服务职责

| 组件 | 职责 | 边界 |
| --- | --- | --- |
| DigiwiseStudio Desktop | 本地工程/LVGL/Build、账号登录、工作空间切换、云文件操作 | 不得到 OSS 凭据、直链和 SFTPGo Admin Key |
| Digiwise Admin | 内部账户、个人/企业空间、套餐/授权、发布、审计、配额策略 | 不默认读取客户文件正文 |
| Node.js Cloud API | 统一业务身份、组织/成员/席位、Workspace、企业开通、许可和容量策略，通过内网 Admin API 管 SFTPGo | 不处理文件流，不直接写 SFTPGo 数据库 |
| SFTPGo | 文件 User API、SFTP/WebDAV（可选）、目录/权限/配额、文件上传下载、审计事件 | Admin API 内网；不掌握业务合同及销售规则 |
| PostgreSQL | Node 业务库与 SFTPGo 独立 Data Provider（可分 schema 或实例） | 不建立两个冲突的文件已用量真相 |
| 阿里云 OSS | Private 对象和生命周期管理 | 客户无法直连 OSS |
| 云效 Flow | 构建、验证、签名、向发行 Bucket 发布 | 不介入客户文件权限 |

### 2.2 控制面与文件面

业务身份以 Digiwise `user_id` 为准，Node 保存与 SFTPGo 用户名/账号 ID 的映射。Digiwise 登录 JWT 不等于 SFTPGo User Token；须验证外部认证 Hook 或受限 Token 交换方案，绝不发送 SFTPGo Admin Key 给客户端。

SFTPGo WebAdmin 仅内部运维访问；用户文件接口通过网关 HTTPS/TLS、用户权限及限流对外提供。SFTPGo 访问 OSS 使用服务器端最小权限 RAM 身份，优先使用同地域私网端点。


```mermaid
flowchart TB
    U[个人开发者 / 企业成员] --> IDE[DigiwiseStudio Desktop\nElectron + LVGL + 本地 Build]
    OPS[内部开发/运营] --> ADMIN[Digiwise Admin\n内部 Web 管理后台]
    IDE -->|HTTPS + Token| API[Digiwise Cloud API\n认证/空间/项目/授权/发布]
    ADMIN -->|HTTPS + RBAC| API
    API --> DB[(PostgreSQL\n用户/空间/配额/文件元数据)]
    API --> REDIS[(Redis / Worker\n任务/限流/清理)]
    API -->|内部调用| GATEWAY[Storage Gateway\n流式上传/下载/删除]
    GATEWAY -->|服务端 RAM 权限/私网优先| OSS[(阿里云 OSS Private)]
    CI[云效 Flow] -->|构建与发布产物| OSS
    API -->|查询已审核构建状态| CI
```

客户端只能访问 Cloud API 的业务域名；Storage Gateway 默认处于内部网络，不对互联网公开独立文件服务端口。云效构建产物可由受控发布管道管理；客户文件和发行包必须分 Bucket。

### 2.1 服务职责

| 部件 | 职责 | 不负责 |
| --- | --- | --- |
| Desktop IDE | 登录、切换 Workspace、本地编辑/编译、云文件上传下载、更新 | OSS 凭据和全局配额裁决 |
| Admin | 客户、组织、用户、空间、配额、版本、构建、资源、授权、监控、审计 | 直接替用户编辑工程 |
| Cloud API | 身份认证、RBAC、Workspace/项目授权、元数据、配额事务、上传会话、版本策略 | 大文件直接缓存在 API 内存 |
| Storage Gateway | API 已授权任务的流式传输、OSS CRUD、完整性验证、带宽/并发控制 | 决定业务所有权或跳过容量校验 |
| PostgreSQL | 事实记录、事务、空间及项目关联、预留量与审计 | 保存文件正文 |
| Redis / Worker | 异步清理、告警、限流、对账调度 | 作为唯一容量事实来源 |
| OSS | 对象持久化、生命周期、加密、版本化按策略配置 | 自行实现业务租户配额 |
| 云效 Flow | Windows/macOS 构建、签名、测试、制品发布 | 客户云项目存储授权 |

## 3. 用户、企业与工作空间

基础实体：`users`、`organizations`、`organization_members`、`workspaces`、`workspace_members`、`cloud_projects`、`project_members`。

- 用户注册后分配个人 Workspace（设计建议：自动创建）。
- 企业由内部管理员创建，或在 IDE 端发起申请并完成审批后开通；试用团队能否自助创建尚待产品决策。
- 企业开通涉及组织、初始所有者、Workspace、容量记录、许可证/席位，可通过带补偿的状态机完成；失败后可重试，不产生半开通可用空间。
- 成员使用同一账号加入企业，不自动转移个人工程；退出企业后个人空间保留，企业数据仍归企业。
- Workspace 是存储归属与权限域的核心，避免以 `user_id` 或企业名称作为 OSS 隔离标识。

```mermaid
erDiagram
 USERS ||--o{ WORKSPACE_MEMBERS : joins
 USERS ||--o{ ORGANIZATION_MEMBERS : joins
 ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERS : has
 ORGANIZATIONS ||--o{ WORKSPACES : owns
 WORKSPACES ||--o{ WORKSPACE_MEMBERS : has
 WORKSPACES ||--|| STORAGE_SPACES : quota
 WORKSPACES ||--o{ CLOUD_PROJECTS : has
 CLOUD_PROJECTS ||--o{ STORAGE_OBJECTS : contains
 WORKSPACES ||--o{ UPLOAD_SESSIONS : reserves
```

个人 Workspace 通过 `owner_user_id` 归属用户；企业 Workspace 通过 `organization_id` 归属组织。两种归属互斥，数据库增加约束。

## 4. OSS Bucket 与对象 Key 设计

**设计建议：生产环境至少分三个 Private Bucket，测试环境另设独立 Bucket。**

| Bucket 示例名 | 内容 | 访问控制 |
| --- | --- | --- |
| `digiwise-customer-prod` | 个人/企业工程、素材、备份 | Private，仅网关服务端操作 |
| `digiwise-release-prod` | Stable/Dev 安装包、更新清单、签名产物 | 受控分发；若坚持所有文件仅通过服务器访问，则发行下载也走专属网关/CDN 授权代理 |
| `digiwise-resources-prod` | 工具链、模板、Style、插件及 MCP 分发包 | 受控分发 |

```text
digiwise-customer-prod/
  workspaces/
    ws_<opaque-id>/
      projects/<project-id>/<object-id>
      assets/<object-id>
      backups/<backup-id>/<object-id>
      exports/<object-id>
```

OSS 为对象前缀而非真实文件夹。对象 Key 必须由后端生成，用户原始文件名仅存数据库。客户前缀实现逻辑隔离，不等于独立账号级或物理隔离；高安全客户可升级到独立 Bucket，迁移和授权方案另立 ADR。

## 5. 容量模型与一致性

**配额政策由 Node 业务系统管理；传输与实际文件用量由 SFTPGo 记录/执行。** 用户购买的额度由 Node 写入目标 Workspace 的 SFTPGo 虚拟目录配额；Node 可缓存上次同步的用量做后台展示，但不能和 SFTPGo 各自独立维护真实 `used_bytes`。

### 5.1 个人与企业

- 个人 Workspace：独立虚拟目录与独立配额。
- 企业 Workspace：建立一个共享虚拟目录，映射至多名企业成员；**使用该目录的专用 Quota，不设置 `-1` 计入各成员个人配额**。
- 调整企业总容量时，只修改对应虚拟目录的配额并审计；成员权限在 SFTPGo 中映射/撤销。跨企业访问必须在服务端和 SFTPGo 路径权限中同时隔离。
- SFTPGo 共享目录的配额和真实 OSS 账单容量并非完全同一概念，分片、历史版本、外部变更、回收策略须单独对账。

### 5.2 严格配额风险（必须 PoC）

SFTPGo 官方 `track_quota` 说明：并发上传开始时可能读取同一个剩余额度，大约每分钟检测并停止超额上传，因此短时超限是可能的；多实例共享 Data Provider 也具有最终一致性。中断上传和绕过 SFTPGo 直接修改 OSS 亦会造成计数漂移。

建议一期使用原生配额 + 文件数限制 + 上传并发/速率限制 + 定时 quota scan，对管理员展示风险。**若产品承诺“绝不超过 10GB/100GB”，上线前必须增加经过实测的跨用户上传准入/配额预留机制或经证实的严格串行策略；原生配额不可直接作为强一致验收依据。**

推荐监控：空间用量、文件数、传输流量、失败率、配额扫描偏差、未完成分片、跨实例短时超限和网关带宽成本。


`available_bytes = quota_bytes - used_bytes - reserved_bytes`，上述计数以数据库事务为准，所有长度均用 BIGINT bytes。

- 申请上传时根据 Workspace 加锁或原子更新，验证用户/项目权限、空间状态、文件尺寸和剩余容量，创建 `upload_sessions` 并预留 `reserved_bytes`。
- 对象不可被用户直接写入/覆盖；网关只能处理已经授权且未过期的上传会话。
- 服务端边接收边统计流量与对象大小，超出会话允许大小立即中断；不得因 HTTP chunked body 无 Content-Length 而放弃限制。
- 成功后网关从 OSS 核验对象真实大小、ETag/校验信息和 Key，事务提交 `storage_objects`，将预留转为已用，记录用量事件。
- 失败、超时、取消及服务重启时通过幂等补偿清理暂存对象/未完成分片并回退预留量。
- 替换文件采用新对象写入、版本提交、旧对象按回收策略清理；统计逻辑需同时考虑新旧对象占用。
- 多设备并发上传、请求重试、配额缩小、空间冻结、软删除与恢复都需要测试。
- **提醒阈值设计建议**：80% 预警、95% 高容量提醒、100% 拒绝增长；不得自动删除工程。
- 文件版本、回收站、OSS 版本化、备份对象是否计入计费和逻辑配额，应分别说明；不能将 `used_bytes` 视为 OSS 账单用量。

## 6. 上传下载、身份认证与安全数据流

```mermaid
sequenceDiagram
    participant IDE as Digiwise Desktop
    participant API as Node Cloud API
    participant SG as SFTPGo User API
    participant DB as Digiwise DB
    participant OSS as Private OSS
    IDE->>API: Digiwise 登录 / 查询 Workspace
    API->>DB: 校验成员/授权与套餐
    API->>SG: 内网 Admin API 配置用户/共享目录/配额
    Note over API,SG: 管理权限仅服务端可用
    IDE->>SG: HTTPS 用户级认证/短期会话
    SG-->>IDE: User Token（非 Admin Token / OSS 凭据）
    IDE->>SG: 上传/下载/列目录（用户 File API）
    SG->>OSS: 服务端 S3 兼容对象读写
    OSS-->>SG: 对象/状态
    SG-->>IDE: 文件流和用户级响应
    API->>SG: 内网查询审计与用量 / 定期对账
```

说明：示例采用两个用户级认证步骤，**不是说 SFTPGo 可以直接识别 Digiwise JWT**。需要在 PoC 中确定 SFTPGo 外部认证 Hook / 账户映射 / User Token 签发方式及失效同步。仅暴露 SFTPGo User API 或按需的 SFTP/WebDAV；WebAdmin/Admin API 设私网访问控制。

客户端不能获得 OSS AccessKey/STS/预签名 URL，下载不得重定向至 OSS 公网地址。文件只在 SFTPGo 和 OSS 间流动，Node 不直接承载字节流；断点续传、Range、路径穿越/越权、恶意文件、密钥轮换及单文件/会话限流都需验收。


```mermaid
sequenceDiagram
    participant IDE as Desktop IDE
    participant API as Cloud API
    participant DB as PostgreSQL
    participant GW as Storage Gateway
    participant OSS as Private OSS
    IDE->>API: POST /client/uploads (workspace, project, size)
    API->>DB: 校验成员/项目权限，原子预留配额
    DB-->>API: 上传会话 id
    API-->>IDE: 业务上传端点 + 会话令牌（非 OSS 凭据）
    IDE->>API: 上传文件流（HTTPS）
    API->>GW: 内部已授权上传流 / 会话上下文
    GW->>OSS: 服务端流式写入 / 分片
    OSS-->>GW: 对象结果
    GW->>API: 真实大小、哈希、对象状态
    API->>DB: 幂等提交元数据，结算配额
    API-->>IDE: 文件 id / 版本 / 已用量
```

下载：IDE 请求文件 ID → API 验证 Workspace 和项目权限 → 网关从 OSS 读取流 → API/网关经受控入口流式返回。严禁重定向到 OSS 对象 URL；不提供客户端 STS/签名 URL。支持 Range 下载、断点续传、流量限速与审计。大型工程传输避免整文件加载内存。

网关流式传输会增加应用网络出流量和算力成本，需做峰值并发、GB 级文件、客户端断线和出口费用的专项压测。

## 7. 后台规划（仅内部使用）

| 一级模块 | 页面及功能 | 阶段 |
| --- | --- | --- |
| Dashboard | 用户/组织/空间、容量、构建发布、告警 | P0 |
| Users | 个人账号、禁用、会话/设备、审计 | P0 |
| Organizations | 企业创建、审核、成员、初始负责人、状态 | P1 |
| Workspaces | 空间列表、个人/企业类型、归属、状态、权限 | P0 |
| Storage | 配额调整、用量、文件元数据、传输记录、对账、回收 | P0 |
| Releases | Stable/Dev、版本、元数据、灰度/暂停、审核、回滚策略 | P0 |
| Builds | 云效流水线、记录、产物、签名与校验 | P0 |
| Resources | SDK、工具链、工程模板、主题、组件、MCP/插件 | P1 |
| Licenses | 个人许可、企业席位、设备激活、有效期 | P1 |
| Monitoring | API/网关错误、容量告警、审计、任务重试 | P0 |
| Settings | 内部管理员/RBAC、系统参数、操作记录 | P0 |

企业员工在 IDE 内查看和切换工作空间、使用企业云项目；邀请/角色管理需明确组织成员权限，不因此建设企业 Web Portal。所有后台的“客户文件查看”默认仅允许元数据，不应开放读取客户工程正文的通用超管能力。

## 8. 软件发行与公共资源

保留现有云效 + OSS。构建产物路径以 `channel/platform/version/build-number/` 等不可变版本目录存储；更新通道元数据独立维护，Stable/Dev 隔离。发布需审核签名、哈希、平台、兼容性与回归结果。旧版本回滚需符合 Electron Updater 的版本比较规则，不假定已安装高版本能直接降级。

工具链、模板、Style 和插件都通过版本化资源清单分发，记录平台、文件哈希、兼容 IDE 版本及发布状态。MCP 后台可管版本与能力清单，但 MCP 属性/工具调用能力仍要在本地 MCP 代码中实现。

## 9. 数据库与接口草案

### 9.1 Digiwise 业务域（Node）

- `users`、`organizations`、`organization_members`、`workspaces`、`workspace_members`、`cloud_projects`；
- `workspace_storage_bindings`（workspace_id ↔ sftpgo_virtual_folder）、`sftpgo_account_bindings`（user_id ↔ SFTPGo account）、`storage_entitlements`（套餐允许额度）、`storage_usage_snapshots`（上次对账值，非文件事实来源）；
- `app_versions`、`release_channels`、`release_artifacts`、`build_runs`、`license_plans`、`licenses`、`license_seats`；
- `admin_users`、`admin_roles`、`admin_audit_logs`、`background_jobs`。

### 9.2 SFTPGo 文件数据域

SFTPGo 使用自身 Data Provider 维护用户、组、虚拟目录、映射、用户文件权限与配额用量。Node **只经 SFTPGo Admin API** 配置，不能在其数据库表中直接增删改。实际客户文件由 OSS Private Bucket 存储。

### 9.3 API 分工

```http
# Digiwise Node 业务 API
POST   /client/auth/login
GET    /client/workspaces
GET    /client/workspaces/{id}/storage-usage
POST   /client/organizations/applications
GET    /client/releases/latest
GET    /admin/users
POST   /admin/organizations
PATCH  /admin/workspaces/{id}/storage-entitlement
GET    /admin/storage/reconciliation
POST   /admin/releases/{id}/publish

# 受保护的 SFTPGo 用户级文件接口
# 以选定版本的 /api/v2/user/* 为准，不自行编造映射
# 内部服务经 /api/v2 Admin API 创建账号/目录/配额
```

配置变更需具备幂等性、异步补偿和审计：例如 Node 创建企业成功但 SFTPGo 建立虚拟目录失败时，该 Workspace 必须处于不可用的“开通中/失败”状态，并可重试。


关键数据表（第一期重点标 *）：

- `users`*、`organizations`、`organization_members`、`workspaces`*、`workspace_members`*；
- `storage_spaces`*、`storage_objects`*、`upload_sessions`*、`storage_usage_events`*、`storage_reconcile_runs`*；
- `cloud_projects`*、`project_members`、`file_revisions`；
- `app_versions`*、`release_channels`*、`release_artifacts`*、`build_runs`*；
- `license_plans`、`licenses`、`license_seats`；
- `admin_users`*、`admin_roles`*、`admin_audit_logs`*、`background_jobs`*。

所有带空间归属的数据表建立 `workspace_id` 索引；后台查询及 API 操作均须执行真实租户边界检查。容量预留使用事务、约束和幂等键，不能依赖 Redis 作为唯一数据源。

API 草案（需单独落 OpenAPI 文件）：

```http
POST   /client/auth/login
GET    /client/workspaces
GET    /client/workspaces/{id}/usage
GET    /client/projects
POST   /client/uploads
PUT    /client/uploads/{id}/content
POST   /client/uploads/{id}/complete
POST   /client/uploads/{id}/abort
GET    /client/files/{id}/content
DELETE /client/files/{id}
GET    /client/releases/latest

GET    /admin/users
POST   /admin/organizations
GET    /admin/workspaces
PATCH  /admin/workspaces/{id}/quota
GET    /admin/storage/reconciliations
GET    /admin/releases
POST   /admin/releases/{id}/publish
GET    /admin/builds
GET    /admin/audit-logs
```

业务错误码至少包括：`UNAUTHENTICATED`、`FORBIDDEN`、`WORKSPACE_SUSPENDED`、`QUOTA_EXCEEDED`、`UPLOAD_EXPIRED`、`FILE_CONFLICT`、`TRANSFER_INTERRUPTED`、`STORAGE_UNAVAILABLE`。

## 10. 技术选型与部署建议

| 层 | 选择 | 状态 |
| --- | --- | --- |
| Admin 前端 | React + TypeScript + Ant Design Pro | 建议 / 未实现 |
| Node 业务 API | NestJS 模块化单体 | 建议 / 未实现 |
| 文件服务 | **SFTPGo**，独立容器/进程，User API 对外、Admin API 内网 | 首选 / PoC 待验证 |
| 业务数据库 | PostgreSQL（Digiwise schema） | 建议 |
| SFTPGo Data Provider | PostgreSQL（SFTPGo 独立 schema/实例） | 建议 |
| 缓存与异步任务 | Redis + Worker，按需引入 | 可选 |
| 对象存储 | 阿里云 OSS Private，客户/发行/资源 Bucket 分离 | 规划 |
| 构建发布 | 延续云效 Flow + Electron updater | 复用现有 |

阿里云 OSS 的 S3 兼容配置参考 SFTPGo 官方文档：`https://s3.oss-<REGION>.aliyuncs.com`，同区域优先使用内网 Endpoint；`Force path style` 采用文档要求的虚拟主机样式。必须验证 Multipart、Range、列举、权限、删除、GB 级文件和性能。OSS 生命周期等特定能力仍需阿里云原生管理接口。

Open Source 版 SFTPGo 为 AGPLv3 并有 Web UI 主题额外许可限制；不能默认把其页面复制或改成自有产品 UI。投入生产前需核对使用版本的功能分层、商业许可、网络服务条款和部署方式。


| 层 | 建议 | 状态 |
| --- | --- | --- |
| Admin 前端 | React + TypeScript + Ant Design Pro | 待选型 |
| API | NestJS 模块化单体 | 待选型 |
| Storage Gateway | 独立进程/容器 + OSS SDK 流式中转 | 待实现 |
| 数据库 | PostgreSQL | 待部署 |
| 队列与限流 | Redis + Worker | 待部署 |
| 对象存储 | 阿里云 OSS 三 Bucket + dev/prod 隔离 | 规划 |
| CI/CD | 延续云效 Flow，构建制品受控发布 | 延续现有 |
| 运维 | 指标/日志/链路追踪/备份恢复 | 待建立 |

部署建议：独立 API 与网关进程，网关可水平扩容；入口 HTTPS + WAF/限流；内部服务在私有网络访问 OSS，RAM 最小权限；数据库自动备份及可验证恢复；密钥放专用密钥管理，不放源码/配置明文。测试与生产数据、Bucket、数据库和凭据必须隔离。

开源选型（SFTPGo/Cloudreve 等）须专项验证许可证、OSS 兼容性及**是否确实不向客户端暴露 OSS**；不将候选产品当作已确定依赖。

## 11. 安全与风险

1. **客户端不得直接访问 OSS**，不暴露 OSS 凭据/直链；SFTPGo 用户端点可以按业务需要对外，但不允许对外开放 Admin API、WebAdmin、内部存储端点。
2. Digiwise 业务身份与 SFTPGo 用户身份映射必须可追溯、可撤销。客户端只能有用户级短期凭据，不能保存管理员密钥。
3. 每个 Workspace 单独 OSS 前缀 + SFTPGo 虚拟目录；企业共享目录使用独立共享配额，成员权限最小化；退出企业需撤销映射和活跃会话。
4. 控制面与文件面分离监控与限流：Node 管管理操作审计，SFTPGo 管登录、传输和目录操作事件；通过可靠同步或定期对账形成业务审计视图。
5. 配额计数属于应用层近似值，不能承诺 SFTPGo 原生功能在多用户多实例并发下绝对不超限；合同硬限制要专项实现。
6. 服务器私网访问 OSS；RAM 凭据应最小授权，生产/测试隔离；优先 TLS、密钥轮换与访问日志。
7. IDE 本地工程和 Build 离线可用；云文件上传失败不得破坏本地工作区。
8. 对客户文件的个人信息、数据驻留、删除保留、恢复及 SFTPGo AGPL 许可进行专门评审。


- OSS Bucket Private、服务端 RAM、禁止客户端 OSS 凭据和直接 URL。
- API 强制 Workspace/Project 权限，防止只用客户端传来的 workspace_id 做授权。
- 管理 API 和 Client API 分离，审计所有高权限动作；管理员默认不读取用户文件正文。
- 支持单文件上限、请求限流、网关背压、上传超时、恶意文件与资源滥用检测策略。
- 云端故障时 IDE 本地功能可离线继续；上传有断点/重试与幂等恢复。
- 处理客户工程的个人信息、删除申请、保留期及跨境存储地域需进行合规评审。
- 发行版涉及 EEZ Studio GPLv3 派生代码，商业授权及源码分发义务应独立法律审查。

## 12. 分阶段实施与验收

### P0：SFTPGo + OSS PoC 和基础平台
- 使用固定 SFTPGo 版本，建立独立 Data Provider、Private OSS Bucket、最小权限 RAM 和测试域名；通过 S3 兼容接口上传、列举、下载和删除。
- Node API 通过内网 Admin API 创建个人 Workspace 对应的 SFTPGo 用户/虚拟目录/配额；桌面端以用户权限访问 User API。
- 做身份映射、跨用户隔离、密钥失效、单用户超限与并发超额测试。
- 复用现有云效 + 发行 OSS；不得把用户文件 API 引入发行通道。
- **验收门槛**：客户端抓包无 OSS 地址及管理员密钥，客户端不能调用 Admin API；本地 Build 不受云服务停机影响。

### P1：企业共享空间
- 组织创建/审批、成员邀请、企业 Workspace、共享虚拟目录独立总配额、权限撤销、配额配置和审计。
- **验收门槛**：个人同时加入两个企业，文件隔离；多员工共享同一配额；离职撤销即时有效；并发/多实例配额行为记录偏差与缓解策略。

### P2：运营与规模化
- 资源与发布管理、套餐/授权、容量扩容、账单/流量监控、定时对账和灾备。
- **验收门槛**：真实带宽与 OSS 成本压测、恢复演练、客户端大文件与网络断线测试、许可证和安全评审。

**注意**：PoC 与上线实现是不同状态，此方案不代表当前项目已部署 SFTPGo。


### P0：基础平台与个人空间

- 内部 Admin 登录/RBAC、Dashboard 基础指标、用户与 Workspace 列表。
- 个人账号、Personal Workspace、OSS Private、网关上传下载和文件列表。
- 严格并发配额预留、取消/失败补偿、对账、日志和审计。
- 复用云效 OSS 更新，建立文档及验收追踪。

**验收**：客户 A 无法访问 B；客户端无 OSS 凭据及 OSS 重定向；10 GB 配额在 2 台设备并发上传中不超卖；网关重启后会话可回收；本地 Build 不依赖云服务。

### P1：企业与运营

- 企业创建/审批、成员邀请、企业 Workspace、企业共享配额和席位。
- 软件资源中心、授权、客户存储回收机制、错误告警。
- 组织与个人空间切换、项目访问控制、空间迁移的显式审批。

**验收**：用户可同时属于个人和两个企业空间；退企业不影响个人空间；不同企业数据完全隔离；企业成员角色不能越权。

### P2：规模化与商业化

- 套餐/订阅、自动扩容、历史版本、可选同步、运营报表、成本与流量配额。
- 大文件高并发网关扩容、限速、容灾、多 Bucket/地域策略。

**验收**：流式传输压测、对象元数据对账、备份恢复演练及可审计收费口径。

## 13. 待评审决策

1. 采用开源 SFTPGo 还是 Enterprise 许可，AGPL 对 Digiwise 发行和服务模式的影响。
2. Digiwise Token 与 SFTPGo User API 的集成方式及短期凭据续期/注销。
3. 是否只开放 HTTPS User API，或向高级企业用户开放 SFTP/WebDAV。
4. 严格配额是否是合同承诺；若是，使用什么跨用户并发准入/预留策略。
5. 同一用户跨个人与多个企业 Workspace 的挂载、切换及项目级 ACL。
6. SFTPGo 的 PostgreSQL Data Provider、HA 与 quota scan 的运维策略。
7. OSS 地域、文件历史/回收站、成本统计与流量额度。
8. 软件更新和资源包是否采用 CDN/下载代理分发，仍不允许客户获得 OSS 原始私有访问凭据。

详见 [ADR-0001](../adr/0001-sftpgo-file-plane.md) 的 PoC 验收门槛。


1. 企业工作空间可否由个人自助创建？正式企业是否需后台审核？
2. 默认个人/企业配额、单文件上限、回收站保留期和流量上限。
3. 客户上传备份和文件历史是否计入逻辑配额。
4. OSS Bucket 所在地域、跨区域与国际客户的数据驻留要求。
5. Storage Gateway 使用自研 OSS SDK 还是经严格安全验证的开源网关。
6. 对发行安装包是否同样要求全量服务端中转，或允许 CDN 受控分发。

以上属于待决策项，不能作为现有实现或已获批准功能处理。

## 14. 变更记录

| 日期 | 版本 | 内容 |
| --- | --- | --- |
| 2026-11-10 | v1.0 | 确立内部后台、个人/企业统一 Workspace、OSS 服务端中转、严格配额与文档规范 |
| 2026-11-10 | v1.1 | 首选 Node.js + SFTPGo + OSS；调整传输面、认证、配额一致性风险和 PoC 门槛，见 ADR-0001 |
