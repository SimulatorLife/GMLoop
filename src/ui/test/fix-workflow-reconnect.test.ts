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

test.afterEach(() => {
    globalThis.fetch = originalFetch;
});

void test("GmAppShell reconnects to in-flight fix workflow on connection and polls until finished", async (t) => {
    let fetchCount = 0;
    const fetchCalls: string[] = [];

    globalThis.fetch = async (input) => {
        fetchCount++;
        const url = String(input);
        fetchCalls.push(url);

        if (url.includes("/api/fix/progress")) {
            if (fetchCount === 1) {
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

    assert.equal(fetchCount, 1);
    assert.ok(fetchCalls[0].includes("/api/fix/progress"));
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
