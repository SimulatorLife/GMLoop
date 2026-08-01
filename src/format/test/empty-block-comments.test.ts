import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Format } from "../src/index.js";

void describe("empty block comments", () => {
    void it("keeps single-line block comments inline inside empty blocks", async () => {
        const source = "function make_game(_genre) { /* ... */ }\n";

        const formatted = await Format.format(source);

        const expected = ["function make_game(_genre) { /* ... */ }", ""].join("\n");

        assert.strictEqual(formatted, expected);
    });

    void it("preserves standalone empty block comments", async () => {
        const source = ["function remove_empty_comment() {", "    /** */", "    return 0;", "}", ""].join("\n");

        const formatted = await Format.format(source);

        assert.ok(formatted.includes("/** */"), "Expected standalone empty block comments to be preserved.");
        assert.ok(
            formatted.includes("function remove_empty_comment() {"),
            "Expected the surrounding function to remain intact."
        );
    });
});
