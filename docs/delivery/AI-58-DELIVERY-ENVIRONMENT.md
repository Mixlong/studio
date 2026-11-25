# AI-58 真实安装升级、后台联调与设备验收环境

日期：2026-11-19（CST）
任务：AI-58
范围：隔离环境、可追溯制品、联调前置和设备验收清单。
边界：不部署、不发布、不改生产；本文件不构成发布批准。

## 1. 当前结论

已整理可直接交给 AI-56 QA、AI-57 安全使用的隔离执行基线。当前可以进行本机 Java/API/Redis/对象存储前置检查、IDE 契约联调和本地 Middleware 协议验证；不能把这些检查写成真实安装、真实 OSS 下载、PIO 编译或设备烧录通过。

阻塞真实闭环的资源及解除条件：

| 资源 | 当前状态 | 负责人 | 解除条件 |
|---|---|---|---|
| 独立 IDE 测试账号（可登录、退出、停用） | 未提供；禁止在文档或命令中写凭证 | 后台/产品 | 提供隔离用户名、人工输入验证码和可停用测试身份；禁止使用生产账号或默认密码 |
| Java Public API | 本机入口已明确：`http://127.0.0.1:18080/api/ide/v1` | 后台 | `start-all.ps1 -NoBrowser` 后健康检查通过；真实接口测试需账号 |
| Redis/数据库 | 本机 WSL 私有桥接：Redis `127.0.0.1:16379`，MySQL `127.0.0.1:13306` | 后台/运维 | `+PONG`、TCP 连通，且 Java API 返回业务成功 |
| 对象存储/OSS | 未配置真实凭证和可验收文件 | 后台/运维 | 上架一份隔离模板/BSP/安装包，返回短期 HTTPS URL、大小、SHA-256；用完清理 |
| 生产 HTTPS API 域名 | 未提供 | 后台/运维 | 提供部署后的 HTTPS `DIGIWISE_IDE_API_BASE_URL`；在批准发布前不得写入正式包 |
| PIO/目标 BSP/工具链 | 未提供完整版本矩阵 | CTO/嵌入式负责人 | 给出 PlatformIO、平台包、框架、编译器、CMake/Python 版本和可重复安装命令，锁定依赖摘要 |
| 探针/驱动/目标板 | 未提供代表设备及唯一标识 | 嵌入式/QA | 提供目标板型号、芯片、接口、探针序列号、驱动版本、固件格式/地址和人工确认人 |
| Middleware 新结果契约 | 当前实现仍主要按日志阶段判断；`id/result/stop` 契约待后端确认 | Middleware 后端负责人 | 确认 `id` 贯穿 `build/download/transform`，并返回 `result.state=completed|failed|stopped` |

## 2. 可追溯安装包制品

以下制品均为工作区现有文件，不代表已签名、已发布或已安装。SHA-256 与 SHA-512 已在本机重新计算，完整记录见 `docs/delivery/AI-58-artifact-manifest.sha256.txt`。两份 Windows x64 文件的文件名、尺寸和生成时间不同；旧/新在此处仅表示验收基线，不表示语义版本升级。

| 角色 | 绝对路径 | 版本/来源 | 大小 | SHA-256 | SHA-512 |
|---|---|---|---:|---|---|
| 旧/基线 Windows x64 | `D:/代码/DigiwiseStudio/dist-win-x64/DigiStudio-x64-setup.exe` | `latest.yml` 标记 `0.0.13`；文件时间 2026-11-17 14:03:24 | 126,519,281 | `0e29872087f12a05861eb66f2dc4d0bd2180395f45417b0598529c429a8a7ee8` | `f014b3a775485e60d868b846811aa224ac10cd59dcf203f9db31abea69e4f22dd8ee24a0a6ed1f4c48ededce8d438e09efe7647662b1559c925c9df92d242314` |
| 新/候选 Windows x64 | `D:/代码/DigiwiseStudio/dist/DigiwiseStudio-0.0.13-x64-setup.exe` | `latest.yml` 标记 `0.0.13`；文件时间 2026-11-19 14:55:18 | 141,050,453 | `3779bec2086f40a80f567806a8f0fb06f81d5d5eab68ce5b58e55a7918563252` | `674b9be4c876666a503531af7426c22ffc314a5a4526b6752928d9308da6207ea18386178aca30983f030214490d1d5976171b2d13713cb5ff111ef7d0b5fc0f` |

