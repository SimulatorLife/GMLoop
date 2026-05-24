import assert from "node:assert/strict";
import test from "node:test";

import {
    GmAppShell,
    GmLiveReloadPanel,
    GRAPH_UI_EVENT_TRIGGER_REFRESH_LIVE_RELOAD,
    GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD
} from "../src/app/components/index.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import type { GraphVisualizationLiveReloadStatusSnapshot } from "../src/graph/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmLiveReloadPanel extends GmLiveReloadPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmAppShell extends GmAppShell {
    public override requestUpdate(): void {}
}

function countOccurrences(value: string, searchValue: string): number {
    return value.split(searchValue).length - 1;
}

function createStatusSnapshot(): GraphVisualizationLiveReloadStatusSnapshot {
    return {
        avgHotReloadLatencyMs: 42,
        errorCount: 1,
        maxPatchHistory: 50,
        patchCount: 2,
        patchHistorySize: 2,
        p95HotReloadLatencyMs: 80,
        recentErrors: [
            {
                error: "Unexpected symbol",
                filePath: "scripts/scr_error.gml",
                recoveryHint: "Check the changed line.",
                timestamp: 1_766_000_001_000
            }
        ],
        recentPatches: [
            {
                durationMs: 7.5,
                filePath: "scripts/scr_player.gml",
                hotReloadLatencyMs: 75,
                id: "gml/script/scr_player",
                timestamp: 1_766_000_000_000
            }
        ],
        scanComplete: true,
        totalPatchCount: 12,
        uptimeMs: 65_000,
        watcherStatus: "running",
        websocketClients: 1
    };
}

function createMockModel(statusSnapshot: GraphVisualizationLiveReloadStatusSnapshot | null): GraphVisualizationUiModel {
    return {
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
        loadedTarget: null,
        liveReload: {
            endpoints: {
                runtimeUrl: "http://127.0.0.1:51264",
                statusUrl: "http://127.0.0.1:17891/status",
                websocketUrl: "ws://127.0.0.1:17890"
            },
            pollIntervalMs: 2000,
            runtimeHealth: {
                appliedPatches: 10,
                closureCount: 1,
                eventCount: 2,
                failedPatches: 1,
                patchQueueDepth: 0,
                registryVersion: 5,
                runtimeStatus: "ready",
                scriptCount: 7
            },
            statusSnapshot
        },
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Live Reload"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "live-reload",
        errorMessage: null,
        fixErrorMessage: null,
        fixLogLines: [],
        fixStatus: "idle",
        isFixPending: false,
        isLiveReloadRefreshPending: false,
        isLiveReloadStartPending: false,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        liveReloadErrorMessage: null,
        liveReloadStatus: null,
        mcpServerStatus: "not-started",
        pendingActionCount: 0,
        searchQuery: ""
    };
}

void test("GmLiveReloadPanel renders configured live-reload dashboard sections", () => {
    const panel = new TestableGmLiveReloadPanel();
    panel.model = createMockModel(createStatusSnapshot());
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="live-reload-page"[\s\S]*class=page docs-page active/u);
    assert.match(rendered, /<h2>Live Reload<\/h2>/u);
    assert.match(rendered, /Overview/u);
    assert.match(rendered, /Clients/u);
    assert.match(rendered, /Patches/u);
    assert.match(rendered, /Average/u);
    assert.match(rendered, /Pipeline Overview/u);
    assert.match(rendered, /File Watcher/u);
    assert.match(rendered, /Runtime Wrapper/u);
    assert.match(rendered, /live-reload-status-chip running/u);
    assert.match(rendered, /gml\/script\/scr_player/u);
    assert.match(rendered, /Unexpected symbol/u);
    assert.match(rendered, /Registry Version/u);
    assert.match(rendered, /Scripts \/ Events \/ Closures/u);
    assert.match(rendered, /Connection Details/u);
    assert.match(rendered, /http:\/\/127\.0\.0\.1:17891\/status/u);
    assert.match(rendered, /ws:\/\/127\.0\.0\.1:17890/u);
});

void test("GmLiveReloadPanel renders single inactive setup state when host does not provide live-reload config", () => {
    const panel = new TestableGmLiveReloadPanel();
    panel.model = {
        ...createMockModel(null),
        liveReload: null
    };
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Live Reload Not Connected/u);
    assert.match(rendered, /Start Live Reload/u);
    assert.match(rendered, /Start live reload to watch project files/u);
    assert.match(rendered, /Connection Details/u);
    assert.match(rendered, /Not configured/u);
    assert.doesNotMatch(rendered, /No patches yet\./u);
    assert.doesNotMatch(rendered, /Runtime details unavailable\./u);
});

void test("GmLiveReloadPanel renders live-reload error state from UI state", () => {
    const panel = new TestableGmLiveReloadPanel();
    panel.model = createMockModel(null);
    panel.state = {
        ...createMockState(),
        liveReloadErrorMessage: "Status server is offline."
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /gm-error-banner/u);
    assert.match(rendered, /Status server is offline\./u);
    assert.match(rendered, /Recent Errors/u);
    assert.equal(countOccurrences(rendered, "Status server is offline."), 1);
});

void test("GmLiveReloadPanel preserves action labels while pending", () => {
    const panel = new TestableGmLiveReloadPanel();
    panel.model = createMockModel(createStatusSnapshot());
    panel.state = {
        ...createMockState(),
        isLiveReloadRefreshPending: true,
        isLiveReloadStartPending: true
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="start-live-reload"[\s\S]*aria-busy=true/u);
    assert.match(rendered, /id="refresh-live-reload"[\s\S]*aria-busy=true/u);
    assert.match(rendered, /button-spinner/u);
    assert.match(rendered, /Start Live Reload/u);
    assert.match(rendered, /Refresh Status/u);
    assert.doesNotMatch(rendered, /Building & Starting/u);
    assert.doesNotMatch(rendered, /Refreshing\.\.\./u);
});

void test("GmAppShell routes live-reload refresh events through the host callback", async () => {
    const shell = new TestableGmAppShell();
    let refreshCount = 0;
    shell.model = createMockModel(null);
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => null,
        onRefreshLiveReloadStatus: () => {
            refreshCount += 1;
            return createStatusSnapshot();
        }
    };

    shell.connectedCallback();
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_REFRESH_LIVE_RELOAD, { bubbles: true }));
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(refreshCount, 1);
});

void test("GmAppShell routes live-reload start events through the host callback", async () => {
    const shell = new TestableGmAppShell();
    let startCount = 0;
    shell.model = createMockModel(null);
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => {
            startCount += 1;
            return createMockModel(createStatusSnapshot()).liveReload;
        },
        onRefreshLiveReloadStatus: () => null
    };

    shell.connectedCallback();
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD, { bubbles: true }));
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(startCount, 1);
});
