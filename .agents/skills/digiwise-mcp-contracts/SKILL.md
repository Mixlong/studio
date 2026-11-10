---
name: digiwise-mcp-contracts
description: Use when auditing, adding, repairing, or testing DigiwiseStudio MCP tools, read/write APIs, widget properties, style/image/icon controls, tool registration, schema parity, or AI end-to-end editor workflows. Do not use for unrelated backend or general text tasks.
---

# DigiwiseStudio MCP 能力契约与回归

## 目标
使 AI 能通过 MCP 执行用户已经授权的真实编辑流程，不以“工具存在”或“接口返回成功”代替画布行为和工程持久化验证。

## 开始前
1. 读取 `AGENTS.md`、`docs/standards/documentation.md`、现有 MCP 实现及接口文档。
2. 检查当前进程与正在使用的 MCP 子进程版本，识别工具注册状态、读写能力和实例连接；避免使用旧进程结果评估新代码。
3. 确认目标组件和属性的真实数据模型，包括控件类型（Button / Switch 等）、Style、Image、Icon、事件、绑定等。

## 能力矩阵
为每类控件/属性至少记录：
- IDE UI 是否支持查看/编辑；
- 工程模型的实际字段、类型和约束；
- MCP 是否支持读取、创建、修改、删除、批量操作；
- 输入校验、错误码、事务/撤销与保存后的持久性；
- 画布实时渲染、预览和重开工程是否一致。

优先采用统一的属性契约和 schema，而不是仅针对个别 Switch/Button 写补丁。不得凭猜测创建不存在的属性字段。

## 执行顺序
- 先在 `docs/features/` 或 `docs/api/` 写缺口矩阵、兼容性和端到端测试用例。
- 根据代码实现最小扩展，保持已有工程向后兼容；涉及破坏性接口修改先写迁移和回退方案。
- 通过运行中的 MCP 实例进行 create → read → update → save → reload → verify。
- 对可撤销操作验证 Undo/Redo；跨工程/跨页面检查污染；对无效参数验证失败响应。
- 验证 IDE 右侧 Properties、Canvas 和 Style 预览与 MCP 修改结果一致。
- 更新能力矩阵，将“未实现/未验证/已实现”分开。

## 失败处理
缺少桌面操控、MCP 写权限或本地工程样本时，不声称“已经修复”，只提交代码审查与待运行测试清单；不得未经用户授权操作其他屏幕或生产工程。

## 交付
给出新增/修改的工具名称、具体属性覆盖变化、代码位置、测试证据、仍缺失的调用能力及文档链接。
