# ADR-0002：评估 NocoBase 作为 Digiwise 内部管理后台

- 日期：2026-11-10
- 状态：候选方案 / 推荐 PoC / **尚未替代当前已记录的 Node.js 业务方案**
- 涉及：Digiwise Admin、Digiwise Cloud API、SFTPGo Admin API、用户/企业/工作空间、发布管理
- 关联：[总体架构](../architecture/digiwise-platform-and-oss.md)、[ADR-0001 文件面采用 SFTPGo](0001-sftpgo-file-plane.md)

## 1. 需求边界与候选方案

已确定：
- 个人与企业用户使用 DigiwiseStudio 桌面 IDE，不提供客户 Web 门户。
- 内部团队需要用户、Organizations、Workspace、成员/席位、许可证、容量策略、版本发布、审计和工作流管理。
- 文件操作由 SFTPGo 执行，实际对象存放于阿里云 OSS Private；客户不可直接访问 OSS 或取得 SFTPGo 管理员密钥。
- 正在比较 **NocoBase + SFTPGo + OSS** 与此前 **Ant Design Pro + NestJS + SFTPGo + OSS**。

NocoBase 自身基于 Node.js 技术体系，可承担内部 Admin 的界面、数据模型、权限和部分业务工作流；不需要再为同类后台页面搭建一套完全独立的 Ant Design Pro 管理端。

## 2. 推荐架构（待 PoC）

```mermaid
flowchart TB
  OPS[内部员工] --> ADMIN[NocoBase 内部 Admin]
  USER[个人/企业客户] --> IDE[DigiwiseStudio Desktop]
  ADMIN --> DB[(PostgreSQL 管理业务库)]
  ADMIN -->|受保护业务扩展/内部 API| BRIDGE[Digiwise Provisioning Service\n账号映射/幂等/密钥/补偿]
  IDE -->|用户业务 HTTPS API| BRIDGE
  BRIDGE -->|内网 Admin REST API| SFTP[SFTPGo]
  IDE -->|受限用户 HTTPS 文件接口| SFTP
  SFTP -->|服务端凭据/S3 兼容接口| OSS[(阿里云 OSS Private)]
  CI[云效 Flow] -->|构建发布| RELEASE[(发行 OSS Bucket)]
  ADMIN -->|查看发布状态/受控审核| CI
```

### 责任划分

| 组件 | 职责 | 不做 |
| --- | --- | --- |
| NocoBase | 内部管理 UI、客户与组织记录、配额策略、审批、后台操作权限和展示 | 不承担 GB 级文件传输，不作为面向所有桌面客户的唯一公共鉴权入口 |
| Digiwise Provisioning/API（精简） | 桌面身份/令牌桥接、用户与组织开通、SFTPGo 账号映射、幂等补偿、撤销会话、敏感审计 | 不提供重复的内部后台页面，不转发文件流 |
| SFTPGo | 用户文件接口、SFTP/WebDAV（按需）、虚拟目录/共享、实际文件使用计数及文件操作审计 | 不维护 Digiwise 套餐、订单与组织合同 |
| OSS Private | 用户数据对象、服务端存储与生命周期 | 不直接向客户端授权上传下载 |
| 云效 Flow | 构建/制品/发布 | 不管理客户空间 |

### 为什么保留精简业务 API

NocoBase 后台角色和内部会话不应直接暴露给所有桌面客户；即使 NocoBase 支持 HTTP API，也需要设计客户端的登录、令牌生命周期、SFTPGo User API 认证、用户/企业空间切换、成员权限撤销与并发补偿。可以实现成 NocoBase 后端插件或独立最小 Node 服务，具体部署由 PoC 决定。

严禁在 NocoBase 可公开查询的业务表中保存 SFTPGo Admin Token。密钥应在受控后端配置/密钥服务中管理。

## 3. 官方版本差异（必须锁定版本）

NocoBase 2.x 与 3 的实现体系已有差异，不能将两套文档混用：

