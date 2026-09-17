"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");

const projectRoot = path.resolve(__dirname, "../..");
process.env.NODE_PATH = path.join(projectRoot, "build");
require("module").Module._initPaths();

const { EmbeddedWebSocketClient } = require(
    "../../build/project-editor/features/embedded-platform/embedded-websocket"
);
const { startDemoMiddleware } = require("./demo-middleware");

global.WebSocket = WebSocket;

function waitFor(predicate, messages, timeoutMs = 3000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            const match = messages.find(predicate);
            if (match) {
                resolve(match);
                return;
            }
            if (Date.now() - started >= timeoutMs) {
                reject(new Error("Timed out waiting for demo Middleware message."));
                return;
            }
            setTimeout(check, 20);
        };
        check();
    });
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "eez-p1-demo-"));
    fs.mkdirSync(path.join(root, "src"));
    const middleware = startDemoMiddleware({ host: "127.0.0.1", port: 0, root });
    const address = await middleware.ready;
    const messages = [];
    const client = new EmbeddedWebSocketClient(address.endpoint, 1000, {
        onMessage: message => messages.push(message)
    });

    try {
        await client.send({ command: "test", msg: "demo test" });
        await waitFor(message => message.command === "test", messages);

        await client.send({ command: "transform", type: "picture", model: "rom" });
        await waitFor(
            message => message.command === "log" && /transform 100%/.test(message.data),
            messages
        );

        await client.send({ command: "build", src: "./", dst: "./build" });
        await waitFor(
            message => message.command === "log" && /build completed/.test(message.data),
            messages
        );
        const firmware = path.join(root, "build", "firmware.bin");
        assert(fs.existsSync(firmware), "demo build should create firmware.bin");

        await client.send({
            command: "download",
            interface: "cmsis-dap.cfg",
            target: "stm32f4x.cfg",
            speed: "5000",
            firmware: "./build/firmware.bin",
            addr: "0x08000000"
        });
        await waitFor(
            message => message.command === "log" && /download completed/.test(message.data),
            messages
        );

        console.log("Complete P1 demo middleware verification passed.");
    } finally {
        client.close();
        await middleware.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
