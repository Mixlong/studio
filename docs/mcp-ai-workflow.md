# DigiwiseStudio MCP — AI 全流程操作规范

版本：V9（2026-11-11；源码能力与运行验收分别记录）  
范围：本地 Electron IDE / LVGL 工程。后台与 OSS 不属于本 MCP 的信任域。

## 1. 目标

AI 必须在不绕过编辑器 ProjectStore、UndoManager、属性元数据与用户授权的前提下，完成「发现能力 → 识别工程 → 分析目标 → 创建或修改 → 回读验证 → 保存 → 构建/预览 → 反馈/回滚」的可观测闭环。不得把 MCP 工具注册成功视为功能可用；每项能力须通过真实工程与 UI 一致性验收。

## 2. 标准闭环

1. `get_mcp_capabilities`：读取当前版本支持范围和限制，遇到不支持的操作明确说明。
2. `get_current_project` + `get_active_page`：固定工程文件路径、LVGL 版本、运行模式和当前页面。
3. `list_pages` + `list_widgets` + `get_widget_schema`：分析组件树、部件、状态、属性和资源引用；处理 Style 时读取 `list_styles` / `get_style`。
4. 变更时始终传 `expectedProjectPath`；对象使用最新 `widgetPath` / `widgetId`，Style 使用 `stylePath` / `styleId`，防止切换工程或路径变化后写错对象。
5. 同一对象多个普通属性优先使用 `set_widget_properties`，全部校验后作为一条撤销事务提交；其他编辑走专用工具。
6. 回读确认模型属性与期望一致。对于当前实际可见的 LVGL 编辑页，先 `get_active_page` 获取 pageId，再 `get_canvas_snapshot` 获取原生 Canvas PNG，结合组件位置和样式检查画布结果；这是编辑器像素，不代表模拟器运行成功。失败则给出可定位错误；仅回滚 MCP 自身的历史事务，不撤销用户手动操作。
7. `save_project` 并回读 modified 状态。随后可调用 Check / Build；对于本地 WASM 项目，用户授权后可调用 `start_preview`，轮询 `get_preview_status`，使用 `stop_preview` 返回编辑器。在新版 IDE 中，`get_preview_status` 给出 selectedPageId 后，`get_preview_snapshot` 能获取当前 WASM 运行帧；授权的 `preview_tap` 可按页面坐标执行单点按下/松开。**2026-11-11 已在独立工程完成真实 E2E：单击按钮 → Flow Action → LVGL changeScreen → Success 页稳定画面。** 注意 Runtime 的 selectedPage 可能先于 Canvas 完成渲染；应连续读取至少两帧确认稳定，不能仅凭页面状态或一张过渡帧宣告成功。设备 Download 仍未开放。

## 3. 已实现 MCP 能力（以源码为准）

- 读取 19 项：能力、工程、页面、组件、Style、资源、变量、Action、事件、Flow 图、异步 Check/Build、`get_canvas_snapshot` 编辑器 Canvas PNG、`get_preview_status` 本地 WASM 预览状态、新增 `get_preview_snapshot({pageId})` 原生 WASM 帧 PNG。画布 PNG 限 1024px/边、135 万 base64 字符。**2026-11-11 真实 IDE 800×480 画布截图、Stdio 图片传输和 WASM 预览状态查询均已通过。**
- 写入 37 项：原有工程/页面/Style/组件/变量/资源/事件/Check/Build/Undo 与受限 Flow（IsTrue、CallAction、LVGL 页面跳转）；包括本地授权的 `start_preview` / `stop_preview` 和新增单点触摸 `preview_tap({expectedProjectPath,pageId,x,y})`，复用原生 WASM Runtime，启动前必须保存，运行中禁止其他 MCP 工程写入。**2026-11-11 真实 WASM Runtime 启停通过：start→running→stop→idle，且回到编辑画布、项目仍未修改。**
- 安全：仅本地认证桥接；开启 MCP Server 仅允许提出写入请求，实际写入需要本地弹窗单次或本次会话授权，关闭服务器即撤销会话授权；写入串行；校验工程和对象身份；拒绝 Run Mode 和只读工程。
- 批量属性写入为 1–32 个标量字段，必须来自该组件的运行时 ClassInfo Schema；整组先校验、后以单条 Undo 事务修改。

## 4. 缺口矩阵（不得标记已完成）

