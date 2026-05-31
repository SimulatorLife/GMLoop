import assert from "node:assert/strict";
import test from "node:test";

import type { GraphVisualizationLiveReloadModel } from "../src/graph/types.js";
import { __test__ as webTestExports } from "../src/web/index.js";

type TestLiveReloadRuntimeTab = Readonly<{
    close: () => void;
    focus: () => void;
    location: {
        href: string;
    };
}>;

function createLiveReloadModel(runtimeUrl: string | null): GraphVisualizationLiveReloadModel {
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

function createTestRuntimeTab(onFocus: () => void): TestLiveReloadRuntimeTab {
    return {
        close: () => {},
        focus: onFocus,
        location: {
            href: ""
        }
    };
}

void test("web live-reload start action requests a fresh session restart", () => {
    assert.deepEqual(JSON.parse(webTestExports.LIVE_RELOAD_START_REQUEST_BODY), { restart: true });
});

void test("web live-reload runtime tab reservation reuses the dedicated runtime target synchronously", () => {
    const openedTabs: Array<Readonly<{ target: string; url: string }>> = [];
    let focused = false;

    const runtimeTab = webTestExports.reserveLiveReloadRuntimeTab((url, target) => {
        openedTabs.push({ target, url });
        return createTestRuntimeTab(() => {
            focused = true;
        });
    });

    assert.notEqual(runtimeTab, null);
    assert.deepEqual(openedTabs, [
        {
            target: webTestExports.LIVE_RELOAD_RUNTIME_TAB_TARGET,
            url: ""
        }
    ]);
    assert.equal(focused, true);
});

void test("web live-reload runtime tab opener reuses the dedicated runtime target", () => {
    const openedTabs: Array<Readonly<{ target: string; url: string }>> = [];
    let focused = false;

    webTestExports.openLiveReloadRuntimeTab(createLiveReloadModel("http://127.0.0.1:51264/"), null, (url, target) => {
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

void test("web live-reload runtime tab opener navigates the reserved runtime tab after startup", () => {
    let focused = false;
    const runtimeTab = createTestRuntimeTab(() => {
        focused = true;
    });

    webTestExports.openLiveReloadRuntimeTab(createLiveReloadModel("http://127.0.0.1:51264/"), runtimeTab);

    assert.equal(runtimeTab.location.href, "http://127.0.0.1:51264/");
    assert.equal(focused, true);
});

void test("web live-reload runtime tab opener ignores missing runtime URLs", () => {
    const openedTabs: Array<Readonly<{ target: string; url: string }>> = [];

    webTestExports.openLiveReloadRuntimeTab(createLiveReloadModel(null), null, (url, target) => {
        openedTabs.push({ target, url });
        return null;
    });

    assert.deepEqual(openedTabs, []);
});

void test("web live-reload runtime tab opener does not fail the start flow when opening is blocked", () => {
    assert.doesNotThrow(() => {
        webTestExports.openLiveReloadRuntimeTab(createLiveReloadModel("http://127.0.0.1:51264/"), null, () => {
            throw new Error("Popup blocked");
        });
    });
});
