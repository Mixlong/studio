# DigiwiseStudio 项目 Skills 编写、发现与验收规范

- 文档编号：STD-AGENT-001
- 版本：v1.0
- 日期：2026-11-10
- 状态：拟实施 / 随文档 PR 评审
- 使用范围：仓库内的 Codex 及支持 Agent Skills 标准的开发助手

## 1. 目标与分层

将项目约束和可复用的开发检查流程固化到版本控制，不依赖某一次聊天上下文。

| 层 | 文件 | 目的 |
| --- | --- | --- |
| 全局项目规则 | `AGENTS.md` | 持续有效的项目边界、代码与文档约束 |
| 任务技能 | `.agents/skills/<name>/SKILL.md` | 基于任务描述按需触发的具体执行流程 |
| 正式设计依据 | `docs/` | 书面架构、接口、数据库、验收与决策记录 |
| 代码与测试 | 对应源码、测试与 CI | 事实来源；文档不能代替真实验证 |

Skills 不是后台功能、服务接口或自动定时任务。创建 Skill 只表示规则可供助手加载，并不表示 IDE、MCP 或云服务已实现对应能力。

## 2. 目录与文件格式

使用仓库级 `.agents/skills/`，每个 Skill 单独目录，目录名与 YAML 中的 `name` 完全一致。Codex 从仓库根目录内扫描该目录；其他开发助手需要依据自身规则配置或引入，**不能承诺自动适用所有 AI 工具**。

```text
AGENTS.md
.agents/
  skills/
    digiwise-docs-first/SKILL.md
    digiwise-cloud-storage/SKILL.md
    digiwise-mcp-contracts/SKILL.md
    digiwise-ui-review/SKILL.md
    digiwise-release-operations/SKILL.md
docs/
  README.md
  architecture/
  standards/
    documentation.md
    agent-skills.md
```

每个 `SKILL.md` 须以 YAML frontmatter 起始，至少包含：

```yaml
---
name: digiwise-example
description: Use when working on [specific Digiwise task]; verify [expected outcome]. Do not use for unrelated tasks.
---
```

- `name`：小写字母、数字、连字符，最多 64 字符，不以前后连字符结束；应与文件夹同名。
- `description`：非空、最多 1024 字符，明确“什么时候用”和“什么时候不该用”，避免诸如“处理所有项目事项”的泛化触发。
- 正文：目的、适用输入、必读事实、顺序步骤、约束、验证/验收、交付形式。
- 可选 `references/`、`scripts/`、`assets/`；少量流程优先保持指令型 Skill，不创建无必要脚本。
- 技能必须引用真实仓库路径，不能引用未存在的模块作为已实现依据。

标准参考：
- [Agent Skills Specification](https://agentskills.io/specification)
- [OpenAI Build Skills](https://learn.chatgpt.com/docs/build-skills)

## 3. Skill 设计原则

1. **单一职责**：一个 Skill 解决一个可识别的工作流，不重复堆叠全局规则。
2. **渐进式披露**：`description` 短、明确；正文只放必要工作流；较长技术内容链接 `docs/`。
3. **来源真实**：先核实仓库及部署现状，不将建议或示例说成已实现。
4. **文档先行**：重要改动遵循 `docs/standards/documentation.md`；实际验证结果须有证据。
5. **安全边界不可放宽**：OSS 不直连、服务端鉴权/配额、最小权限、客户隔离。
6. **无隐形增项**：Skill 不授予助手修改生产环境、合并 PR、增加功能或读取客户文件的额外权限。
7. **适度触发**：用户只询问一般知识、无需改动此项目时，不主动修改仓库。

## 4. 创建 / 修改 Skill 的流程

1. **需求**：说明触发任务、输入材料、预期输出、限制与不适用场景。
2. **查重**：检查 `AGENTS.md`、已有 Skills 和 `docs/`，避免同类流程重复规定。
3. **设计**：编写 `SKILL.md` 的准确元数据与可执行步骤；如果改变架构判断，更新相关 ADR/设计文档。
4. **检验**：验证 frontmatter 可解析、名称与目录相符、链接有效、无机密或假路径。
5. **用例验证**：至少覆盖 1 个应触发任务、1 个不应触发任务、1 个失败/无权限场景。
6. **提交**：先通过文档/技能 PR 审查；未经批准不更改生产配置。

若环境安装了 `skills-ref`，可运行 `skills-ref validate .agents/skills/<name>`；没有安装时应说明未执行，而不能说“校验通过”。

## 5. 项目 Skills 清单

| Skill | 触发场景 | 重点检查 |
| --- | --- | --- |
| `digiwise-docs-first` | 新功能、架构/API/数据库调整、修复与验收文档 | 文档状态、设计/实现边界、证据、变更记录 |
| `digiwise-cloud-storage` | 个人/企业 Workspace、OSS、安全、配额、网关、后台 | 客户不能直连 OSS、跨空间授权、并发配额 |
| `digiwise-mcp-contracts` | MCP 能力审计、工具/属性增改、AI 完整工作流 | 工具可发现、真读写、属性覆盖、端到端验证 |
| `digiwise-ui-review` | IDE 布局、主题、图标、属性面板和本地化修改 | 与既有设计对齐、状态一致、回归及截图 |
| `digiwise-release-operations` | Electron 更新、云效构建、制品管理、版本发布 | 通道隔离、不可变路径、审核、回滚与记录 |

## 6. 交付与验收清单

- [ ] Skill 的 `name`、目录名、`description` 符合规范。
- [ ] 不依赖未提供的工具，不把本地或云端未执行的工作说成完成。
- [ ] 相关 `docs/` 索引与规范已更新；大型决定留 ADR。
- [ ] 正反例触发说明完整；失败与缺权限时有安全退出路径。
- [ ] 不含真实 OSS 账号、密钥、客户工程或私人数据。
- [ ] 有真实校验记录，若未执行测试如实标记“未验证”。

## 7. 维护规则

当项目架构、安全边界、流程或工具支持发生变化时，同一个 PR 更新 `AGENTS.md`、受影响的 Skills 和相应 `docs/`。Skills 版本跟随 Git 提交；重大不兼容行为改动需记录 ADR。禁止仅凭聊天指令长期替代仓库文档。

## 8. 变更记录

| 日期 | 版本 | 内容 |
| --- | --- | --- |
| 2026-11-10 | v1.0 | 定义 DigiwiseStudio 仓库 Skills 的格式、分层、触发、审查与验收规范 |
