# GitHub Actions 自动更新

当前发布方案使用一套代码、两类 GitHub Runner：

```text
GitHub 仓库
├── macOS Runner    -> npm run release:dev:mac
└── Windows Runner  -> npm run release:dev:win
                         ↓
                 Ubuntu 上传任务 -> 阿里云 OSS
```

业务代码只维护在 GitHub 仓库中，不需要再维护一份独立的 macOS 代码。

## 开发版流水线

工作流文件为 `.github/workflows/release-dev.yml`。

- 推送 `codex/integrate-upstream` 或 `dev` 分支会自动构建开发版。
- 也可以在 GitHub Actions 页面手动运行，并填写版本号，例如
  `0.0.14-dev.10`。
- macOS 和 Windows 使用同一个 `RELEASE_VERSION`，避免客户端版本不一致。
- OSS 目标目录为 `d-space/DigiwiseStudio/dev/`。

正式版暂不自动发布，后续可以单独增加 Tag 或人工审批工作流，上传到
`d-space/DigiwiseStudio/stable/`。

## GitHub Secrets

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中添加：

- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`

这两个值只用于上传 OSS，不要写入代码、工作流文件或提交记录。建议使用仅允许访问
`bikewise` 目标目录的 RAM 凭证。GitHub Actions 不会自动读取云效中已经创建的 OSS
服务连接，因此需要单独配置 GitHub Secrets。

## macOS 签名与公证

当前仓库在没有 Apple Developer 凭证时会跳过公证，继续生成开发用 macOS 包。若后续需要
正式签名和公证，再在 GitHub Secrets 中配置 `APPLEID`、`APPLEIDPASS` 和 `APPLETEAMID`，
不要把这些值提交到仓库。
