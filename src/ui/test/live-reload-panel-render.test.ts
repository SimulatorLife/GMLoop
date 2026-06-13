import assert from "node:assert/strict";
import test from "node:test";

import {
    GmAppShell,
    GmGraphToolbar,
    GmLiveReloadPanel,
    GRAPH_UI_EVENT_CLEAR_PAGE_ERROR,
    GRAPH_UI_EVENT_TRIGGER_FIX,
    GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD,
    GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD
} from "../src/app/components/index.js";
import type { GraphVisualizationFixRunResult, GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import type { GraphVisualizationLiveReloadStatusSnapshot } from "../src/graph/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmLiveReloadPanel extends GmLiveReloadPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmGraphToolbar extends GmGraphToolbar {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmAppShell extends GmAppShell {
    public override requestUpdate(): void {}

    public renderForTest(): unknown {
        return this.render();
    }
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
        runtimeUrl: "http://127.0.0.1:51264/",
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
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "live-reload",
        labelMode: "auto"
    };
}

void test("GmLiveReloadPanel renders configured live-reload dashboard sections", () => {
    const panel = new TestableGmLiveReloadPanel();
    panel.model = createMockModel(createStatusSnapshot());
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="live-reload-page"[\s\S]*class=page content-page active/u);
    assert.doesNotMatch(rendered, /<h2>Live Reload<\/h2>/u);
    assert.match(rendered, /Overview/u);
    assert.match(rendered, /Clients/u);
    assert.match(rendered, /Patches/u);
    assert.match(rendered, /Average/u);
    assert.match(rendered, /Pipeline Overview/u);
    assert.match(rendered, /File Watcher/u);
    assert.match(rendered, /Runtime Wrapper/u);
    assert.doesNotMatch(rendered, /<gm-status-chip/u);
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
    assert.match(rendered, /Start live reload to watch project files/u);
    assert.doesNotMatch(rendered, /Connection Details/u);
    assert.doesNotMatch(rendered, /Not configured/u);
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

void test("GmLiveReloadPanel preserves action labels while start is pending", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel(createStatusSnapshot());
    toolbar.state = {
        ...createMockState(),
        isLiveReloadStartPending: true
    };

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id="start-live-reload"[\s\S]*aria-busy=true/u);
    assert.match(rendered, /live-reload-btn-spinner/u);
    assert.match(rendered, /title=Starting Live Reload/u);
    assert.doesNotMatch(rendered, /Building & Starting/u);
    assert.doesNotMatch(rendered, /Refreshing\.\.\./u);
});

void test("GmAppShell routes live-reload start events through the host callback", async () => {
    const shell = new TestableGmAppShell();
    let startCount = 0;
    shell.model = createMockModel(null);
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => {
            startCount += 1;
            return createMockModel(createStatusSnapshot()).liveReload;
        },
        onStopLiveReload: () => {}
    };

    shell.connectedCallback();
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD, { bubbles: true }));
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(startCount, 1);
});

void test("GmAppShell ignores duplicate live-reload start events while startup is pending", async () => {
    const shell = new TestableGmAppShell();
    let startCount = 0;
    let resolveStart: ((value: GraphVisualizationUiModel["liveReload"]) => void) | null = null;
    const startPromise = new Promise<GraphVisualizationUiModel["liveReload"]>((resolve) => {
        resolveStart = resolve;
    });

    shell.model = createMockModel(null);
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => {
            startCount += 1;
            return startPromise;
        },
        onStopLiveReload: () => {}
    };

    shell.connectedCallback();
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD, { bubbles: true }));
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD, { bubbles: true }));
    await Promise.resolve();
    resolveStart?.(createMockModel(createStatusSnapshot()).liveReload);
    await startPromise;
    shell.disconnectedCallback();

    assert.equal(startCount, 1);
});

void test("GmGraphToolbar disables start while a session is active", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel(createStatusSnapshot());
    toolbar.state = createMockState();

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /title=Live Reload Running/u);
    assert.doesNotMatch(rendered, /title=Start Live Reload/u);
    assert.match(rendered, /id="start-live-reload"[\s\S]*disabled/u);
    assert.match(rendered, /id="start-live-reload"[\s\S]*aria-busy=false/u);
    assert.match(rendered, /id="start-live-reload"[\s\S]*<path d="M4 4v16"/u);
    assert.doesNotMatch(rendered, /id="refresh-live-reload"/u);
    assert.doesNotMatch(rendered, /Refresh Status/u);
});

void test("GmGraphToolbar shows runtime opener when active session has a runtime URL", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel(createStatusSnapshot());
    toolbar.state = createMockState();

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id="open-live-reload-runtime"/u);
    assert.match(rendered, /href=http:\/\/127\.0\.0\.1:51264/u);
    assert.match(rendered, /target=gmloop-live-reload-runtime/u);
    assert.match(rendered, /title="Open Runtime"/u);
});

