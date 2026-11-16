# DigiwiseStudio MCP — LVGL 组件属性覆盖审计（2026-11-11）

## 验收结论

本轮**完成源码级属性盘点 + 39 类 ClassInfo 安全校验夹具回归**，并修复了动态 Enum 元数据引发整个 MCP 属性 Schema 读取失败的问题。

**不能视为 37 种组件已逐一完成真实 IDE GUI、保存重开、运行预览和 Build 的完整验收。**

- 源码直接继承 `LVGLWidget` 的组件类：**39**
- 静态识别的组件**专有**安全标量/可受控字面量候选字段：**136**
- 静态识别的复杂、受限制字段：**20**，另外存在 **4** 处需运行期解析的展开元数据
- 已运行 Schema/值校验夹具的类：**39**
- 已通过安全属性值校验夹具：**136** 项
- 已通过拒绝非安全属性/异常枚举的负向断言：**117** 项
- 之前真实 IDE 在特定 LVGL 工程下返回的 Palette 组件数为 **37**；本次 39 是静态类数量，差别可能包含内部组件、条件组件和版本限制。两者**不能直接等同**。
- 基础几何、通用状态等继承自 `LVGLWidget.classInfo` 的字段不计入 136；`0` 个专有字段**不代表**该组件无基础可编辑属性。

## 主要类型与缺口

| 类型范围 | 已有基础能力 | 当前主要限制 |
| --- | --- | --- |
| Label、Button、Checkbox、Switch | 几何、文字（适用时）、Style、状态、事件；可以查当前 Widget Schema | 字体二进制与复杂数据对象未覆盖；Button 无专有标量是正常的 |
| Slider、Arc、Bar、Spinbox、Roller、Scale | 由组件 ClassInfo 动态公开数值、模式、枚举及可编辑字面量 | 在不同模式、不同 LVGL 版本下可能禁用或隐藏；需要逐版本真实测试 |
| Image、AnimationImage、Imgbutton、Lottie | 已存在 Bitmap 引用与部分安全标量操作 | 动画帧列表、多个状态图片、二进制/动画数据等复杂结构不能盲写 |
| Chart、Meter、ButtonMatrix、Table、Span | 基础创建和可用标量操作受 Schema 约束 | 图表序列、仪表指标、按钮矩阵项、表格单元格、富文本等数组/对象管理接口尚缺 |
| Container、Panel、Tabview、Tab、TileView、Window、Menu、List | 基础容器节点、Geometry 和样式字段可通过 MCP 安全能力读取 | 容器整体复制/复杂子项生命周期、布局约束、页面级联重排未完整验收 |
| Keyboard、Textarea、Calendar、Colorwheel、QRCode、Dropdown 等 | 部分专有字段可在相应版本暴露给 Schema | 与输入设备、特殊模式、版本依赖有关的完整运行验收仍需补充 |

## 修复：动态枚举选项的容错

以前 `widgetPropertySchema` 对 `enumItems(widget)` 的动态函数直接求值，一旦某组件当前状态下抛异常，**整个 Schema 读取可能失败**。

现在：
1. 只对 Enum 字段读取选项；
2. 捕获运行期异常，过滤非法选项，限制最多输出 128 个安全 ID；
3. 当前没有可用合法选项时报告 `editable=false`，而不是向 AI 虚报可编辑；
4. `set_widget_property` 使用同一枚举列表校验，拒绝不可用枚举值；
5. 已覆盖异常回调、复杂数组、脚本属性、错误枚举值等负向测试。

此处没有开放任意表达式执行、数组对象写入、字体二进制导入或不受控属性修改。

## 执行方式与证据

```powershell
cd D:\代码\DigiwiseStudio
npm run build-src
npm run verify-mcp-widgets
npm run verify-mcp
npm run pack
npm run verify-mcp-packaged
```

`npm run verify-mcp-widgets` 生成逐类 JSON：
`artifacts/mcp-acceptance/mcp-widget-property-coverage.json`

测试源文件：`packages/mcp/test-widget-coverage.cjs`。测试逐个读取 TSX 中的 ClassInfo 元数据，执行已编译 `supportedWidgetProperties` / `widgetPropertySchema` / `validateRuntimeWidgetProperty` 的受控夹具回归。因为使用源码元数据与模拟实例，**不能证明所有实际控件的创建、画布、保存重开或真实固件编译已成功**。

## 接下来的真正 P0/P1 任务

1. 在干净且正常运行的 IDE 中按 LVGL **8.4.0 → 9.x** 逐版本查询实际 `get_mcp_capabilities.creatableWidgetTypes`；输出与静态 39 类的对应差异，记录版本限制。
2. 对 37 种可创建组件逐类执行 `add_widget → get_widget_schema → set_widget_property → get_widget_details → save_project → reopen → Check/Build`，仅对当前 Schema 允许的属性尝试安全值，记录失败和回滚。
3. 优先补齐 ButtonMatrix 的 `buttons`、Chart 的 `series`、Meter 的指示器、Table 的单元格、Imgbutton 状态图片等复杂对象，以明确、受限的结构化 MCP API 实现，不开放任意对象赋值。
4. 高级 Flow（IsTrue True/False、CallAction、变量联动）真实 WASM E2E 当前受 `IPC_TIMEOUT` 阻断，使用独立验收工程验证，不与本次组件静态测试混为一谈。

**本轮未写入用户既有工程，未强制结束 IDE，也未提交 Git。**
