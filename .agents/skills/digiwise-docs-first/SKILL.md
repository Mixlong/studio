---
name: digiwise-docs-first
description: Use when planning, implementing, fixing, or reviewing DigiwiseStudio features, architecture, APIs, database schemas, MCP interfaces, UI, builds, or releases that need formal project documentation. Do not use for unrelated general questions or trivial text-only requests.
---

# DigiwiseStudio 文档优先开发流程

## 工作目标
实现“已确认需求 → 书面设计 → 最小实现 → 验证 → 文档更新 → PR”的闭环。先阅读仓库根目录 `AGENTS.md`、`docs/README.md` 和 `docs/standards/documentation.md`，按任务读取相应设计文档。

## 必须步骤
1. **确认事实**：检查仓库、当前分支、源代码、现有 docs、用户明确批准的范围。将现有实现和未来规划分开。
2. **写设计记录**：新增/更新 `docs/features/`、`docs/architecture/`、`docs/api/`、`docs/database/` 或 `docs/operations/`。写清目标、非目标、兼容性、数据流、失败/回滚与可验证的验收标准。
3. **重大决定写 ADR**：无法回退的架构选择、数据归属模型、更新通道或安全边界，记录候选、权衡、决定和迁移方案。
4. **实施前审查**：发现设计超出需求时不要自行增加功能；标为“设计建议 / 待批准”。未得到授权不修改生产环境。
5. **实施与测试**：按最小范围改动；运行合适的静态检查、单元/集成/端到端测试。无法使用工具时明确未测试及原因。
6. **闭环归档**：将源码/配置路径、接口契约、迁移步骤、测试结论、缺陷与 PR 记录回写文档；更新 `docs/README.md` 索引。

## 文档内容最低要求
- 编号、版本、状态（已确认/设计建议/待验证/已实现）、日期。
- 需求依据及范围、架构或流程图（适用时 Mermaid）、API/Schema。
- 安全与异常、兼容性与回滚、具体验收用例、变更记录。
- 不包含密钥、真实客户文件、私人账号数据或无依据的完成声明。

## 示例触发
- “完善 MCP 图标属性并验证” → 先查接口及现有文档，写能力矩阵与测试计划，再实施。
- “设计后台与 OSS 配额” → 阅读 `docs/architecture/digiwise-platform-and-oss.md`，更新设计，不声称已部署。

## 不适用
只要求概念解释、泛泛推荐或与仓库无关的话题时，不创建文件、不声称执行了项目变更。

## 交付格式
说明文档路径、代码/配置变更、实际验证、未验证事项、PR/提交链接。只写方案时明确“仅文档，无运行功能改动”。
