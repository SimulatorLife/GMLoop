import assert from "node:assert/strict";
import test from "node:test";

import {
    type MessageEventLike,
    type RuntimePatchError,
    type RuntimeWebSocketConstructor,
    type RuntimeWebSocketInstance,
    RuntimeWrapper,
    type WebSocketEvent
} from "../index.js";

const globalWithWebSocket = globalThis as unknown as {
    WebSocket?: RuntimeWebSocketConstructor;
};

const globalBuiltins = globalThis as Record<string, unknown>;

if (!globalBuiltins.g_pBuiltIn) {
    globalBuiltins.g_pBuiltIn = { application_surface: -1 };
}

const globalWithJson = globalThis as Record<string, unknown> & {
    JSON_game?: { ScriptNames?: Array<string>; Scripts?: Array<unknown> };
};

if (!globalWithJson.JSON_game) {
    globalWithJson.JSON_game = {
        ScriptNames: ["gml_Script_bootstrap"],
        Scripts: [() => void 0]
    };
}

const wait = (ms: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });

const flush = () =>
    new Promise<void>((resolve) => {
        setImmediate(resolve);
    });

class MockWebSocket implements RuntimeWebSocketInstance {
    public readyState = 0;
    private readonly listeners: Record<WebSocketEvent, Array<(event?: unknown) => void>> = {
        open: [],
        message: [],
        close: [],
        error: []
    };

    constructor(public readonly url: string) {
        setImmediate(() => {
            this.readyState = 1;
            this.dispatch("open");
        });
    }

    addEventListener(event: WebSocketEvent, handler: (event?: Error | MessageEventLike) => void) {
        this.listeners[event]?.push(handler);
    }

    removeEventListener(event: WebSocketEvent, handler: (event?: Error | MessageEventLike) => void) {
        const queue = this.listeners[event];
        const index = queue?.indexOf(handler);
        if (queue && typeof index === "number" && index >= 0) {
            queue.splice(index, 1);
        }
    }

    send(data: string) {
        void data;
        if (this.readyState !== 1) {
            throw new Error("WebSocket is not open");
        }
    }

    close() {
        if (this.readyState === 3) {
            return;
        }

        this.readyState = 3;
        setImmediate(() => {
            this.dispatch("close");
        });
    }

    simulateMessage(data: unknown) {
        this.dispatch("message", { data });
    }

    simulateError(error: Error = new Error("Connection error")) {
        this.dispatch("error", error);
    }

    private dispatch(event: WebSocketEvent, payload?: Error | MessageEventLike) {
        for (const handler of this.listeners[event] ?? []) {
            handler(payload);
        }
    }
}

async function runWebSocketTest(
    options: Parameters<typeof RuntimeWrapper.createWebSocketClient>[0],
    testFn: (
        client: ReturnType<typeof RuntimeWrapper.createWebSocketClient>,
        mockSocket: MockWebSocket
    ) => Promise<void>
) {
    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        client = RuntimeWrapper.createWebSocketClient(options);

        await flush();

        const ws = client.getWebSocket();
        await testFn(client, ws as MockWebSocket);
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
}

void test("createWebSocketClient returns client interface", () => {
    const client = RuntimeWrapper.createWebSocketClient({ autoConnect: false });
    assert.strictEqual(typeof client.connect, "function");
    assert.strictEqual(typeof client.disconnect, "function");
    assert.strictEqual(typeof client.isConnected, "function");
    assert.strictEqual(typeof client.send, "function");
});

void test("createWebSocketClient does not auto-connect when autoConnect is false", () => {
    const client = RuntimeWrapper.createWebSocketClient({ autoConnect: false });
    assert.strictEqual(client.isConnected(), false);
});

void test("WebSocket client connects and receives patches", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    let connectCalled = false;

    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;
    const connectPromise = new Promise<void>((resolve) => {
        client = RuntimeWrapper.createWebSocketClient({
            wrapper,
            onConnect: () => {
                connectCalled = true;
                resolve();
            },
            autoConnect: true
        });
    });

    await connectPromise;

    assert.ok(connectCalled);
    assert.ok(client, "WebSocket client should exist");
    assert.ok(client.isConnected());

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client applies patches from messages", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    await wait(50);

    const patch = {
        kind: "script",
        id: "script:test",
        js_body: "return 42;"
    };

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");
    const mockSocket = ws as MockWebSocket;

    mockSocket.simulateMessage(JSON.stringify(patch));

    await wait(10);

    assert.ok(wrapper.hasScript("script:test"));

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client applies batch patches from messages", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    await wait(50);

    const patches = [
        {
            kind: "script",
            id: "script:batch_one",
            js_body: "return 21;"
        },
        {
            kind: "event",
            id: "obj_batch#Create",
            js_body: "this.created = true;"
        }
    ];

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");
    const mockSocket = ws as MockWebSocket;

    mockSocket.simulateMessage(JSON.stringify(patches));

    await wait(10);

    assert.ok(wrapper.hasScript("script:batch_one"));
    assert.ok(wrapper.hasEvent("obj_batch#Create"));

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client clears readiness timer on close with pending patches", async (t) => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const intervalIds = new Set<ReturnType<typeof setInterval>>();
    const originalJsonGame = globalWithJson.JSON_game;

    globalThis.setInterval = ((handler, timeout, ...args) => {
        void handler;
        void timeout;
        void args;
        const id = Symbol("readiness-timer") as unknown as ReturnType<typeof setInterval>;
        intervalIds.add(id);
        return id;
    }) as typeof setInterval;

    globalThis.clearInterval = ((id) => {
        intervalIds.delete(id as ReturnType<typeof setInterval>);
    }) as typeof clearInterval;

    globalWithJson.JSON_game = {
        ScriptNames: [],
        Scripts: []
    };

    globalWithWebSocket.WebSocket = MockWebSocket;

    t.after(() => {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
        globalWithJson.JSON_game = originalJsonGame;
        delete globalWithWebSocket.WebSocket;
    });

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    await flush();

    const ws = client.getWebSocket() as MockWebSocket;
    ws.simulateMessage(
        JSON.stringify({
            kind: "script",
            id: "script:queued",
            js_body: "return 1;"
        })
    );

    assert.equal(intervalIds.size, 1);

    ws.close();

    await flush();

    assert.equal(intervalIds.size, 0);

    client.disconnect();
});

