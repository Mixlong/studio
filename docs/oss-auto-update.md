# OSS 自动更新发布

DigiStudio 使用 `electron-updater` 从 OSS 的公开 HTTPS 目录检查更新。当前工作区的
默认更新根目录是：

```text
https://bikewise.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio/
```

构建时可以用 `EEZ_UPDATE_URL` 覆盖这个地址，用于其他项目或发布通道。

## 开发版和正式版双通道

开发阶段建议在同一个 Bucket 下使用两个目录，不需要创建两个 OSS Bucket：

```text
d-space/DigiwiseStudio/dev/       # 开发版
d-space/DigiwiseStudio/stable/    # 正式版
```

项目提供了带通道保护的发布命令。命令会自动把更新地址写入打包文件，避免开发版
误指向正式版：

```bash
# 开发版
npm run release:dev
npm run release:dev:mac
npm run release:dev:win
npm run release:dev:win-ia32

# 正式版（建议只由 Tag 或手动审批触发）
npm run release:stable
npm run release:stable:mac
npm run release:stable:win
npm run release:stable:win-ia32
```

命令默认使用当前项目的 OSS 根地址。如果 OSS Bucket 或路径不同，可以在云效流水线中
设置 `EEZ_UPDATE_ROOT`，例如：

```text
EEZ_UPDATE_ROOT=https://<your-public-domain>/d-space/DigiwiseStudio
```

云效 Flow 的 OSS 上传步骤配置如下：

| 流水线 | 触发方式 | 上传源目录 | OSS 目标目录 |
| --- | --- | --- | --- |
| DigiStudio-Dev | 开发分支 Push | `release-oss/DigiwiseStudio/` | `d-space/DigiwiseStudio/dev/` |
| DigiStudio-Stable | Tag 或手动审批 | `release-oss/DigiwiseStudio/` | `d-space/DigiwiseStudio/stable/` |

开发流水线会更新同名的 `latest*.yml` 最新版本指针，但安装包和 `blockmap` 文件名带版本号，
历史版本会在 OSS 中叠加保留；正式流水线只在测试通过后上传。
`latest*.yml`、安装包和 `blockmap` 都必须允许客户端匿名读取。

旧的 `release:patch*` 命令仍保留兼容，继续使用原来的根目录；采用双通道后，云效流水线
应改用 `release:dev*` 或 `release:stable*`，不要混用。

如果需要覆盖默认 OSS 根地址，使用 `EEZ_UPDATE_ROOT`，不要直接手工拼接开发或正式目录；
发布命令会自动追加 `/dev/` 或 `/stable/`。

版本号默认使用 `npm version patch` 递增。云效每次从干净工作区构建时，建议显式设置
`RELEASE_VERSION`，避免不同流水线运行生成相同版本：

```text
# 开发版示例：使用云效流水线的递增构建编号替换 <build-number>
RELEASE_VERSION=0.0.14-dev.<build-number>

# 正式版示例：由发布人或 Tag 提供明确版本
RELEASE_VERSION=0.1.0
```

如果 macOS、Windows x64 和 Windows ia32 分开构建，所有构建机必须使用同一个
`RELEASE_VERSION`，只在第一台构建机上递增或指定版本。

版本从 `0.0.1` 开始。`0.0.01` 不是合法的 SemVer 版本，不能用于 electron-builder。

## 一键构建命令

每次命令会先把 patch 版本号加一，再重新构建源码和安装包：

```bash
# macOS + Windows x64 + Windows ia32，要求当前环境支持三个平台的构建
npm run release:patch

# 单独构建 macOS
npm run release:patch:mac

# 单独构建 Windows x64
npm run release:patch:win

# 单独构建 Windows ia32
npm run release:patch:win-ia32
```

不要在 macOS 和 Windows 上都执行 `release:patch`，否则版本号会递增两次。
如果分别构建，先只在一个环境执行版本递增命令，另一个环境使用同一份代码和版本号构建。

一键构建完成后，原始产物分别位于：

```text
dist-mac/
dist-win-x64/
dist-win-ia32/
```

同时会生成可直接上传的目录：

```text
release-oss/DigiwiseStudio/
├── dist-mac/
│   ├── latest-mac.yml
│   ├── DigiStudio-0.0.14-dev.10-arm64.dmg
│   ├── DigiStudio-0.0.14-dev.10-arm64.zip
│   └── DigiStudio-0.0.14-dev.10-arm64.zip.blockmap
├── dist-win-x64/
│   ├── latest.yml
│   ├── DigiStudio-0.0.14-dev.10-x64-setup.exe
│   └── DigiStudio-0.0.14-dev.10-x64-setup.exe.blockmap
└── win-ia32/
    ├── latest.yml
    ├── DigiStudio-0.0.14-dev.10-ia32-setup.exe
    └── DigiStudio-0.0.14-dev.10-ia32-setup.exe.blockmap
```

在 OSS 控制台进入 `d-space/`，把本地的整个 `release-oss/DigiwiseStudio/`
目录上传进去。最终远程路径应是：

```text
d-space/DigiwiseStudio/dist-mac/latest-mac.yml
d-space/DigiwiseStudio/dist-win-x64/latest.yml
d-space/DigiwiseStudio/win-ia32/latest.yml
```

这三个平台目录需要保留，不能把文件混到 `DigiwiseStudio/` 根目录，也不要把目录改名为
`DigiStudio`；应用配置访问的是精确的 `d-space/DigiwiseStudio/`。

## 客户端如何判断更新

客户端不会读取 OSS 的网页目录，也不会比较安装包文件名。打包时把
`EEZ_UPDATE_URL` 写入应用的更新配置；应用启动后会请求对应目录下的平台元数据：

