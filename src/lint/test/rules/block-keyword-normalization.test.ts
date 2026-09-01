import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lintWithRule } from "./lint-rule-test-harness.js";

void describe("block keyword normalization", () => {
    void it("normalizes begin-end blocks to curly braces", () => {
        const input = [
            "if (ready) begin",
            "    do_work();",
            "end // done",
            "begin;",
            "    nested += 1;",
            "end;",
            ""
        ].join("\n");
        const expected = ["if (ready) {", "    do_work();", "} // done", "", "    nested += 1;", ""].join("\n");

        const result = lintWithRule("normalize-block-keyword-aliases", input, {});

        assert.strictEqual(result.output, expected);
    });

    void it("drops standalone begin-end wrappers while preserving a single separating blank line", () => {
        const input = ["begin;", "    nested += 1;", "end;", ""].join("\n");
        const expected = ["", "    nested += 1;", ""].join("\n");

        const result = lintWithRule("normalize-block-keyword-aliases", input, {});

        assert.strictEqual(result.output, expected);
    });
});