void test("WebSocket client defers patch batches until runtime readiness", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const readyJsonGame = {
        ScriptNames: ["gml_Script_bootstrap"],
        Scripts: [() => void 0]
    };

    globalWithJson.JSON_game = {
        ScriptNames: readyJsonGame.ScriptNames,
        Scripts: [null]
    };

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    try {
        await wait(50);

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");
        const mockSocket = ws as MockWebSocket;

        const pendingPatches = [
            { kind: "script", id: "script:pending_one", js_body: "return 1;" },
            { kind: "script", id: "script:pending_two", js_body: "return 2;" }
        ];

        mockSocket.simulateMessage(JSON.stringify(pendingPatches));

        await wait(50);

        assert.strictEqual(wrapper.hasScript("script:pending_one"), false);
        assert.strictEqual(wrapper.hasScript("script:pending_two"), false);

        globalWithJson.JSON_game = readyJsonGame;

        await wait(100);

        assert.ok(wrapper.hasScript("script:pending_one"));
        assert.ok(wrapper.hasScript("script:pending_two"));
    } finally {
        client.disconnect();
        globalWithJson.JSON_game = readyJsonGame;
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client deduplicates deferred patches before runtime readiness flush", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const readyJsonGame = {
        ScriptNames: ["gml_Script_bootstrap"],
        Scripts: [() => void 0]
    };

    globalWithJson.JSON_game = {
        ScriptNames: readyJsonGame.ScriptNames,
        Scripts: [null]
    };

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    try {
        await wait(50);

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");
        const mockSocket = ws as MockWebSocket;

        mockSocket.simulateMessage(
            JSON.stringify({
                kind: "script",
                id: "script:deferred_duplicate",
                js_body: "return 1;"
            })
        );
        mockSocket.simulateMessage(
            JSON.stringify({
                kind: "script",
                id: "script:deferred_duplicate",
                js_body: "return 2;"
            })
        );
        mockSocket.simulateMessage(
            JSON.stringify({
                kind: "script",
                id: "script:deferred_duplicate",
                js_body: "return 3;"
            })
        );

        await wait(40);

        assert.strictEqual(wrapper.hasScript("script:deferred_duplicate"), false);

        globalWithJson.JSON_game = readyJsonGame;

        await wait(120);

        assert.strictEqual(wrapper.hasScript("script:deferred_duplicate"), true);
        assert.strictEqual(wrapper.getRegistrySnapshot().scriptCount, 1);

        const appliedScript = wrapper.getScript("script:deferred_duplicate");
        assert.ok(appliedScript, "Deferred script should be installed after readiness");
        assert.strictEqual(appliedScript(null, null, []), 3);

        const history = wrapper.getPatchById("script:deferred_duplicate");
        assert.strictEqual(history.length, 1);
    } finally {
        client.disconnect();
        globalWithJson.JSON_game = readyJsonGame;
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client bounds deferred patches before runtime readiness", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const readyJsonGame = {
        ScriptNames: ["gml_Script_bootstrap"],
        Scripts: [() => void 0]
    };

    globalWithJson.JSON_game = {
        ScriptNames: readyJsonGame.ScriptNames,
        Scripts: [null]
    };

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    try {
        await wait(50);

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");
        const mockSocket = ws as MockWebSocket;

        for (let index = 0; index < 120; index += 1) {
            mockSocket.simulateMessage(
                JSON.stringify({
                    kind: "script",
                    id: `script:deferred_${index}`,
                    js_body: `return ${index};`
                })
            );
        }

        await wait(40);

        assert.strictEqual(wrapper.hasScript("script:deferred_0"), false);
        assert.strictEqual(wrapper.hasScript("script:deferred_119"), false);

        globalWithJson.JSON_game = readyJsonGame;

        await wait(120);

        const snapshot = wrapper.getRegistrySnapshot();
        assert.strictEqual(snapshot.scriptCount, 100);
        assert.strictEqual(wrapper.hasScript("script:deferred_0"), false);
        assert.strictEqual(wrapper.hasScript("script:deferred_19"), false);
        assert.ok(wrapper.hasScript("script:deferred_20"));
        assert.ok(wrapper.hasScript("script:deferred_119"));
    } finally {
        client.disconnect();
        globalWithJson.JSON_game = readyJsonGame;
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client routes deferred patches through patch queue after runtime readiness", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const runtimeGlobals = globalThis as unknown as { JSON_game: unknown };
    const originalJsonGame = runtimeGlobals.JSON_game;

    globalWithWebSocket.WebSocket = MockWebSocket;

    Reflect.set(runtimeGlobals, "JSON_game", {
        ScriptNames: ["gml_Script_bootstrap"],
        Scripts: [null]
    });

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true,
        patchQueue: {
            enabled: true,
            flushIntervalMs: 10,
            maxQueueSize: 10
        }
    });

    try {
        await wait(50);

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");
        const mockSocket = ws as MockWebSocket;

        mockSocket.simulateMessage(
            JSON.stringify({
                kind: "script",
                id: "script:deferred_with_queue",
                js_body: "return 7;"
            })
        );

        await wait(50);

        assert.strictEqual(wrapper.hasScript("script:deferred_with_queue"), false);
        assert.strictEqual(client.getPatchQueueMetrics()?.totalQueued ?? 0, 0);

        Reflect.set(runtimeGlobals, "JSON_game", {
            ScriptNames: ["gml_Script_bootstrap"],
            Scripts: [() => void 0]
        });

        await wait(120);

        assert.strictEqual(wrapper.hasScript("script:deferred_with_queue"), true);

        const metrics = client.getPatchQueueMetrics();
        assert.ok(metrics, "Patch queue metrics should be available");
        assert.ok(metrics.totalQueued >= 1);
        assert.ok(metrics.totalFlushed >= 1);
    } finally {
        client.disconnect();
        Reflect.set(runtimeGlobals, "JSON_game", originalJsonGame);
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client reports hot reload error notifications", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    let reportedError: RuntimePatchError | null = null;
    let reportedPhase: "connection" | "patch" | null = null;

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true,
        onError: (error, phase) => {
            reportedError = error;
            reportedPhase = phase;
        }
    });

    await wait(50);

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");
    const mockSocket = ws as MockWebSocket;

    mockSocket.simulateMessage(
        JSON.stringify({
            kind: "error",
            filePath: "test_script.gml",
            error: "Syntax error at line 4",
            timestamp: Date.now()
        })
    );

    await wait(10);

    assert.ok(reportedError, "Should surface hot reload errors");
    assert.strictEqual(reportedPhase, "patch");
    assert.match(reportedError.message, /test_script\.gml/u);
    assert.match(reportedError.message, /Syntax error at line 4/u);
    assert.strictEqual(wrapper.hasScript("test_script"), false);

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client waits for GameMaker builtins before applying patches", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    globalWithWebSocket.WebSocket = MockWebSocket;

    const globals = globalThis as Record<string, unknown>;
    const savedBuiltins = globals.g_pBuiltIn;

    delete globals.g_pBuiltIn;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    try {
        await wait(50);

        const patch = {
            kind: "script",
            id: "script:application_surface",
            js_body: "return application_surface;"
        };

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");
        const mockSocket = ws as MockWebSocket;
        mockSocket.simulateMessage(JSON.stringify(patch));

        await wait(20);

        assert.ok(!wrapper.hasScript(patch.id), "Patch should be deferred until builtins are ready");

        globals.g_pBuiltIn = {
            application_surface: 123,
            get_application_surface() {
                const self = this as Record<string, unknown>;
                return self.application_surface;
            }
        };

        await wait(150);

        assert.ok(wrapper.hasScript(patch.id));
        const fn = wrapper.getScript(patch.id);
        assert.ok(fn);
        const result = fn(null, null, []) as number;
        assert.strictEqual(result, 123);
    } finally {
        client.disconnect();

        if (savedBuiltins === undefined) {
            delete globals.g_pBuiltIn;
        } else {
            globals.g_pBuiltIn = savedBuiltins;
        }

        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client waits for JSON_game before applying patches", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    globalWithWebSocket.WebSocket = MockWebSocket;

    const globals = globalThis as Record<string, unknown>;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJson = globals.JSON_game;

    delete globals.JSON_game;
    globals.g_pBuiltIn = {
        application_surface: -1,
        get_application_surface() {
            const self = this as Record<string, unknown>;
            return self.application_surface;
        }
    };

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        client = RuntimeWrapper.createWebSocketClient({
            wrapper,
            autoConnect: true
        });

        await wait(50);

        const patch = {
            kind: "script",
            id: "script:application_surface_property",
            js_body: "return application_surface;"
        };

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");
        (ws as MockWebSocket).simulateMessage(JSON.stringify(patch));

        await wait(20);

        assert.ok(!wrapper.hasScript(patch.id), "Patch should wait for JSON_game");

        globals.JSON_game = {
            ScriptNames: ["gml_Script_application_surface"],
            Scripts: [
                function applicationSurfaceScript() {
                    const runtimeGlobals = globalThis as Record<string, unknown>;
                    const runtimeBuiltins = runtimeGlobals.g_pBuiltIn as Record<string, unknown> | undefined;
                    return runtimeBuiltins?.application_surface;
                }
            ]
        };

        await wait(150);

        assert.ok(wrapper.hasScript(patch.id));
        const fn = wrapper.getScript(patch.id);
        assert.ok(fn);
        const result = fn(null, null, []) as number;
        assert.strictEqual(result, -1);
    } finally {
        client?.disconnect();

        if (savedBuiltins === undefined) {
            delete globals.g_pBuiltIn;
        } else {
            globals.g_pBuiltIn = savedBuiltins;
        }

        if (savedJson === undefined) {
            delete globals.JSON_game;
        } else {
            globals.JSON_game = savedJson;
        }

        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client caches runtime readiness checks after first successful probe", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    globalWithWebSocket.WebSocket = MockWebSocket;

    const globals = globalThis as Record<string, unknown>;
    const savedJson = globals.JSON_game;

    const scripts = [() => void 0] as Array<unknown> & { someCallCount: number };
    const originalSome = scripts.some.bind(scripts);
    scripts.someCallCount = 0;
    scripts.some = ((predicate, thisArg) => {
        scripts.someCallCount += 1;
        return originalSome(predicate, thisArg);
    }) as Array<unknown>["some"];

    globals.JSON_game = {
        ScriptNames: ["gml_Script_probe"],
        Scripts: scripts
    };

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    try {
        await wait(50);

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");
        const mockSocket = ws as MockWebSocket;

        mockSocket.simulateMessage(
            JSON.stringify({
                kind: "script",
                id: "script:cached_ready_one",
                js_body: "return 1;"
            })
        );

        mockSocket.simulateMessage(
            JSON.stringify({
                kind: "script",
                id: "script:cached_ready_two",
                js_body: "return 2;"
            })
        );

        await wait(10);

        assert.strictEqual(wrapper.hasScript("script:cached_ready_one"), true);
        assert.strictEqual(wrapper.hasScript("script:cached_ready_two"), true);
        assert.strictEqual(scripts.someCallCount, 1);
    } finally {
        client.disconnect();

        if (savedJson === undefined) {
            delete globals.JSON_game;
        } else {
            globals.JSON_game = savedJson;
        }

        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client accepts structured payloads", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    await wait(50);

    const patch = {
        kind: "event",
        id: "obj_structured#Create",
        js_body: "this.ready = true;"
    } satisfies Record<string, unknown>;

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");

    (ws as MockWebSocket).simulateMessage(patch);

    await wait(10);

    assert.ok(wrapper.hasEvent("obj_structured#Create"));

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client decodes binary JSON payloads", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    await wait(50);

    const patch = {
        kind: "script",
        id: "script:binary",
        js_body: "return 128;"
    };

    const encoded = new TextEncoder().encode(JSON.stringify(patch));

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");

    (ws as MockWebSocket).simulateMessage(encoded);

    await wait(10);

    assert.ok(wrapper.hasScript("script:binary"));

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client prefers trySafeApply when available", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const originalTrySafeApply = wrapper.trySafeApply.bind(wrapper);
    let trySafeApplyCalls = 0;

    wrapper.trySafeApply = (...args) => {
        trySafeApplyCalls++;
        return originalTrySafeApply(...args);
    };

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: true
    });

    await wait(50);

    const patch = {
        kind: "script",
        id: "script:prefers_safe",
        js_body: "return 7;"
    };

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");
    const mockSocket = ws as MockWebSocket;

    mockSocket.simulateMessage(JSON.stringify(patch));

    await wait(10);

    assert.strictEqual(trySafeApplyCalls, 1);
    assert.ok(wrapper.hasScript("script:prefers_safe"));

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client handles invalid JSON gracefully", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    let errorCalled = false;

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        onError: (error, context) => {
            errorCalled = true;
            assert.strictEqual(context, "patch");
        },
        autoConnect: true
    });

    await wait(50);

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");
    const mockSocket = ws as MockWebSocket;

    mockSocket.simulateMessage("invalid json");

    await wait(10);

    assert.ok(errorCalled);

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client surfaces trySafeApply failures", async () => {
    let capturedError: RuntimePatchError | null = null;
    let capturedContext: "connection" | "patch" | null = null;

    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    wrapper.trySafeApply = () => ({
        success: false,
        message: "Shadow validation failed: syntax error",
        error: "syntax error",
        rolledBack: true
    });

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        onError: (error, context) => {
            capturedError = error;
            capturedContext = context;
        },
        autoConnect: true
    });

    await wait(50);

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");
    const mockSocket = ws as MockWebSocket;

    const failingPatch = {
        kind: "script",
        id: "script:bad",
        js_body: "return 42;"
    };

    mockSocket.simulateMessage(JSON.stringify(failingPatch));

    await wait(10);

    assert.ok(capturedError);
    assert.strictEqual(capturedContext, "patch");
    assert.ok(capturedError.message.includes("Shadow validation failed"));
    assert.deepEqual(capturedError.patch, failingPatch);
    assert.strictEqual(capturedError.rolledBack, true);

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client disconnects cleanly", async () => {
    let disconnectCalled = false;

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        onDisconnect: () => {
            disconnectCalled = true;
        },
        autoConnect: true
    });

    await wait(50);

    client.disconnect();

    await wait(50);

    assert.ok(disconnectCalled);
    assert.strictEqual(client.isConnected(), false);

    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client removes socket observers on disconnect to prevent listener leaks", () => {
    type Listener = (event?: Error | MessageEventLike) => void;
    type ListenerMap = Record<WebSocketEvent, Array<Listener>>;

    class ListenerTrackingWebSocket implements RuntimeWebSocketInstance {
        public readyState = 0;
        private readonly listeners: ListenerMap = {
            open: [],
            message: [],
            close: [],
            error: []
        };

        constructor(public readonly url: string) {
            void this.url;
        }

        addEventListener(event: WebSocketEvent, handler: Listener): void {
            this.listeners[event].push(handler);
        }

        removeEventListener(event: WebSocketEvent, handler: Listener): void {
            const index = this.listeners[event].indexOf(handler);
            if (index !== -1) {
                this.listeners[event].splice(index, 1);
            }
        }

        send(_data: string): void {}

        close(): void {
            this.readyState = 3;
            for (const handler of this.listeners.close) {
                handler();
            }
        }

        countListeners(): number {
            return (
                this.listeners.open.length +
                this.listeners.message.length +
                this.listeners.close.length +
                this.listeners.error.length
            );
        }
    }

    globalWithWebSocket.WebSocket = ListenerTrackingWebSocket as unknown as RuntimeWebSocketConstructor;

    try {
        const client = RuntimeWrapper.createWebSocketClient({
            autoConnect: false
        });
        client.connect();
        const socket = client.getWebSocket() as ListenerTrackingWebSocket;

        assert.equal(socket.countListeners(), 4, "expected one listener per websocket event type after connect");

        client.disconnect();

        assert.equal(socket.countListeners(), 0, "disconnect() should remove all websocket listeners from the socket");
    } finally {
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client reconnects after connection loss", async () => {
    let reconnectCount = 0;

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        onConnect: () => {
            reconnectCount++;
        },
        reconnectDelay: 30,
        autoConnect: true
    });

    try {
        await wait(40);

        assert.strictEqual(reconnectCount, 1);

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");

        ws.close();

        await wait(10);
        await wait(40);

        assert.ok(reconnectCount >= 2, `Expected at least 2 reconnects, got ${reconnectCount}`);
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client clears pending reconnect timer on manual reconnect", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const trackedTimers = new Map<ReturnType<typeof originalSetTimeout>, { cleared: boolean; delay: number }>();
    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null;

    const restoreTimers = () => {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    };

    try {
        globalThis.setTimeout = ((
            fn: (...callbackArgs: Array<unknown>) => void,
            delay?: number,
            ...args: Array<unknown>
        ) => {
            const handle = originalSetTimeout(() => {
                trackedTimers.delete(handle);
                fn(...args);
            }, delay);

            trackedTimers.set(handle, {
                cleared: false,
                delay: delay ?? 0
            });
            return handle;
        }) as typeof setTimeout;

        globalThis.clearTimeout = ((handle: ReturnType<typeof originalSetTimeout>) => {
            const meta = trackedTimers.get(handle);
            if (meta) {
                meta.cleared = true;
            }

            return originalClearTimeout(handle);
        }) as typeof clearTimeout;

        client = RuntimeWrapper.createWebSocketClient({
            wrapper,
            autoConnect: false,
            reconnectDelay: 50
        });

        client.connect();
        await flush();

        const initialSocket = client.getWebSocket();
        assert.ok(initialSocket, "Initial WebSocket should be available");

        initialSocket.close();
        await flush();

        const timers = [...trackedTimers.entries()];
        assert.strictEqual(timers.length, 1);

        const [handle, meta] = timers[0];
        assert.ok(handle, "Expected reconnect timer handle to be tracked");
        assert.strictEqual(meta.cleared, false);

        client.connect();
        await flush();

        assert.strictEqual(meta.cleared, true, "Reconnect timer should be cleared on reconnect");
        assert.ok(client.isConnected(), "Client should be connected after manual reconnect");

        client.disconnect();
    } finally {
        restoreTimers();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client does not reconnect after manual disconnect", async () => {
    let connectCount = 0;

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        onConnect: () => {
            connectCount++;
        },
        reconnectDelay: 50,
        autoConnect: true
    });

    await wait(50);

    assert.strictEqual(connectCount, 1);

    client.disconnect();

    await wait(150);

    assert.strictEqual(connectCount, 1);

    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket send throws when not connected", () => {
    const client = RuntimeWrapper.createWebSocketClient({ autoConnect: false });

    assert.throws(() => client.send({ test: "data" }), {
        message: /WebSocket is not connected/
    });
});

