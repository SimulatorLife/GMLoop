import assert from "node:assert/strict";
import test from "node:test";

import { liveReloadBootstrapConfig } from "../browser/config.js";
import { initializeLiveReload } from "../browser/index.js";

void test("runtime-wrapper exposes a browser bootstrap entry at the public browser path", () => {
    assert.equal(typeof initializeLiveReload, "function");
});

void test("runtime-wrapper browser bootstrap config exports a websocket-aware default object", () => {
    assert.equal(typeof liveReloadBootstrapConfig.websocketUrl, "string");
    assert.match(liveReloadBootstrapConfig.websocketUrl, /^ws:\/\//u);
});
