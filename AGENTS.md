# DigiwiseStudio 开发 AI 协作规则

本仓库是 **DigiwiseStudio Electron 桌面客户端**；独立后台仓库是 [Mixlong/studio-admin](https://github.com/Mixlong/studio-admin)（Private）。两个对话/Agent **不会彼此实时共享聊天记录**，必须以 GitHub Issue、仓库提交和 OpenAPI 作为交接事实，不得凭对话声称其他 Agent 已完成工作。

## 每次接任务先读
1. [共同任务板](https://github.com/Mixlong/studio/issues)：#2 COORD-001、#3 CLIENT-001、#4 ADMIN-001、#5 LICENSE-001、#6 INT-001。更新的任务记录高于历史聊天摘要。
2. [协作总计划](docs/coordination/MASTER_PLAN.md)、[任务状态](docs/coordination/TASK_STATUS.md)、[API 变更日志](docs/coordination/API_CHANGELOG.md)。
3. [公共 API 草案](contracts/openapi.yaml)；任何端点/字段变动先更新契约并在 #2 留说明，然后两端同步。
4. 开始前检查本仓库 Git 分支、工作区和已有代码。不可把尚未实现的设计标成已上线。

## 项目边界
- Desktop 的工作：注册/登录/试用倒计时/授权码输入、受控主进程 SDK 与 Mock、离线状态 UI；本仓库不开发后台业务表。
- Digiwise Public API 提供服务端邮箱身份、试用、授权/企业许可、Workspace 和配额。不能直接以 NocoBase 管理身份调用后台。
- SFTPGo User API 承载客户文件；客户端不能得到 OSS Key、STS、预签名直链、SFTPGo Admin Key，也不能调用 SFTPGo Admin API。
- 试用期由服务端 UTC 时间及不可重复的试用记录决定，客户端本地时间仅展示，不得自行判定激活成功。
- 本地工程和本地编辑/编译在云服务不可用时应尽量保持；正式许可策略尚待产品确认，不要默认锁死或删除本地文件。
- 不擅自改变已确定的 Guider 风格、深色/英文桌面 IDE 基线、LVGL/MCP/更新链路。后台简体中文默认不代表桌面 IDE 语言策略变更。

## 并行协作与完成标准
- 任务必须写明 Issue 编号、负责仓库、契约版本/commit、影响路径和验收标准。
- 一端可用 Mock 独立开发，但标记 `mock`，真实联调通过才能标记 `integrated`。
- 提交 PR 时关联 Issue；在 Issue 评论写明：commit/PR、已实现接口、测试命令与真实结果、阻塞/下一步。禁止凭未运行的测试宣称通过。
- 对外 API 的 `breaking` 变更：先更新 `contracts/openapi.yaml` 和 #2，再通知后台 AI 更新镜像契约和 SDK，签约后才改实现。
- 不将用户凭据、私有存储路径、客户数据、密钥写入仓库或日志。

> 跨仓库任务流以 GitHub 为事实来源；本地文件作为引用索引。仓库配置、代码和发布流程未经单独授权不得改动生产环境。
