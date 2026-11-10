# 双 AI 任务索引（GitHub Issues 才是实时状态）

最后核对：2026-11-10。**本文件仅记录初始化快照，不替代 Issue/PR。** 每次接任务请实时读取以下链接；不要仅根据快照判断是否完成。

| ID | 项目 | GitHub 任务 | 初始化状态 | 需更新的内容 |
| --- | --- | --- | --- | --- |
| COORD-001 | 双端 | [#2](https://github.com/Mixlong/studio/issues/2) | 待评审 | OpenAPI 版本与两端一致性 |
| CLIENT-001 | `Mixlong/studio` | [#3](https://github.com/Mixlong/studio/issues/3) | 未开发 | 客户端 PR/Mock 测试/联调 |
| ADMIN-001 | `Mixlong/studio-admin` | [#4](https://github.com/Mixlong/studio/issues/4) | 未开发 | 后端迁移/API/权限测试 |
| LICENSE-001 | 双端 | [#5](https://github.com/Mixlong/studio/issues/5) | 未开发 | 兑换/企业席位/审计 |
| INT-001 | 双端 | [#6](https://github.com/Mixlong/studio/issues/6) | 未开始 | API 兼容性/E2E/安全验收 |

## 状态词表
`planned` → `in_progress` → `mock_ready` 或 `api_ready` → `integrated` → `verified`。
阻塞用 `blocked` 并注明原因。Issue 评论记录真实证据；关闭 Issue 前需有验收记录和关联 PR。

## 交接评论模板
```md
Task: CLIENT-001 | ADMIN-001 | ...
Repository/Branch:
Contract: OpenAPI version / commit SHA:
Status: planned | in_progress | mock_ready | api_ready | integrated | verified | blocked
Changed files / PR:
Verified commands and actual results:
Incompatibilities / API changes:
Handoff to the other AI:
```

注意：`studio-admin` 是独立私有仓库；不应公开其源代码或把客户数据复制到本公开任务仓库的 Issue。
