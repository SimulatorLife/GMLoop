import assert from "node:assert/strict";
import test from "node:test";

import {
    GmAppShell,
    GmLiveReloadPanel,
    GRAPH_UI_EVENT_TRIGGER_REFRESH_LIVE_RELOAD
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
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        liveReloadErrorMessage: null,
        liveReloadStatus: null,
        mcpServerStatus: "not-started",
        searchQuery: ""
    };
}

void test("GmLiveReloadPanel renders configured live-reload status, patches, errors, and runtime health", () => {
    const panel = new TestableGmLiveReloadPanel();
    panel.model = createMockModel(createStatusSnapshot());
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="live-reload-page"[\s\S]*class=page docs-page active/u);
    assert.match(rendered, /Pipeline Overview/u);
    assert.match(rendered, /File Watcher/u);
    assert.match(rendered, /Runtime Wrapper/u);
    assert.match(rendered, /live-reload-status-chip running/u);
    assert.match(rendered, /gml\/script\/scr_player/u);
    assert.match(rendered, /Unexpected symbol/u);
    assert.match(rendered, /Registry Version/u);
    assert.match(rendered, /Scripts \/ Events \/ Closures/u);
});

void test("GmLiveReloadPanel renders inactive empty state when host does not provide live-reload config", () => {
    const panel = new TestableGmLiveReloadPanel();
    panel.model = {
        ...createMockModel(null),
        liveReload: null
    };
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Live-reload endpoints were not provided by the host\./u);
    assert.match(rendered, /No runtime patch payloads have been generated yet\./u);
    assert.match(rendered, /Runtime-wrapper diagnostics are not available from the host\./u);
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
});

void test("GmAppShell routes live-reload refresh events through the host callback", async () => {
    const shell = new TestableGmAppShell();
    let refreshCount = 0;
    shell.model = createMockModel(null);
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
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
