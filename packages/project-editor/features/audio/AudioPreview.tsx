import fs from "fs";
import { pathToFileURL } from "url";
import React from "react";
import { observer } from "mobx-react";

import { isObjectExists } from "project-editor/store";
import { ProjectContext } from "project-editor/project/context";
import { AudioResource } from "project-editor/features/audio/audio";

////////////////////////////////////////////////////////////////////////////////

interface WavFormat {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
}

interface WavPreviewInfo extends WavFormat {
    dataSize: number;
    duration: number;
    fileSize: number;
    waveform: number[];
}

interface AudioPreviewState {
    error?: string;
    info?: WavPreviewInfo;
    loading: boolean;
    fileSize?: number;
    mp3Duration?: number;
}

const MAX_WAVEFORM_POINTS = 320;
const MAX_FRAMES_PER_WAVEFORM_POINT = 64;

async function readBuffer(
    fileHandle: fs.promises.FileHandle,
    length: number,
    position: number
) {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fileHandle.read(buffer, 0, length, position);

    if (bytesRead !== length) {
        throw new Error("The WAV file is incomplete.");
    }

    return buffer;
}

function readSample(buffer: Buffer, offset: number, format: WavFormat): number {
    if (format.audioFormat === 1) {
        switch (format.bitsPerSample) {
            case 8:
                return (buffer.readUInt8(offset) - 128) / 128;
            case 16:
                return buffer.readInt16LE(offset) / 32768;
            case 24: {
                const value =
                    buffer.readUInt8(offset) |
                    (buffer.readUInt8(offset + 1) << 8) |
                    (buffer.readUInt8(offset + 2) << 16);
                return (
                    (value & 0x800000 ? value | 0xff000000 : value) / 8388608
                );
            }
            case 32:
                return buffer.readInt32LE(offset) / 2147483648;
        }
    }

    if (format.audioFormat === 3 && format.bitsPerSample === 32) {
        return buffer.readFloatLE(offset);
    }

    return 0;
}

function getWaveformPeak(buffer: Buffer, bytesRead: number, format: WavFormat) {
    const bytesPerSample = format.bitsPerSample / 8;
    let peak = 0;

    for (
        let frameOffset = 0;
        frameOffset + format.blockAlign <= bytesRead;
        frameOffset += format.blockAlign
    ) {
        for (let channel = 0; channel < format.channels; channel++) {
            const sampleOffset = frameOffset + channel * bytesPerSample;
            if (sampleOffset + bytesPerSample > bytesRead) {
                break;
            }

            const amplitude = Math.abs(
                readSample(buffer, sampleOffset, format)
            );
            if (Number.isFinite(amplitude)) {
                peak = Math.max(peak, Math.min(amplitude, 1));
            }
        }
    }

    return peak;
}

async function readWaveform(
    fileHandle: fs.promises.FileHandle,
    dataOffset: number,
    dataSize: number,
    format: WavFormat
) {
    const bytesPerSample = format.bitsPerSample / 8;
    const numberOfFrames = Math.floor(dataSize / format.blockAlign);

    if (
        ![1, 3].includes(format.audioFormat) ||
        !Number.isInteger(bytesPerSample) ||
        bytesPerSample < 1 ||
        bytesPerSample > 4 ||
        format.blockAlign > 4096 ||
        numberOfFrames === 0
    ) {
        return [];
    }

    const numberOfPoints = Math.min(MAX_WAVEFORM_POINTS, numberOfFrames);
    const framesPerPoint = Math.max(
        1,
        Math.ceil(numberOfFrames / numberOfPoints)
    );

    return Promise.all(
        Array.from({ length: numberOfPoints }, async (_, index) => {
            const startFrame = Math.min(
                numberOfFrames - 1,
                index * framesPerPoint
            );
            const framesToRead = Math.min(
                framesPerPoint,
                MAX_FRAMES_PER_WAVEFORM_POINT,
                numberOfFrames - startFrame
            );
            const length = framesToRead * format.blockAlign;
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await fileHandle.read(
                buffer,
                0,
                length,
                dataOffset + startFrame * format.blockAlign
            );

            return getWaveformPeak(buffer, bytesRead, format);
        })
    );
}