void test("GmGraphToolbar hides runtime opener until active session has a runtime URL", () => {
    const toolbar = new TestableGmGraphToolbar();
    const modelWithMissingRuntimeUrl = createMockModel(createStatusSnapshot());
    toolbar.model = {
        ...modelWithMissingRuntimeUrl,
        liveReload:
            modelWithMissingRuntimeUrl.liveReload === null
                ? null
                : {
                      ...modelWithMissingRuntimeUrl.liveReload,
                      endpoints: {
                          ...modelWithMissingRuntimeUrl.liveReload.endpoints,
                          runtimeUrl: null
                      }
                  }
    };
    toolbar.state = createMockState();

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.doesNotMatch(rendered, /id="open-live-reload-runtime"/u);
});

void test("GmGraphToolbar shows Retry Start when startup failed with no active session", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = {
        ...createMockModel(null),
        liveReload: null
    };
    toolbar.state = {
        ...createMockState(),
        liveReloadErrorMessage: "Igor failed to build the project."
    };

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /title=Retry Start/u);
    assert.doesNotMatch(rendered, /title=Start Live Reload/u);
    assert.match(rendered, /id="start-live-reload"[\s\S]*aria-busy=false/u);
    assert.doesNotMatch(rendered, /Igor failed to build/u);
});

void test("GmGraphToolbar shows Starting Live Reload while start is pending", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel(createStatusSnapshot());
    toolbar.state = {
        ...createMockState(),
        isLiveReloadStartPending: true
    };

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /title=Starting Live Reload/u);
    assert.match(rendered, /id="start-live-reload"[\s\S]*aria-busy=true/u);
});

void test("GmGraphToolbar keeps stop button visible and disabled until a session is active", () => {
    const toolbarWithSession = new TestableGmGraphToolbar();
    toolbarWithSession.model = createMockModel(createStatusSnapshot());
    toolbarWithSession.state = createMockState();

    const renderedWithSession = renderTemplateValue(toolbarWithSession.renderForTest());
    assert.match(renderedWithSession, /id="stop-live-reload"[\s\S]*\?disabled=false/u);
    assert.match(renderedWithSession, /title=Stop Live Reload/u);

    const toolbarWithoutSession = new TestableGmGraphToolbar();
    toolbarWithoutSession.model = {
        ...createMockModel(null),
        liveReload: null
    };
    toolbarWithoutSession.state = createMockState();

    const renderedWithoutSession = renderTemplateValue(toolbarWithoutSession.renderForTest());
    assert.match(renderedWithoutSession, /id="stop-live-reload"[\s\S]*\?disabled=true/u);
    assert.match(renderedWithoutSession, /title=Live Reload Not Running/u);
});

void test("GmGraphToolbar stop button is disabled while start is pending", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel(createStatusSnapshot());
    toolbar.state = {
        ...createMockState(),
        isLiveReloadStartPending: true
    };

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /id="stop-live-reload"[\s\S]*disabled/u);
});

void test("GmAppShell routes live-reload stop events through the host callback", async () => {
    const shell = new TestableGmAppShell();
    let stopCount = 0;
    shell.model = createMockModel(createStatusSnapshot());
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => null,
        onStopLiveReload: () => {
            stopCount += 1;
        }
    };

    shell.connectedCallback();
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD, { bubbles: true }));
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(stopCount, 1);
});

void test("GmAppShell clears live-reload model after stop callback succeeds", async () => {
    const shell = new TestableGmAppShell();
    const modelWithSession = createMockModel(createStatusSnapshot());
    shell.model = modelWithSession;
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => null,
        onStopLiveReload: async () => {}
    };

    shell.connectedCallback();
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD, { bubbles: true }));
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(shell.model?.liveReload, null);
});

void test("GmAppShell ignores live-reload stop events without an active session", async () => {
    const shell = new TestableGmAppShell();
    let stopCount = 0;
    shell.model = {
        ...createMockModel(null),
        liveReload: null
    };
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => null,
        onStopLiveReload: () => {
            stopCount += 1;
        }
    };

    shell.connectedCallback();
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD, { bubbles: true }));
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(stopCount, 0);
    assert.equal(shell.model?.liveReload, null);
});

void test("GmGraphToolbar keeps active-session start button disabled while start is pending", () => {
    const toolbar = new TestableGmGraphToolbar();
    toolbar.model = createMockModel(createStatusSnapshot());
    toolbar.state = {
        ...createMockState(),
        isLiveReloadStartPending: true
    };

    const rendered = renderTemplateValue(toolbar.renderForTest());

    assert.match(rendered, /Starting Live Reload/u);
    assert.match(rendered, /id="start-live-reload"[\s\S]*disabled/u);
    assert.match(rendered, /id="start-live-reload"[\s\S]*aria-busy=true/u);
});

