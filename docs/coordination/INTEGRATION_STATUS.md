# DigiwiseStudio 联调状态

> 本文件由 IDE 与 RuoYi 后台窗口共同查看。只记录真实状态、阻塞点和已验证结果，不记录假设完成项。
>
> 更新日期：2026-11-12

## 最新更新：2026-11-12 · IDE 首页「最新变动」动态对接

- 若依「IDE 版本管理」已增加更新内容配置、分类排序、中文/英文编辑与 IDE 预览。
- Java 增加 `GET /api/ide/v1/release/changelog`，按**已安装版本 + 通道 + 语言**读取，而非展示最新灰度版本内容。
- IDE 首页原有硬编码演示内容已移除；主进程 IPC 读取真实 Java Public API，客户端仅缓存精确版本/通道/语言的数据。
- 离线接口/错误缓存校验通过，Java 真实接口多语言/草稿隐藏/错误通道测试通过，全部临时数据已清理；正式版本需要管理员维护真实文案后才会显示。
- 浏览器内管理弹窗操作和 Electron 首页真实视觉仍需手工验收。Java 说明：`DigiwiseStudio-Admin-Java/backend/doc/api/IDE_CHANGELOG_V6.md`。

## 最新更新：2026-11-12 · Java 灰度发布接入

- IDE 主进程已接入 Java 实际的 `/api/ide/v1/release/check`、`/{id}/download`、`/{id}/events`。
- Java 未允许更新、返回异常或账号未登录时，不再使用旧 OSS 更新清单进行版本发现。
- 新增临时本机 `electron-updater` 清单适配、SHA-512 校验、安装前二次授权和新版本启动后成功上报。
- 编译、离线契约/清单测试及 Java 服务未登录/无更新/不存在下载的负向测试通过；尚未完成真实安装包下载和安装回归。
- 生产打包必须注入部署后的 HTTPS `DIGIWISE_IDE_API_BASE_URL`。详细说明见 [IDE_RELEASE_ROLLOUT_INTEGRATION.md](./IDE_RELEASE_ROLLOUT_INTEGRATION.md)。
- 以下 2026-11-11 的“自动更新未开始”属于历史状态，不再作为当前结论。

## 1. 当前范围

本轮只联调以下四项 IDE 能力：

1. 账号登录；
2. 模板列表读取并全量渲染；
3. 下载选定远程模板到用户指定目录并创建本地项目；
4. IDE 自动更新。

不接入旧 `studio-admin` 接口，不使用 Mock，不做用户云存储、BSP、MCP、注册试用和授权码功能。

## 2. 当前状态

| 项目 | 后台窗口 | IDE 窗口 | 联调状态 |
| --- | --- | --- | --- |
| IDE 登录、当前用户、退出 | 验证码和未登录拦截已可用；登录成功、退出和停用场景待测试账号 | 已按契约完成客户端适配；未登录时显示强制门禁 | 待真实账号联调 |
| 模板列表 | RuoYi Controller/Service 已有实现；真实数据、权限及运行时验收待确认 | 已实现主进程 API/IPC 全量分页、新建页卡片字段映射、筛选及加载/错误/空态 | 待真实接口联调 |
| 模板下载 | Controller/Service 与契约已存在；OSS 对象及真实下载待验收 | 已实现指定版本下载、HTTPS 下载、文件大小与 SHA-256 校验、ZIP 安全检查、本地创建及打开 | 待真实接口联调 |
| IDE 自动更新 | 检查接口已定义，更新源待实现 | 已有更新发现与更新器代码，等待接入 | 未开始 |

## 3. 当前阻塞

后台窗口已提交契约：

```text
D:\代码\DigiwiseStudio-Admin-Java\backend\doc\api\ide-public-api.yaml
```

IDE 已读取并按契约实现账号登录所需接口：

```http
GET  /api/ide/v1/auth/captcha
POST /api/ide/v1/auth/login
GET  /api/ide/v1/auth/me
POST /api/ide/v1/auth/logout
```