export async function readWavPreview(
    filePath: string
): Promise<WavPreviewInfo> {
    const fileHandle = await fs.promises.open(filePath, "r");

    try {
        const stats = await fileHandle.stat();
        if (stats.size < 12) {
            throw new Error("The WAV file is too small to contain a header.");
        }

        const riffHeader = await readBuffer(fileHandle, 12, 0);
        if (
            riffHeader.toString("ascii", 0, 4) !== "RIFF" ||
            riffHeader.toString("ascii", 8, 12) !== "WAVE"
        ) {
            throw new Error("The selected file is not a RIFF/WAVE audio file.");
        }

        let format: WavFormat | undefined;
        let dataOffset: number | undefined;
        let dataSize: number | undefined;
        let offset = 12;

        while (offset + 8 <= stats.size) {
            const chunkHeader = await readBuffer(fileHandle, 8, offset);
            const chunkName = chunkHeader.toString("ascii", 0, 4);
            const chunkSize = chunkHeader.readUInt32LE(4);
            const chunkDataOffset = offset + 8;

            if (chunkSize > stats.size - chunkDataOffset) {
                throw new Error(
                    "The WAV file contains an incomplete data chunk."
                );
            }

            if (chunkName === "fmt ") {
                if (chunkSize < 16) {
                    throw new Error("The WAV format chunk is invalid.");
                }

                const formatBuffer = await readBuffer(
                    fileHandle,
                    16,
                    chunkDataOffset
                );
                format = {
                    audioFormat: formatBuffer.readUInt16LE(0),
                    channels: formatBuffer.readUInt16LE(2),
                    sampleRate: formatBuffer.readUInt32LE(4),
                    byteRate: formatBuffer.readUInt32LE(8),
                    blockAlign: formatBuffer.readUInt16LE(12),
                    bitsPerSample: formatBuffer.readUInt16LE(14)
                };
            } else if (chunkName === "data") {
                dataOffset = chunkDataOffset;
                dataSize = chunkSize;
            }

            if (format && dataOffset !== undefined && dataSize !== undefined) {
                break;
            }

            offset = chunkDataOffset + chunkSize + (chunkSize % 2);
        }

        if (!format) {
            throw new Error("The WAV format chunk is missing.");
        }

        if (dataOffset === undefined || dataSize === undefined) {
            throw new Error("The WAV data chunk is missing.");
        }

        if (
            format.channels < 1 ||
            format.sampleRate < 1 ||
            format.byteRate < 1 ||
            format.blockAlign < 1 ||
            format.bitsPerSample < 1
        ) {
            throw new Error("The WAV format values are invalid.");
        }

        return {
            ...format,
            dataSize,
            duration: dataSize / format.byteRate,
            fileSize: stats.size,
            waveform: await readWaveform(
                fileHandle,
                dataOffset,
                dataSize,
                format
            )
        };
    } finally {
        await fileHandle.close();
    }
}

function formatDuration(duration: number) {
    if (!Number.isFinite(duration) || duration < 0) {
        return "--:--";
    }
    const totalSeconds = Math.max(0, Math.floor(duration));
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    return [hours, minutes, seconds]
        .filter((_, index) => index !== 0 || hours > 0)
        .map((value, index) =>
            index === 0 && hours === 0
                ? value.toString()
                : value.toString().padStart(2, "0")
        )
        .join(":");
}