验证制品时：

```bash
sha256sum "D:/代码/DigiwiseStudio/dist-win-x64/DigiStudio-x64-setup.exe"
sha256sum "D:/代码/DigiwiseStudio/dist/DigiwiseStudio-0.0.13-x64-setup.exe"
sha512sum "D:/代码/DigiwiseStudio/dist-win-x64/DigiStudio-x64-setup.exe"
sha512sum "D:/代码/DigiwiseStudio/dist/DigiwiseStudio-0.0.13-x64-setup.exe"
```

安装包执行前必须由 QA 记录：文件绝对路径、获取渠道、SHA-256、版本、平台/架构、签名验证结果、安装日志目录。当前没有签名验证证据，不得以哈希替代代码签名验收。

## 3. 环境清单和连通性

### 3.1 版本与入口

| 项目 | 已知值/入口 | 前置 |
|---|---|---|
| IDE 仓库 | `D:/代码/DigiwiseStudio` | Windows 工作区；保留并发/用户改动 |
| IDE HEAD | `e203807232d506f812c3fc504beaad3c628da008` | 真实验收前冻结提交或记录实际工作树 |
| Node/npm/TypeScript | Node `v22.23.4`、npm `10.9.9`、TypeScript `7.0.2` | `node --version && npm --version && node node_modules/typescript/bin/tsc --version` |
| Java 后台仓库 | `D:/代码/DigiwiseStudio-Admin-Java` | JDK 17、项目 Maven 3.9.11；不得读取 `.local` 或凭证 |
| Java API | `http://127.0.0.1:18080` | 仅本机，不得公网暴露 |
| Vue 后台 | `http://127.0.0.1:13080` | 仅本机 |
| Redis | `127.0.0.1:16379` | Ubuntu WSL；使用 `+PONG` 验证，不输出配置/密码 |
| MySQL | `127.0.0.1:13306`，库名 `digiwise_admin` | Ubuntu WSL；只由后台启动脚本检查 |
| IDE API 前缀 | `/api/ide/v1` | 不使用旧 `13003/v1`、旧 `studio-admin` 或管理端 `/login` |

后台启动（Windows PowerShell；不改生产）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\代码\DigiwiseStudio-Admin-Java\ops\start-all.ps1" -NoBrowser
```

脚本前置和安全边界：WSL Ubuntu、JDK 17、构建后的 Java JAR、前端依赖；脚本只操作本项目 WSL 数据库桥接、Java、Vue，不停止其他项目进程；端口必须保持回环地址。

### 3.2 无凭证健康检查

```powershell
Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:18080/captchaImage
Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://127.0.0.1:13080
```

Java API 业务健康不能只看 HTTP 200；按 `ops/start-all.ps1` 的规则检查 JSON `code=200`。IDE 受保护端点的匿名负例：

```powershell
Invoke-WebRequest -UseBasicParsing -Method GET http://127.0.0.1:18080/api/ide/v1/auth/me
```

预期是 HTTP 401、`AUTH_REQUIRED`；不要把响应中的 token 或验证码内容写入日志。真实登录必须人工输入验证码和密码，禁止在脚本、Issue、日志中保存凭证。

### 3.3 IDE 与本机 Middleware

本机协议验证入口：

```bash
cd /d/代码/DigiwiseStudio
npm run demo-middleware -- --root "<已保存的隔离 Studio 工程目录>"
```

Studio Local/Debug 地址填 `ws://127.0.0.1:8765`。随后按顺序执行 `Detect`、`Transform`、`Start Remote Build`、`Download Remotely`。自动化契约命令：

```bash
npm run verify-demo-middleware
```

该 Demo 只生成开发验证用 `./build/firmware.bin`，不执行真实 CMake、PIO 或烧录。证据应落在隔离工程目录的 `build/`、IDE Output 面板导出和 QA 运行日志，不得覆盖真实工程。

远端真实 Middleware 当前使用的既有示例字段（仅作测试占位，不是本机路径）：项目目录 `D:/__PRJ__/S350_EEZ`、目标 `mh2457`、频率 `500000`、固件 `D:/__PRJ__/S350_EEZ/build/HMI_MH2457.bin`、地址 `0x08001000`。使用前必须由 Middleware 负责人确认目标板和路径，不能直接烧录。

