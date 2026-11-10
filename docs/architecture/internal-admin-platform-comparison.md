# Digiwise 统一内部管理平台候选产品比较

- 文档编号：ARCH-ADMIN-COMPARE-001
- 版本：v0.2（需求范围修订）
- 日期：2026-11-10
- 状态：选型调研 / 未完成部署 PoC / 未批准替换现有后台
- 关联：[NocoBase 候选 ADR](../adr/0002-nocobase-internal-admin-evaluation.md)、[SFTPGo 文件面 ADR](../adr/0001-sftpgo-file-plane.md)、[多项目数据库接入](multi-project-data-integration.md)

## 1. 项目需求

内部员工通过统一 Web 平台管理个人与企业账号、邮箱开通审核、Organizations、成员、Workspace、存储配额、许可证和发布运维。客户仅使用 DigiwiseStudio Desktop，不访问内部管理平台。用户文件通过受限 SFTPGo User API 提供、落盘到阿里云 OSS Private；NocoBase/Budibase/Appsmith 等平台**只负责内部管理层**，不直接替代文件网关或桌面 Public API。

当前明确只有一个可选外部系统——**已有的迪太云管理系统**，未来可能读取部分数据；并不计划建设通用的多项目平台。因此比较重点应回到：

- 可视化建表和管理页面的速度、界面可定制性；
- 企业/个人账号、邮箱开通、组织关系和软件授权的配置效率；
- 对迪太云现有 API 或只读数据源的**可选**接入能力及版本/许可成本；
- 账号、组织、角色/数据权限及审批流程；
- 调用 SFTPGo Admin API 的安全性和跨系统幂等补偿；
- 部署维护、版本管理、许可证及扩展成本。

## 2. 候选平台对比

| 平台 | 长处 | 短板 / 许可注意 | 优先场景 |
| --- | --- | --- | --- |
| **NocoBase 2.x** | 数据模型、关联关系、内部 CRUD、表单、基础工作流、权限；低代码搭业务管理 | 2.x 完整外部 PostgreSQL/MySQL/REST 数据源插件归 Standard+；高级审批及审计等部分插件更高档付费 | 组织、用户、许可、审批重的业务后台 |
| **Budibase** | 自托管开源版有外部数据源、REST、可视化页面、表单和自动化 | 免费档 Workspace 数及许可需核对；复杂业务和跨系统补偿需另写服务 | 如果后续发现 NocoBase 的后台配置流程不适用，作为备选验证 |
| **Appsmith** | 自由拖拽布局、数据库/API 连接、JavaScript/SQL、Git 协作 | 高级权限、Workflows、审计和部分协作能力属于 Business；复杂业务域模型非强项 | 高度自定义运维控制台和 API 管理页面 |
| **ToolJet** | API/数据库连接广、页面组件与 AI 辅助 | 自托管免费档限制约 2 Builders/50 End Users/10 Apps（以具体版本/报价核实）；AGPLv3 | 快速构建内部工具、数据查询 |
| **Directus** | 连接数据库后快速提供 REST/GraphQL、SDK、权限、Flows | 当前为 MSCL 许可而非 OSI 传统开源许可证；Core 免费档功能/规模限制，复杂内部表单审批可能需开发 | 已有数据库需要优先提供标准 API |

## 3. 重要事实核对

1. NocoBase 2.x 的基础工作流 HTTP Request 社区版可用，但**完整外部数据库数据源与外部 REST 数据源插件并非免费 Community**。Community 的 FDW/外部表方式不能与可视化完整数据源等同；NocoBase 3 更偏代码化应用开发，必须按明确版本重新验证。
2. Budibase 当前自托管 Open Source 定价页显示：1 Workspace、Unlimited Apps、Unlimited Automations、Unlimited Users、Unlimited Datasources，并提供外部数据库及 REST API 连接。1 Workspace 指 Budibase 平台容器，不等于 Digiwise 中只能有一个 Personal/Organization Workspace。
3. Appsmith 适合连接已有独立后端做页面，但 Free/Business 的权限与 Workflow 功能区别明显；不要从 UI 编辑器具备“按钮发 API”推断所有业务审批均免费。
4. ToolJet 自托管 Free 当前显示存在 Builder、End User 和 App 规模上限；不能笼统称“开源可无限用”。
5. Directus 适合做数据即 API 的服务，但要评审 MSCL 和当下套餐；它不是 NocoBase 的完全等价替代。
6. 无论采用哪种后台，桌面登录业务 API、SFTPGo 文件认证映射和成员撤销必须有独立的后端可信实现。不得把后台管理员密钥交给 Electron 客户端。

