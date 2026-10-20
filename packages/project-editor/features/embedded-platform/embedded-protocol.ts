////////////////////////////////////////////////////////////////////////////////

export type EmbeddedProtocolCommand =
    | "test"
    | "log"
    | "cmake"
    | "build"
    | "download"
    | "transform";

export type EmbeddedTransformType = "picture" | "font" | "audio";
export type EmbeddedTransformModel = "rom" | "romxip" | "flashnormal";

export interface EmbeddedTestMessage {
    command: "test";
    msg?: string;
}

export interface EmbeddedLogMessage {
    command: "log";
    data: string;
}

export interface EmbeddedCMakeMessage {
    command: "cmake";
    output_dir: string;
    config_file: string;
}

export interface EmbeddedBuildMessage {
    command: "build";
    src: string;
    dst: string;
}

export interface EmbeddedDownloadMessage {
    command: "download";
    target: string;
    pack: string;
    script: string;
    frequency: string;
    firmware: string;
    addr: string;
}

export interface EmbeddedTransformMessage {
    command: "transform";
    type: EmbeddedTransformType;
    model: EmbeddedTransformModel;
}

export type EmbeddedOutgoingMessage =
    | EmbeddedTestMessage
    | EmbeddedBuildMessage
    | EmbeddedCMakeMessage
    | EmbeddedDownloadMessage
    | EmbeddedTransformMessage
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
            if (message.msg !== undefined && typeof message.msg !== "string") {
                errors.push("msg must be a string when provided");
            }
            break;
        case "log":
            requiredString(message, "data", errors);
            break;
        case "cmake":
            requiredString(message, "output_dir", errors);
            requiredString(message, "config_file", errors);
            break;
        case "build":
            requiredString(message, "src", errors);
            requiredString(message, "dst", errors);
            break;
        case "download":
            requiredString(message, "target", errors);
            requiredString(message, "pack", errors);
            requiredString(message, "script", errors);
            requiredPositiveIntegerString(message, "frequency", errors);
            requiredString(message, "firmware", errors);
            requiredString(message, "addr", errors);
            break;
        case "transform":
            requiredEnum(message, "type", ["picture", "font", "audio"], errors);
            requiredEnum(message, "model", ["rom", "romxip", "flashnormal"], errors);
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