void test("WebSocket send works when connected", async () => {
    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({ autoConnect: true });

    await wait(50);

    assert.doesNotThrow(() => {
        client.send({ kind: "ping" });
    });

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client reports malformed patch payloads", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const errors: Array<{
        message: string;
        context: "connection" | "patch";
    }> = [];

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        onError: (error, context) => {
            errors.push({ message: error.message, context });
        },
        autoConnect: true
    });

    await wait(50);

    const ws = client.getWebSocket();
    assert.ok(ws, "WebSocket should be available");
    const mockSocket = ws as MockWebSocket;

    mockSocket.simulateMessage(JSON.stringify({ id: "script:missing_kind" }));

    await wait(10);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0]?.context, "patch");
    assert.match(errors[0]?.message ?? "", /missing required field/i);
    assert.strictEqual(wrapper.hasScript("script:missing_kind"), false);

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client tracks connection metrics", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        client = RuntimeWrapper.createWebSocketClient({
            wrapper,
            autoConnect: true
        });

        await flush();

        const metricsAfterConnect = client.getConnectionMetrics();
        assert.strictEqual(metricsAfterConnect.totalConnections, 1);
        assert.strictEqual(metricsAfterConnect.totalDisconnections, 0);
        assert.strictEqual(metricsAfterConnect.patchesReceived, 0);
        assert.strictEqual(metricsAfterConnect.patchesApplied, 0);
        assert.strictEqual(metricsAfterConnect.patchesFailed, 0);
        assert.ok(metricsAfterConnect.lastConnectedAt);
        assert.strictEqual(metricsAfterConnect.lastDisconnectedAt, null);

        const ws = client.getWebSocket();
        assert.ok(ws);
        const mockSocket = ws as MockWebSocket;

        mockSocket.simulateMessage({
            kind: "script",
            id: "script:test",
            js_body: "return 42;"
        });

        await wait(10);

        const metricsAfterPatch = client.getConnectionMetrics();
        assert.strictEqual(metricsAfterPatch.patchesReceived, 1);
        assert.strictEqual(metricsAfterPatch.patchesApplied, 1);
        assert.strictEqual(metricsAfterPatch.patchesFailed, 0);
        assert.ok(metricsAfterPatch.lastPatchReceivedAt);
        assert.ok(metricsAfterPatch.lastPatchAppliedAt);

        client.disconnect();
        await wait(10);

        const metricsAfterDisconnect = client.getConnectionMetrics();
        assert.strictEqual(metricsAfterDisconnect.totalDisconnections, 1);
        assert.ok(metricsAfterDisconnect.lastDisconnectedAt);
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client tracks failed patches in metrics", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    await runWebSocketTest(
        {
            wrapper,
            autoConnect: true,
            onError: () => {}
        },
        async (client, mockSocket) => {
            assert.ok(mockSocket);

            mockSocket.simulateMessage({
                kind: "script",
                id: "script:invalid",
                js_body: "return {{ invalid syntax"
            });

            await wait(10);

            const metrics = client.getConnectionMetrics();
            assert.strictEqual(metrics.patchesReceived, 1);
            assert.strictEqual(metrics.patchesApplied, 0);
            assert.strictEqual(metrics.patchesFailed, 1);
            assert.strictEqual(metrics.patchErrors, 1);
            assert.ok(metrics.lastPatchReceivedAt);
            assert.strictEqual(metrics.lastPatchAppliedAt, null);
        }
    );
});

