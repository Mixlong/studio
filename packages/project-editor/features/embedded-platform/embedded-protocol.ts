////////////////////////////////////////////////////////////////////////////////

export type EmbeddedProtocolCommand =
    | "test"
    | "log"
    | "cmake"
    | "build"
    | "download"
    | "transform"
    | "cancel";

export type EmbeddedExecutionMode = "real" | "mock";

export type EmbeddedTransformType = "picture" | "font" | "audio";
export type EmbeddedTransformModel = "rom" | "romxip" | "flashnormal";

export interface EmbeddedTestMessage {
    command: "test";
    msg?: string;
    mode?: EmbeddedExecutionMode;
}

export interface EmbeddedLogMessage {
    command: "log";
    data: string;
}

export interface EmbeddedCMakeMessage {
    command: "cmake";
    output_dir: string;
    config_file: string;
    mode?: EmbeddedExecutionMode;
}

export interface EmbeddedBuildMessage {
    command: "build";
    src: string;
    dst: string;
    mode?: EmbeddedExecutionMode;
}

export interface EmbeddedDownloadMessage {
    command: "download";
    target: string;
    pack: string;
    script: string;
    frequency: string;
    firmware: string;
    addr: string;
    mode?: EmbeddedExecutionMode;
}

export interface EmbeddedTransformMessage {
    command: "transform";
    type: EmbeddedTransformType;
    model: EmbeddedTransformModel;
    mode?: EmbeddedExecutionMode;
}

export interface EmbeddedCancelMessage {
    command: "cancel";
    operation: "cmake" | "build" | "download" | "transform";
    mode?: EmbeddedExecutionMode;
}

export type EmbeddedOutgoingMessage =
    | EmbeddedTestMessage
    | EmbeddedBuildMessage
    | EmbeddedCMakeMessage
    | EmbeddedDownloadMessage
    | EmbeddedTransformMessage
    | EmbeddedCancelMessage
    | EmbeddedLogMessage;

export interface EmbeddedIncomingMessage {
    command: string;
    [key: string]: unknown;
}

////////////////////////////////////////////////////////////////////////////////

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
    message: Record<string, unknown>,
    key: string,
    errors: string[]
) {
    if (typeof message[key] !== "string" || !message[key].trim()) {
        errors.push(`${key} must be a non-empty string`);
    }
}

function requiredPositiveIntegerString(
    message: Record<string, unknown>,
    key: string,
    errors: string[]
) {
    const value = message[key];
    if (typeof value !== "string" || !value.trim()) {
        errors.push(`${key} must be a non-empty string`);
        return;
    }
    if (!/^\d+$/.test(value.trim()) || Number(value) <= 0) {
        errors.push(`${key} must be a positive integer string`);
    }
}

function requiredEnum(
    message: Record<string, unknown>,
    key: string,
    values: readonly string[],
    errors: string[]
) {
    requiredString(message, key, errors);
    if (typeof message[key] === "string" && !values.includes(message[key])) {
        errors.push(`${key} must be one of: ${values.join(", ")}`);
    }
}

function optionalMode(message: Record<string, unknown>, errors: string[]) {
    if (
        message.mode !== undefined &&
        (typeof message.mode !== "string" || !["real", "mock"].includes(message.mode))
    ) {
        errors.push("mode must be either real or mock when provided");
    }
}

export function validateEmbeddedMessage(message: unknown): string[] {
    if (!isRecord(message)) {
        return ["message must be a JSON object"];
    }

    const errors: string[] = [];
    if (typeof message.command !== "string" || !message.command.trim()) {
        return ["command must be a non-empty string"];
    }

    switch (message.command) {
        case "test":
            optionalMode(message, errors);
            if (message.msg !== undefined && typeof message.msg !== "string") {
                errors.push("msg must be a string when provided");
            }
            break;
        case "log":
            requiredString(message, "data", errors);
            break;
        case "cmake":
            optionalMode(message, errors);
            requiredString(message, "output_dir", errors);
            requiredString(message, "config_file", errors);
            break;
        case "build":
            optionalMode(message, errors);
            requiredString(message, "src", errors);
            requiredString(message, "dst", errors);
            break;
        case "download":
            optionalMode(message, errors);
            requiredString(message, "target", errors);
            requiredString(message, "pack", errors);
            requiredString(message, "script", errors);
            requiredPositiveIntegerString(message, "frequency", errors);
            requiredString(message, "firmware", errors);
            requiredString(message, "addr", errors);
            break;
        case "transform":
            optionalMode(message, errors);
            requiredEnum(message, "type", ["picture", "font", "audio"], errors);
            requiredEnum(message, "model", ["rom", "romxip", "flashnormal"], errors);
            break;
        case "cancel":
            optionalMode(message, errors);
            requiredEnum(message, "operation", ["cmake", "build", "download", "transform"], errors);
            break;
        default:
            errors.push(`unsupported command: ${message.command}`);
            break;
    }

    return errors;
}

export function serializeEmbeddedMessage(message: EmbeddedOutgoingMessage) {
    const errors = validateEmbeddedMessage(message);
    if (errors.length > 0) {
        throw new Error(`Invalid embedded protocol message: ${errors.join("; ")}`);
    }
    return JSON.stringify(message);
}

// Preserve optional middleware fields (progress, phase, error metadata, etc.)
// in the remote console instead of showing only the "data" property.
export function formatEmbeddedIncomingMessage(message: EmbeddedIncomingMessage): string {
    if (message.command !== "log") {
        return `WebSocket ${message.command}: ${JSON.stringify(message, null, 2)}`;
    }
    const data = typeof message.data === "string"
        ? message.data
        : JSON.stringify(message.data ?? null, null, 2);
    const otherFields = Object.fromEntries(
        Object.entries(message).filter(([key]) => key !== "command" && key !== "data")
    );
    if (Object.keys(otherFields).length === 0) {
        return data;
    }
    return `${data}\n[WebSocket details] ${JSON.stringify(otherFields, null, 2)}`;
}

export function parseEmbeddedMessage(data: unknown): EmbeddedIncomingMessage {
    let value: unknown = data;
    if (typeof data === "string") {
        try {
            value = JSON.parse(data);
        } catch (error) {
            throw new Error(`Invalid embedded protocol JSON: ${error}`);
        }
    }

    if (!isRecord(value) || typeof value.command !== "string") {
        throw new Error("Embedded protocol message must contain a command string.");
    }

    return value as EmbeddedIncomingMessage;
}
