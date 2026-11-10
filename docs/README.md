# DigiwiseStudio 技术文档中心

> 文档规范版本：1.0 · 建立日期：2026-11-10 · 状态：规划 / 待技术评审

本目录为 DigiwiseStudio 的正式工程文档入口。涉及架构、接口、数据结构、安全、产品行为和发布流程的变更，均应在实施前形成 Markdown 设计记录，实施后同步更新并在代码审查中检查。

## 文档索引

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [总体架构与后台 OSS 技术方案](architecture/digiwise-platform-and-oss.md) | Node + SFTPGo + OSS、个人与企业统一空间、安全、配额、部署、实施与验收 | 首选方案 / 待 PoC |
| [ADR-0001：SFTPGo 文件面选型](adr/0001-sftpgo-file-plane.md) | Node 管业务、SFTPGo 管文件、OSS 管存储的架构决策、风险与验收门槛 | 原则同意 / 待 PoC |
| [ADR-0002：NocoBase 内部后台评估](adr/0002-nocobase-internal-admin-evaluation.md) | NocoBase 2.x/3 功能差异、授权成本、SFTPGo 集成及验证计划 | 候选 / 待 PoC |
| [文档编写与变更规范](standards/documentation.md) | 目录、命名、模板、评审与维护规则 | 拟实施 |
| [项目 Agent Skills 规范](standards/agent-skills.md) | Skill 结构、触发、评审和验证流程 | 拟实施 |

## AI 开发约束与 Skills

- 根目录 [`AGENTS.md`](../AGENTS.md) 定义持续有效的项目边界和文档先行规则。
- [`.agents/skills/`](../.agents/skills/) 存放按任务加载的 5 个项目级 Skills（文档、云存储、MCP、UI、发布）。
- Skills 格式及维护细则参见 [项目 Agent Skills 规范](standards/agent-skills.md)。

## 目录规范

- `architecture/`：系统、模块、部署及安全架构。
- `api/`：OpenAPI 定义、接口约定及错误码。
- `database/`：ERD、迁移、约束与数据字典。
- `features/`：功能需求和详细设计。
- `adr/`：架构决策记录（Architecture Decision Records）。
- `operations/`：构建、发布、备份、监控、故障与回滚手册。
- `standards/`：编码、文档、UI、测试与安全规范。

未建设的目录随首份文件创建，不保留空目录。文档是项目内的版本化资料，不包含实际 AccessKey、账号密码、私有下载链接或客户文件。

## 维护原则

1. **先书面、后实现**：新增模块、数据表、外部接口、发布流程或重大行为变更，先补充文档。
2. **设计与实施分离**：文档须标注“已确认 / 设计建议 / 待验证”，不得将设计草案写成已上线能力。
3. **可追溯**：每次调整记录日期、变更摘要、代码 PR/Issue 和验收结论。
4. **安全优先**：客户不可直接访问 OSS；任何绕开 Cloud API / Storage Gateway 的方案必须重新评审。
5. **同步提交**：实现接口或数据库修改时一并修改对应文档。
6. **不覆盖既有规范**：修改历史文档时应保留必要的决策过程、迁移及兼容性说明。

> 当前仓库的运行代码尚未依据本技术方案完成改造；该目录是规划落地的基线，不构成实现完成声明。
