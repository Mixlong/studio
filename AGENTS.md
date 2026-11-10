# DigiwiseStudio 工程智能体协作规范

> 适用范围：本仓库所有目录。文档基线：`docs/README.md`、`docs/standards/documentation.md`。本文件是持续有效的项目规则；具体工作流程由 `.agents/skills/` 提供。

## 项目事实与边界
- 本仓库包含基于 EEZ Studio 的 Electron 桌面 IDE，涉及 LVGL、Style、工程编辑、MCP 和构建发布。执行任务前先检查实际源码和分支，不能把讨论中的云服务方案当作已实现功能。
- 规划的后台仅供内部员工使用；个人及企业客户通过同一个桌面 IDE 和账号使用个人/组织 Workspace。企业不需要 Web 后台。
- 客户文件必须由后端 Cloud API + 内部 Storage Gateway 流式中转至 Private OSS；**客户端不得接触 OSS AccessKey、STS、预签名 URL 或可直接访问的 OSS 对象地址**。任何与此相冲突的改动须先取得项目方批准。
- 已有 `docs/architecture/digiwise-platform-and-oss.md` 是设计草案。未落实的 Cloud API、数据库、配额、网关及商业功能不得声称已上线。

## 改动前必须执行
1. 确认用户批准的范围、目标分支、代码版本、相关文件与已有文档；不擅自增加功能、不随意覆盖最近调整。
2. 非微小改动先补充/更新书面文档：需求、架构/API/数据模型、兼容性、测试与回滚；与代码一同提交。适用的文档规范：`docs/standards/documentation.md`。
3. 涉及重要架构选择，先记录在 `docs/adr/`，标注“已确认 / 设计建议 / 待验证”。
4. 不能访问用户电脑、云环境或无法运行测试时，明确写“未验证”，绝不虚构测试通过、已部署、已发布或已合并。

## 项目专用 Skills
- `digiwise-docs-first`：文档优先、需求追溯、设计与验收闭环。
- `digiwise-cloud-storage`：后台、个人/企业 Workspace、OSS 安全、配额和上传下载。
- `digiwise-mcp-contracts`：MCP 工具/属性能力覆盖、接口一致性和回归。
- `digiwise-ui-review`：桌面 IDE 主题、图标、属性面板与视觉一致性。
- `digiwise-release-operations`：云效、安装包、Stable/Dev、OSS 与 Electron 更新。

按任务选用匹配 Skill；技能文件是按需加载的工作流，**本文件与 docs 规范不因未自动选中某个 Skill 而失效**。

## 开发和验证底线
- 修改前检查依赖关系、回归范围、迁移与兼容性；优先最小可审查补丁。
- UI 变更不得破坏用户已确认的 Guider 风格、深色/英文默认、图标对齐和属性视觉一致性；不要未经批准增加切换或额外面板。
- MCP 改动必须验证工具清单、真实读写效果、属性序列化与错误响应，不能仅凭工具已注册判断已支持。
- 构建发布必须区分 Stable/Dev、源码版本、构建号与产物路径；不得覆盖不可变历史产物或未经审核触发生产发布。
- 对权限、OSS 和客户数据执行最小权限、服务端鉴权、审计；不能把密钥、真实用户文件或敏感数据写入仓库。

## 任务交付格式
最终报告至少列：改动范围、更新的文档、涉及的代码/配置、真实执行的测试及结果、未验证或待决策事项、提交/PR 地址（如有）。仅写设计文档时明确“未实现”。
