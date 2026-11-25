# AGENTS.md — DigiwiseStudio IDE (studio) AI 协作规范

本文件供所有接入本仓库的 AI Coding Agent（Antigravity、Codex、GitHub Copilot、Claude Code 等）在开工前自动读取。

## 1. 仓库定位与双端联动
- **本仓库**：`Mixlong/studio`（Electron + TypeScript + React 上位机 IDE 客户端，GitHub 远程名通常为 `github`）。
- **配套后台仓库**：`Mixlong/DigiwiseStudio-Admin-Java`（Spring Boot + Vue3 管理后台，双端工作区中通常位于 `../admin-java/`）。
- **统一项目看板**：GitHub Project #1（`DigiwiseStudio · 产品与研发管理`），跨端工单统一维护在 `Mixlong/DigiwiseStudio-Admin-Java` Issues。

## 2. GitHub Project #1 标准状态机（必须遵守）
1. **领单**：从 **`AI 调度看板`** 的 `Todo` 领取任务后，立即将 `Status` 改为 `In Progress`，并在 `Agent` 字段填写自身标识。
2. **遇阻**：需要人类决策、环境/凭据或高风险确认时，立即停手并将 `Status` 改为 `Blocked`、写明 `阻塞原因` 与 `等待环节`（自动进入 **`待人工处理`** 视图）。
3. **提审**：
   - 在独立分支 / 隔离 Worktree 开发并推送至 `github`（`Mixlong/studio`），创建 PR，正文使用 `Refs Mixlong/DigiwiseStudio-Admin-Java#<编号>`（过程关联，**不自动关单**）。
   - 回填 `Mixlong/DigiwiseStudio-Admin-Java` 对应 Issue 评论（修改文件、Commit、PR 链接、实跑测试结果、尚未完成的联调/验收项）。
   - 将 Project #1 中对应条目的 `Status` 改为 `In Review`、`测试` 填实跑结果、`验收` 改为 `待验收`、`等待环节` 改为 `待代码审查` 或 `待产品验收`。
4. **严禁自签收**：TypeScript 编译通过 / 回归测试通过 / PR 创建 **绝不等同于** QA 验收通过或发布；只有人类明确确认验收后才流转至 `Done`。

## 3. 常用构建与验证命令
- **TypeScript 编译**：
  ```powershell
  .\node_modules\.bin\tsc --pretty false
  ```
- **MCP 全量回归测试**：
  ```powershell
  npm run verify-mcp
  ```
- **跨仓库契约校验**：
  ```powershell
  node packages/mcp/test-java-admin-policy-contract.cjs
  node packages/mcp/test-java-model-contract.cjs
  ```

## 4. 红线约束
- 保护现有未提交修改、未跟踪文件与 `codex/client-001` 等已有分支，严禁覆盖或删除他人文件。
- 严禁在代码、日志、PR 或 Issue 评论中提交或泄露任何令牌（Bearer/JWT）、绑定密钥、密码或用户工程原文。
- 严禁未经人类明确授权执行 `git push --force`。
- 严禁擅自更改工单的 `版本`（如将 `Backlog` 改为 `v0.0.1`）或擅自关闭未验收 Issue。
