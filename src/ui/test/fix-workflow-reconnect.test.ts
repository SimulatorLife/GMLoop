import assert from "node:assert/strict";
import test from "node:test";

import type { PropertyValues } from "lit";

import { GmAppShell } from "../src/app/components/gm-app-shell.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";

class TestableGmAppShell extends GmAppShell {
    protected override update(_changedProperties: PropertyValues<this>): void {}
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

void test("GmAppShell reconnects to in-flight fix workflow on connection and polls until finished", async (t) => {
    let fetchCount = 0;
    let fixFetchCount = 0;
    const fetchCalls: string[] = [];

    globalThis.fetch = async (input) => {
        fetchCount++;
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
            } else {
                return Response.json({
                    isRunning: false,
                    logLines: ["Starting format...", "Reformatting files...", "Format complete!"],
                    status: "success",
                    workflow: "format"
                });
            }
        }
        return Response.json({ ok: true });
    };
    Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
            href: "http://127.0.0.1:3000/graph"
        }
    });

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let timerCallback: (() => Promise<void>) | null = null;
    let timerInterval = 0;
    const activeTimerId = 12_345;
    let clearedTimerId: number | null = null;

    (globalThis as any).setInterval = (callback: any, interval: number) => {
        timerCallback = callback;
        timerInterval = interval;
        return activeTimerId;
    };
    (globalThis as any).clearInterval = (id: any) => {
        clearedTimerId = id;
    };

    t.after(() => {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    });

    const shell = new TestableGmAppShell();
    shell.model = createMockModel({ isServerMode: true });

    shell.connectedCallback();

    await new Promise((resolve) => setTimeout(resolve, 10));

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

    assert.equal(fetchCount, 2);
    assert.equal(fetchCalls[1], "http://127.0.0.1:3000/api/fix/progress");
    assert.notEqual(timerCallback, null);
    assert.equal(timerInterval, 1000);

    if (timerCallback) {
        await timerCallback();
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    const stateAfterFinished = shell.getStateForTest();
    assert.equal(stateAfterFinished.isFixPending, false);
    assert.equal(stateAfterFinished.fixStatus, "success");
    assert.deepEqual(stateAfterFinished.fixLogLines, [
        "Starting format...",
        "Reformatting files...",
        "Format complete!"
    ]);

    assert.equal(clearedTimerId, activeTimerId);

    shell.disconnectedCallback();
});

void test("GmAppShell cleans up the reconnect timer on disconnection", async (t) => {
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

    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const activeTimerId = 98_765;
    let clearedTimerId: number | null = null;

    (globalThis as any).setInterval = () => {
        return activeTimerId;
    };
    (globalThis as any).clearInterval = (id: any) => {
        clearedTimerId = id;
    };

    t.after(() => {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    });

    const shell = new TestableGmAppShell();
    shell.model = createMockModel({ isServerMode: true });

    shell.connectedCallback();

    await new Promise((resolve) => setTimeout(resolve, 10));

    shell.disconnectedCallback();

    assert.equal(clearedTimerId, activeTimerId);
});

void test("GmAppShell skips fix workflow reconnect when no browser location is available", async () => {
    let fetchCount = 0;

    globalThis.fetch = async () => {
        fetchCount++;
        return Response.json({ ok: true });
    };
    Reflect.deleteProperty(globalThis, "location");

    const shell = new TestableGmAppShell();
    shell.model = createMockModel({ isServerMode: true });

    shell.connectedCallback();

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(fetchCount, 0);

    shell.disconnectedCallback();
});
