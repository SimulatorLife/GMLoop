import assert from "node:assert/strict";
import test from "node:test";

import type { GraphVisualizationLiveReloadModel, GraphVisualizationRenderOptions } from "../src/graph/types.js";
import { __test__ as webTestExports } from "../src/web/index.js";

type TestLiveReloadRuntimeTab = Readonly<{
    close: () => void;
    focus: () => void;
    location: {
        href: string;
    };
}>;

function createTestRuntimeTab(onFocus: () => void): TestLiveReloadRuntimeTab {
    return {
        close: () => {},
        focus: onFocus,
        location: {
            href: ""
        }
    };
}

function createLiveReloadModel(runtimeUrl: string): GraphVisualizationLiveReloadModel {
    return {
        endpoints: {
            runtimeUrl,
            statusUrl: "http://127.0.0.1:17891/status",
            websocketUrl: "ws://127.0.0.1:17890"
        },
        pollIntervalMs: 2000,
        runtimeHealth: null,
        statusSnapshot: null
    };
}

function setBootstrapOptionsForTest(options: GraphVisualizationRenderOptions | undefined): void {
    globalThis.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__ = options;
}

test.afterEach(() => {
    delete globalThis.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__;
});

void test("web live-reload start action requests start-or-reuse instead of forced restart", () => {
    assert.deepEqual(JSON.parse(webTestExports.LIVE_RELOAD_START_REQUEST_BODY), { restart: false });
});

void test("web live-reload open function opens the tab at the correct runtime URL", () => {
    const openedTabs: Array<Readonly<{ target: string; url: string }>> = [];
    let focused = false;

    webTestExports.openLiveReloadRuntimeTab("http://127.0.0.1:51264/", (url, target) => {
        openedTabs.push({ target, url });
        return createTestRuntimeTab(() => {
            focused = true;
        });
    });

    assert.deepEqual(openedTabs, [
        {
            target: webTestExports.LIVE_RELOAD_RUNTIME_TAB_TARGET,
            url: "http://127.0.0.1:51264/"
        }
    ]);
    assert.equal(focused, true);
});

void test("web live-reload start opens runtime tab only after startup returns a runtime URL", async () => {
    const openedTabs: Array<Readonly<{ target: string; url: string }>> = [];
    let focused = false;
    let resolveStartResponse: ((response: Response) => void) | null = null;
    const startResponse = new Promise<Response>((resolve) => {
        resolveStartResponse = resolve;
    });

    const startPromise = webTestExports.startLiveReloadFromServer(
        async () => startResponse,
        (url, target) => {
            openedTabs.push({ target, url });
            return createTestRuntimeTab(() => {
                focused = true;
            });
        }
    );

    await Promise.resolve();

    assert.deepEqual(openedTabs, []);

    resolveStartResponse?.(
        Response.json(
            {
                liveReload: createLiveReloadModel("http://127.0.0.1:51264/"),
                ok: true
            },
            { status: 200 }
        )
    );

    const liveReload = await startPromise;

    assert.equal(liveReload.endpoints.runtimeUrl, "http://127.0.0.1:51264/");
    assert.deepEqual(openedTabs, [
        {
            target: webTestExports.LIVE_RELOAD_RUNTIME_TAB_TARGET,
            url: "http://127.0.0.1:51264/"
        }
    ]);
    assert.equal(focused, true);
});

void test("web live-reload start identifies an unreachable graph server", async () => {
    await assert.rejects(
        () =>
            webTestExports.startLiveReloadFromServer(async () => {
                throw new TypeError("Failed to fetch");
            }),
        /Unable to reach the GMLoop graph server \(POST \/api\/live-reload\/start\)\. Check that the server is running and try again\./u
    );
});

void test("web live-reload start preserves server-side startup errors", async () => {
    await assert.rejects(
        () =>
            webTestExports.startLiveReloadFromServer(async () =>
                Response.json({ error: "live-reload worker failed", ok: false }, { status: 500 })
            ),
        /live-reload worker failed/u
    );
});

void test("web live-reload start mirrors active session into bootstrap options for Vite UI HMR remounts", async () => {
    setBootstrapOptionsForTest({
        isServerMode: true,
        title: "HMR"
    });

    await webTestExports.startLiveReloadFromServer(
        async () =>
            Response.json(
                {
                    liveReload: createLiveReloadModel("http://127.0.0.1:51264/"),
                    ok: true
                },
                { status: 200 }
            ),
        () => null
    );

    assert.equal(
        globalThis.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__?.liveReload?.endpoints.runtimeUrl,
        "http://127.0.0.1:51264/"
    );
});

void test("web live-reload start rejects missing runtime URLs without opening a tab", async () => {
    const openedTabs: Array<Readonly<{ target: string; url: string }>> = [];

    await assert.rejects(
        async () =>
            webTestExports.startLiveReloadFromServer(
                async () =>
                    Response.json(
                        {
                            liveReload: {
                                endpoints: {
                                    runtimeUrl: null,
                                    statusUrl: "http://127.0.0.1:17891/status",
                                    websocketUrl: "ws://127.0.0.1:17890"
                                },
                                pollIntervalMs: 2000,
                                runtimeHealth: null,
                                statusSnapshot: null
                            },
                            ok: true
                        },
                        { status: 200 }
                    ),
                (url, target) => {
                    openedTabs.push({ target, url });
                    return null;
                }
            ),
        new RegExp(webTestExports.LIVE_RELOAD_RUNTIME_URL_MISSING_ERROR, "u")
    );

    assert.deepEqual(openedTabs, []);
});

void test("web live-reload stop clears bootstrap live-reload state only after host stop succeeds", async () => {
    setBootstrapOptionsForTest({
        isServerMode: true,
        liveReload: createLiveReloadModel("http://127.0.0.1:51264/"),
        title: "HMR"
    });

    await assert.rejects(
        async () =>
            webTestExports.stopLiveReloadFromServer(async () =>
                Response.json({ error: "stop failed", ok: false }, { status: 500 })
            ),
        /stop failed/u
    );
    assert.equal(
        globalThis.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__?.liveReload?.endpoints.runtimeUrl,
        "http://127.0.0.1:51264/"
    );

    await webTestExports.stopLiveReloadFromServer(async () => Response.json({ ok: true }, { status: 200 }));

    assert.equal(globalThis.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__?.liveReload, undefined);
});

void test("web live-reload open function does not fail when opening is blocked", () => {
    assert.doesNotThrow(() => {
        webTestExports.openLiveReloadRuntimeTab("http://127.0.0.1:51264/", () => {
            throw new Error("Popup blocked");
        });
    });
});
