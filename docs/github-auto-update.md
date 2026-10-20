# GitHub 构建、云效上传自动更新

当前发布方案使用一套代码、两类 GitHub Runner：

```text
GitHub 仓库
├── macOS Runner    -> npm run release:dev:mac
└── Windows Runner  -> npm run release:dev:win
                         ↓
                 GitHub 临时 Release
                         ↓
                 云效流水线下载并上传 OSS
```

业务代码只维护在 GitHub 仓库中，不需要再维护一份独立的 macOS 代码。
GitHub 不直接连接 OSS，也不保存 OSS AccessKey。

## 开发版流水线

工作流文件为 `.github/workflows/release-dev.yml`。

- 推送 `codex/integrate-upstream` 或 `dev` 分支会自动构建开发版。
- 也可以在 GitHub Actions 页面手动运行，并填写版本号，例如
  `0.0.14-dev.10`。
- macOS 和 Windows 使用同一个 `RELEASE_VERSION`，避免客户端版本不一致。
- OSS 目标目录为 `d-space/DigiwiseStudio/dev/`。
- 构建完成后，GitHub 会生成一个临时预发布版本：
  `digi-dev-<RELEASE_VERSION>`。
- 临时 Release 只用于把 macOS/Windows 构建结果交给云效，不是客户端最终更新地址。

正式版暂不自动发布，后续可以单独增加 Tag 或人工审批工作流，上传到
`d-space/DigiwiseStudio/stable/`。

## 云效流水线配置

云效流水线使用 GitHub 代码源或 Webhook 触发，触发版本为：

```text
digi-dev-0.0.14-dev.10
```

在云效构建任务中执行：

```bash
export RELEASE_TAG=digi-dev-0.0.14-dev.10
./scripts/fetch-github-dev-release.sh
```

脚本会把 GitHub 临时 Release 解压到：

```text
release-oss/DigiwiseStudio/
├── dist-mac/
└── dist-win-x64/
```

然后在云效流水线添加“OSS 上传”步骤：

| 配置项 | 值 |
| --- | --- |
| 服务连接 | 云效中已有的 OSS 服务连接 |
| Bucket 地域 | `华南1（深圳）` |
| Bucket | `bikewise` |
| Bucket 目录 | `d-space/DigiwiseStudio/dev` |
| 源文件目录 | `release-oss/DigiwiseStudio` |

云效的 OSS 服务连接负责授权，GitHub 仓库不需要配置
`OSS_ACCESS_KEY_ID` 或 `OSS_ACCESS_KEY_SECRET`。

如果仓库设置为私有，需要在云效中配置 GitHub 代码源/下载凭证；如果仓库公开，脚本可以直接下载
临时 Release。客户端最终仍然只从 OSS 的公开 HTTPS 地址下载更新。

## macOS 签名与公证

当前仓库在没有 Apple Developer 凭证时会跳过公证，继续生成开发用 macOS 包。若后续需要
正式签名和公证，再在 GitHub Secrets 中配置 `APPLEID`、`APPLEIDPASS` 和 `APPLETEAMID`，
不要把这些值提交到仓库。
