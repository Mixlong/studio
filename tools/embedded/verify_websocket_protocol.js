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
    formatEmbeddedIncomingMessage,
    serializeEmbeddedMessage,
    validateEmbeddedMessage
} = require("../../build/project-editor/features/embedded-platform/embedded-protocol");

const messages = [
    { command: "test", msg: "just for testing" },
    { command: "log", data: "OpenOCD is starting" },
    {
        command: "cmake",
        output_dir: "./",
        config_file: "./config_MH2457.py"
    },
    { command: "build", src: "./", dst: "./build" },
    {
        command: "download",
        target: "stm32f407ve",
        pack: "null",
        script: "null",
        frequency: "500000",
        firmware: "Project.bin",
        addr: "0x08000000"
    },
    { command: "transform", type: "picture", model: "rom" },
    { command: "cancel", operation: "build", mode: "mock" }
];

for (const message of messages) {
    assert.deepStrictEqual(validateEmbeddedMessage(message), []);
    assert.deepStrictEqual(
        parseEmbeddedMessage(serializeEmbeddedMessage(message)),
        message
    );
}

assert(
    validateEmbeddedMessage({ command: "download", target: "stm32f407ve" }).length > 0,
    "incomplete download messages must be rejected"
);
assert(
    validateEmbeddedMessage({ command: "cmake", output_dir: "./" }).length > 0,
    "incomplete cmake messages must be rejected"
);
assert(
    validateEmbeddedMessage({
        command: "download",
        interface: "cmsis-dap.cfg",
        target: "stm32f4x.cfg",
        speed: "5000",
        firmware: "Project.bin",
        addr: "0x08000000"
    }).length > 0,
    "legacy download messages must be rejected"
);
assert(
    validateEmbeddedMessage({
        command: "transform",
        type: "picture",
        model: "non-xip"
    }).length > 0,
    "legacy transform models must be rejected"
);
assert(
    validateEmbeddedMessage({ command: "cancel", operation: "unsupported" }).length > 0,
    "cancel must name a supported operation"
);
assert.throws(
    () => serializeEmbeddedMessage({ command: "build", src: "", dst: "./build" }),
    /Invalid embedded protocol message/
);
assert.throws(
    () => parseEmbeddedMessage("not-json"),
    /Invalid embedded protocol JSON/
);

// The remote console must retain structured metadata as well as multiline
// command output; only the protocol's log.data is used for stage detection.
const enrichedLog = {
    command: "log",
    data: "line one\nline two",
    progress: 64,
    phase: "build",
    diagnostics: { source: "middleware", code: 12 }
};
const displayed = formatEmbeddedIncomingMessage(enrichedLog);
assert(displayed.includes("line one\nline two"));
assert(displayed.includes('"progress": 64'));
assert(displayed.includes('"phase": "build"'));
assert(displayed.includes('"code": 12'));
assert.equal(formatEmbeddedIncomingMessage({ command: "log", data: "plain" }), "plain");
assert(formatEmbeddedIncomingMessage({ command: "result", state: "failed" }).includes('"state": "failed"'));

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
