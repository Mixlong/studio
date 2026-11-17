# DigiwiseStudio update21

这是从 GUI Guider update21 批量导入的 DigiwiseStudio LVGL 工程。

- 页面：58
- 组件：856
- 图片资源：84
- 页面跳转：91（含主菜单、Ebike Settings、APP Connection 和信息页返回链路）
- 原项目中的受保护 custom_code 钩子：1082

打开 DigiwiseStudio_update21.eez-project 后，可以在 Pages 中查看全部页面，在 Flow 中查看页面跳转；设备协议、传感器读写等原固件业务逻辑仍需按硬件接口接入。

## 运行路径

在仓库根目录执行 `npm run start`，或在 DigiwiseStudio 中按 F5。运行入口是 `mainSrc`，当前可现场操作的主路径是：

`mainSrc` → 左上角 `MENU` → `menu_screen`，再进入 `Basic Settings`、`Ebike Settings`、`APP Connection`、`Smart Devices`、`Battery Information`、`System Information` 或 `Control Information`。

`Ebike Settings` 下面的 `Clear Trip`、`Auto Power Off`、`Auto Headlight`、`Auto Backlight`、`Speed Limit`、`Password`、`Advanced Settings` 和 `Factory Settings` 也已接入对应页面。

其中一条可直接演示的完整路径是：`mainSrc` → `MENU` → `Basic Settings` → `Languages` → `BACK` → `Basic Settings` → `BACK` → `menu_screen` → `BACK` → `mainSrc`。

菜单右上角 `BACK` 返回首页；基础设置页的各行继续进入对应的设置页，页面中的 `Change Screen` 动作就是实际交互逻辑。菜单滚动列表已按 960×640 画布修正，可直接看到各个菜单项。

## 实际操作示例

1. 在左侧 Pages 搜索 `basic_setting_screen`，双击打开页面。
2. 点击工具栏的“完整编辑视图”，即可看到页面组件和动作节点。
3. 选中 `Languages` 行对应的 `Change Screen` 动作，右侧可以修改目标页面、Fade、Speed、Delay 和 Use stack。
4. 本工程已核对：`basic_setting_screen -> languages_screen`，以及 `languages_screen -> basic_setting_screen` 返回动作。
5. 组件树用于选中页面控件，右侧 Properties 用于修改位置、大小、文本和样式；Components Palette 的 Actions 用于添加动作。

## 导入边界

- `logo_screen` 的一条点击动作和 `trip_data_screen` 的一条加载动作在原始 GUI Guider 文件中没有目标页面，因此保留为未解析动作，未擅自猜测。
- 原项目 `custom.c/custom.h` 是受保护固件代码；页面结构、资源和可识别跳转已导入，硬件协议、传感器读写等业务逻辑需要接入实际硬件接口。
