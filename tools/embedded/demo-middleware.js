"use strict";

const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;

function parseArguments(argv) {
    const options = {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        root: process.cwd()
    };

    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--host") {
            options.host = argv[++index] || options.host;
        } else if (argument === "--port") {
            options.port = Number(argv[++index]);
        } else if (argument === "--root") {
            options.root = path.resolve(argv[++index] || options.root);
        } else if (argument === "--help" || argument === "-h") {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }

    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new Error("--port must be an integer between 0 and 65535.");
    }

    return options;
}

function printHelp() {
    console.log(`Usage: node tools/embedded/demo-middleware.js [options]

Options:
  --host <host>  Listen host (default: ${DEFAULT_HOST})
  --port <port>  Listen port (default: ${DEFAULT_PORT}; 0 chooses a free port)
  --root <path>  Project root used to resolve ./src, ./build and firmware paths
`);
}

function resolveInsideRoot(root, requestPath) {
    const resolved = path.resolve(root, String(requestPath || ""));
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path escapes demo root: ${requestPath}`);
    }
    return resolved;
}

function sendMessage(socket, message) {
    if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

function sendLog(socket, data) {
    sendMessage(socket, { command: "log", data });
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function sendProgress(socket, label, values = [0, 50, 100]) {
    for (const value of values) {
        sendLog(socket, `${label} ${value}%`);
        await wait(120);
    }
}

function createDemoFirmware(root, destination) {
    fs.mkdirSync(destination, { recursive: true });
    const firmwarePath = path.join(destination, "firmware.bin");
    const header = Buffer.from("EEZ-STUDIO-DEMO-FIRMWARE\n", "ascii");
    const contents = Buffer.alloc(256, 0);
    header.copy(contents);
    fs.writeFileSync(firmwarePath, contents);
    return `./${path.relative(root, firmwarePath).replace(/\\/g, "/")}`;
}

async function handleMessage(socket, message, root) {
    if (!message || typeof message !== "object") {
        sendLog(socket, "error: message must be a JSON object");
        return;
    }

    switch (message.command) {
        case "test":
            // §5.7 says test payload data is returned directly.
            sendMessage(socket, message);
            sendLog(socket, "middleware test ok");
            return;
        case "log":
            sendLog(socket, `studio log: ${String(message.data || "")}`);
            return;
        case "transform":
            sendLog(socket, `transform ${message.type} ${message.model} started`);
            await sendProgress(socket, "transform");
            sendLog(socket, "transform completed");
            return;
        case "build": {
            try {
                const source = resolveInsideRoot(root, message.src || "");
                const destination = resolveInsideRoot(root, message.dst || "");
                if (!fs.existsSync(source)) {
                    throw new Error(`source does not exist: ${message.src}`);
                }
                sendLog(socket, `build source=${message.src} destination=${message.dst}`);
                await sendProgress(socket, "build");
                const firmware = createDemoFirmware(root, destination);
                sendLog(socket, `build completed: ${firmware}`);
            } catch (error) {
                sendLog(socket, `build failed: ${error.message || error}`);
            }
            return;
        }
        case "download": {
            try {
                const firmware = resolveInsideRoot(root, message.firmware || "");
                if (!fs.existsSync(firmware)) {
                    throw new Error(`firmware does not exist: ${message.firmware}`);
                }
                sendLog(
                    socket,
                    `download ${message.interface} ${message.target} ${message.speed}kHz ${message.addr}`
                );
                await sendProgress(socket, "download");
                sendLog(socket, "download completed (demo; no hardware was flashed)");
            } catch (error) {
                sendLog(socket, `download failed: ${error.message || error}`);
            }
            return;
        }
        default:
            sendLog(socket, `error: unsupported command ${message.command || ""}`);
    }
}

function startDemoMiddleware({ host = DEFAULT_HOST, port = DEFAULT_PORT, root = process.cwd(), logger = console.log } = {}) {
    const resolvedRoot = path.resolve(root);
    const server = new WebSocketServer({ host, port });
    const ready = new Promise((resolve, reject) => {
        const onError = error => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.off("error", onError);
            const address = server.address();
            const actualPort = address && typeof address === "object" ? address.port : port;
            const endpoint = `ws://${host}:${actualPort}`;
            logger(`Demo Middleware listening on ${endpoint}`);
            logger(`Demo Middleware root: ${resolvedRoot}`);
            resolve({ endpoint, port: actualPort, root: resolvedRoot });
        };
        server.once("error", onError);
        server.once("listening", onListening);
    });

    server.on("connection", socket => {
        logger("Demo Middleware client connected");
        socket.on("message", data => {
            let message;
            try {
                message = JSON.parse(data.toString());
            } catch (error) {
                sendLog(socket, `error: invalid JSON (${error.message || error})`);
                return;
            }
            void handleMessage(socket, message, resolvedRoot);
        });
        socket.on("close", () => logger("Demo Middleware client disconnected"));
    });

    return {
        server,
        ready,
        close: () => new Promise(resolve => server.close(() => resolve()))
    };
}

if (require.main === module) {
    try {
        const options = parseArguments(process.argv.slice(2));
        if (options.help) {
            printHelp();
            process.exit(0);
        }
        const middleware = startDemoMiddleware(options);
        process.once("SIGINT", async () => {
            await middleware.close();
            process.exit(0);
        });
        process.once("SIGTERM", async () => {
            await middleware.close();
            process.exit(0);
        });
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

module.exports = { startDemoMiddleware };