## 4. API/Redis/对象存储/测试账号申请表

申请记录只写资源标识、负责人、有效期和状态，不写用户名密码、Bearer、验证码、OSS secret、签名 URL 或完整响应正文。

| 项目 | 申请字段 | 最低验收 |
|---|---|---|
| IDE 测试账号 | 账号标识、内部/外部类型、可用窗口、停用负责人 | captcha → login → me → logout；停用后 me 为拒绝 |
| 测试授权 | A 来源品类、B 目标品类、C 无授权品类、有效期/撤权动作 | A/B 可见；C 列表和直调均拒绝；撤权后新请求拒绝 |
| 模板/BSP 样本 | 资源 ID、版本、格式、大小、SHA-256、上架状态 | 授权下载、坏摘要、下架、路径冲突和失败清理 |
| OSS | 隔离 bucket/prefix、对象 ID、HTTPS 域名、短 TTL | 不打印签名 URL；下载后仅留摘要/大小；用后清理 |
| API | 开发 URL、契约版本、request ID 记录位置 | 401/403/404/429/5xx 映射固定错误码 |
| Redis | 仅服务端连接；不向 QA 发密钥 | 登录后会话存在，logout/停用后失效 |

来源依据：`D:/代码/DigiwiseStudio-Admin-Java/backend/doc/api/IDE_HANDOFF.md`、`CATEGORY_BSP_IMPLEMENTATION_2026-11-16.md`、`D:/代码/DigiwiseStudio/docs/coordination/IDE_RELEASE_ROLLOUT_INTEGRATION.md`。

## 5. Egolite/嵌入式运行入口与证据

当前仓库没有可确认的 Egolite 可执行文件、BSP、工具链或目标板资源，因此不提供虚构命令。解除条件是嵌入式负责人提供以下四项并核对路径：

1. Egolite 版本、运行入口（可执行文件或脚本）、参数契约和工作目录；
2. 目标 BSP/PIO platform/framework、编译器和 CMake/Python 版本；
3. 目标板、探针、驱动及下载 CLI 版本；
4. 隔离工程、构建输出和证据目录。

在资源到位后，运行入口必须按此模板记录（把尖括号替换为已确认值，不可猜测）：

```text
<egolite-entry> --project <isolated-project> --target <target> --output <evidence-dir>
```

证据目录建议：

```text
D:/验收证据/AI-58/<run-id>/
  environment.txt       # 版本、PATH 中工具名，不含凭证
  command.txt           # 完整命令，去除 secret/token
  stdout.log
  stderr.log
  build-manifest.json   # target、BSP version、toolchain、sha256、timestamp
  pio-result.json       # build 与 flash 分开
  device-confirmation.md
```

禁止将账号、token、签名 URL、工程正文或芯片安全密钥放进证据目录。没有实际 Egolite 入口时，AI-56/AI-57 只能验收 Studio 的适配协议和失败闭环，不能验收真实运行。

## 6. PIO、工具链、探针、目标板和人工确认清单

### 6.1 Build 前

- [ ] 锁定 Windows、Node/npm、Python、Java、CMake、Ninja/Make、PlatformIO Core 版本。
- [ ] 锁定 `platformio.ini`、platform/framework/package 版本和下载 CLI 版本；记录包名与 SHA，不记录凭证。
- [ ] 确认 A 来源工程、B 目标品类、B BSP 版本、BSP SHA-256 和兼容矩阵。
- [ ] Main 每次 Build 前在线复核账号、品类、BSP/版本和项目指纹；授权失败时 PIO 启动次数必须为 0。
- [ ] 下载到隔离临时目录，核对大小和 SHA-256；构建失败不得复用旧成功产物。
- [ ] 保存构建命令、退出码、构建日志和产物摘要；Build PASS 不等于设备 PASS。

### 6.2 Flash 前人工闸门

人工确认人逐项勾选并签名/写入时间：

- [ ] 目标板型号、芯片和板上序列号与任务单一致。
- [ ] 探针型号、序列号、驱动版本和连接接口与目标一致。
- [ ] 固件文件绝对路径、SHA-256、目标品类/BSP/版本、地址偏移（例如 `0x08001000`）已二次核对。
- [ ] 供电、跳线、复位和可中止方案已确认；禁止错板写入。
- [ ] 操作者明确确认“开始写入”；该确认不能由 Build 成功自动替代。

