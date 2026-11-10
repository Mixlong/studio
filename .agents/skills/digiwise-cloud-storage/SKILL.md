---
name: digiwise-cloud-storage
description: Use when planning or implementing DigiwiseStudio user storage, personal/enterprise workspaces, SFTPGo provisioning, Alibaba OSS, quotas, file transfer auth, or cloud storage admin API. Do not use for unrelated local LVGL editing or UI-only changes.
---

# DigiwiseStudio 云后台、SFTPGo 与 OSS Skill

## 必读
- `AGENTS.md`
- `docs/architecture/digiwise-platform-and-oss.md`
- `docs/adr/0001-sftpgo-file-plane.md`
- 相应 API/数据库文件（如已创建）

当前首选架构为 **Node.js 管业务 / SFTPGo 管文件 / Private 阿里云 OSS 管对象存储**；目前仍处于 PoC/许可证评审阶段。不得断言 SFTPGo、Node 或 OSS 配额方案已部署。

## 不可破坏的产品边界
1. 个人及企业客户只使用 DigiwiseStudio Desktop；Digiwise Admin Web 仅内部团队使用。
2. 统一 Digiwise 用户可有个人 Workspace，也可加入多个组织 Workspace；文件与成员权限由 Workspace 归属和授权决定。
3. **客户不得直接访问 OSS**，不得获得 OSS AccessKey、STS、预签名 URL 或可直连私有对象地址。
4. **Node 是业务控制面，不转发文件字节**；Node 经内网 SFTPGo Admin API 创建用户、组、虚拟目录、挂载和容量策略，不直接写 SFTPGo Data Provider 数据库。
5. **SFTPGo 是文件面**：客户端只通过受限 HTTPS User API（或获批准的 SFTP/WebDAV）访问；其 Admin API/WebAdmin 不对客户开放，Admin Key 不交客户端。WebClient 也不自动开放。
6. SFTPGo 后端经 S3 兼容接口接 OSS Private Bucket，客户空间独立 Key Prefix；业务/文件数据域独立。
7. 企业共享空间用**独立共享虚拟目录配额**，不能把共享目录设置为 `-1` 计入多个用户配额。
8. **SFTPGo Quota 不是严格事务配额**：并发和多实例可短暂超限，计数可能漂移。若承诺绝对限制，需要单独验证跨并发准入/预留机制；配额定期 scan 和审计不可省略。
9. 上传下载、目录删除、成员退出及账户禁用均须验证 OSS 隔离、SFTPGo 真实权限与活跃会话失效。

## 执行步骤
1. 核查仓库当前实现和 SFTPGo 的**实际安装版本**、Open Source/Enterprise 版功能与许可证。明确本任务是文档、PoC、业务 API、文件接口还是桌面集成。
2. 先更新对应 docs 和 ADR，写清用户/Workspace 与 SFTPGo 用户/Virtual Folder 映射、认证方案、配额口径、失败补偿。
3. 用官方 OpenAPI / 文档对照 SFTPGo Admin API、User API；不凭空创建参数字段，不默认 Digiwise JWT 可被 SFTPGo 接受。
4. PoC 验证 OSS S3 兼容、GB 级文件/Range/Multipart、共享目录、两企业互不访问、用户撤销与登录失效。
5. 测试单成员、多成员并发上传、超额、重试、网关重启和多实例情况下的 quota 偏差；若未满足硬限制，必须阻止“严格配额已实现”结论。
6. 安全检查：客户端网络抓包无直连 OSS 地址/凭据、无 Admin API；只启用批准的协议和公网入口。
7. 审查 AGPLv3 与 SFTPGo Web UI 主题额外许可，记录测试结果、代码位置、监控和成本结论，更新 docs。

## 交付
报告改动范围、SFTPGo 版本与许可、OSS 测试区域、权限/配额行为的真实测试结果、剩余风险和文档/PR 地址。没有实际环境时，只能提交设计与测试计划，必须注明“未验证”。
