import assert from "node:assert/strict";
import test from "node:test";

import type { PropertyValues } from "lit";

import { GmAppShell } from "../src/app/components/gm-app-shell.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { GRAPH_UI_EVENT_NAVIGATE_PAGE } from "../src/app/events/events.js";

class TestableGmAppShell extends GmAppShell {
    // Tests drive navigation directly through the store and never render the
    // shell into a real DOM tree, so skip Lit's update cycle to avoid
    // touching detached nodes from background work.
    protected override update(_changedProperties: PropertyValues<this>): void {}
}

const originalFetch = globalThis.fetch;

function createProjectModelWithoutGraphNodes(): GraphVisualizationUiModel {
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

function installStubBrowserLocation(search: string): { restore: () => void } {
    const previousLocation = globalThis.location;
    const previousHistory = globalThis.history;
    Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
            hash: "",
            href: `http://127.0.0.1:3000/${search}`,
            pathname: "/",
            search
        }
    });
    const noopHistory = {
        replaceState: () => {}
    } as unknown as History;
    Object.defineProperty(globalThis, "history", { configurable: true, value: noopHistory });

    return {
        restore(): void {
            if (previousLocation === undefined) {
                Reflect.deleteProperty(globalThis, "location");
            } else {
                Object.defineProperty(globalThis, "location", {
                    configurable: true,
                    value: previousLocation
                });
            }
            Object.defineProperty(globalThis, "history", {
                configurable: true,
                value: previousHistory
            });
        }
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

function buildConnectedShellForNavigation(search: string): { shell: TestableGmAppShell; cleanup: () => void } {
    const locationStub = installStubBrowserLocation(search);
    const fetchStub = installStubbedFixReconnectFetch();
    const shell = new TestableGmAppShell();
    shell.model = createProjectModelWithoutGraphNodes();
    shell.connectedCallback();
    locationStub.restore();
    return {
        cleanup(): void {
            fetchStub.restore();
        },
        shell
    };
}

test.afterEach(() => {
    globalThis.fetch = originalFetch;
});

/**
 * Regression: clicking the "Graph Index" header tab when no graph index is
 * loaded must navigate to the Graph Index surface rather than silently
 * dropping the click. The graph panel already owns an empty state that
 * explains how to load or rebuild a graph; the shell must honour explicit
 * navigation requests so the empty state can render.
 */
void test("Graph Index header tab click navigates to graph page when no graph index is loaded", () => {
    const { shell, cleanup } = buildConnectedShellForNavigation("");
    try {
        const initialState = shell.getStateForTest();
        assert.equal(initialState.activePage, "graph");

        shell.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_NAVIGATE_PAGE, {
                bubbles: true,
                composed: true,
                detail: { page: "docs" }
            })
        );
        assert.equal(shell.getStateForTest().activePage, "docs");

        shell.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_NAVIGATE_PAGE, {
                bubbles: true,
                composed: true,
                detail: { page: "graph" }
            })
        );
        assert.equal(
            shell.getStateForTest().activePage,
            "graph",
            "click navigation must reach the graph page even when no graph index is loaded"
        );

        shell.disconnectedCallback();
    } finally {
        cleanup();
    }
});

/**
 * Toolbar-driven navigation requests for the graph page must also reach the
 * store when no graph index is loaded, so a future regression cannot
 * re-introduce a shadow gate at the toolbar-emit boundary while the shell
 * listener behaves correctly.
 */
void test("toolbar navigation to graph is forwarded even when no graph index is loaded", () => {
    const { shell, cleanup } = buildConnectedShellForNavigation("");
    try {
        shell.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_NAVIGATE_PAGE, {
                bubbles: true,
                composed: true,
                detail: { page: "graph" }
            })
        );

        assert.equal(shell.getStateForTest().activePage, "graph");
        shell.disconnectedCallback();
    } finally {
        cleanup();
    }
});

/**
 * Other navigation requests must continue to work regardless of graph
 * availability to ensure the fix is narrow and does not over-restrict the
 * dispatcher when forwarding navigation events.
 */
void test("non-graph navigation requests continue to flow through the navigation listener", () => {
    const { shell, cleanup } = buildConnectedShellForNavigation("?page=docs");
    try {
        assert.equal(shell.getStateForTest().activePage, "docs");

        for (const targetPage of ["config", "fix", "playground", "auto-game", "live-reload"] as const) {
            shell.dispatchEvent(
                new CustomEvent(GRAPH_UI_EVENT_NAVIGATE_PAGE, {
                    bubbles: true,
                    composed: true,
                    detail: { page: targetPage }
                })
            );
            assert.equal(
                shell.getStateForTest().activePage,
                targetPage,
                `expected navigation to ${targetPage} to update activePage`
            );
        }
        shell.disconnectedCallback();
    } finally {
        cleanup();
    }
});