### 6.3 Flash 后

- [ ] 单独记录 `flash` 命令、探针输出、退出码和设备复位结果。
- [ ] 断连、取消、错误地址、错设备、重复写入分别保留失败证据。
- [ ] 运行最小设备验收（启动、通信、显示/功能 smoke），保存串口/探针日志。
- [ ] 设备验收结果与 Build 结果分开签收；失败恢复见下一节。

## 7. 安装、升级、回滚和失败恢复

### 7.1 安装前快照

1. 记录当前安装版本、安装目录、用户数据目录和项目目录；只记录路径/版本，不复制凭证。
2. 关闭 IDE，确认没有运行中的安装器/写入任务。
3. 备份待验收工程和非敏感配置到隔离备份目录；备份完成后记录文件列表与 SHA-256。
4. 对旧/新安装包重新计算 SHA-256，并由第二人核对；签名未通过则停止。
5. 将新包复制到隔离安装机；禁止从生产更新源直接安装。

### 7.2 升级与验收

1. 先安装旧/基线包并打开一个可丢弃工程，记录版本和启动日志。
2. 退出 IDE，运行新安装包；不改变 API/OSS/生产配置。
3. 启动后验证版本、登录门禁、工程重开、模板/BSP 目录和更新检查入口。
4. 真实更新必须满足：检查与下载两次都命中授权、完整包哈希通过、用户再次确认后安装、新版本启动并登录后才上报 `install_success`。
5. 失败只记录固定错误码、request ID、版本、平台和时间；不得记录 token、签名 URL 或密码。

### 7.3 回滚

- 安装失败或新版本无法启动：不要覆盖旧包/数据；关闭新进程，使用已核对 SHA-256 的旧安装包重新安装。
- 启动后业务回归失败：停止继续升级，恢复旧包，使用升级前的工程/配置备份；保留新旧日志、版本和摘要。
- 数据迁移失败：停止重试，保留原目录只读副本；由后端/产品决定恢复，不删除原数据。
- 更新服务暂停/撤销：不执行安装；不能用旧公开 OSS feed 绕过 Java 灰度判定。

### 7.4 设备失败恢复

- Build 失败：删除本次临时输出，禁止把旧 `firmware.*` 标成新结果。
- 探针断连/烧录取消：保持设备安全状态，重新连接并人工复核目标、固件摘要和地址后才允许重试。
- 错板或地址不一致：立即停止，记录设备序列号和固件摘要，交嵌入式负责人处置；禁止自动重试。
- 任何不可恢复数据风险：停止验收并升级给 CTO/安全负责人，不自行清库或改生产。

## 8. QA/安全交接和当前未验证项

交给 AI-56 QA：本文件、制品清单、健康检查命令、安装/回滚步骤、PIO/设备人工勾选项。重点按 `docs/qa/TEST-PLAN.md` 的登录→A 建项→A→B→Build→设备→更新顺序执行。

交给 AI-57 安全：保留 F-01 授权无有效期、F-02 signed URL 五分钟可重放、真实 Java/Redis/OSS/账号未端到端验证的结论；不要把本机契约夹具当作撤权、重放或设备安全通过。

截至本文日期未验证：真实账号登录成功/停用、真实 OSS 字节下载、正式 HTTPS API、签名校验、PIO 真编译、Egolite 真实运行、探针连接、目标板烧录、安装后成功上报。上述每项均有负责人和解除条件，不用 Mock、历史 401 或本地 Demo 补齐。

## 9. 本次执行证据

| 命令 | 退出码 | 关键结果 |
|---|---:|---|
| `date '+%Y-%m-%d %H:%M:%S %Z'` | 0 | 2026-11-19 18:48:07 |
| `node --version` | 0 | v22.23.4 |
| `npm --version` | 0 | 10.9.9 |
| `node node_modules/typescript/bin/tsc --version` | 0 | TypeScript 7.0.2 |
| `git rev-parse HEAD` | 0 | `e203807232d506f8123cfc504beaad3c628da008` |
| 制品 `sha256sum`/`sha512sum` | 0 | 两份 Windows x64 制品摘要已写入本文件及 manifest |

本次没有执行安装、部署、发布、Java 登录、真实下载、PIO、Egolite 或设备写入。