void test("WebSocket client tracks reconnection attempts in metrics", async () => {
    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        client = RuntimeWrapper.createWebSocketClient({
            autoConnect: true,
            reconnectDelay: 10
        });

        await flush();

        const ws = client.getWebSocket();
        assert.ok(ws);

        ws.close();
        await wait(20);

        const metrics = client.getConnectionMetrics();
        assert.strictEqual(metrics.totalConnections, 2);
        assert.strictEqual(metrics.totalDisconnections, 1);
        assert.strictEqual(metrics.totalReconnectAttempts, 1);
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client tracks connection errors in metrics", async () => {
    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        client = RuntimeWrapper.createWebSocketClient({
            autoConnect: true,
            reconnectDelay: 0,
            onError: () => {}
        });

        await flush();

        const ws = client.getWebSocket();
        assert.ok(ws);
        const mockSocket = ws as MockWebSocket;

        mockSocket.simulateError();
        await wait(10);

        const metrics = client.getConnectionMetrics();
        assert.strictEqual(metrics.connectionErrors, 1);
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client falls back to a generic message for non-Error error events", async () => {
    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;
    let capturedMessage = "";

    try {
        client = RuntimeWrapper.createWebSocketClient({
            autoConnect: true,
            reconnectDelay: 0,
            onError: (error) => {
                capturedMessage = error.message;
            }
        });

        await flush();

        const ws = client.getWebSocket();
        assert.ok(ws);
        const mockSocket = ws as unknown as {
            simulateError(error: unknown): void;
        };

        mockSocket.simulateError({ source: "network" });
        await wait(10);

        assert.strictEqual(capturedMessage, "Unknown WebSocket error");
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client returns frozen metrics snapshot", async () => {
    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        client = RuntimeWrapper.createWebSocketClient({
            autoConnect: false
        });

        const metrics = client.getConnectionMetrics();
        assert.throws(() => {
            (metrics as { totalConnections: number }).totalConnections = 999;
        });

        assert.strictEqual(metrics.totalConnections, 0);
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client tracks patch errors for malformed payloads", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    await runWebSocketTest(
        {
            wrapper,
            autoConnect: true,
            onError: () => {}
        },
        async (client, mockSocket) => {
            assert.ok(mockSocket);

            mockSocket.simulateMessage({ id: "script:missing_kind" });

            await wait(10);

            const metrics = client.getConnectionMetrics();
            assert.strictEqual(metrics.patchesReceived, 1);
            assert.strictEqual(metrics.patchErrors, 1);
            assert.strictEqual(metrics.patchesFailed, 0);
        }
    );
});

