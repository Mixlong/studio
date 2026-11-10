# ADR-0001：采用 SFTPGo 作为用户文件网关

- 日期：2026-11-10
- 状态：**原则同意 / 实施需通过 PoC 与许可证评审**
- 决策范围：个人与企业用户的云存储文件面（Data Plane）
- 相关文档：[总体架构](../architecture/digiwise-platform-and-oss.md)

## 背景

DigiwiseStudio 面向个人及企业客户，客户仅使用桌面 IDE，不提供客户 Web 后台。要求个人和企业拥有独立 Workspace 与容量配额、企业成员共享文件、客户端不能直接访问阿里云 OSS。内部 Digiwise Admin 需要创建/维护账号、空间、授权、版本和审计。

旧方案由 Node.js Cloud API 配合自研 Storage Gateway 对 OSS 进行流式上传下载，会重复实现多种成熟文件传输功能。

## 决策

采用 **Digiwise Node.js + SFTPGo + 阿里云 OSS（Private）** 作为首选架构：

1. **Node.js / Digiwise Cloud API（控制面）** 管理 Digiwise 用户、组织、Workspace、成员、席位、许可证、套餐、业务配额配置、审批与审计；通过内网 SFTPGo Admin REST API 开通用户、组、虚拟目录及配额，不直接处理文件字节流。
2. **SFTPGo（文件面）** 管理用户级文件接口、访问权限、虚拟文件系统、共享目录、文件及流量配额、文件上传下载。桌面端通过 HTTPS 用户级文件 API，必要时选用 SFTP/WebDAV；客户不能调用 SFTPGo Admin API。
3. **阿里云 OSS（存储面）** 保存文件对象；使用 Private Bucket、独立 Workspace 前缀及仅服务器端持有的 RAM 凭据；客户端不得获得 OSS AccessKey、STS、预签名 URL 或可直连 OSS 的地址。
4. 网关/反向代理可将 `/files/*` 指向 SFTPGo 的用户级 HTTPS 接口，但不将流量转入 Node.js 进程；业务 API 与文件 API 分离鉴权与限流。
5. Digiwise 的业务数据库与 SFTPGo 自身 Data Provider **逻辑分离**；Node 只通过 Admin API 管理 SFTPGo，不直接修改其数据库表。通过事件、查询和定期对账协调状态。

## 备选方案与取舍

| 方案 | 优点 | 代价 | 结论 |
| --- | --- | --- | --- |
| Node.js + OSS SDK 自研网关 | 统一鉴权和容量事务 | 自研上传下载、目录、共享、协议与高并发传输 | 不优先 |
| Cloudreve 二次开发 | 云盘界面与流程现成 | 业务模式较重，需限制直传/登录和产品化改造 | 备选 |
| **Node.js + SFTPGo + OSS** | 成熟的文件面、协议、共享文件夹及配额 | 双系统账号与认证联动，配额弱一致，AGPL 许可证审查 | **首选，须通过 PoC** |

## 企业与个人工作空间映射

- Digiwise `users`：统一身份；`workspaces`：个人或企业空间；`workspace_members`：授权成员。
- SFTPGo `users`：与 Digiwise User 的不透明 ID 映射，避免重复创建无意义的账号；`groups` 可按组织/授权策略管理。
- 每个 Workspace 有一个专用 SFTPGo Virtual Folder，绑定 `customers/workspaces/<workspace-id>/` 的 OSS Key Prefix。
- 企业工作空间可挂载同一虚拟目录给多名成员；采用**共享虚拟目录的独立配额**，不要对共享目录设置 `-1` 计入各用户配额，以免计数失真。
- 不同企业/个人空间拥有不同前缀及权限边界。删除成员应立即撤销其 SFTPGo 映射、会话与凭据，验证不能继续访问。
- 对单个 SFTPGo 用户映射多个 Workspace，需明确目录可见范围、项目级权限及工作空间切换实现；不能通过宽权限根目录暴露其他空间。

## 认证设计与边界

