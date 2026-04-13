import assert from "node:assert";
import { test } from "node:test";

import { Clients, Runtime } from "../src/index.js";
import { deduplicatePatchesById } from "../src/websocket/patch-queue.js";

const { createRuntimeWrapper } = Runtime;
const { createWebSocketClient } = Clients;

class MockWebSocket {
    public readyState = 0;
    private listeners = new Map<string, Set<(event?: unknown) => void>>();

    constructor() {
        setTimeout(() => {
            this.readyState = 1;
            this.triggerEvent("open");
        }, 10);
    }

    addEventListener(event: string, handler: (event?: unknown) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)?.add(handler);
    }

    removeEventListener(event: string, handler: (event?: unknown) => void): void {
        this.listeners.get(event)?.delete(handler);
    }

    send(): void {
        // No-op for testing: Mock WebSocket implementation doesn't transmit
        // messages over the network. Tests verify client-side behavior
        // (event handling, reconnection logic, state management) without
        // requiring an actual WebSocket server. Real message transmission
        // would add test flakiness and infrastructure dependencies.
    }

    close(): void {
        this.readyState = 3;
        setTimeout(() => this.triggerEvent("close"), 10);
    }

    triggerEvent(event: string, data?: unknown): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                handler(data);
            }
        }
    }

    simulateMessage(data: unknown): void {
        this.triggerEvent("message", { data });
    }
}

const DEFAULT_PATCH_QUEUE_OPTIONS = {
    enabled: true,
    flushIntervalMs: 1000,
    maxQueueSize: 50
};

type RuntimeWrapperInstance = ReturnType<typeof createRuntimeWrapper>;
type WebSocketClientOptions = Parameters<typeof createWebSocketClient>[0];
type WebSocketClientInstance = ReturnType<typeof createWebSocketClient>;
type PatchQueueMetricsSnapshot = NonNullable<ReturnType<WebSocketClientInstance["getPatchQueueMetrics"]>>;

type PatchQueueClientSetupOptions = {
    patchQueue?: WebSocketClientOptions["patchQueue"];
    wrapperMutator?: (wrapper: RuntimeWrapperInstance) => RuntimeWrapperInstance;
    waitAfterConnectMs?: number;
};

function installMockWebSocket(): void {
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
}

function prepareRuntimeGlobalsForPatchQueue(): () => void {
    const globals = globalThis as {
        g_pBuiltIn?: Record<string, unknown>;
        JSON_game?: { ScriptNames?: Array<string>; Scripts?: Array<unknown> };
    };
    const hadBuiltins = Object.hasOwn(globals, "g_pBuiltIn");
    const hadJsonGame = Object.hasOwn(globals, "JSON_game");
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    globals.g_pBuiltIn = { application_surface: -1 };
    globals.JSON_game = {
        ScriptNames: ["__patch_queue_test__"],
        Scripts: [() => {}]
    };

    return () => {
        if (hadBuiltins) {
            globals.g_pBuiltIn = savedBuiltins;
        } else {
            delete globals.g_pBuiltIn;
        }

        if (hadJsonGame) {
            globals.JSON_game = savedJsonGame;
        } else {
            delete globals.JSON_game;
        }
    };
}

function sendScriptPatch(ws: MockWebSocket, id: string, jsBody = "return 1;"): void {
    ws.simulateMessage(JSON.stringify({ kind: "script", id, js_body: jsBody }));
}

function sendScriptPatchWithDependencies(
    ws: MockWebSocket,
    id: string,
    dependencies: ReadonlyArray<string>,
    jsBody = "return 1;"
): void {
    ws.simulateMessage(JSON.stringify({ kind: "script", id, js_body: jsBody, metadata: { dependencies } }));
}

function sendChainedDependencyPatches(ws: MockWebSocket, count: number): void {
    for (let index = count - 1; index >= 0; index -= 1) {
        const patchId = `gml/script/chain_${index}`;
        const dependencies = index === 0 ? [] : [`gml/script/chain_${index - 1}`];
        sendScriptPatchWithDependencies(ws, patchId, dependencies, `return ${index};`);
    }
}

