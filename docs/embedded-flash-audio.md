# 嵌入式 Flash 音频：资源构建说明

## 当前已完成

- 项目可选功能 `Audio`，启用后保存到 `.eez-project` 的 `audio` 节点；新导入文件会归档到项目 `audio/` 文件夹。
- `Audio Resources` 管理 WAV/MP3 音频源，文件路径相对项目保存。
- `Flash Layout` 管理单个音频分区的存储介质、基地址、分区大小和对齐值。
- 支持 `Internal Flash`、`QSPI Flash`、`SPI Flash` 三种存储目标描述。
- 支持自动布局和手工偏移两种资源放置方式。
- 校验 WAV 文件存在、格式、Flash 地址、容量、对齐和手工偏移。
- Build 时解析 PCM 数据，生成 `audio-manifest.json` 和统一的 `audio-data.c/.h` 资源索引；选择外部 Flash 时额外生成 `audio.bin`，选择 ROM 时音频数据直接写入 `audio-data.c`。
- 音频资源使用稳定的 `audio_index`：`0` 保留为停止/无音频，实际资源范围为 `1~100`；旧的连续 `id` 仍保留用于兼容已有消费者。
- `audio-data.h` 会生成资源索引枚举和 `eez_audio_find_resource(audio_index)` 查询接口，便于 Flow/BSP 按索引取得采样率、声道、位深、偏移和长度。
- 未启用统一资源存储时，音频默认按 ROM 方式生成 `audio-data.c/.h`，避免默认工程只得到未接入的裸二进制。
- WAV 可转换为 8/16-bit 有符号或无符号 PCM；MP3 通过 Audio Settings 中配置的 Python 脚本转换为 RAW PCM。
- 自动布局会优先保留手工地址，并在剩余空间中按对齐值填充资源。
- 自动检查资源重叠、分区容量和最终镜像对齐大小。

## 使用方式

1. 打开项目 `Settings`，在 `Project features` 中添加 `Audio`。
2. 在右侧 `Audio` 页签的 `Flash Layout` 中填写目标板的音频分区信息。
3. 通过 `Audio Resources` 的新增按钮导入 WAV 文件，并设置资源名称；确认 `Audio Index (0 = stop)` 唯一且处于 `1~100`。`0` 保留给停止/无音频。
4. 对 MP3 设置输出 PCM 格式。默认使用随 Studio 发布的转换脚本；如果需要自定义脚本，再填写 Python、FFmpeg 和转换脚本路径。自定义参数支持 `{input}`、`{output}`、`{format}`、`{sampleRate}`、`{channels}`、`{ffmpeg}` 占位符，带空格的路径需要加引号。
5. 默认使用 `Automatic` 布局；需要固定地址时切换为 `Manual` 并填写满足分区对齐的偏移。
6. 在 `Checks` 中处理缺失文件、无效地址、容量、对齐和索引错误。
7. 点击项目 `Build`。构建成功后，在 `destinationFolder` 中得到 `audio-data.c/.h`、`audio-manifest.json`，外部 Flash 模式还会得到 `audio.bin`。

WAV 解析使用小端 RIFF/WAVE PCM，支持 8/16/24/32-bit 采样；不支持压缩 WAV 或 IEEE Float WAV。MP3 转换依赖 Python 和 ffmpeg，Studio 默认随应用发布 `tools/embedded/convert_audio.py`，也可以在项目设置中替换为自定义脚本。

`audio.bin` 只包含 WAV `data` 块中的原始 PCM 数据，资源之间的空洞和镜像尾部使用 `0xFF` 填充。

## Studio 端验收清单

在没有开发板的情况下，音频 Studio 阶段按下面的闭环验收：

1. 导入一个 WAV 和一个 MP3，确认它们都被复制到工程的 `audio/` 文件夹。
2. 在预览页播放两个文件，并确认时长、格式和文件大小可见。
3. 配置 Flash 基地址、分区大小和对齐，分别验证 Automatic 和 Manual 两种布局。
4. 点击 Build，确认生成 `audio-data.c`、`audio-data.h`、`audio-manifest.json`；XIP/non-XIP 模式额外确认 `audio.bin`。
5. 修改一个不存在的文件、一个重叠地址和一个错误的转换器路径，确认 Build 失败并在 Output 面板显示可定位的错误。
6. 将两个资源设置为相同索引，或将索引设置为 `0/101`，确认 Checks 阻止构建并指出具体资源。
7. 关闭并重新打开工程，确认资源、索引、布局和转换配置仍然保留。

也可以在仓库根目录执行 `npm run verify-audio`，它会使用测试 MP3 验证内置转换脚本、PCM 输出、Flash 对齐、转换器缺失和资源重叠错误。该命令需要本机安装 `ffmpeg` 和 `python3`。

这条清单只验收 Studio 资源管理和构建，不包含 BSP、烧录器和开发板播放。开发板播放保留到后续阶段。

`audio-data.h` 提供 `eez_audio_resource_t`、`eez_audio_resources`、资源索引枚举和 `eez_audio_find_resource()`。BSP 应按 `audio_index` 读取采样率、声道、位深、Flash 偏移和长度：ROM 模式从 `eez_audio_data + flash_offset` 读取，XIP 模式从 `eez_audio_base_address + flash_offset` 读取，非 XIP 模式通过 SPI/QSPI 驱动按相同偏移读取。`id` 是旧版连续资源序号，仅用于兼容，不应作为 Flow 的业务索引。

项目数据结构示例：

```json
{
    "audio": {
        "flashLayout": {
            "storage": "qspi-flash",
            "baseAddress": "0x90000000",
            "partitionSize": 4194304,
            "alignment": 4096
        },
        "resources": [
            {
                "name": "startup_tone",
                "audioIndex": 1,
                "filePath": "assets/audio/startup.wav",
                "format": "wav",
                "placement": "automatic",
                "flashOffset": 0
            }
        ]
    }
}
```

清单中的 `flashOffset` 是相对于 `baseAddress` 的偏移，`flashAddress` 是可直接用于目标 Flash 映射的绝对地址。`imageSize` 是实际输出文件大小，已经按 `alignment` 向上取整。

## 当前边界

Studio 侧已经生成音频和图片资源镜像、资源索引以及 ROM/XIP/non-XIP 元数据；MCU 端仍需按清单实现 SPI/QSPI 读取和音频播放驱动。Flash 地址和容量必须来自目标板的 BSP/链接脚本，不能用通用默认值代替。

## 后续拆分

1. **下载烧录**：按照 BSP 定义将资源包写入内部 Flash、QSPI 或 SPI Flash。
2. **固件运行时**：实现 `audio_init`、`audio_play`、`audio_stop`，接入 I2S、PWM 或 Codec。
3. **编辑器编排**：增加 Flow 的播放/停止节点、资源引用和 PC 仿真。

第 1 步可以完全在 Studio 内独立完成；后续步骤需要明确 MCU、Flash 芯片、音频输出链路、烧录器和 BSP 工程。
