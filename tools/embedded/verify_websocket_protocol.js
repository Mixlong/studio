const assert = require("assert");
const path = require("path");

const projectRoot = path.resolve(__dirname, "../..");
process.env.NODE_PATH = path.join(projectRoot, "build");
require("module").Module._initPaths();

const {
    EmbeddedWebSocketClient
} = require("../../build/project-editor/features/embedded-platform/embedded-websocket");
const {
    parseEmbeddedMessage,
    serializeEmbeddedMessage,
    validateEmbeddedMessage
} = require("../../build/project-editor/features/embedded-platform/embedded-protocol");

const messages = [
    { command: "test", msg: "just for testing" },
    { command: "log", data: "OpenOCD is starting" },
    { command: "build", src: "./", dst: "./build" },
    {
        command: "download",
        interface: "cmsis-dap.cfg",
        target: "stm32f4x.cfg",
        speed: "5000",
        firmware: "Project.bin",
        addr: "0x08000000"
    },
    { command: "transform", type: "picture", model: "rom" }
];

for (const message of messages) {
    assert.deepStrictEqual(validateEmbeddedMessage(message), []);
    assert.deepStrictEqual(
        parseEmbeddedMessage(serializeEmbeddedMessage(message)),
        message
    );
}

assert(
    validateEmbeddedMessage({ command: "download", speed: "5000" }).length > 0,
    "incomplete download messages must be rejected"
);
assert.throws(
    () => serializeEmbeddedMessage({ command: "build", src: "", dst: "./build" }),
    /Invalid embedded protocol message/
);
assert.throws(
    () => parseEmbeddedMessage("not-json"),
    /Invalid embedded protocol JSON/
);

class FakeWebSocket {
    static OPEN = 1;

    constructor(endpoint) {
        this.endpoint = endpoint;
        this.sent = [];
        this.readyState = 0;
        setImmediate(() => {
            this.readyState = 1;
            this.onopen?.();
        });
    }

    send(data) {
        this.sent.push(data);
    }

    close() {
        this.readyState = 3;
        this.onclose?.({ code: 1000 });
    }
}

global.WebSocket = FakeWebSocket;

void (async () => {
    const client = new EmbeddedWebSocketClient("ws://127.0.0.1:8765", 500);
    await client.send(messages[3]);
    assert.deepStrictEqual(JSON.parse(client.socket?.sent?.[0] || "{}"), messages[3]);
    client.close();
    console.log("WebSocket client transport verification passed.");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

console.log(`WebSocket protocol verification passed (${messages.length} message types).`);
