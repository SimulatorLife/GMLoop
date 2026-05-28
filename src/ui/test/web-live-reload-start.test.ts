import assert from "node:assert/strict";
import test from "node:test";

import { __test__ as webTestExports } from "../src/web/index.js";

void test("web live-reload start action requests a fresh session restart", () => {
    assert.deepEqual(JSON.parse(webTestExports.LIVE_RELOAD_START_REQUEST_BODY), { restart: true });
});
