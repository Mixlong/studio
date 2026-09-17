import {
    parseEmbeddedMessage,
    serializeEmbeddedMessage,
    type EmbeddedIncomingMessage,
    type EmbeddedOutgoingMessage
} from "project-editor/features/embedded-platform/embedded-protocol";

////////////////////////////////////////////////////////////////////////////////

export type EmbeddedWebSocketState =
    | "disconnected"
    | "connecting"
    | "open"
    | "closing";

export interface EmbeddedWebSocketEventHandlers {
    onMessage?: (message: EmbeddedIncomingMessage) => void;
    onStateChange?: (state: EmbeddedWebSocketState) => void;
    onError?: (error: Error) => void;
}

////////////////////////////////////////////////////////////////////////////////

export class EmbeddedWebSocketClient {
    private endpoint: string;
    private timeoutMs: number;
    private socket: WebSocket | undefined;
    private connecting: Promise<void> | undefined;
    private timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    private state: EmbeddedWebSocketState = "disconnected";
    private handlers: EmbeddedWebSocketEventHandlers;

    constructor(
        endpoint: string,
        timeoutMs: number,
        handlers: EmbeddedWebSocketEventHandlers = {}
    ) {
        this.endpoint = endpoint;
        this.timeoutMs = timeoutMs;
        this.handlers = handlers;
    }

    get currentState() {
        return this.state;
    }

    setEndpoint(endpoint: string) {
        if (endpoint === this.endpoint) {
            return;
        }

        this.close();
        this.endpoint = endpoint;
    }

    setTimeout(timeoutMs: number) {
        this.timeoutMs = timeoutMs;
    }

    async connect() {
        if (!this.endpoint.trim()) {
            throw new Error("Embedded middleware WebSocket endpoint is empty.");
        }

        if (this.socket?.readyState === 1) {
            return;
        }

        if (this.connecting) {
            return this.connecting;
        }

        const WebSocketConstructor = (
            globalThis as typeof globalThis & {
                WebSocket?: typeof WebSocket;
            }
        ).WebSocket;
        if (!WebSocketConstructor) {
            throw new Error("WebSocket is not available in this runtime.");
        }

        this.setState("connecting");
        this.connecting = new Promise<void>((resolve, reject) => {
            let settled = false;
            let socket: WebSocket;

            const fail = (error: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.clearTimeout();
                this.socket = undefined;
                this.setState("disconnected");
                reject(error);
            };

            try {
                socket = new WebSocketConstructor(this.endpoint);
                this.socket = socket;
            } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
                return;
            }

            socket.onopen = () => {
                if (settled) {
                    return;
                }
                settled = true;
                this.clearTimeout();
                this.setState("open");
                resolve();
            };
            socket.onerror = () => {
                const error = new Error(
                    `Unable to connect to embedded middleware at ${this.endpoint}.`
                );
                this.handlers.onError?.(error);
                fail(error);
            };
            socket.onclose = event => {
                this.clearTimeout();
                this.socket = undefined;
                this.setState("disconnected");
                if (!settled) {
                    fail(
                        new Error(
                            `Embedded middleware WebSocket closed before connecting (code ${event.code}).`
                        )
                    );
                }
            };
            socket.onmessage = event => {
                this.handleMessage(event.data);
            };

            this.timeoutHandle = setTimeout(() => {
                const error = new Error(
                    `Timed out connecting to embedded middleware at ${this.endpoint}.`
                );
                this.handlers.onError?.(error);
                socket.close();
                fail(error);
            }, Math.max(100, this.timeoutMs));
        }).finally(() => {
            this.connecting = undefined;
        });

        return this.connecting;
    }

    async send(message: EmbeddedOutgoingMessage) {
        await this.connect();
        if (!this.socket || this.socket.readyState !== 1) {
            throw new Error("Embedded middleware WebSocket is not open.");
        }
        this.socket.send(serializeEmbeddedMessage(message));
    }

    close() {
        this.clearTimeout();
        this.connecting = undefined;
        if (!this.socket) {
            this.setState("disconnected");
            return;
        }

        this.setState("closing");
        this.socket.close();
        this.socket = undefined;
        this.setState("disconnected");
    }

    private setState(state: EmbeddedWebSocketState) {
        if (this.state === state) {
            return;
        }
        this.state = state;
        this.handlers.onStateChange?.(state);
    }

    private clearTimeout() {
        if (this.timeoutHandle !== undefined) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
    }

    private handleMessage(data: unknown) {
        try {
            this.handlers.onMessage?.(parseEmbeddedMessage(data));
        } catch (error) {
            this.handlers.onError?.(
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }
}
