# Digiwise Admin：NocoBase 3 Core 本地 PoC 搭建手册

- 文档编号：OPS-NOCOBASE3-001
- 版本：v0.1
- 日期：2026-11-10
- 状态：**已提交可执行初始化脚本 / 尚未成功执行安装与登录验收**
- 关联：[Digiwise Admin MVP](../features/digiwise-admin-mvp.md)、[NocoBase 选型 ADR](../adr/0002-nocobase-internal-admin-evaluation.md)、[SFTPGo 架构](../adr/0001-sftpgo-file-plane.md)

## 1. 目标

在 DigiwiseStudio 现有 Git 仓库内，以 **apps/digiwise-admin/** 的独立目录生成 NocoBase 3 Core Beta 应用，用于 AI 编程、验证界面与后台能力。**不会替换 Electron IDE，不修改原有 `npm start`，也不连接生产 OSS。**

NocoBase 3 截至 2026-11-10 仍为 Beta。PoC 与正式生产环境严格分离；不要默认将任何 Beta 版本部署为正式客户的账号与许可后台。

## 2. 环境准备

| 项目 | 本地开发要求 |
| --- | --- |
| Node.js | **24+**（不能用 22） |
| pnpm | **11+** |
| Windows | 推荐 WSL + Bash |
| macOS/Linux | 原生 Bash |
| 网络 | 能访问 pnpm/npm Registry，首次安装会下载依赖 |
| 数据库 | 首次 PoC 使用 SQLite（官方模板默认驱动），正式环境建议独立 PostgreSQL |
| Docker | 本地生成和开发**不强制需要** Docker；部署时按官方生成的 Dockerfile 使用 Docker |

从仓库根目录先确认环境：

```bash
node --version
pnpm --version
```

## 3. 一键生成与初始化（测试环境）

```bash
# 仓库根目录
bash tools/admin/bootstrap-nocobase3.sh

# 新窗口（或脚本完成后）
cd apps/digiwise-admin
pnpm dev
```

脚本行为：
1. 校验 Node 24+/pnpm 11+；若已有 `apps/digiwise-admin` 目录则停止，不覆盖。
2. 执行官方创建指令 `PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 pnpm create @nocobase/app@beta digiwise-admin --template-tag=beta`。
3. 执行 `pnpm nocobase config init --dialect sqlite --json`，生成**本地私有** `config.yml`。
4. 执行 `pnpm nocobase config check --connect`。初始化成功并不代表全部业务已开发或安全验收通过。

NocoBase 首次启动打印包含 `/main/` 的本地 URL，**以终端显示的真实地址为准**。官方默认演示账号通常为 `nocobase / admin123`，只用于本机隔离 PoC；应在任何可访问的网络部署前修改密码，不得将默认账号用于生产。

从仓库根目录检查：

```bash
bash tools/admin/verify-nocobase3.sh
```

**当前状态**：脚本已编写，但这里没有运行 Node 24 和 pnpm 11，也没有安装 NocoBase 3 或测试浏览器登录。只有执行并完成检查后才能标记“安装成功”。

## 4. AI 开发流程

创建应用后，在 `apps/digiwise-admin` 目录运行 Codex/Claude Code；官方 NocoBase 3 Skill 可在本地按官方指南安装（外部工具安装需执行者确认），同时遵循根目录 `AGENTS.md` 及 `.agents/skills/digiwise-nocobase-admin/SKILL.md`。

先依据 `docs/features/digiwise-admin-mvp.md` 完成：
- 企业管理表单与列表；
- 用户/邮箱申请审核状态；
- Personal/Organization Workspace 管理；
- 配额/席位/授权策略；
- 文件开通任务的状态与审核操作。

**不要**一开始就连接真实 SFTPGo Admin API 或生产 OSS。先用本地隔离 Mock 验证状态机、权限和幂等，再接测试 SFTPGo。

## 5. PostgreSQL 环境的正确做法

正式架构拟使用 PostgreSQL，但**已初始化的 SQLite 实例不会因改掉 config.yml 自动迁移到 PostgreSQL**。为了避免产生无法验证的配置，当前脚本只生成本机 SQLite PoC。

为一个**新的空应用**使用 PostgreSQL 时，按官方 NocoBase 3 指南：

```bash
# 在尚未生成 config.yml 的全新应用目录内
pnpm add @nocobase/db-postgres@beta
pnpm nocobase config init --dialect postgres --json
# 编辑生成的 config.yml 中数据库 host/database/username/SSL；
# 密钥使用服务端环境变量或安全的凭据管理服务
pnpm nocobase config check --connect
pnpm dev
```

实际数据库需要已创建并为专用账号授予受限 schema 的读写和迁移权限。不要提交 `config.yml`，不要复用 DigiwiseStudio 工程数据库或迪太云生产数据库。

## 6. Docker 部署原则（阶段二）

NocoBase 3 Core **不是** NocoBase 2.x 的 `nocobase/nocobase:latest` Docker 使用方式。先由 `pnpm create @nocobase/app@beta` 生成包含 Dockerfile 的独立应用源码，运行测试通过后，从该源码构建镜像。具体构建与部署参考官方 https://docs.nocobase.com/core/tutorials/deploy-with-docker/ 。

不得直接公开 NocoBase Admin 或 SFTPGo Admin API。所有管理员入口必须具备 HTTPS、独立认证、最小权限、审计及网络策略；生产部署必须固化镜像摘要/版本和数据库备份。SFTPGo/OSS 的端到端配置属于后续独立步骤。

## 7. 验收项目

- [ ] Node 24+ 和 pnpm 11+ 满足；
- [ ] 自动生成独立应用目录与锁文件；
- [ ] 初始化成功，`config.yml` 和本地数据库没有提交 Git；
- [ ] 配置检查 `--connect` 通过；
- [ ] `pnpm dev` 输出实际 URL，浏览器能完成管理员登录；
- [ ] 创建并读取测试企业记录，刷新后仍存在；
- [ ] 非管理员不能执行企业开通和配额调整；
- [ ] 中断与重启后应用数据仍可读取；
- [ ] Desktop `npm start` 行为未改变；
- [ ] 未暴露 OSS 凭据或 SFTPGo Admin Key；
- [ ] Beta 版本、依赖锁文件和测试结果已记录。

## 8. 官方资料

- https://docs.nocobase.com/core/getting-started/create-app/
- https://docs.nocobase.com/core/getting-started/create-app-with-database/
- https://docs.nocobase.com/core/tutorials/deploy-with-docker/
- https://docs.nocobase.com/core/developing-apps/testing-and-acceptance/

## 9. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-11-10 | v0.1 | 建立 NocoBase 3 Core 应用初始化脚本、本地开发与验证手册 |
