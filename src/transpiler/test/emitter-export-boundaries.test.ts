import assert from "node:assert/strict";
import test from "node:test";

import * as Emitter from "../src/emitter/index.js";
import * as EventContext from "../src/event-context/index.js";

void test("emitter index does not re-export EventContextOracle compatibility alias", () => {
    assert.equal("EventContextOracle" in Emitter, false);
});

void test("event-context index exports EventContextOracle from canonical owner", () => {
    assert.equal(typeof EventContext.EventContextOracle, "function");
});
