import assert from "node:assert/strict";
import test from "node:test";

import type { PropertyValues } from "lit";

import { GmAppShell } from "../src/app/components/gm-app-shell.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";

class TestableGmAppShell extends GmAppShell {
    protected override update(_changedProperties: PropertyValues<this>): void {}
}

function waitForProgressPolls(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

function createMockModel(overrides?: Partial<GraphVisualizationUiModel>): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: null,
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: {
            activePath: "/tmp/test",
            projectRoot: "/tmp/test",
            selectedPaths: [],
            source: "working-directory"
        },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test App Shell",
        ...overrides
    };
}

const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;

test.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) {
        Reflect.deleteProperty(globalThis, "location");
    } else {
        Object.defineProperty(globalThis, "location", {
            configurable: true,
            value: originalLocation
        });
    }
});

void test("GmAppShell delegates fix workflow reconnect without lifecycle overrides", () => {
    const prototype = GmAppShell.prototype as unknown as Record<string, unknown>;
    const hasOwn = Object.prototype.hasOwnProperty;

    assert.equal(hasOwn.call(prototype, "connectedCallback"), false);
    assert.equal(hasOwn.call(prototype, "disconnectedCallback"), false);
});

/**
 * Test-local timer instrumentation.
 *
 * `setInterval` and `clearInterval` are captured per-test so the assertions can
 * inspect the participant's timer behaviour without depending on the wall
 * clock. `waitForProgressPolls` flushes the event loop so microtasks scheduled
 * by `connect()` (the initial progress fetch) run before the assertions read
 * the participant's state, which is far less timing-sensitive than a fixed
 * `setTimeout(10)`.
 */
interface IntervalRecord {
    callback: () => void;
    delay: number;
}

interface IntervalSpy {
    readonly activeIds: ReadonlySet<number>;
    readonly delays: ReadonlyArray<number>;
    readonly intervals: ReadonlyArray<IntervalRecord>;
    clearIds: number[];
    restore(): void;
    tickOnce(): Promise<void>;
}

function captureIntervals(): IntervalSpy {
    let nextId = 1;
    const intervals: IntervalRecord[] = [];
    const activeIds = new Set<number>();
    const clearIds: number[] = [];
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let restored = false;

    const wrappedSetInterval = ((handler: TimerHandler, delay = 0, ...args: unknown[]) => {
        const id = nextId++;
        const record: IntervalRecord = {
            callback: () => {
                if (typeof handler === "function") {
                    (handler as (...params: unknown[]) => void)(...args);
                }
            },
            delay
        };
        intervals.push(record);
        activeIds.add(id);
        return id as unknown as ReturnType<typeof globalThis.setInterval>;
    }) as typeof globalThis.setInterval;

    const wrappedClearInterval = ((id: unknown) => {
        const numericId = id as number;
        if (activeIds.delete(numericId)) {
            clearIds.push(numericId);
        }
    }) as typeof globalThis.clearInterval;

    globalThis.setInterval = wrappedSetInterval;
    globalThis.clearInterval = wrappedClearInterval;

    const restore = (): void => {
        if (restored) {
            return;
        }
        restored = true;
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    };

    const tickOnce = async (): Promise<void> => {
        // Snapshot before firing so callbacks that re-register themselves do
        // not interfere with this iteration.
        const queue = intervals.filter((_record, index) => activeIds.has(index + 1));
        for (const record of queue) {
            record.callback();
        }
        await waitForProgressPolls();
    };

    return {
        get activeIds() {
            return activeIds;
        },
        get clearIds() {
            return clearIds;
        },
        get delays() {
            return intervals.map((record) => record.delay);
        },
        get intervals() {
            return intervals;
        },
        restore,
        tickOnce
    };
}