function sendScriptPatchBatch(ws: MockWebSocket, patches: Array<{ id: string; js_body?: string }>): void {
    ws.simulateMessage(
        JSON.stringify(
            patches.map((patch) => ({
                kind: "script",
                id: patch.id,
                js_body: patch.js_body ?? "return 1;"
            }))
        )
    );
}

function wait(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitForCondition(
    label: string,
    predicate: () => boolean,
    options: { timeoutMs: number; pollIntervalMs: number }
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < options.timeoutMs) {
        if (predicate()) {
            return;
        }
        await wait(options.pollIntervalMs);
    }
    throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForConnection(client: WebSocketClientInstance, timeoutMs = 200): Promise<void> {
    await waitForCondition("WebSocket connection", () => client.isConnected(), {
        timeoutMs,
        pollIntervalMs: 5
    });
}

async function waitForQueueMetrics(
    client: WebSocketClientInstance,
    label: string,
    predicate: (metrics: PatchQueueMetricsSnapshot) => boolean,
    timeoutMs = 200
): Promise<PatchQueueMetricsSnapshot> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const metrics = client.getPatchQueueMetrics();
        if (metrics && predicate(metrics)) {
            return metrics;
        }
        await wait(5);
    }
    const latest = client.getPatchQueueMetrics();
    const snapshot = latest ? JSON.stringify(latest) : "null";
    throw new Error(`Timed out waiting for ${label}. Latest metrics: ${snapshot}`);
}

async function createConnectedPatchQueueClient(options: PatchQueueClientSetupOptions = {}): Promise<{
    wrapper: RuntimeWrapperInstance;
    client: WebSocketClientInstance;
    ws: MockWebSocket;
    restoreRuntimeGlobals: () => void;
}> {
    const wrapper = createRuntimeWrapper();
    const configuredWrapper = options.wrapperMutator ? options.wrapperMutator(wrapper) : wrapper;

    const client = createWebSocketClient({
        wrapper: configuredWrapper,
        autoConnect: false,
        patchQueue: {
            ...DEFAULT_PATCH_QUEUE_OPTIONS,
            ...options.patchQueue
        }
    });

    installMockWebSocket();
    const restoreRuntimeGlobals = prepareRuntimeGlobalsForPatchQueue();

    client.connect();
    await waitForConnection(client, options.waitAfterConnectMs ?? 200);

    const ws = client.getWebSocket() as unknown as MockWebSocket;
    assert.ok(ws);

    return { wrapper, client, ws, restoreRuntimeGlobals };
}