function formatBytes(value: number) {
    if (value < 1024) {
        return `${value} B`;
    }

    const units = ["KB", "MB", "GB"];
    let unitIndex = -1;
    let size = value;

    do {
        size /= 1024;
        unitIndex++;
    } while (size >= 1024 && unitIndex < units.length - 1);

    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSampleRate(value: number) {
    if (value >= 1000) {
        return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`;
    }

    return `${value} Hz`;
}

function getFormatName(format: WavFormat) {
    const encoding =
        format.audioFormat === 1
            ? "PCM"
            : format.audioFormat === 3
              ? "IEEE Float"
              : `Format ${format.audioFormat}`;

    return `${encoding}, ${format.bitsPerSample}-bit`;
}

function getChannelName(channels: number) {
    if (channels === 1) {
        return "Mono";
    }

    if (channels === 2) {
        return "Stereo";
    }

    return `${channels} channels`;
}

function getStorageName(storage: string | undefined) {
    switch (storage) {
        case "internal-flash":
            return "Internal Flash";
        case "qspi-flash":
            return "QSPI Flash";
        case "spi-flash":
            return "SPI Flash";
        default:
            return "Not configured";
    }
}

const AudioMetadataItem = (props: { label: string; value: string }) => (
    <div className="EezStudio_AudioPreview_MetadataItem">
        <span>{props.label}</span>
        <strong title={props.value}>{props.value}</strong>
    </div>
);

////////////////////////////////////////////////////////////////////////////////

export const AudioPreview = observer(
    class AudioPreview extends React.Component {
        static contextType = ProjectContext;
        declare context: React.ContextType<typeof ProjectContext>;

        waveformCanvasRef = React.createRef<HTMLCanvasElement>();
        waveformContainerRef = React.createRef<HTMLDivElement>();
        resizeObserver: ResizeObserver | undefined;
        animationFrame: number | undefined;
        currentResource: AudioResource | undefined;
        currentFilePath: string | undefined;
        loadId = 0;
        unmounted = false;

        state: AudioPreviewState = {
            loading: false
        };

        get resource() {
            const resource =
                this.context.navigationStore.selectedAudioResourceObject.get();

            return resource instanceof AudioResource && isObjectExists(resource)
                ? resource
                : undefined;
        }

        componentDidMount() {
            this.loadPreview();

            if (
                this.waveformContainerRef.current &&
                typeof ResizeObserver !== "undefined"
            ) {
                this.resizeObserver = new ResizeObserver(this.drawWaveform);
                this.resizeObserver.observe(this.waveformContainerRef.current);
            }

            window.addEventListener("resize", this.drawWaveform);
        }

        componentDidUpdate() {
            const resource = this.resource;
            if (
                resource !== this.currentResource ||
                resource?.filePath !== this.currentFilePath
            ) {
                this.loadPreview();
            }

            this.drawWaveform();
        }

        componentWillUnmount() {
            this.unmounted = true;
            this.loadId++;
            this.resizeObserver?.disconnect();
            window.removeEventListener("resize", this.drawWaveform);

            if (this.animationFrame !== undefined) {
                cancelAnimationFrame(this.animationFrame);
            }
        }

        loadPreview = async () => {
            const resource = this.resource;
            const filePath = resource?.filePath;
            this.currentResource = resource;
            this.currentFilePath = filePath;
            const loadId = ++this.loadId;

            if (!resource) {
                this.setState({
                    error: undefined,
                    info: undefined,
                    loading: false,
                    fileSize: undefined,
                    mp3Duration: undefined
                });
                return;
            }

            if (!filePath) {
                this.setState({
                    error: "Select an audio file for this resource.",
                    info: undefined,
                    loading: false
                });
                return;
            }

            if (resource.format === "mp3") {
                const absolutePath = this.context.getAbsoluteFilePath(filePath);
                const stats = await fs.promises.stat(absolutePath).catch(() => undefined);
                if (loadId !== this.loadId || this.unmounted) {
                    return;
                }
                this.setState({
                    error: "MP3 waveform is not decoded in Studio; use the player below to preview it.",
                    info: undefined,
                    loading: false,
                    fileSize: stats?.size
                });
                return;
            }

            this.setState({ error: undefined, info: undefined, loading: true });

            try {
                const info = await readWavPreview(
                    this.context.getAbsoluteFilePath(filePath)
                );
                if (!this.unmounted && loadId === this.loadId) {
                    this.setState({ error: undefined, info, loading: false, fileSize: info.fileSize });
                }
            } catch (error) {
                if (!this.unmounted && loadId === this.loadId) {
                    this.setState({
                        error:
                            error instanceof Error
                                ? error.message
                                : "The WAV file could not be read.",
                        info: undefined,
                        loading: false
                    });
                }
            }
        };

        drawWaveform = () => {
            if (this.animationFrame !== undefined) {
                cancelAnimationFrame(this.animationFrame);
            }

            this.animationFrame = requestAnimationFrame(() => {
                this.animationFrame = undefined;

                const canvas = this.waveformCanvasRef.current;
                const container = this.waveformContainerRef.current;
                const waveform = this.state.info?.waveform;
                if (!canvas || !container || !waveform?.length) {
                    return;
                }

                const bounds = container.getBoundingClientRect();
                const pixelRatio = window.devicePixelRatio || 1;
                const width = Math.max(
                    1,
                    Math.floor(bounds.width * pixelRatio)
                );
                const height = Math.max(
                    1,
                    Math.floor(bounds.height * pixelRatio)
                );

                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }

                const context = canvas.getContext("2d");
                if (!context) {
                    return;
                }

                const style = window.getComputedStyle(container);
                const middle = canvas.height / 2;
                const barWidth = canvas.width / waveform.length;

                context.fillStyle = style.backgroundColor;
                context.fillRect(0, 0, canvas.width, canvas.height);

                context.strokeStyle = style.color;
                context.globalAlpha = 0.22;
                context.beginPath();
                context.moveTo(0, middle);
                context.lineTo(canvas.width, middle);
                context.stroke();

                context.globalAlpha = 0.76;
                context.fillStyle = style.color;
                waveform.forEach((peak, index) => {
                    const barHeight = Math.max(
                        1,
                        Math.min(1, peak) * canvas.height * 0.8
                    );
                    context.fillRect(
                        Math.floor(index * barWidth),
                        middle - barHeight / 2,
                        Math.max(1, Math.ceil(barWidth) - 1),
                        barHeight
                    );
                });

                context.globalAlpha = 1;
            });
        };

        render() {
            const resource = this.resource;
            if (!resource) {
                return (
                    <div className="EezStudio_AudioPreview_Empty" role="status">
                        Select an audio resource to view its preview.
                    </div>
                );
            }

            const { error, info, loading } = this.state;
            const flashLayout = this.context.project.audio?.flashLayout;
            const absoluteFilePath = resource.filePath
                ? this.context.getAbsoluteFilePath(resource.filePath)
                : undefined;
            const flashPlacement =
                resource.placement === "manual"
                    ? `Manual at 0x${resource.flashOffset
                          .toString(16)
                          .toUpperCase()}`
                    : "Automatic";

            return (
                <div className="EezStudio_AudioPreview">
                    <div className="EezStudio_AudioPreview_Header">
                        <div>
                            <div className="EezStudio_AudioPreview_Title">
                                {resource.name || "Unnamed Audio Resource"}
                            </div>
                            <div
                                className="EezStudio_AudioPreview_Path"
                                title={resource.filePath || undefined}
                            >
                                {resource.filePath || "No audio file selected"}
                            </div>
                        </div>
                        <span className="EezStudio_AudioPreview_FormatBadge">
                            {resource.format.toUpperCase()}
                        </span>
                    </div>

                    <div className="EezStudio_AudioPreview_WaveformSection">
                        <div className="EezStudio_AudioPreview_SectionHeader">
                            <span>{resource.format === "mp3" ? "Preview" : "Waveform"}</span>
                            <span aria-live="polite">
                                {loading
                                    ? "Reading audio file..."
                                    : info
                                      ? formatDuration(info.duration)
                                      : ""}
                            </span>
                        </div>
                        <div
                            ref={this.waveformContainerRef}
                                className={`EezStudio_AudioPreview_Waveform${resource.format === "mp3" ? " is-mp3" : ""}`}
                            role="img"
                            aria-label={
                                info
                                    ? `Waveform preview for ${resource.name}`
                                    : resource.format === "mp3"
                                      ? `Audio preview for ${resource.name}`
                                      : "Waveform preview unavailable"
                            }
                        >
                            <canvas
                                ref={this.waveformCanvasRef}
                                aria-hidden="true"
                            />
                            {!info && (
                                <div
                                    className="EezStudio_AudioPreview_WaveformMessage"
                                    aria-live="polite"
                                >
                                    {loading
                                        ? "Loading waveform..."
                                        : error ||
                                          "Audio metadata is not available."}
                                </div>
                            )}
                            {info && info.waveform.length === 0 && (
                                <div className="EezStudio_AudioPreview_WaveformMessage">
                                    Waveform preview is unavailable for this WAV
                                    encoding.
                                </div>
                            )}
                        </div>
                    </div>

                    {absoluteFilePath && !loading && (
                            <audio
                            className="EezStudio_AudioPreview_Player"
                            controls
                            preload="metadata"
                            src={pathToFileURL(absoluteFilePath).href}
                                aria-label={`Play ${resource.name}`}
                                onLoadedMetadata={event => {
                                    if (resource.format === "mp3") {
                                        this.setState({ mp3Duration: event.currentTarget.duration });
                                    }
                                }}
                        />
                    )}

                    {(info || resource.format === "mp3") && (
                        <div className="EezStudio_AudioPreview_Metadata">
                            <AudioMetadataItem label="Duration" value={formatDuration(info?.duration ?? this.state.mp3Duration ?? 0)} />
                            <AudioMetadataItem
                                label="Format"
                                value={info ? getFormatName(info) : "MP3 audio"}
                            />
                            <AudioMetadataItem
                                label="Sample Rate"
                                value={info ? formatSampleRate(info.sampleRate) : "Read by player"}
                            />
                            <AudioMetadataItem
                                label="Channels"
                                value={info ? getChannelName(info.channels) : "Read by player"}
                            />
                            <AudioMetadataItem
                                label="File Size"
                                value={formatBytes(info?.fileSize ?? this.state.fileSize ?? 0)}
                            />
                            <AudioMetadataItem
                                label="Flash Placement"
                                value={flashPlacement}
                            />
                            <AudioMetadataItem
                                label="Storage Target"
                                value={getStorageName(flashLayout?.storage)}
                            />
                            <AudioMetadataItem
                                label="Audio Data"
                                value={info ? formatBytes(info.dataSize) : "Decoded during build"}
                            />
                        </div>
                    )}

                    {resource.description && (
                        <div className="EezStudio_AudioPreview_Description">
                            {resource.description}
                        </div>
                    )}
                </div>
            );
        }
    }
);
