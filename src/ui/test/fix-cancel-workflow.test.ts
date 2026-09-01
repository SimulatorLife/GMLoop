import assert from "node:assert/strict";
import test from "node:test";

import type { PropertyValues } from "lit";

import { GmAppShell } from "../src/app/components/gm-app-shell.js";
import { createNoopGraphVisualizationUiCallbacks, type GraphVisualizationUiModel } from "../src/app/contracts.js";
import { GRAPH_UI_EVENT_TRIGGER_CANCEL_FIX } from "../src/app/events/events.js";

class TestableGmAppShell extends GmAppShell {
    // Tests drive the store directly and never render the shell into a real
    // DOM tree, so skip Lit's update cycle to avoid touching detached nodes.
    protected override update(_changedProperties: PropertyValues<this>): void {}
}

const originalFetch = globalThis.fetch;

function createProjectModel(): GraphVisualizationUiModel {
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
            activePath: "/tmp/test/project.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: [],
            source: "working-directory"
        },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test GMLoop"
    };
}

function installStubbedFixReconnectFetch(): { restore: () => void } {
    globalThis.fetch = () => {
        return Promise.resolve(Response.json({ isRunning: false, logLines: [], workflow: null }));
    };
    return {
        restore(): void {
            globalThis.fetch = originalFetch;
        }
    };
}

function buildConnectedShell(): { cleanup: () => void; shell: TestableGmAppShell } {
    const fetchStub = installStubbedFixReconnectFetch();
    const shell = new TestableGmAppShell();
    shell.model = createProjectModel();
    shell.connectedCallback();
    return {
        cleanup(): void {
            shell.disconnectedCallback();
            fetchStub.restore();
        },
        shell
    };
}

function emitCancelFix(shell: TestableGmAppShell): void {
    shell.dispatchEvent(
        new CustomEvent(GRAPH_UI_EVENT_TRIGGER_CANCEL_FIX, {
            bubbles: true,
            composed: true
        })
    );
}

test.afterEach(() => {
    globalThis.fetch = originalFetch;
});

void test("cancelling an in-flight fix workflow invokes onCancelFix and clears pending state", async () => {
    const { cleanup, shell } = buildConnectedShell();
    try {
        let cancelFixCallCount = 0;
        shell.callbacks = {
            ...createNoopGraphVisualizationUiCallbacks(),
            onCancelFix: async () => {
                cancelFixCallCount += 1;
            }
        };

        shell.getStoreForTest().dispatch({ pending: true, type: "set-fix-pending", workflow: "fix" });
        assert.equal(shell.getStateForTest().isFixPending, true);
        assert.equal(shell.getStateForTest().isFixCancelPending, false);

        emitCancelFix(shell);
        // Allow the async cancel handler's microtasks to settle.
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(cancelFixCallCount, 1);
        assert.equal(shell.getStateForTest().isFixCancelPending, false);
        assert.equal(shell.getStateForTest().fixErrorMessage, null);
    } finally {
        cleanup();
    }
});

void test("cancel fix reports an error message when the host callback rejects", async () => {
    const { cleanup, shell } = buildConnectedShell();
    try {
        shell.callbacks = {
            ...createNoopGraphVisualizationUiCallbacks(),
            onCancelFix: async () => {
                throw new Error("Cancellation transport failed.");
            }
        };

        shell.getStoreForTest().dispatch({ pending: true, type: "set-fix-pending", workflow: "format" });

        emitCancelFix(shell);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(shell.getStateForTest().isFixCancelPending, false);
        assert.equal(shell.getStateForTest().fixErrorMessage, "Cancellation transport failed.");
    } finally {
        cleanup();
    }
});

void test("cancel fix is a no-op when no fix workflow is currently pending", async () => {
    const { cleanup, shell } = buildConnectedShell();
    try {
        let cancelFixCallCount = 0;
        shell.callbacks = {
            ...createNoopGraphVisualizationUiCallbacks(),
            onCancelFix: async () => {
                cancelFixCallCount += 1;
            }
        };

        assert.equal(shell.getStateForTest().isFixPending, false);
        emitCancelFix(shell);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(cancelFixCallCount, 0);
    } finally {
        cleanup();
    }
});

void test("finishing a fix workflow resets any lingering cancel-pending state", async () => {
    const { cleanup, shell } = buildConnectedShell();
    try {
        shell.getStoreForTest().dispatch({ pending: true, type: "set-fix-pending", workflow: "fix" });
        shell.getStoreForTest().dispatch({ pending: true, type: "set-fix-cancel-pending" });
        assert.equal(shell.getStateForTest().isFixCancelPending, true);

        shell.getStoreForTest().dispatch({ pending: false, type: "set-fix-pending", workflow: "fix" });

        assert.equal(shell.getStateForTest().isFixCancelPending, false);
    } finally {
        cleanup();
    }
});
