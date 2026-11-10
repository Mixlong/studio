---
name: digiwise-release-operations
description: Use when modifying DigiwiseStudio Electron build/package flows, Aliyun Yunxiao Flow pipelines, OSS artifact paths, Stable/Dev update channels, version/build numbers, download/update behavior, signing, or release rollback. Do not use for unrelated features.
---

# DigiwiseStudio 构建与发布运维

## 必读
读取 `AGENTS.md`、`docs/standards/documentation.md` 和已有发布/安装配置；先核实当前 `package.json`、Electron Builder、云效流水线、OSS 上传脚本、应用 ID/签名与运行进程，避免混用源项目 EEZ Studio 安装身份。

## 发布约束
- Stable/Dev 通道独立；版本号与 Build Number、包名/应用 ID、制品路径要有明确对应。
- 不覆盖已有不可变历史制品；通道元数据更新应单独原子化/可回滚。
- Windows/macOS 包、签名、更新器元数据和操作系统兼容性分别检查。
- 不假定把更新指针指向旧版本就能让高版本客户端自动降级。
- 客户工程 Private OSS 与安装包发行 OSS 隔离，后台仅管理构建/发布流程，不替代云效构建执行器。
- 生产发布、强制更新、覆盖文件、删除历史包须有明确授权及审计。

## 执行顺序
1. 查现有仓库代码、流水线和实际启用的更新服务；写出版本、渠道、平台、目标环境。
2. 在 `docs/operations/` 记录构建链路、OSS Key、更新清单格式、验证/回滚与风险。
3. 优先开发或修复 dev/test 通道，检查构建任务、产物哈希/签名、下载和更新检查。
4. 验证正常升级、失效网络、错误元数据、不同电脑已有安装包及旧进程/缓存导致的版本不一致。
5. 审核通过后才考虑生产发布；在最终报告中区分“已构建 / 已上传 / 已发布 / 已安装验收”。

## 交付
记录源码提交、构建执行标识、安装包清单与哈希、实际验证环境、发布通道、回滚入口和未验证项；若无云效权限或实际测试设备，不得说发布流程已验收。
