# T04-LB06（#32）真实开发板端到端验收操作手册

- **关联任务**：`Mixlong/DigiwiseStudio-Admin-Java#32`（父任务 `#8 T04`，前置 `LB02`～`LB05`）
- **当前状态**：软件全链路（`LB02`～`LB05` + Java T02 Manifest 校验）已联调通过；**本手册用于拿到明文真实 BSP + 实体开发板后执行最终硬件验收**。

---

## 1. 给真实 MH2457 / S350 BSP 包补充 `bsp-manifest.json`

从 SVN 真实 BSP（`02-BSP/01-Projects/V0.0.1`）经正常解密流程导出明文工程后，**不改原固件目录结构**，仅在 ZIP 根目录放入以下 `bsp-manifest.json`：

```json
{
  "schemaVersion": "1.0",
  "bsp": {
    "id": "s350-mh2457",
    "categoryCode": "S350",
    "version": "1.0.0",
    "name": "S350 MH2457 Local BSP",
    "minStudioVersion": "0.0.1",
    "supportedHostOs": ["windows-x64"]
  },
  "target": {
    "chip": "mh2457",
    "arch": "cortex-m4",
    "display": { "width": 800, "height": 480, "colorBpp": 16 }
  },
  "build": {
    "system": "cmake",
    "sourceDir": ".",
    "cmakeLists": "CMakeLists.txt",
    "preConfigureScript": null,
    "toolchainFile": null,
    "generator": "Ninja",
    "uiSync": {
      "strategy": "copy-to-dir",
      "generatedUiDir": "APP/ui",
      "resourceManifest": "build/generated/embedded-resources.json"
    },
    "env": {},
    "extraArgs": [],
    "artifacts": [
      { "role": "firmware", "format": "bin", "path": "build/HMI_MH2457.bin", "required": true },
      { "role": "symbols", "format": "elf", "path": "build/HMI_MH2457.elf", "required": false }
    ]
  },
  "toolchain": {
    "compiler": { "id": "arm-none-eabi-gcc", "version": "14.3.rel1" },
    "cmake": { "minVersion": "3.25.0" },
    "ninja": { "minVersion": "1.11.0" },
    "python": { "minVersion": "3.10.0", "requirementsFile": null }
  },
  "download": {
    "probe": "jlink",
    "target": "mh2457",
    "interface": "SWD",
    "frequencyHz": 500000,
    "flashAddress": "0x08001000",
    "pack": null,
    "script": null,
    "verifyAfterFlash": true,
    "resetAfterFlash": true
  }
}
```

> 注：若 T00 最终冻结的首发品类编码为 `BC350` 或 `BC351`，请同步修改 `bsp.categoryCode` 与后台目标品类编码保持一致；若使用 CMSIS-DAP/pyOCD 烧录器，将 `download.probe` 改为 `"pyocd"` 并填写 `download.pack`。

---

## 2. 端到端实板验收检查表（全部勾选并附证据后方可验收 `#32`）

### A. 正常主链路
- [ ] **Java 后台上传发布**：管理员上传带 `bsp-manifest.json` 的真实 BSP ZIP，`BspArchiveValidator` 校验通过，发布状态为 `published`，授予测试账号对应品类权限。
- [ ] **Studio 受控下载与绑定（LB02）**：IDE 登录测试账号 → 仅见获授权品类与已发布 BSP → 下载完成并核对 SHA-256 → 绑定工程并保存 → 关闭重开工程自动恢复绑定。
- [ ] **工具链准备（LB03）**：干净 Windows 机无需手动配系统 PATH，Studio 自动就绪 `arm-none-eabi-gcc 14.3.rel1`、`CMake`、`Ninja` 与探针驱动。
- [ ] **本地 Build（LB04）**：修改 Studio LVGL 界面文字/图片 → 点击 Build → 产出真实 `HMI_MH2457.bin`，留存 `build/records/<buildId>.json`、`.log` 与固件 SHA-256。
- [ ] **本地 Download（LB05）**：连接真实探针与开发板 → Detect 识别到设备 → Download 烧录并读回校验通过 → 留存 `build/downloads/<downloadId>.json` 与 `.log`。
- [ ] **实板启动运行（LB06）**：开发板复位上电，屏幕正确显示本次 Studio 修改后的 GUI 页面（拍照/录屏留证）。

### B. 异常与安全门禁
- [ ] **撤权拦截**：后台撤销用户该品类授权后，IDE 再次点击 Build 被在线门禁拒绝（`BSP_NOT_AUTHORIZED`），不复用本地缓存绕过。
- [ ] **下架拦截**：后台下架该 BSP 版本后，IDE 无法签发新下载且无法继续 Build。
- [ ] **断连/坏包拦截**：拔掉探针点击 Download 准确报 `PROBE_NOT_CONNECTED`；篡改固件 SHA-256 拒绝烧录（`FIRMWARE_INTEGRITY_FAILED`）。
- [ ] **取消与重试**：下载或编译中途点击取消，子进程树干净退出、不留脏文件，再次重试可成功。