void test("GmLiveReloadPanel renders inactive after live reload is stopped", () => {
    const panel = new TestableGmLiveReloadPanel();
    panel.model = {
        ...createMockModel(null),
        liveReload: null
    };
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.doesNotMatch(rendered, /<gm-status-chip/u);
    assert.match(rendered, /Live Reload Not Connected/u);
    assert.doesNotMatch(rendered, /Uptime 1m 05s/u);
    assert.doesNotMatch(rendered, /id="stop-live-reload"/u);
});

void test("GmAppShell forwards live fix progress snapshots while a fix run is pending", async () => {
    const shell = new TestableGmAppShell();
    let resolveFixRun: ((result: GraphVisualizationFixRunResult) => void) | null = null;
    const runFixPromise = new Promise<GraphVisualizationFixRunResult>((resolve) => {
        resolveFixRun = resolve;
    });

    shell.model = {
        ...createMockModel(null),
        loadedTarget: {
            activePath: "/tmp/test",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test"],
            source: "working-directory"
        }
    };
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: () => {},
        onRunFix: (options) => {
            options?.onProgress({ logLines: ["[1/3 Refactor Codemods]"] });
            return runFixPromise;
        },
        onStartLiveReload: () => null,
        onStopLiveReload: () => {}
    };

    shell.connectedCallback();
    shell.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_TRIGGER_FIX, { bubbles: true }));
    await Promise.resolve();

    const pendingRender = renderTemplateValue(shell.renderForTest());
    assert.match(pendingRender, /\[1\/3 Refactor Codemods\]/u);

    if (!resolveFixRun) {
        assert.fail("Expected fix workflow completion callback to be captured.");
    }
    resolveFixRun({ logLines: ["Success!"], status: "success" });
    await Promise.resolve();
    shell.disconnectedCallback();
});

void test("GmLiveReloadPanel no longer overrides connectedCallback, disconnectedCallback, or updated", () => {
    // The panel used to override all three Lit lifecycle hooks to wire up the
    // gm-error-banner-dismiss listener and the polling controller. The
    // composition refactor moved that wiring into an EventBusManager and the
    // LiveReloadPollingController's hostUpdate() hook. Verify the host no
    // longer declares its own overrides so future contributors do not
    // reintroduce the duplication. Reading own properties (not the prototype
    // chain) keeps this assertion stable against inherited LitElement hooks.
    const prototype = GmLiveReloadPanel.prototype as unknown as Record<string, unknown>;
    const hasOwn = Object.prototype.hasOwnProperty;

    assert.equal(
        hasOwn.call(prototype, "connectedCallback"),
        false,
        "Expected GmLiveReloadPanel to drop its connectedCallback override."
    );
    assert.equal(
        hasOwn.call(prototype, "disconnectedCallback"),
        false,
        "Expected GmLiveReloadPanel to drop its disconnectedCallback override."
    );
    assert.equal(hasOwn.call(prototype, "updated"), false, "Expected GmLiveReloadPanel to drop its updated override.");
});

void test("GmLiveReloadPanel still propagates gm-error-banner-dismiss without overriding lifecycle hooks", () => {
    // With the composition refactor the EventBusManager registered in the
    // constructor is responsible for wiring the gm-error-banner-dismiss
    // listener. The panel must still translate the dismissed event into a
    // GRAPH_UI_EVENT_CLEAR_PAGE_ERROR custom event so the surrounding app
    // shell can clear the live-reload error state. Invoking the inherited
    // LitElement connectedCallback/disconnectedCallback drives the
    // LifecycleParticipantsController in the same way the DOM would, so the
    // event bus subscriptions are installed and torn down without the host
    // declaring its own overrides. The test installs a minimal `document`
    // stub so the polling controller's `visibilitychange` hook can run
    // without a real DOM.
    const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const stubDocument = {
        addEventListener: () => undefined,
        removeEventListener: () => undefined
    };
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: stubDocument
    });

    try {
        const panel = new GmLiveReloadPanel();
        let observedPage: string | null = null;
        const listener = (event: Event): void => {
            const customEvent = event as CustomEvent<{ page: string }>;
            if (customEvent.detail?.page !== undefined) {
                observedPage = customEvent.detail.page;
            }
        };
        panel.addEventListener(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, listener);
        panel.connectedCallback();
        panel.dispatchEvent(new CustomEvent("gm-error-banner-dismiss", { bubbles: true }));
        panel.disconnectedCallback();
        panel.removeEventListener(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, listener);

        assert.equal(observedPage, "live-reload");
    } finally {
        if (originalDocumentDescriptor === undefined) {
            Reflect.deleteProperty(globalThis, "document");
        } else {
            Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
        }
    }
});