void test("patch queue tracks patches received without double-counting on flush", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 50
        }
    });

    try {
        const metricsBefore = client.getConnectionMetrics();
        assert.strictEqual(metricsBefore.patchesReceived, 0);

        sendScriptPatch(ws, "script:queued_metrics");

        await waitForQueueMetrics(client, "queue to contain pending patch", (snapshot) => snapshot.totalQueued === 1);

        const metricsWhileQueued = client.getConnectionMetrics();
        assert.strictEqual(metricsWhileQueued.patchesReceived, 1);
        assert.strictEqual(metricsWhileQueued.patchesApplied, 0);

        const flushedCount = client.flushPatchQueue();
        assert.strictEqual(flushedCount, 1);

        await waitForQueueMetrics(
            client,
            "queue to flush pending patch",
            (snapshot) => snapshot.totalFlushed === 1 && snapshot.flushCount === 1,
            100
        );

        const metricsAfterFlush = client.getConnectionMetrics();
        assert.strictEqual(metricsAfterFlush.patchesReceived, 1);
        assert.strictEqual(metricsAfterFlush.patchesApplied, 1);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("deduplicatePatchesById preserves input reference when no duplicate ids exist", () => {
    const patches = [
        { kind: "script", id: "gml/script/a", js_body: "return 1;" },
        { kind: "script", id: "gml/script/b", js_body: "return 2;" },
        { kind: "event", id: "obj_player#Step", js_body: "return;" }
    ];

    const result = deduplicatePatchesById(patches);
    assert.strictEqual(result.duplicateCount, 0);
    assert.strictEqual(result.patches, patches);
});

void test("deduplicatePatchesById keeps only the newest patch for duplicate ids", () => {
    const firstVersion = { kind: "script", id: "gml/script/a", js_body: "return 1;" };
    const newestVersion = { kind: "script", id: "gml/script/a", js_body: "return 99;" };
    const uniquePatch = { kind: "script", id: "gml/script/b", js_body: "return 2;" };
    const patches = [firstVersion, uniquePatch, newestVersion];

    const result = deduplicatePatchesById(patches);
    assert.strictEqual(result.duplicateCount, 1);
    assert.deepStrictEqual(result.patches, [uniquePatch, newestVersion]);
});

void test("patch queue reorders dependency-linked patches before batch apply", async () => {
    const { wrapper, client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 1000
        }
    });

    try {
        sendScriptPatchWithDependencies(ws, "gml/script/dependent", ["gml/script/provider"], "return provider();");
        sendScriptPatch(ws, "gml/script/provider", "return 42;");

        const flushedCount = client.flushPatchQueue();
        assert.strictEqual(flushedCount, 2);

        assert.ok(wrapper.hasScript("gml/script/provider"), "Provider patch should be applied");
        assert.ok(wrapper.hasScript("gml/script/dependent"), "Dependent patch should be applied after provider");

        const metrics = client.getConnectionMetrics();
        assert.strictEqual(metrics.patchesApplied, 2);
        assert.strictEqual(metrics.patchesFailed, 0);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue keeps already ordered dependency batches intact", async () => {
    const { wrapper, client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 1000
        }
    });

    try {
        sendScriptPatch(ws, "gml/script/provider_in_order", "return 42;");
        sendScriptPatchWithDependencies(
            ws,
            "gml/script/dependent_in_order",
            ["gml/script/provider_in_order"],
            "return provider_in_order();"
        );

        const flushedCount = client.flushPatchQueue();
        assert.strictEqual(flushedCount, 2);

        assert.ok(wrapper.hasScript("gml/script/provider_in_order"));
        assert.ok(wrapper.hasScript("gml/script/dependent_in_order"));

        const metrics = client.getConnectionMetrics();
        assert.strictEqual(metrics.patchesApplied, 2);
        assert.strictEqual(metrics.patchesFailed, 0);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue handles duplicate dependency entries when reordering batches", async () => {
    const { wrapper, client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 1000
        }
    });

    try {
        sendScriptPatchWithDependencies(
            ws,
            "gml/script/duplicate_dependency_consumer",
            ["gml/script/duplicate_dependency_provider", "gml/script/duplicate_dependency_provider"],
            "return duplicate_dependency_provider();"
        );
        sendScriptPatch(ws, "gml/script/duplicate_dependency_provider", "return 42;");

        const flushedCount = client.flushPatchQueue();
        assert.strictEqual(flushedCount, 2);

        assert.ok(wrapper.hasScript("gml/script/duplicate_dependency_provider"));
        assert.ok(wrapper.hasScript("gml/script/duplicate_dependency_consumer"));

        const metrics = client.getConnectionMetrics();
        assert.strictEqual(metrics.patchesApplied, 2);
        assert.strictEqual(metrics.patchesFailed, 0);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue applies long dependency chains from reverse receive order", async () => {
    const { wrapper, client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 1000,
            maxQueueSize: 300
        }
    });

    try {
        sendChainedDependencyPatches(ws, 120);

        const flushedCount = client.flushPatchQueue();
        assert.strictEqual(flushedCount, 120);

        assert.ok(wrapper.hasScript("gml/script/chain_0"), "First dependency patch should be applied");
        assert.ok(wrapper.hasScript("gml/script/chain_119"), "Last dependent patch should be applied");

        const metrics = client.getConnectionMetrics();
        assert.strictEqual(metrics.patchesApplied, 120);
        assert.strictEqual(metrics.patchesFailed, 0);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("getPatchQueueMetrics returns null when queuing is disabled", () => {
    const wrapper = createRuntimeWrapper();
    const client = createWebSocketClient({
        wrapper,
        autoConnect: false
    });

    const metrics = client.getPatchQueueMetrics();
    assert.strictEqual(metrics, null);
});

void test("patch queue is disabled when enabled without a runtime wrapper", () => {
    const client = createWebSocketClient({
        wrapper: null,
        autoConnect: false,
        patchQueue: {
            enabled: true
        }
    });

    const metrics = client.getPatchQueueMetrics();
    assert.strictEqual(metrics, null);
});

void test("getPatchQueueMetrics returns initial metrics when queuing is enabled", () => {
    const wrapper = createRuntimeWrapper();
    const client = createWebSocketClient({
        wrapper,
        autoConnect: false,
        patchQueue: {
            enabled: true
        }
    });

    const metrics = client.getPatchQueueMetrics();
    assert.ok(metrics !== null);
    assert.strictEqual(metrics.totalQueued, 0);
    assert.strictEqual(metrics.totalFlushed, 0);
    assert.strictEqual(metrics.totalDropped, 0);
    assert.strictEqual(metrics.totalDeduplicated, 0);
    assert.strictEqual(metrics.maxQueueDepth, 0);
    assert.strictEqual(metrics.flushCount, 0);
    assert.strictEqual(metrics.lastFlushSize, 0);
    assert.strictEqual(metrics.lastFlushedAt, null);
});

void test("patch queue enqueues patches instead of applying immediately", async () => {
    let patchesApplied = 0;

    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 100,
            maxQueueSize: 10
        },
        wrapperMutator: (wrapper) => {
            const originalApplyPatchBatch = wrapper.applyPatchBatch.bind(wrapper);
            wrapper.applyPatchBatch = (patches: Array<unknown>) => {
                patchesApplied += patches.length;
                return originalApplyPatchBatch(patches);
            };
            return wrapper;
        }
    });

    try {
        sendScriptPatch(ws, "script:test1");

        const metricsBeforeFlush = await waitForQueueMetrics(
            client,
            "queue to contain pending patch",
            (metrics) => metrics.totalQueued === 1
        );
        assert.strictEqual(metricsBeforeFlush.totalQueued, 1);
        assert.strictEqual(patchesApplied, 0);

        const metricsAfterFlush = await waitForQueueMetrics(
            client,
            "queue to flush pending patch",
            (metrics) => metrics.totalFlushed === 1 && metrics.flushCount === 1,
            300
        );

        assert.strictEqual(metricsAfterFlush.totalFlushed, 1);
        assert.strictEqual(metricsAfterFlush.flushCount, 1);
        assert.strictEqual(patchesApplied, 1);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue flushes automatically when reaching max size", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 1000,
            maxQueueSize: 3
        }
    });

    try {
        sendScriptPatch(ws, "script:test1");
        sendScriptPatch(ws, "script:test2");

        let metrics = await waitForQueueMetrics(
            client,
            "queue to capture two patches",
            (snapshot) => snapshot.totalQueued === 2
        );
        assert.strictEqual(metrics.totalQueued, 2);
        assert.strictEqual(metrics.flushCount, 0);

        sendScriptPatch(ws, "script:test3");

        metrics = await waitForQueueMetrics(
            client,
            "queue to flush after reaching max size",
            (snapshot) => snapshot.totalFlushed === 3 && snapshot.flushCount === 1
        );
        assert.strictEqual(metrics.totalQueued, 3);
        assert.strictEqual(metrics.totalFlushed, 3);
        assert.strictEqual(metrics.flushCount, 1);
        assert.strictEqual(metrics.maxQueueDepth, 3);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue drops oldest patches when exceeding max size", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 1000,
            maxQueueSize: 2
        }
    });

    try {
        sendScriptPatch(ws, "script:test1");

        let metrics = await waitForQueueMetrics(
            client,
            "queue to contain initial patch",
            (snapshot) => snapshot.totalQueued === 1
        );
        assert.strictEqual(metrics.totalQueued, 1);
        assert.strictEqual(metrics.totalDropped, 0);

        sendScriptPatch(ws, "script:test2");

        metrics = await waitForQueueMetrics(
            client,
            "queue to flush after reaching max size",
            (snapshot) => snapshot.totalFlushed === 2 && snapshot.flushCount === 1
        );
        assert.strictEqual(metrics.totalFlushed, 2);
        assert.strictEqual(metrics.flushCount, 1);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("flushPatchQueue manually flushes queued patches", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 500,
            maxQueueSize: 50
        }
    });

    try {
        sendScriptPatch(ws, "script:test1");
        sendScriptPatch(ws, "script:test2");
        sendScriptPatch(ws, "script:test3");

        const metrics = await waitForQueueMetrics(
            client,
            "queue to hold three patches before manual flush",
            (snapshot) => snapshot.totalQueued === 3 && snapshot.flushCount === 0
        );
        assert.strictEqual(metrics.totalQueued, 3);
        assert.strictEqual(metrics.flushCount, 0);

        const flushed = client.flushPatchQueue();
        assert.strictEqual(flushed, 3);

        const flushedMetrics = await waitForQueueMetrics(
            client,
            "queue to reflect manual flush",
            (snapshot) => snapshot.totalFlushed === 3 && snapshot.flushCount === 1
        );
        assert.strictEqual(flushedMetrics.totalFlushed, 3);
        assert.strictEqual(flushedMetrics.flushCount, 1);
        assert.strictEqual(flushedMetrics.lastFlushSize, 3);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("flushPatchQueue returns zero when queue is empty", () => {
    const wrapper = createRuntimeWrapper();

    const client = createWebSocketClient({
        wrapper,
        autoConnect: false,
        patchQueue: {
            enabled: true
        }
    });

    const flushed = client.flushPatchQueue();
    assert.strictEqual(flushed, 0);
});

void test("flushPatchQueue returns zero when queuing is disabled", () => {
    const wrapper = createRuntimeWrapper();

    const client = createWebSocketClient({
        wrapper,
        autoConnect: false
    });

    const flushed = client.flushPatchQueue();
    assert.strictEqual(flushed, 0);
});

void test("patch queue uses applyPatchBatch when available", async () => {
    const batchCalls: Array<Array<unknown>> = [];

    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 50,
            maxQueueSize: 10
        },
        wrapperMutator: (wrapper) => {
            const originalApplyPatchBatch = wrapper.applyPatchBatch.bind(wrapper);
            wrapper.applyPatchBatch = (patches: Array<unknown>) => {
                batchCalls.push(patches);
                return originalApplyPatchBatch(patches);
            };
            return wrapper;
        }
    });

    try {
        sendScriptPatch(ws, "script:test1");
        sendScriptPatch(ws, "script:test2");

        await waitForCondition("batch applyPatchBatch call", () => batchCalls.length === 1, {
            timeoutMs: 200,
            pollIntervalMs: 5
        });

        assert.strictEqual(batchCalls.length, 1);
        assert.strictEqual(batchCalls[0].length, 2);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("disconnect flushes pending patches", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 500,
            maxQueueSize: 50
        }
    });

    try {
        sendScriptPatch(ws, "script:test1");
        sendScriptPatch(ws, "script:test2");

        await waitForQueueMetrics(
            client,
            "queue to contain two patches before disconnect",
            (snapshot) => snapshot.totalQueued === 2
        );

        let metrics = client.getPatchQueueMetrics();
        assert.ok(metrics !== null);
        assert.strictEqual(metrics.totalQueued, 2);
        assert.strictEqual(metrics.totalFlushed, 0);

        client.disconnect();

        metrics = await waitForQueueMetrics(
            client,
            "queue to reflect flush on disconnect",
            (snapshot) => snapshot.totalFlushed === 2 && snapshot.flushCount === 1
        );
        assert.strictEqual(metrics.totalFlushed, 2);
        assert.strictEqual(metrics.flushCount, 1);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue tracks max queue depth correctly", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 200,
            maxQueueSize: 50
        }
    });

    try {
        sendScriptPatch(ws, "script:test1");
        sendScriptPatch(ws, "script:test2");
        sendScriptPatch(ws, "script:test3");

        let metrics = await waitForQueueMetrics(
            client,
            "queue to reach max depth",
            (snapshot) => snapshot.maxQueueDepth === 3
        );
        assert.strictEqual(metrics.maxQueueDepth, 3);

        metrics = await waitForQueueMetrics(
            client,
            "queue to flush without resetting max depth",
            (snapshot) => snapshot.flushCount === 1 && snapshot.maxQueueDepth === 3,
            400
        );
        assert.strictEqual(metrics.maxQueueDepth, 3);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue metrics are frozen", () => {
    const wrapper = createRuntimeWrapper();

    const client = createWebSocketClient({
        wrapper,
        autoConnect: false,
        patchQueue: {
            enabled: true
        }
    });

    const metrics = client.getPatchQueueMetrics();
    assert.ok(metrics !== null);
    assert.ok(Object.isFrozen(metrics));

    assert.throws(() => {
        (metrics as { totalQueued: number }).totalQueued = 999;
    });
});