- Digiwise 账号系统为业务身份源；SFTPGo User API 有独立的用户身份和 Token 机制，不直接接受任意 Digiwise JWT。
- PoC 比较外部认证 Hook、SFTPGo 自己的用户 Token、短期账号凭据和适合桌面端的受限认证桥接；**不向客户端下发 Admin API Key**。
- SFTPGo WebAdmin、Admin REST API 仅允许内网或受保护运维访问；SFTPGo WebClient 不面向客户开放，除非另行批准。SFTP/WebDAV 监听端口按实际业务需要显式启用，不默认全部开放。
- TLS、用户级权限、限流、登录失败保护与审计必须启用；仅 SFTPGo 服务端持有 OSS 访问凭据。

## 容量一致性风险：不可把 SFTPGo Quota 当严格事务配额

SFTPGo 官方文档明确：多用户/多上传在开始时看到的可用容量可能相同，约每分钟检查一次超额；多实例共享 Data Provider 亦为最终一致。进程中断、外部修改对象后配额计数可能漂移。因此：

- 一期采用 SFTPGo 原生虚拟目录配额、上传并发限制与定时 quota scan，并把“可能短时超限”写入风险。
- 若商业合同要求**任何时刻绝不超过配额**，在正式销售前必须验证外部上传准入/容量预留协调机制，或在文件接口层作严格串行/令牌限制；不得承诺原生 Quota 即是强一致。
- Node 是**配额政策的权威来源**（购买额度、套餐），SFTPGo 是**文件使用量的测量与执行来源**；按同步任务及审计对账，不建立两个各自独立且互相冲突的 `used_bytes` 真相。
- PoC 必测同 Workspace 多用户并发、多实例、覆盖上传、取消、重试、对象直写绕过、额度调低、停用 Workspace 与数据恢复。

## OSS 兼容与部署

SFTPGo 通过 S3 兼容后端接入 Alibaba OSS，建议验证 `s3.oss-<region>.aliyuncs.com` 与同地域内网端点、Region、virtual-hosted style、Multipart、Range、删除、目录列举、文件校验与大文件传输；部分 OSS 生命周期等原生能力仍需通过阿里云控制台/API 管理。

部署 SFTPGo 和 Node API 为相互独立的服务；SFTPGo 可使用 PostgreSQL Data Provider（与 Digiwise 业务 schema 隔离）。发布包、资源包及用户文件 Bucket 分离。监控文件请求量、OSS 请求/存储费用、网关出口带宽、连接数、失败率及对账异常。

## 许可证与安全评审

SFTPGo Open Source 采用 AGPL-3.0-only 并附加 Web UI 主题使用限制。使用、修改、向网络用户提供服务及自定义/复用 Web UI 的合规义务必须由项目方评审；不要默认把 WebAdmin/WebClient 前端复用为 Digiwise 品牌后台。确定 Open Source 与 Enterprise 版功能及许可差异后再落生产。

## PoC 验收门槛

- [ ] OSS Private + 客户抓包：没有 OSS URL、AccessKey、STS、预签名 URL；没有 Admin API 入口。
- [ ] 个人空间及企业共享虚拟目录正常挂载、上传、下载、删除。
- [ ] 客户 A/B 不可跨目录访问；企业成员移除后立即失效。
- [ ] 统一身份集成不暴露管理员密钥，不使用长期明文用户凭据。
- [ ] 单人、双人并发、多实例下的容量上限行为实测并记录偏差。
- [ ] 阿里云 OSS S3 兼容性及 >=1GB 文件断点续传通过。
- [ ] 服务中断/恢复、对账、上传失败、目录配额调整通过。
- [ ] 许可证、服务负载、网络带宽及成本评审通过。

## 参考

- https://docs.sftpgo.com/enterprise/rest-api/
- https://docs.sftpgo.com/enterprise/virtual-folders/
- https://docs.sftpgo.com/enterprise/config-file/
- https://docs.sftpgo.com/enterprise/s3-compatible-services/
- https://docs.sftpgo.com/enterprise/external-auth/
- https://apt.sftpgo.com/licensing

## 变更记录

| 日期 | 内容 |
| --- | --- |
| 2026-11-10 | 首选 SFTPGo 管文件面，Node 管业务，OSS 管实际存储；保留配额、认证、许可证 PoC 门槛 |
