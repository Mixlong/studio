# DigiwiseStudio IDE 灰度更新接入（2026-11-12）

## 当前实现

Electron 主进程在 **打包应用**启动且 IDE 登录态有效时，统一请求 Java 灰度服务；`npm start` 不执行实际安装。用户切换或退出账号后，将关闭本地更新源。每六小时尝试重新检查一次（仅在有效登录状态下）。

服务端实际接口（注意：是单数 `release`）：

- `GET /api/ide/v1/release/check?currentVersion=...&channel=stable|dev&platform=win32|darwin&arch=x64|arm64&clientId=...`
- `GET /api/ide/v1/release/{id}/download?platform=...&arch=...&assetType=installer&clientId=...`
- `POST /api/ide/v1/release/{id}/events`：仅在启动安装失败时上报 `install_error`，并在安装成功后的新版本首次授权登录时上报 `install_success`。后端在颁发下载 URL 时自己记录 `download`。

Java 的实际返回是 `hasUpdate`、`forceUpdate`、`release.asset`，**不是旧文档中的** `updateAvailable`、`release.feedUrl`。本实现遵循实际已部署 Java API，并严格检查版本、平台、文件名、大小、SHA-256、SHA-512、HTTPS 签名地址、过期时间与 release ID 一致性。

## 安全更新流程

1. 已登录用户 → Java 判断灰度白名单、比例、通道、版本。
2. `hasUpdate: false` / HTTP 401 / 接口报错 → 不进入下载，**不回退到旧 OSS latest.yml 或 release.json**。
3. 命中更新 → 第二次向 Java 请求经过灰度复核的短期 OSS 安装包下载 URL。
4. Electron 本机 `127.0.0.1` 随机端口生成一次性 `latest.yml`（macOS 为 `latest-mac.yml`）；里面只有**后台批准的版本、文件大小及 SHA-512**。更新器仅通过随机路径访问此清单，安装包地址仅以临时 302 重定向映射到后台签名 URL；不向更新器泄露 IDE Bearer Token。
5. 关闭差分下载与 Web 安装器，下载完整安装包并由 `electron-updater` 验证哈希，Windows 的原有签名校验、macOS 安装辅助程序仍执行既有流程。
6. 下载后、用户真正点击安装前，**再次调用 Java 检查是否仍命中同一版本**。若已暂停发布/撤销账号授权/切换账号，不执行安装。
7. 下载完成不等于安装成功。只在重启后识别运行的新版本且已登录原用户时，才提交 `install_success`；如果断网则保存本机非敏感事件标记，下次登录继续尝试。失败上报 `install_error`。

## 打包部署配置（必需）

用环境变量 `DIGIWISE_IDE_API_BASE_URL` 指定**实际部署的 HTTPS 地址**，例如 `https://<部署域名>/api/ide/v1`。运行 `npm run build` 时 `make-electron-builder-yml` 任务会将地址写入 `build/main/ide-public-api.json`，打包时随 `build/**` 包含。不得将开发机 `http://127.0.0.1:18080` 写入生产包。

若未配置生产 API 地址，打包程序的登录和更新均拒绝操作，这是预期的 fail-closed 行为。当前未提供实际域名，因此**还没有生成可以正式部署的生产包**。本项目保留老的 OSS 构建产物上传流程，但新版本的 IDE 客户端不再直接扫描 OSS 决定升级；**尚未升级的旧客户端仍需通过旧通道过渡，不能由新代码远程改变旧客户端逻辑**。

## 当前边界与验收

- **已完成并验证**：TypeScript 编译、Java API URL/Token 传参模拟、授权/拒绝/异常处理、清单 YAML 与 electron-updater 解析兼容、localhost 临时清单只指向获授权文件、hash/版本/文件名/到期校验，以及 Java 真实环境的未登录 Dev 401、Stable 无更新结果、无效下载 404。
- **未完成真实端到端**：尚无已发布的真实安装包/测试账号/生产 HTTPS 域名，不能验证 OSS 实际字节下载、macOS 与 Windows 安装、成功后新进程上报。
- **格式限制**：当前 Java 上传端允许多种安装格式；Electron 当前实现只接受 Windows `.exe` 和 macOS `.zip`。若管理员上传 .msi、.dmg 或 .pkg 为 installer，此 IDE 将拒绝更新而非绕过校验。Linux 与 Windows ia32 暂未纳入新 Java 端点支持。
- **版本规则**：Java 目前仅按严格 SemVer 新旧版本比较。相同 SemVer 但不同 Build Number 的替换发布不在本轮灰度更新能力内。

离线回归：`npm run verify-java-rollout`（自动 TypeScript 编译并执行清单/契约测试）。

## 相关源码

- `packages/main/digiwise-release-updater.ts`：完整授权、更新器、安装与上报调度。
- `packages/main/digiwise-update-policy.ts`：服务端数据与下载 URL 严格校验。
- `packages/main/digiwise-update-feed.ts`：随机路径、回环地址的受控 feed。
- `packages/main/digiwise-auth-api.ts`：Java 灰度 API 请求。
- `packages/main/digiwise-auth.ts`：主进程独立 IDE 会话和账号切换通知。
- `tools/verify_java_rollout_integration.cjs`：离线回归用例。
