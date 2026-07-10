import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultGmloopProjectConfig } from "../src/modules/ui/default-project-config.js";

void test("default gmloop.json config includes the standard useTabs option", () => {
    const config = createDefaultGmloopProjectConfig();

    assert.equal(config.useTabs, false);
});