void test(
    "GmAppShell reconnects to in-flight fix workflow on connection and polls until finished",
    { timeout: 5000 },
    async () => {
        let fixFetchCount = 0;
        const fetchCalls: string[] = [];

        globalThis.fetch = async (input) => {
            const url = String(input);
            fetchCalls.push(url);

            if (url.includes("/api/graph-index/progress")) {
                return Response.json({
                    current: 4,
                    isRunning: true,
                    logLines: ["Parsing GML files... (4/9)"],
                    ok: true,
                    operationId: "op-1",
                    stage: "gml-parse",
                    status: "running",
                    summary: null,
                    total: 9
                });
            }

            if (url.includes("/api/fix/progress")) {
                fixFetchCount++;
                if (fixFetchCount === 1) {
                    return Response.json({
                        isRunning: true,
                        logLines: ["Starting format...", "Reformatting files..."],
                        workflow: "format"
                    });
                }
                return Response.json({
                    isRunning: false,
                    logLines: ["Starting format...", "Reformatting files...", "Format complete!"],
                    status: "success",
                    workflow: "format"
                });
            }
            return Response.json({ ok: true });
        };
        Object.defineProperty(globalThis, "location", {
            configurable: true,
            value: {
                href: "http://127.0.0.1:3000/graph"
            }
        });

        const intervals = captureIntervals();

        try {
            const shell = new TestableGmAppShell();
            shell.model = createMockModel({ isServerMode: true });

            shell.connectedCallback();

            await waitForProgressPolls();

            const stateAfterConnect = shell.getStateForTest();
            assert.equal(stateAfterConnect.isFixPending, true);
            assert.equal(stateAfterConnect.fixWorkflow, "format");
            assert.deepEqual(stateAfterConnect.fixLogLines, ["Starting format...", "Reformatting files..."]);
            assert.deepEqual(stateAfterConnect.graphIndexProgress, {
                current: 4,
                isRunning: true,
                logLines: ["Parsing GML files... (4/9)"],
                operationId: "op-1",
                stage: "gml-parse",
                status: "running",
                summary: null,
                total: 9
            });

            assert.equal(fetchCalls.length, 2);
            assert.equal(fetchCalls[1], "http://127.0.0.1:3000/api/fix/progress");
            // Two lifecycle participants poll on connect: the graph-index
            // progress poll and the fix-workflow reconnect poll.
            assert.deepEqual(intervals.delays, [1000, 1000]);
            assert.equal(intervals.activeIds.size, 2, "both polling timers should be active after connect");

            const fixReconnectIntervalId = 2;

            await intervals.tickOnce();
            await waitForProgressPolls();

            const stateAfterFinished = shell.getStateForTest();
            assert.equal(stateAfterFinished.isFixPending, false);
            assert.equal(stateAfterFinished.fixStatus, "success");
            assert.deepEqual(stateAfterFinished.fixLogLines, [
                "Starting format...",
                "Reformatting files...",
                "Format complete!"
            ]);

            assert.equal(
                intervals.activeIds.has(fixReconnectIntervalId),
                false,
                "reconnect timer should be cleared once the workflow finishes"
            );
            assert.equal(intervals.clearIds.length, 1);

            shell.disconnectedCallback();

            assert.equal(intervals.activeIds.size, 0, "all polling timers should be cleared on disconnect");
            assert.equal(intervals.clearIds.length, 2);
        } finally {
            intervals.restore();
        }
    }
);

void test("GmAppShell cleans up the reconnect timer on disconnection", { timeout: 5000 }, async () => {
    globalThis.fetch = async () => {
        return Response.json({
            isRunning: true,
            logLines: ["Fixing..."],
            workflow: "fix"
        });
    };
    Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
            href: "http://127.0.0.1:3000/graph"
        }
    });

    const intervals = captureIntervals();

    try {
        const shell = new TestableGmAppShell();
        shell.model = createMockModel({ isServerMode: true });

        shell.connectedCallback();

        await waitForProgressPolls();

        // Both the graph-index progress poll and the fix-workflow reconnect
        // poll register a 1000ms interval on connect.
        assert.deepEqual(intervals.delays, [1000, 1000]);
        assert.equal(intervals.activeIds.size, 2);

        shell.disconnectedCallback();

        assert.equal(intervals.activeIds.size, 0, "disconnect must clear all polling timers");
        assert.equal(intervals.clearIds.length, 2);
    } finally {
        intervals.restore();
    }
});

void test(
    "GmAppShell skips fix workflow reconnect when no browser location is available",
    { timeout: 5000 },
    async () => {
        let fetchCount = 0;

        globalThis.fetch = async () => {
            fetchCount++;
            return Response.json({ ok: true });
        };
        Reflect.deleteProperty(globalThis, "location");

        const intervals = captureIntervals();

        try {
            const shell = new TestableGmAppShell();
            shell.model = createMockModel({ isServerMode: true });

            shell.connectedCallback();

            await waitForProgressPolls();

            // Both polling participants register their interval on connect but
            // resolve the endpoint lazily inside the poll body, so without a
            // browser location no HTTP request ever goes out and no progress is
            // reported through the store.
            assert.equal(fetchCount, 0);
            const state = shell.getStateForTest();
            assert.equal(state.isFixPending, false);
            assert.equal(state.graphIndexProgress, null);

            shell.disconnectedCallback();
        } finally {
            intervals.restore();
        }
    }
);
