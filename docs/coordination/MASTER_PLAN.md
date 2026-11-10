# DigiwiseStudio ↔ studio-admin 跨仓库开发总计划

日期：2026-11-10 · 状态：**已确定产品方向，API 与业务实现仍是草案**

## 已确认产品方向
- 个人/企业用户同用 DigiwiseStudio Desktop；邮箱验证注册后领取**限时一次性试用**。
- 试用到期，用户可继续登录/兑换授权码；正式授权由**个人授权码核销**或**企业管理员后台开通并分配席位**获得。
- 账号、试用、正式许可、企业席位、Workspace/存储额度是独立状态与生命周期；服务端为权限真相源。
- 试用具体天数、试用功能范围、试用结束后的数据读写/保留策略**尚未决定**；需产品负责人明确后写入服务端政策，不得由客户端硬编码。
- 企业成员被撤销权限时不删除个人身份/个人 Workspace；企业文件访问需及时撤权。
- NocoBase Web 后台只供内部员工；客户没有额外 Web 管理门户。

## 系统边界
| 层 | 仓库/服务 | 责任 |
| --- | --- | --- |
| Desktop | `Mixlong/studio` | 邮箱注册 UI、试用状态、授权码激活、Workspace 切换、文件 UI 与受控主进程 SDK |
| 管理平台 | `Mixlong/studio-admin` | NocoBase 3 内部管理、用户/企业/席位/授权/审计、服务端业务协调 |
| Public API | 规划中的可信业务 API | 版本化 `/v1/*` 供 Desktop；实现进程形态待 PoC，**非 NocoBase 管理 API** |
| 文件面 | SFTPGo User API | 用户级文件访问；Admin API 仅可信服务端调用 |
| 存储面 | Alibaba OSS Private | 只接受服务端最小权限访问；桌面端永不获取 OSS 凭据 |

## 开发顺序（两个 AI 同时开发，逐阶段联调）
1. **COORD-001**：共同审核 OpenAPI 与状态/错误码；提出变更先改契约；为双仓库绑定版本。
2. **CLIENT-001 / ADMIN-001 并行**：Desktop Mock 注册/试用 UI 与后端邮箱验证/一次性试用引擎。以相同契约互测。
3. **LICENSE-001**：授权码生成/核销、企业直接授权/席位与客户端交互，保留审计。
4. **INT-001**：联合验证注册、试用、到期、核销、企业分配/撤销、文件权限隔离。未做 PoC 不宣称完成。

## 联合验收底线
- 同一邮箱不能重复领取试用；数据库并发和重试幂等，服务端 UTC 时间决定有效期。
- 授权码核销具备原子性、撤销/过期/作用域约束；客户端不能伪造激活。
- 未授权用户不能越权读取其他用户/企业 Workspace；企业撤销后 SFTPGo 用户级文件会话须失效。
- API 不返回管理 Token、OSS Key、STS、对象直链或客户其他敏感字段。
- Electron 使用受控 IPC/OS 安全存储而非把管理密钥放在 renderer。
- 每条需求都有服务端测试 + 客户端契约测试 + 真实联调结果；Mock 测试不等于联调验收。

## 交接入口
- [COORD-001](https://github.com/Mixlong/studio/issues/2)
- [CLIENT-001](https://github.com/Mixlong/studio/issues/3)
- [ADMIN-001](https://github.com/Mixlong/studio/issues/4)
- [LICENSE-001](https://github.com/Mixlong/studio/issues/5)
- [INT-001](https://github.com/Mixlong/studio/issues/6)
- [共享 OpenAPI 草案](../../contracts/openapi.yaml)