模板路由已在 RuoYi 源码中实现，契约状态为 `implemented-pending-acceptance`；IDE 模板列表适配已经开始。更新检查仍待后端接口实现：

```http
GET  /api/ide/v1/templates
GET  /api/ide/v1/templates/{templateId}
GET  /api/ide/v1/templates/{templateId}/download
GET  /api/ide/v1/releases/check
```

契约已明确 Token、错误结构、模板文件格式、版本锁定、文件大小、SHA-256、更新包签名/哈希和开发环境地址。

## 4. IDE 侧已知情况

- 当前 IDE 分支：`codex/client-001`。
- 工作区已有用户修改，IDE 窗口不会重置、覆盖或清理无关改动。
- `packages/project-editor/project/ui/Wizard.tsx` 已有本地项目名称、目录和创建流程，可作为远程模板创建的接入点。
- `packages/main/update-discovery.ts` 和 `packages/main/main.ts` 已有更新发现及 `electron-updater` 相关机制，可复用。
- `packages/main/digiwise-auth.ts` 已切换为新版 IDE Bearer 会话，旧网关协议不再使用。
- `packages/main/digiwise-auth-api.ts` 严格校验 `HTTP 2xx + code: OK + data`；不会把 HTTP 200 的 RuoYi `code: 401` 当成成功。
- IDE 根入口未通过服务端会话校验前不创建 Tabs、不恢复本地工程；登出或会话校验失败时停用当前 Tab 并回到登录门禁。
- 启动参数和系统文件打开事件在登录前不会加载工程；拖入文件及新建、导入操作要求有效登录态。

## 5. 下一步

1. 后台窗口提供真实测试账号，验收登录成功、退出和停用场景。
2. 双方联调验证码、登录、`me`、退出和账号停用场景。
3. 用真实账号联调模板列表权限、分页、封面和空列表状态。
4. 联调指定版本下载、`.eez-project`/ZIP 创建、文件完整性校验和目标路径冲突处理。
5. 模板链路验收通过后，再接入 IDE 自动更新。

## 6. 已验证结果

| 日期 | 验证项 | 结果 |
| --- | --- | --- |
| 2026-11-11 | 旧 `studio-admin-preview` 服务 | 已停止并禁用自启动，13001 端口已关闭 |
| 2026-11-11 | 新版 Java 后台 IDE Public API 契约 | 已读取 `ide-public-api.yaml`；验证码和未登录拦截运行时可用 |
| 2026-11-11 | IDE 账号客户端适配 | 已切换新契约，TypeScript 校验通过，未完成真实登录验收 |
| 2026-11-11 | IDE 账号代码静态校验 | `npx tsc --noEmit` 和账号样式 Less 编译均通过 |
| 2026-11-11 | IDE 强制登录门禁 | 已接入根入口及工程恢复时序；本次尚未运行构建或手工 UI 验收 |
| 2026-11-11 | 登录界面统一 | 强制登录门禁与账号弹窗复用品牌头部、卡片与表单规格；浅色/深色 Less 编译通过，尚未做运行时截图验收 |
| 2026-11-11 | 新建页模板列表与远程创建代码 | 已接入分页列表、卡片和过滤状态；创建流程按版本取下载授权，在主进程下载并验证后安全落盘；尚未运行构建或连接真实 OSS 模板验收 |

当前运行时验证：

- `GET /api/ide/v1/auth/captcha` 返回 HTTP 200、`code: OK`，验证码图片和 UUID 均存在；
- 无 Token 请求 `GET /api/ide/v1/auth/me` 返回 HTTP 401、`code: AUTH_REQUIRED`；
- `POST /api/ide/v1/auth/login` 在缺少验证码时返回 HTTP 400、`code: CAPTCHA_REQUIRED`；
- 旧的 `http://127.0.0.1:13003/main/api/v1` 当前返回 HTTP 404，不再作为 IDE 接口使用；
- 还没有使用真实后台账号完成登录、会话恢复和退出验收。