void test("WebSocket client resets metrics to initial state", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        client = RuntimeWrapper.createWebSocketClient({
            wrapper,
            autoConnect: true,
            onError: () => {}
        });

        await flush();

        const ws = client.getWebSocket();
        assert.ok(ws);
        const mockSocket = ws as MockWebSocket;

        mockSocket.simulateMessage({
            kind: "script",
            id: "script:test",
            js_body: "return 42;"
        });

        await wait(10);

        const metricsBefore = client.getConnectionMetrics();
        assert.strictEqual(metricsBefore.totalConnections, 1);
        assert.strictEqual(metricsBefore.patchesReceived, 1);
        assert.strictEqual(metricsBefore.patchesApplied, 1);
        assert.ok(metricsBefore.lastConnectedAt);
        assert.ok(metricsBefore.lastPatchReceivedAt);
        assert.ok(metricsBefore.lastPatchAppliedAt);

        client.resetConnectionMetrics();

        const metricsAfter = client.getConnectionMetrics();
        assert.strictEqual(metricsAfter.totalConnections, 0);
        assert.strictEqual(metricsAfter.totalDisconnections, 0);
        assert.strictEqual(metricsAfter.totalReconnectAttempts, 0);
        assert.strictEqual(metricsAfter.patchesReceived, 0);
        assert.strictEqual(metricsAfter.patchesApplied, 0);
        assert.strictEqual(metricsAfter.patchesFailed, 0);
        assert.strictEqual(metricsAfter.lastConnectedAt, null);
        assert.strictEqual(metricsAfter.lastDisconnectedAt, null);
        assert.strictEqual(metricsAfter.lastPatchReceivedAt, null);
        assert.strictEqual(metricsAfter.lastPatchAppliedAt, null);
        assert.strictEqual(metricsAfter.connectionErrors, 0);
        assert.strictEqual(metricsAfter.patchErrors, 0);
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client metrics reset does not affect connection state", async () => {
    globalWithWebSocket.WebSocket = MockWebSocket;

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        client = RuntimeWrapper.createWebSocketClient({
            autoConnect: true
        });

        await flush();

        assert.strictEqual(client.isConnected(), true);
        assert.ok(client.getWebSocket());

        client.resetConnectionMetrics();

        assert.strictEqual(client.isConnected(), true);
        assert.ok(client.getWebSocket());

        const metrics = client.getConnectionMetrics();
        assert.strictEqual(metrics.totalConnections, 0);
    } finally {
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client clears reconnect timer when disconnect is called", async () => {
    globalWithWebSocket.WebSocket = MockWebSocket;

    const originalClearTimeout = globalThis.clearTimeout;
    const clearedTimers = new Set<ReturnType<typeof setTimeout>>();

    const restoreClearTimeout = () => {
        globalThis.clearTimeout = originalClearTimeout;
    };

    let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null = null;

    try {
        globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
            clearedTimers.add(handle);
            return originalClearTimeout(handle);
        }) as typeof clearTimeout;

        client = RuntimeWrapper.createWebSocketClient({
            autoConnect: true,
            reconnectDelay: 100
        });

        await flush();

        const ws = client.getWebSocket();
        assert.ok(ws, "WebSocket should be available");

        ws.close();
        await flush();

        const timersBeforeDisconnect = clearedTimers.size;

        client.disconnect();

        assert.ok(clearedTimers.size > timersBeforeDisconnect, "disconnect() should have cleared the reconnect timer");
    } finally {
        restoreClearTimeout();
        client?.disconnect();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket reconnect timer is properly cleared on rapid close events preventing leak", async () => {
    globalWithWebSocket.WebSocket = MockWebSocket;

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const activeTimers = new Map<
        ReturnType<typeof originalSetTimeout>,
        {
            cleared: boolean;
            callback: (...args: Array<unknown>) => void;
            delay: number;
        }
    >();

    const restoreTimers = () => {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    };

    try {
        globalThis.setTimeout = ((
            fn: (...callbackArgs: Array<unknown>) => void,
            delay?: number,
            ...args: Array<unknown>
        ) => {
            const handle = originalSetTimeout(() => {
                const meta = activeTimers.get(handle);
                if (meta && !meta.cleared) {
                    meta.callback(...args);
                }
                activeTimers.delete(handle);
            }, delay);

            activeTimers.set(handle, {
                cleared: false,
                callback: fn,
                delay: delay ?? 0
            });
            return handle;
        }) as typeof setTimeout;

        globalThis.clearTimeout = ((handle: ReturnType<typeof originalSetTimeout>) => {
            const meta = activeTimers.get(handle);
            if (meta) {
                meta.cleared = true;
            }

            return originalClearTimeout(handle);
        }) as typeof clearTimeout;

        let client: ReturnType<typeof RuntimeWrapper.createWebSocketClient> | null =
            RuntimeWrapper.createWebSocketClient({
                autoConnect: true,
                reconnectDelay: 50
            });

        await flush();

        const ws = client.getWebSocket();
        assert.ok(ws, "Initial WebSocket should be available");

        // Close the WebSocket, which triggers reconnect timer
        ws.close();
        await flush();

        const timersAfterFirstClose = [...activeTimers.values()].filter((meta) => !meta.cleared && meta.delay >= 50);
        assert.strictEqual(
            timersAfterFirstClose.length,
            1,
            "There should be exactly one uncleared reconnect timer after first close"
        );

        // Get the new WebSocket after reconnect
        await wait(60);
        const ws2 = client.getWebSocket();
        assert.ok(ws2, "WebSocket should reconnect");

        // Close again rapidly
        ws2.close();
        await flush();

        const timersAfterSecondClose = [...activeTimers.values()].filter((meta) => !meta.cleared && meta.delay >= 50);
        assert.strictEqual(
            timersAfterSecondClose.length,
            1,
            "With the fix, there should still be only one active reconnect timer (old one cleared before new one set)"
        );

        // Verify the first timer was cleared
        const firstTimer = timersAfterFirstClose[0];
        assert.ok(firstTimer, "First timer should exist");
        assert.strictEqual(
            firstTimer.cleared,
            true,
            "The fix ensures the first timer was cleared before setting the second timer"
        );

        // Clean up
        client.disconnect();
        client = null;

        const finalTimers = [...activeTimers.values()].filter((meta) => !meta.cleared && meta.delay >= 50);
        assert.strictEqual(finalTimers.length, 0, "After disconnect(), all reconnect timers should be cleared");
    } finally {
        restoreTimers();
        delete globalWithWebSocket.WebSocket;
    }
});

