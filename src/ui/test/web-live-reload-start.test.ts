import assert from "node:assert/strict";
import test from "node:test";

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

void test("web live-reload start action requests a fresh session restart", () => {
    assert.deepEqual(JSON.parse(webTestExports.LIVE_RELOAD_START_REQUEST_BODY), { restart: true });
});

void test("web live-reload runtime tab reservation opens a tab synchronously", () => {
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

void test("web live-reload navigate function sets the runtime tab href", () => {
    let focused = false;
    const runtimeTab = createTestRuntimeTab(() => {
        focused = true;
    });

    webTestExports.navigateLiveReloadRuntimeTab(runtimeTab, "http://127.0.0.1:51264/");

    assert.equal(runtimeTab.location.href, "http://127.0.0.1:51264/");
    assert.equal(focused, true);
});

void test("web live-reload open function ignores null runtime URLs", () => {
    const openedTabs: Array<Readonly<{ target: string; url: string }>> = [];

    webTestExports.openLiveReloadRuntimeTab(null, (url, target) => {
        openedTabs.push({ target, url });
        return null;
    });

    assert.deepEqual(openedTabs, []);
});

void test("web live-reload open function does not fail when opening is blocked", () => {
    assert.doesNotThrow(() => {
        webTestExports.openLiveReloadRuntimeTab("http://127.0.0.1:51264/", () => {
            throw new Error("Popup blocked");
        });
    });
});