## 4. 方案建议与部署边界

不需要仅为可选的迪太云数据查看而同时部署多个后台。建议先做 Digiwise 业务闭环 PoC：

- **优先 PoC：NocoBase** —— 验证个人邮箱开通、企业管理、Workspace、配额、授权及调用 SFTPGo Admin API 的完整闭环。
- **按需 PoC：迪太云数据读取** —— 只有确定需要展示的具体数据后，验证现有 API 或单个只读数据源的连通、权限及费用。
- 若 NocoBase 在 UI、权限、性能或费用上实测不符合要求，再针对这些问题比较 Budibase 或 Appsmith；不建议部署五个平台。

推荐稳定拓扑：**Admin Builder（NocoBase 或 Budibase） ↔ 受保护的 Digiwise Provisioning/Public API ↔ SFTPGo Admin/User API → OSS Private**。Admin 不直接以超级账户写入其他项目生产事务表；跨项目业务修改应通过各项目自身 API。SFTPGo Admin API 保持私网访问。

## 5. 决策验收（每个平台同一用例）

1. 创建一个个人账户、一个企业组织及 3 位成员，形成 Personal 和 Organization Workspace；
2. 在后台配置容量和席位，经可信后端调用 SFTPGo 建立共享虚拟目录（重复提交必须幂等）；
3. 模拟账号审核拒绝、用户退出企业、SFTPGo Admin API 超时和失败重试；
4. 迪太云接入暂不作为首期必测项。若决定实施，使用其实际数据库或 API 连接一个获准的只读测试页面，不虚构 PostgreSQL/MySQL 类型；
5. 审查只有管理员能执行开通/扩容操作，普通客户桌面用户无法访问管理 API、SFTPGo Admin API、OSS 凭据与直链；
6. 评估实施耗时、许可证与插件费用、数据库查询性能、升级维护和备份恢复成本；
7. 记录实际安装版本和真实测试结果；**不能把设计文档写成已通过 PoC**。

## 6. 初步结论

**修订结论：先验证 NocoBase 是否满足 DigiwiseStudio 内部管理业务；Budibase 保留备选，而非因为未来可能接入迪太云就优先替换。** 两者都不替代 SFTPGo + OSS，也不意味着无需 Digiwise Public API。迪太云仅作为可能的数据来源，按独立集成实施。

## 7. 官方资料（核对时点：2026-11-10）

- NocoBase 插件版别：https://docs.nocobase.com/plugins/
- NocoBase 可视化版外部数据源：https://nocode.nocobase.com/en/plugins
- Budibase 自托管开源定价：https://budibase.com/pricing/
- Budibase 低代码界面及外部数据库：https://budibase.com/product/apps
- Appsmith 介绍与数据源：https://docs.appsmith.com/
- Appsmith 定价：https://www.appsmith.com/pricing
- ToolJet 自托管限制：https://tooljet.com/self-hosted
- Directus 产品与许可：https://directus.com/docs/getting-started/overview

## 8. 变更记录

| 日期 | 版本 | 内容 |
| --- | --- | --- |
| 2026-11-10 | v0.1 | 增加 Budibase、Appsmith、ToolJet、Directus 与 NocoBase 的可用性/费用/架构对比及同等 PoC 验收 |
| 2026-11-10 | v0.2 | 将“多项目平台”需求收窄为未来可能读取迪太云部分数据，NocoBase 优先 PoC，其他作为备选 |