void test("WebSocket client integrates with logger for lifecycle events", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const logEvents: Array<{ level: string; message: string }> = [];

    const mockLogger = {
        websocketConnected(url: string) {
            logEvents.push({ level: "info", message: `Connected to ${url}` });
        },
        websocketDisconnected() {
            logEvents.push({ level: "info", message: "Disconnected" });
        },
        websocketReconnecting(attempt: number, delayMs: number) {
            logEvents.push({ level: "info", message: `Reconnecting (attempt ${attempt}, delay ${delayMs}ms)` });
        },
        websocketError(error: string) {
            logEvents.push({ level: "error", message: `Error: ${error}` });
        },
        patchQueueFlushed(count: number, durationMs: number) {
            logEvents.push({ level: "info", message: `Flushed ${count} patches in ${durationMs}ms` });
        },
        patchQueued(patchId: string, queueDepth: number) {
            logEvents.push({ level: "debug", message: `Queued ${patchId} (depth: ${queueDepth})` });
        },
        info(message: string) {
            logEvents.push({ level: "info", message });
        },
        debug(message: string) {
            logEvents.push({ level: "debug", message });
        },
        warn() {},
        error() {},
        patchApplied() {},
        patchUndone() {},
        patchRolledBack() {},
        validationError() {},
        shadowValidationFailed() {},
        registryCleared() {},
        setLevel() {},
        getLevel() {
            return "info" as const;
        }
    };

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        logger: mockLogger,
        autoConnect: false
    });

    client.connect();
    await wait(50);

    assert.strictEqual(logEvents.length, 1);
    assert.strictEqual(logEvents[0].level, "info");
    assert.ok(logEvents[0].message.includes("Connected to"));

    client.disconnect();
    await wait(50);

    assert.ok(logEvents.some((e) => e.message.includes("Disconnected")));

    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client integrates with logger for patch queue events", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const logEvents: Array<{ level: string; message: string }> = [];

    const mockLogger = {
        patchQueueFlushed(count: number, durationMs: number) {
            logEvents.push({ level: "info", message: `Flushed ${count} patches in ${durationMs}ms` });
        },
        patchQueued(patchId: string, queueDepth: number) {
            logEvents.push({ level: "debug", message: `Queued ${patchId} (depth: ${queueDepth})` });
        },
        info(message: string) {
            logEvents.push({ level: "info", message });
        },
        debug(message: string) {
            logEvents.push({ level: "debug", message });
        },
        websocketConnected() {},
        websocketDisconnected() {},
        websocketReconnecting() {},
        websocketError() {},
        warn() {},
        error() {},
        patchApplied() {},
        patchUndone() {},
        patchRolledBack() {},
        validationError() {},
        shadowValidationFailed() {},
        registryCleared() {},
        setLevel() {},
        getLevel() {
            return "debug" as const;
        }
    };

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        logger: mockLogger,
        autoConnect: false,
        patchQueue: {
            enabled: true,
            flushIntervalMs: 100,
            maxQueueSize: 10
        }
    });

    client.connect();
    await wait(50);

    const ws = client.getWebSocket();
    assert.ok(ws instanceof MockWebSocket);

    ws.simulateMessage(JSON.stringify({ kind: "script", id: "script:test1", js_body: "return 1;" }));

    const queuedEvents = logEvents.filter((e) => e.message.includes("Queued"));
    assert.strictEqual(queuedEvents.length, 1);
    assert.ok(queuedEvents[0].message.includes("script:test1"));

    await wait(150);

    const flushedEvents = logEvents.filter((e) => e.message.includes("Flushed"));
    assert.strictEqual(flushedEvents.length, 1);
    assert.ok(flushedEvents[0].message.includes("1 patches"));

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});

void test("WebSocket client works without logger (backward compatibility)", async () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    globalWithWebSocket.WebSocket = MockWebSocket;

    const client = RuntimeWrapper.createWebSocketClient({
        wrapper,
        autoConnect: false
    });

    client.connect();
    await wait(50);

    const ws = client.getWebSocket();
    assert.ok(ws instanceof MockWebSocket);

    ws.simulateMessage(JSON.stringify({ kind: "script", id: "script:test", js_body: "return 42;" }));
    await wait(50);

    assert.ok(wrapper.hasScript("script:test"));

    client.disconnect();
    delete globalWithWebSocket.WebSocket;
});