| 能力 | 当前状态 | 后续设计与验收 |
| --- | --- | --- |
| 创建、删除、重命名 Style / 设置默认 Style | 基础 CRUD 已实现 | 仍需在真实 IDE 验证引用同步、Style 预览、嵌套 Style 生命周期 |
| Bitmap / 字体资源导入删除 | Bitmap 限定项目目录 PNG/JPEG（<=10 MiB）导入已实现；字体和删除未开放 | 验证合法图像、格式、尺寸、嵌入/路径模式和 UI 实时预览；扩展字体/资源删除 |
| Variable / Action 创建修改 | 类型化变量与 Action 创建；Action 基础节点 CRUD（创建、删除）及连接/断开已实现 | 变量与 Action 重命名、删除、其他组件属性修改仍未开放 |
| 表达式与 Flow 数据绑定 | 支持变量绑定、SetVariable 字面量、Delay、IsTrue 布尔分支、CallAction 受限调用、LVGL 页面跳转；分支 True/False 顺序连接 | 复杂表达式、多条件比较、循环、任意数据端口连接、复杂 Action 参数与真实编辑器/模拟器验收仍未完成 |
| 完整 LVGL Widget 类型覆盖 | 按当前注册表和 Palette 动态发现可创建类型 | 实际 Palette 的每类组件、嵌套容器、版本差异及专有属性仍需逐一验证 |
| 页面重命名、删除、复制、排序 | 重命名和安全删除已实现（基于 ClassInfo 引用和初始页面检查） | 需真实 IDE 验证引用、运行态跳转；页面复制/排序仍未开放 |
| 组件重排/复制/对齐 | 同父级重排、叶子组件复制、跨页面/容器移动已实现 | 整棵容器复制、批量对齐、批量选择、布局属性与画布同步仍需实现或真实验证 |
| 构建、画布截图、预览、下载固件 | Check / Build、编辑画布 PNG、WASM 启停及真实运行帧/点击均已实测通过；独立工程验证了按钮 CLICKED → Flow → 页面跳转 → 两次稳定帧，变化像素 4.392%，Check/Build 均 0 错误 0 警告 | 拖拽、多指、键盘、Docker 模拟器、Toolchain/Download、取消与恢复，以及复杂 Flow 分支与其他 LVGL 版本的真实验收仍未完成 |
| 真实 IDE 端到端验收 | 2026-11-10 版本已完成真实 MCP 36/36 写入、9/9 保存重开和 Check/Build；2026-11-11 新增条件/导航/调用节点**尚未真实运行验收** | 新版 IDE 中隔离工程测试多分支、真实页面跳转、Action 调用、保存重开及构建；再核对 Canvas/Properties/Preview |

## 5. 版本与验收门禁

- 编译：`npm run build-src`
- 回归：`npm run verify-mcp`
- 真实运行连接：`npm run verify-mcp-live`，需要重启后的 DigiwiseStudio 与已启用的 MCP
- 打包与客户端：`npm run pack`、`npm run verify-mcp-packaged`
- 每新增一项工具必须同时更新协议常量、参数校验、renderer/main 授权路由、stdio 注册、README、正常/非法/过期路径/Undo 测试。
- 必须保留用户工作区现有修改。未经单独审批，不提交、清理或重置已有改动。

## 6. 安全原则

不向 MCP 暴露通用文件系统写入、任意 Shell、任意脚本执行或工程外部路径。对安全敏感操作先做专用工具和最小权限设计。每项变更必须可识别工程/对象、可验证结果、可报告失败、支持与现有 Undo 机制一致的撤销。

## 7. 下一阶段实施顺序

P0：确认所有 IDE 工程已保存后再加载新版 MCP；在隔离演示工程依次验收 IsTrue True/False 分支、CallAction、LVGL 页面跳转、Check/Build、保存退出重开，并检查 Properties/Canvas/预览及真实跳转行为。**不得仅凭 mock 单测宣告完成。**  
P1：扩展多条件比较、循环、复杂 Action 参数和数据端口连线、变量/Action 生命周期；组件整棵复制与对齐、页面复制/排序、字体与资源删除。  
P2：简单按钮 CLICKED → Flow 页面跳转 → 稳定画面 E2E 已通过；下一阶段实测 IsTrue / CallAction、变量绑定和真实事件联动，再扩展受控拖拽/键盘、运行日志与 Docker 模拟器、Toolchain→Download、任务取消及跨 LVGL 版本验证。