```text
macOS        -> dist-mac/latest-mac.yml
Windows x64  -> dist-win-x64/latest.yml
Windows ia32 -> win-ia32/latest.yml
Linux        -> dist-linux/latest-linux.yml
```

元数据中包含最新版本号、安装包文件名、文件大小和 sha512。客户端发现元数据中的
版本高于当前版本后，才会下载对应安装包。因此手动上传时必须同时上传元数据和它引用
的安装包，不能只上传一个新的 `.dmg` 或 `.exe`。

安装包和 `blockmap` 文件名包含版本号，发布时不会覆盖历史版本；只有用于指向当前版本的
`latest*.yml` 会被更新：

```text
DigiStudio-0.0.14-dev.10-arm64.zip
DigiStudio-0.0.14-dev.10-arm64.dmg
DigiStudio-0.0.14-dev.10-x64-setup.exe
DigiStudio-0.0.14-dev.10-ia32-setup.exe
```

`latest*.yml` 中仍然保留版本号，客户端通过它判断是否更新。

应用启动后会自动检查更新。发现新版本时会弹出下载提示，下载完成后会弹出
“立即重启”或“稍后”选项。没有更新时不会弹窗，但主进程日志会记录检查地址和
当前版本。

当前 macOS 内部分发方式与 UniMaster 保持一致：没有 Apple Developer 证书时也允许
生成 adhoc 签名包，并通过 `立即重启` 执行替换。此方式适合已手动安装过 DigiStudio
的受控设备，但不等同于 Apple 官方签名和公证，首次安装仍可能被 Gatekeeper 提示。

adhoc 包不会交给 Squirrel.Mac 替换。DigiStudio 下载并校验 ZIP 后会启动独立更新助手，
等待当前进程退出，再备份和替换 `.app`；替换失败会恢复旧应用，成功后重新打开新版。
更新助手日志位于 macOS 用户日志目录下的 `mac-update-helper.log`。

macOS 发布机需要在钥匙串中安装 `Developer ID Application` 证书，并配置：

```text
APPLEID=<Apple ID>
APPLEIDPASS=<App 专用密码>
APPLETEAMID=<Apple Team ID>
```

macOS 发布命令固定使用 `electron-builder-mac.yml`。上述公证变量是可选的：全部配置时
执行 Apple 公证，没有配置时跳过公证并继续生成内部分发更新包。

## 本地构建和手动上传

在执行构建命令时配置变量：

```text
EEZ_UPDATE_URL=https://bikewise.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio/
```

构建命令：

```bash
npm ci
EEZ_UPDATE_URL=https://bikewise.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio/ npm run dist-oss
```

`dist-oss` 会清理旧的 `dist/`、生成源码和样式、注入 OSS 更新地址，最后只在本地
生成安装包和更新元数据，不会向 OSS、GitHub 或云效自动上传。它会按执行机选择发布目标：
macOS 生成 DMG/ZIP，Windows 生成 NSIS，Linux 使用项目配置中的 Linux 目标。

Windows 32 位构建使用：

```bash
EEZ_UPDATE_URL=https://bikewise.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio/ npm run build
npx electron-builder --win --ia32 --publish never
```

客户端运行在 Windows `ia32` 时会自动请求：

```text
https://bikewise.oss-cn-shenzhen.aliyuncs.com/d-space/DigiwiseStudio/win-ia32/latest.yml
```

执行完成后，直接上传 `release-oss/DigiwiseStudio/` 目录中的内容。不要把
`release-oss` 或 `dist/` 作为额外层级上传，否则更新元数据中的文件路径会不匹配。

例如更新地址是：

```text
https://download.example.com/digistudio/
```

那么 `release-oss/DigiwiseStudio/dist-mac/latest-mac.yml` 上传后应该可以直接通过下面的地址访问：

```text
https://download.example.com/digistudio/dist-mac/latest-mac.yml
```

OSS 目录中至少应包含：

```text
dist-mac/latest-mac.yml
dist-mac/DigiStudio-*.dmg
dist-mac/DigiStudio-*.zip
dist-win-x64/latest.yml
dist-win-x64/DigiStudio-*.exe
win-ia32/latest.yml
win-ia32/DigiStudio-*.exe
dist-linux/latest-linux.yml
dist-linux/DigiStudio-*.AppImage
```

每次发布新版本时，更新对应平台的 `latest*.yml`，并把新的带版本号安装包和 blockmap
上传到同一平台目录。应用会从这些元数据读取版本、文件名、大小和校验值；旧版本文件
无需删除，可用于回滚或历史下载。

更新器允许降级。如果需要回退到旧版本，重新构建并上传较低版本号的完整发布文件，
包括安装包、blockmap 和 `latest*.yml`。上传完成后，客户端会把 OSS 上的低版本当作
可用更新并覆盖安装。

## OSS 访问要求

- `EEZ_UPDATE_URL` 必须是客户端可以访问的 HTTPS 公网地址。
- 各平台目录下的 `latest*.yml`、安装包和对应的 blockmap 文件必须可匿名读取。
- `latest*.yml` 使用短缓存或不缓存；安装包和 blockmap 可以使用长期缓存。
- 如果 OSS 绑定了 CDN，刷新或缩短 `latest*.yml` 的缓存，否则客户端可能继续看到旧版本。

## 发布前检查

上传后从公网检查：

```bash
curl -I https://<public-domain>/digistudio/dist-win-x64/latest.yml
curl -I https://<public-domain>/digistudio/dist-mac/latest-mac.yml
curl -I https://<public-domain>/digistudio/win-ia32/latest.yml
```

返回 `200` 后，再用旧版本安装包启动 DigiStudio，观察自动更新日志中是否出现
`[auto-update] Update available` 和 `Update downloaded`。
