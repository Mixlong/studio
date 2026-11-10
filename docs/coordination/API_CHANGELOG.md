# Digiwise Public API 契约变更记录

## 2026-11-10 — 0.1.0-draft（未实现）
- 建立 [OpenAPI 3.1 草案](../../contracts/openapi.yaml) 并与 [COORD-001](https://github.com/Mixlong/studio/issues/2) 绑定。
- 约定邮箱验证码申请、验证注册、登录、用户有效授权查询、授权码兑换、Workspace 列表、存储配额查询。
- 所有路径是**拟定契约**，目前没有生产域名、生产 API 或合格的前后端联调证据。
- 未定产品配置：试用天数、试用功能、到期数据保留、正式许可套餐、企业席位规则、SFTPGo 身份映射。
- 约定客户端不调用 NocoBase 管理 API、SFTPGo Admin API 或 OSS 直链。

## 修改流程
1. 发起 Issue #2 评论说明兼容性、权限影响和拟新增/删除的字段。
2. 更新**本仓库** `contracts/openapi.yaml` 并通过 CI；记录 PR/commit。
3. 后台 AI 将相同契约复制到 `studio-admin/contracts/openapi.yaml`，校验 SHA256，并在 #2 关联后台 PR。
4. 两端 SDK/服务实现后，分别提供测试结果及 INT-001 的真实联调证据。
5. 破坏性改动必须先获批准并采用新契约版本；任何单方面字段/状态变更不得默默合并。
