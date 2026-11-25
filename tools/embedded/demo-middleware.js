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

function modePrefix(message) {
    return message?.mode === "mock" ? "[模拟环境 / MOCK] MOCK_SIMULATED " : "";
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function sendProgress(socket, label, operation, values = [0, 50, 100]) {
    for (const value of values) {
        if (operation.cancelled) {
            sendLog(socket, `${operation.prefix}${label} cancelled`);
            return false;
        }
        sendLog(socket, `${operation.prefix}${label} ${value}%`);
        await wait(120);
    }
    return !operation.cancelled;
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
            sendMessage(socket, message);
            sendLog(socket, `${modePrefix(message)}middleware test ok`);
            return;
        case "log":
            sendLog(socket, `studio log: ${String(message.data || "")}`);
            return;
        case "cancel": {
            const operation = socket.__demoOperations?.get(message.operation);
            if (operation) {
                operation.cancelled = true;
            }
            return;
        }
        case "cmake": {
            const operation = {
                cancelled: false,
                prefix: modePrefix(message)
            };
            socket.__demoOperations ||= new Map();
            socket.__demoOperations.set("cmake", operation);
            try {
                resolveInsideRoot(root, message.output_dir || "./");
                const configFile = resolveInsideRoot(root, message.config_file || "");
                if (!fs.existsSync(configFile)) {
                    throw new Error(`config file does not exist: ${message.config_file}`);
                }
                sendLog(
                    socket,
                    `cmake output=${message.output_dir} config=${message.config_file}`
                );
                if (await sendProgress(socket, "cmake", operation)) {
                    sendLog(socket, `${operation.prefix}cmake completed`);
                }
            } catch (error) {
                sendLog(socket, `${operation.prefix}cmake failed: ${error.message || error}`);
            } finally {
                socket.__demoOperations.delete("cmake");
            }
            return;
        }
        case "transform":
            {
                const operation = {
                    cancelled: false,
                    prefix: modePrefix(message)
                };
                socket.__demoOperations ||= new Map();
                socket.__demoOperations.set("transform", operation);
                sendLog(socket, `${operation.prefix}transform ${message.type} ${message.model} started`);
                if (await sendProgress(socket, "transform", operation)) {
                    sendLog(socket, `${operation.prefix}transform completed`);
                }
                socket.__demoOperations.delete("transform");
            }
            return;
        case "build": {
            const operation = {
                cancelled: false,
                prefix: modePrefix(message)
            };
            socket.__demoOperations ||= new Map();
            socket.__demoOperations.set("build", operation);
            try {
                const source = resolveInsideRoot(root, message.src || "");
                const destination = resolveInsideRoot(root, message.dst || "");
                if (!fs.existsSync(source)) {
                    throw new Error(`source does not exist: ${message.src}`);
                }
                sendLog(socket, `${operation.prefix}build source=${message.src} destination=${message.dst}`);
                if (!(await sendProgress(socket, "build", operation))) {
                    return;
                }
                const firmware = createDemoFirmware(root, destination);
                sendLog(socket, `${operation.prefix}build completed: ${firmware}`);
            } catch (error) {
                sendLog(socket, `${operation.prefix}build failed: ${error.message || error}`);
            } finally {
                socket.__demoOperations.delete("build");
            }
            return;
        }
        case "download": {
            const operation = {
                cancelled: false,
                prefix: modePrefix(message)
            };
            socket.__demoOperations ||= new Map();
            socket.__demoOperations.set("download", operation);
            try {
                const firmware = resolveInsideRoot(root, message.firmware || "");
                if (!fs.existsSync(firmware)) {
                    throw new Error(`firmware does not exist: ${message.firmware}`);
                }
                sendLog(
                    socket,
                    `${operation.prefix}download target=${message.target} pack=${message.pack} script=${message.script} ${message.frequency}Hz ${message.addr}`
                );
                if (await sendProgress(socket, "download", operation)) {
                    sendLog(socket, `${operation.prefix}download completed (demo; no hardware was flashed)`);
                }
            } catch (error) {
                sendLog(socket, `${operation.prefix}download failed: ${error.message || error}`);
            } finally {
                socket.__demoOperations.delete("download");
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

    const clients = new Set();
    server.on("connection", socket => {
        clients.add(socket);
        socket.__demoOperations = new Map();
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
        socket.on("close", () => {
            clients.delete(socket);
            logger("Demo Middleware client disconnected");
        });
    });

    return {
        server,
        ready,
        disconnectClients: () => {
            for (const client of clients) {
                client.close(1012, "simulated disconnect");
            }
        },
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
