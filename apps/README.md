# Digiwise Admin — 独立后台应用

本目录用于存放 **NocoBase 3 Core** 生成的 Digiwise Admin 应用源码。DigiwiseStudio Electron IDE 仍从仓库根目录的 `npm start` 运行，两者不共用启动命令或依赖目录。

NocoBase 官方 3.x 创建命令会在本目录生成 `digiwise-admin/`，该目录目前**不是已经运行的服务**。

## 创建

从仓库根目录执行：

```bash
bash tools/admin/bootstrap-nocobase3.sh
cd apps/digiwise-admin
pnpm dev
```

需要 Node.js 24+、pnpm 11+；Windows 通过 WSL 运行。脚本默认 SQLite 用于本机 PoC，NocoBase 配置文件及数据不得提交到 Git。正式 PostgreSQL 部署需独立初始化、备份与评审，不得直接切换已有 SQLite 配置并假设数据会迁移。

详细步骤见 [NocoBase 3 本地搭建手册](../docs/operations/nocobase3-local-poc.md)，首期模块见 [Digiwise Admin MVP](../docs/features/digiwise-admin-mvp.md)。

客户的云文件服务通过 SFTPGo，真实文件保存到 Private OSS。NocoBase 管理 UI 不公开给桌面客户。