void test("patch queue handles array of patches correctly", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 50,
            maxQueueSize: 10
        }
    });

    try {
        sendScriptPatchBatch(ws, [{ id: "script:test1" }, { id: "script:test2" }, { id: "script:test3" }]);

        let metrics = await waitForQueueMetrics(
            client,
            "queue to capture batch",
            (snapshot) => snapshot.totalQueued === 3
        );
        assert.strictEqual(metrics.totalQueued, 3);

        metrics = await waitForQueueMetrics(client, "queue to flush batch", (snapshot) => snapshot.totalFlushed === 3);
        assert.strictEqual(metrics.totalFlushed, 3);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue reports failures when a batch rolls back", async () => {
    const { wrapper, client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 50,
            maxQueueSize: 10
        }
    });

    sendScriptPatchBatch(ws, [
        { id: "script:good", js_body: "return 1;" },
        { id: "script:bad", js_body: "return {{ invalid syntax" }
    ]);

    try {
        const queueMetrics = await waitForQueueMetrics(
            client,
            "queue to flush failed batch",
            (snapshot) => snapshot.totalFlushed === 2 && snapshot.flushCount === 1,
            300
        );
        assert.strictEqual(queueMetrics.totalFlushed, 2);
        assert.strictEqual(queueMetrics.flushCount, 1);

        const connectionMetrics = client.getConnectionMetrics();
        assert.strictEqual(connectionMetrics.patchesApplied, 0);
        assert.strictEqual(connectionMetrics.patchesFailed, 2);
        assert.strictEqual(connectionMetrics.patchErrors, 2);

        assert.strictEqual(wrapper.hasScript("script:good"), false);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue clears flush timer on disconnect", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 500,
            maxQueueSize: 50
        }
    });

    try {
        sendScriptPatch(ws, "script:test1");

        await waitForQueueMetrics(
            client,
            "queue to capture patch before disconnect",
            (snapshot) => snapshot.totalQueued === 1
        );

        client.disconnect();

        const metrics = await waitForQueueMetrics(
            client,
            "queue to flush on disconnect",
            (snapshot) => snapshot.flushCount === 1
        );

        assert.strictEqual(metrics.flushCount, 1);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue deduplicates patches with the same ID on flush", async () => {
    // Simulates rapid saves: the same script is patched three times within the
    // flush window. Only the last version should be applied; earlier occurrences
    // are counted in totalDeduplicated and still reflected in totalFlushed.
    let batchCallCount = 0;
    const batchArgs: Array<Array<unknown>> = [];

    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 500,
            maxQueueSize: 50
        },
        wrapperMutator: (wrapper) => {
            const originalApplyPatchBatch = wrapper.applyPatchBatch.bind(wrapper);
            wrapper.applyPatchBatch = (patches: Array<unknown>) => {
                batchCallCount++;
                batchArgs.push(patches);
                return originalApplyPatchBatch(patches);
            };
            return wrapper;
        }
    });

    try {
        // Send three patches for the same script ID within the flush window.
        sendScriptPatch(ws, "script:rapidly_edited", "return 1;");
        sendScriptPatch(ws, "script:rapidly_edited", "return 2;");
        sendScriptPatch(ws, "script:rapidly_edited", "return 3;");

        await waitForQueueMetrics(
            client,
            "queue to contain three duplicate patches",
            (snapshot) => snapshot.totalQueued === 3
        );

        const flushed = client.flushPatchQueue();

        const metrics = await waitForQueueMetrics(
            client,
            "queue to flush deduplicated patches",
            (snapshot) => snapshot.flushCount === 1,
            300
        );

        // flushPatchQueue returns the original queue size (before deduplication).
        assert.strictEqual(flushed, 3);

        // totalFlushed counts all patches removed from the queue (including deduped).
        assert.strictEqual(metrics.totalFlushed, 3);

        // Two of the three patches were deduplicated (only the last one applied).
        assert.strictEqual(metrics.totalDeduplicated, 2);

        // applyPatchBatch was called with only the deduplicated patch.
        assert.strictEqual(batchCallCount, 1);
        assert.strictEqual(batchArgs[0].length, 1);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue deduplicates preserving the latest body of each patch", async () => {
    // Verifies that after deduplication, the function actually installed is the
    // one from the LAST patch for that ID (not an earlier version).
    const { wrapper, client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 500,
            maxQueueSize: 50
        }
    });

    try {
        ws.simulateMessage(JSON.stringify({ kind: "script", id: "script:versioned", js_body: "return 'v1';" }));
        ws.simulateMessage(JSON.stringify({ kind: "script", id: "script:versioned", js_body: "return 'v2';" }));
        ws.simulateMessage(JSON.stringify({ kind: "script", id: "script:versioned", js_body: "return 'v3';" }));

        await waitForQueueMetrics(client, "queue to capture three patches", (snapshot) => snapshot.totalQueued === 3);

        client.flushPatchQueue();

        await waitForQueueMetrics(
            client,
            "queue to flush with deduplication",
            (snapshot) => snapshot.flushCount === 1 && snapshot.totalDeduplicated === 2,
            300
        );

        const fn = wrapper.getScript("script:versioned");
        assert.ok(typeof fn === "function", "Script should be registered after flush");
        assert.strictEqual(fn(null, null, []), "v3", "Latest patch body should be installed");
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue deduplication preserves patches without string IDs", async () => {
    let capturedBatch: Array<unknown> | null = null;

    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 500,
            maxQueueSize: 50
        },
        wrapperMutator: (wrapper) => {
            wrapper.applyPatchBatch = (patches: Array<unknown>) => {
                capturedBatch = patches;
                return {
                    success: true,
                    version: wrapper.getVersion(),
                    appliedCount: patches.length,
                    rolledBack: false
                };
            };
            return wrapper;
        }
    });

    try {
        ws.simulateMessage(JSON.stringify({ kind: "script", id: "script:stable", js_body: "return 1;" }));
        ws.simulateMessage(JSON.stringify({ kind: "script", id: "script:stable", js_body: "return 2;" }));
        ws.simulateMessage(
            JSON.stringify({
                kind: "script",
                id: 42,
                js_body: "return 99;"
            })
        );

        await waitForQueueMetrics(
            client,
            "queue to capture duplicate and unidentifiable patches",
            (snapshot) => snapshot.totalQueued === 3
        );

        client.flushPatchQueue();

        const metrics = await waitForQueueMetrics(
            client,
            "queue to flush deduplicated and unidentifiable patches",
            (snapshot) => snapshot.flushCount === 1,
            300
        );

        assert.strictEqual(metrics.totalDeduplicated, 1, "Only duplicate string IDs should be deduplicated");
        assert.ok(capturedBatch, "Expected applyPatchBatch to be invoked");
        assert.strictEqual(capturedBatch.length, 2, "Latest duplicate and non-string-id patch should both be retained");

        const latestStablePatch = capturedBatch[0] as { id: string; js_body: string };
        const nonStringIdPatch = capturedBatch[1] as { id: number; js_body: string };
        assert.strictEqual(latestStablePatch.id, "script:stable");
        assert.strictEqual(latestStablePatch.js_body, "return 2;");
        assert.strictEqual(nonStringIdPatch.id, 42);
        assert.strictEqual(nonStringIdPatch.js_body, "return 99;");
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});

void test("patch queue does not deduplicate patches with different IDs", async () => {
    const { client, ws, restoreRuntimeGlobals } = await createConnectedPatchQueueClient({
        patchQueue: {
            flushIntervalMs: 500,
            maxQueueSize: 50
        }
    });

    try {
        sendScriptPatch(ws, "script:alpha");
        sendScriptPatch(ws, "script:beta");
        sendScriptPatch(ws, "script:gamma");

        await waitForQueueMetrics(
            client,
            "queue to capture three distinct patches",
            (snapshot) => snapshot.totalQueued === 3
        );

        client.flushPatchQueue();

        const metrics = await waitForQueueMetrics(
            client,
            "queue to flush without deduplication",
            (snapshot) => snapshot.flushCount === 1,
            300
        );

        assert.strictEqual(metrics.totalDeduplicated, 0, "No patches should be deduplicated for distinct IDs");
        assert.strictEqual(metrics.totalFlushed, 3);
    } finally {
        client.disconnect();
        restoreRuntimeGlobals();
    }
});
