# GitHub Actions 自动更新

开发版发布现在是一条完整链路：

```text
推送代码
  ↓
Codeup（唯一代码入口）
  ↓ 云效流水线自动同步
GitHub 镜像仓库
  ↓
GitHub Actions
  ├── macOS Runner 构建 macOS 包
  └── Windows Runner 构建 Windows 包
        ↓
创建 GitHub 开发版 Release
        ↓ Webhook 自动触发
云效流水线
        ↓ 使用云效中已配置的 OSS 服务连接
阿里云 OSS：d-space/DigiwiseStudio/dev/
        ↓
客户端 electron-updater 自动检查并更新
```

业务代码只维护在 Codeup 中，GitHub 只是由云效自动维护的镜像，不需要人工维护第二套代码。
OSS 上传由云效完成，GitHub 只负责构建和生成 Release 资产。

日常只需要把代码推送到 Codeup：

```bash
git push origin codex/integrate-upstream
```

提交后不需要再到云效或 GitHub 手动点击运行。

云效的 `DigiStudio Codeup → GitHub 同步` 流水线监听 Codeup 的代码提交，把
`digitech/DigiwiseStudio` 同步到 `Mixlong/studio` 的同名分支。同步脚本使用云效中已授权的
GitHub 服务连接推送，不在脚本或仓库中保存 GitHub Token。

## 开发版流水线

工作流文件为 `.github/workflows/release-dev.yml`。

- GitHub 镜像收到 `codex/integrate-upstream` 或 `dev` 分支更新后会自动构建开发版。
- 也可以在 GitHub Actions 页面手动运行，并填写版本号，例如 `0.0.14-dev.10`。
- macOS 和 Windows 使用同一个 `RELEASE_VERSION`，避免客户端版本不一致。
- 构建成功后会创建 `digi-dev-版本号` 的 GitHub prerelease。
- 随后自动调用云效 Webhook；云效从该 Release 下载两个平台的资产并上传 OSS。
- OSS 目标目录为 `d-space/DigiwiseStudio/dev/`。

如果手动运行工作流，版本号必须是尚未创建过的开发版版本号，否则 GitHub Release 会明确
报错，避免覆盖已经发布的版本。

## 只需要配置一次的连接

GitHub Actions 调用已有的云效发布 Webhook；Webhook 地址保存到 GitHub 仓库：

`Settings -> Secrets and variables -> Actions -> New repository secret`

Secret 名称必须是：

```text
YUNXIAO_RELEASE_WEBHOOK_URL
```

这个 Secret 只是云效流水线的触发地址，不是 OSS 密钥。云效流水线内部继续使用已有的
`黄江龙的对象存储(OSS)服务连接` 完成上传，因此 GitHub 不需要配置
`OSS_ACCESS_KEY_ID` 或 `OSS_ACCESS_KEY_SECRET`。

Codeup 到 GitHub 的同步流水线使用云效的 GitHub 服务连接完成写入授权；这与 OSS 服务连接
是两条独立连接，代码同步和 OSS 上传互不共享密钥。

云效脚本会优先使用 Webhook 传入的 `RELEASE_TAG`，手动运行云效时则自动选择最新的
`digi-dev-*` GitHub prerelease。这样自动发布和手动补发使用同一套逻辑。

正式版暂不自动发布，后续可以单独增加 Tag 或人工审批工作流，上传到
`d-space/DigiwiseStudio/stable/`。

## macOS 签名与公证

当前仓库在没有 Apple Developer 凭证时会跳过公证，继续生成开发用 macOS 包。若后续需要
正式签名和公证，再在 GitHub Secrets 中配置 `APPLEID`、`APPLEIDPASS` 和 `APPLETEAMID`，
不要把这些值提交到仓库。
