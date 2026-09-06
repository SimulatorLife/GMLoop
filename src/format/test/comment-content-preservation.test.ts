import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Format } from "../src/index.js";

void describe("comment content preservation", () => {
    void it("does not rewrite line-comment text content", async () => {
        const source = ["//Uppercase heading", "function foo() {}", ""].join("\n");

        const formatted = await Format.format(source);

        const expected = ["//Uppercase heading", "function foo() {}", ""].join("\n");
        assert.strictEqual(formatted, expected);
    });
});