- NocoBase 2.x：基础用户、权限、工作流及 **Workflow HTTP Request** 为 Community；**Workflow Approval** 为 Professional；**Audit Logs** 为 Enterprise；**REST API 外部数据源** 为 Standard；**Workflow Database Transaction Node** 为 Enterprise。普通 HTTP 请求节点可调用 SFTPGo，但不等于高级外部 REST 数据源功能免费，也不意味着能在两个系统之间实现分布式事务。
- NocoBase 3：Core、用户权限、数据库与存储基础、代码定义流程/基础审批是其当前产品能力；**并非与 2.x 相同的拖拽工作流设计器**。商业版包括高级审批、治理、审计/高可用等，部署前按锁定版本官方表核对。
- NocoBase 内部 File Manager 的 S3/OSS 插件服务于业务附件，**不要拿它存 Digiwise 用户个人/企业文件**；客户文件仍走 SFTPGo，避免权限和配额双系统。

官方参考：
- https://docs.nocobase.com/plugins/
- https://docs.nocobase.com/start/from-v2/
- https://www.nocobase.com/pricing/
- https://docs.nocobase.com/plugins/%40nocobase/plugin-workflow-request/
- https://docs.nocobase.com/plugins/%40nocobase/plugin-workflow-approval/
- https://docs.nocobase.com/plugins/%40nocobase/plugin-data-source-rest-api/

## 4. 优势和隐藏成本

### 优势
- 内部 CRUD、列表、表单、角色、关联数据与基础报表成型更快。
- 使用社区版可减少首期 UI/管理端开发；可通过 HTTP 请求或自定义插件调用 SFTPGo。
- 不改变已经确认的 SFTPGo + OSS 文件面和 Desktop 产品边界。

### 隐藏成本及风险
1. **版本与插件许可**：2.x 和 3 的特性/部署方式不同；商用高级插件、官方品牌替换及高可用可能付费。
2. **业务一致性**：创建企业 → 写 Digiwise DB → SFTPGo 建账号/共享目录 → 分配配额不是单数据库事务；必须有幂等、失败补偿、重试/对账和审计。
3. **身份统一**：NocoBase 管理员/用户身份、Digiwise Desktop Token、SFTPGo User 身份不是自动同一个系统，需要明确可信身份源和可撤销映射。
4. **容量限制**：SFTPGo 并发上传可短时超额，属于 ADR-0001 待解决风险；NocoBase 的容量字段只是业务策略，不能直接保证硬配额。
5. **发布管理**：云效构建、Electron Stable/Dev、不可变发行包、回滚及审批仍需编写适配器和测试。
6. **安全**：不得向客户端公开 NocoBase 管理 API 及 SFTPGo Admin API；云文件权限在服务端鉴权，不能仅由管理 UI 的隐藏页面决定。
7. **扩容运维**：NocoBase、SFTPGo、PostgreSQL 与 OSS 的数据库备份、监控、版本升级、许可证均需维护；“免费社区版”不等于零运营成本。

## 5. 选型结论与 PoC

**建议作为首选内部后台候选，但暂不直接改写 ADR-0001 或宣称选型已完成。**

执行最小 PoC：
- [ ] 锁定 NocoBase 2.x 或 3 的具体镜像/版本、插件列表和许可证。
- [ ] 内部后台创建个人用户和企业 Workspace，触发受保护 SFTPGo Admin API 开通用户/虚拟目录/配额。
- [ ] 创建失败、重复点击、接口超时、服务重启时不会开通重复目录或产生不可用半成品。
- [ ] 桌面端只获得用户文件权限，不可访问内部 NocoBase Admin、SFTPGo Admin 或 OSS。
- [ ] 个人空间/企业共享文件夹隔离及单用户和多用户配额测试。
- [ ] 至少完成一次员工撤销与企业管理员变更，确认会话和共享文件权限及时收回。
- [ ] 验证社区版可实现目标流程；若用到收费功能，列明确切费用与替代方案。
- [ ] 完成安全审计、实际安装部署、备份恢复与核心升级演练。

## 6. 选型建议

若团队首要目标是**尽快具备内部管理 CRUD、表单及配置工作流**，NocoBase 值得优先；若项目追求高度定制的对外用户平台/复杂事务和长期 API 契约，则精简业务 API 无法全部省略。NocoBase 可替代 AdminJS/Ant Design Pro 管理端，不自动替代专门的认证与开通服务。

## 7. 变更记录

| 日期 | 内容 |
| --- | --- |
| 2026-11-10 | NocoBase 内部后台候选架构与 2.x/3 插件边界评估；保留待 PoC 决策 |
