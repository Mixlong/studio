---
name: digiwise-cloud-storage
description: Use for DigiwiseStudio cloud backend, personal and organization workspaces, OSS storage gateway, file upload/download, strict storage quotas, permissions, authentication, or storage-related API designs and implementations. Do not use for unrelated local LVGL editing or UI-only changes.
---

# DigiwiseStudio 云后台与 OSS 安全实现

## 必读
先看 `AGENTS.md`、`docs/architecture/digiwise-platform-and-oss.md` 和对应 API/数据库文档（若已存在）。该总体方案仍属设计草案；先检查实际后端是否已经创建，不得假设 NestJS/Redis/网关已部署。

## 必须保持的边界
1. 个人与企业客户只有桌面 IDE；内部人员使用 Digiwise Admin。统一用户，个人/组织 Workspace 两种归属。
2. Workspace 决定文件、配额和项目权限；个人加入组织不自动转移个人数据。
3. **客户端仅访问受控 Cloud API**；严禁提供 OSS AccessKey、STS、预签名 URL、可直接读取/写入的 OSS 地址；不允许 OSS 重定向代替服务端下载。
4. Storage Gateway 处于服务器端并使用最小权限 RAM 身份，Private OSS 分客户逻辑前缀；跨 Workspace API 必须服务端鉴权。
5. 数据库是容量事实来源：`quota_bytes - used_bytes - reserved_bytes`；预留必须事务化、可并发、幂等；Redis 不可替代数据库锁/事务。
6. 上传使用服务端**有界流式中转**，验证声明大小和实际字节数；大文件考虑分片、背压、超时和断线清理；成功须再次核验 OSS 对象再结算配额。
7. 下载先验权，服务端流式返回（支持 Range 时校验 Range），不得向客户端暴露 OSS 直连方式；删除/恢复需校验归属、保留期和用量。
8. 发行安装包、公共资源、客户私有工程分别独立 Bucket，开发/生产环境隔离。发布链路改动需遵循 release Skill。

## 实施顺序
- 识别需求属于架构设计、接口、数据库迁移、网关、桌面客户端还是后台。
- 更新书面方案和 API/Schema，列出对象 Key、配额口径、失败补偿与对象生命周期。
- 实现服务端授权、配额原子预留和操作审计，再实现网关文件流。
- 通过单空间、跨空间、超额、并发、取消、失败/重试、网关重启、删除恢复及对账测试。
- 审查客户端抓包：不得收到可直接操作 OSS 的凭据、地址或重定向。
- 记录网关出口流量、CPU/内存与 OSS 成本；客户文件不默认由内部管理员读取内容。

## 必须回报的证据
描述用例和真实结果，明确“OSS 不能直接访问”“并发不超额”“用户不可跨空间”的验证方法。没有实际云账号或运行环境，只能标记待验证，不能宣布安全验收通过。
