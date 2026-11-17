# DigiwiseStudio 文档编写与变更规范

- 文档编号：STD-DOC-001
- 版本：v1.0
- 日期：2026-11-10
- 状态：拟实施
- 适用范围：DigiwiseStudio Desktop、Digiwise Admin、Cloud API、Storage Gateway、OSS、云效发布链路、MCP 与工具链。

## 1. 强制书面化场景

功能增删与交互修改、数据结构与 API 变更、工程/版本迁移、基础设施与部署、安全或权限变更、MCP 工具接口修改、重大 Bug 修复及回归验收，都应产生或更新相应文档。普通格式化和纯注释修改可以在 PR 描述中记录。

## 2. 文档分类及命名

| 类别 | 路径 | 示例 |
| --- | --- | --- |
| 总体架构 | `docs/architecture/` | `digiwise-platform-and-oss.md` |
| 功能设计 | `docs/features/` | `workspace-switching.md` |
| API | `docs/api/` | `cloud-storage-openapi.yaml` |
| 数据库 | `docs/database/` | `storage-schema.md` |
| 架构决策 | `docs/adr/` | `0001-workspace-as-tenant.md` |
| 运维 | `docs/operations/` | `release-runbook.md` |
| 规范 | `docs/standards/` | `documentation.md` |

文件使用小写英文 kebab-case；标题、内容允许中文。版本通过 Git 管理，不通过反复复制 `-final-v2` 文件来管理。

## 3. 文档最小模板

每份技术文档应包含：**目的与边界、状态及负责人、现状依据、需求和非目标、架构与数据流、接口/数据模型、安全与异常、兼容及迁移、验收清单、风险与待决策、变更记录**。必要时附 Mermaid 图，确保源码能随仓库维护。

## 4. 变更与评审流程

1. 需求确认：记录用户明确批准的范围，未批准功能只列“建议”。
2. 设计提交：通过 docs 变更或 ADR 先行评审；涉及密钥、用户数据、跨租户权限必须安全评审。
3. 实施：代码和 API/Schema 文档同一 PR 更新；迁移必须记录回滚策略。
4. 验证：提交测试场景、结果、环境和已知限制；不得以“已设计”代替“已验证”。
5. 发布：文档与代码版本关联；发行更改更新 release runbook 和用户可见变更说明。

## 5. 标记规则

- **已确认需求**：由项目需求对话明确约束。
- **设计建议**：尚未决定的技术选择或数值。
- **待验证**：依赖实际源码、云服务、性能或安全验证。
- **已实现**：必须关联代码路径和合格测试证据。

## 6. Git 与文档质量

文档改动使用 `docs:` 类型提交；在 PR 中说明影响范围、是否改动运行行为、验证和回滚。Markdown 链接应可访问，Mermaid 应可渲染，示例数据须标明非生产数据。禁止提交真实密码、令牌、客户资料及可利用的内网敏感信息。

## 7. 与 Agent Skills 的配合

根目录 `AGENTS.md` 规定项目持续有效的约束，`.agents/skills/<skill>/SKILL.md` 定义按任务触发的复用流程。编写或修改 Skills 必须遵循 [`agent-skills.md`](agent-skills.md)；Skills 不能代替此文档规定的设计记录、验收证据及评审。

## 8. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-11-10 | v1.0 | 建立文档目录、书面化要求和审查流程 |
| 2026-11-10 | v1.0 附录 | 增加 Agent Skills 规范链接及适用关系 |
