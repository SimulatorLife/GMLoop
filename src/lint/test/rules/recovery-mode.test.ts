import { strict as assert } from "node:assert";
import test from "node:test";

import { resolveFixtureLintRecoveryMode } from "./recovery-mode.js";

void test("resolveFixtureLintRecoveryMode keeps malformed-safe fixture rules on limited recovery", () => {
    assert.equal(resolveFixtureLintRecoveryMode({ "gml/require-argument-separators": "error" }), "limited");
    assert.equal(resolveFixtureLintRecoveryMode({ "gml/no-scientific-notation": "warn" }), "limited");
});

void test("resolveFixtureLintRecoveryMode keeps AST-based fixture rules on strict parsing", () => {
    assert.equal(resolveFixtureLintRecoveryMode({ "gml/no-globalvar": "error" }), "none");
    assert.equal(
        resolveFixtureLintRecoveryMode({
            "gml/require-argument-separators": "error",
            "gml/no-globalvar": "error"
        }),
        "none"
    );
});
