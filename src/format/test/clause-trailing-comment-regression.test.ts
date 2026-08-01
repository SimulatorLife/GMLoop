import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("prints clause trailing comments with non-block bodies", async () => {
    const source = ["if (condition)\t//\tClause comment with tabs", "    perform_action();"].join("\n");

    const formatted = await Format.format(source);
    const [clauseLine] = formatted.split("\n");

    assert.ok(
        clauseLine.includes("//\tClause comment with tabs"),
        "Clause trailing comments should remain attached to their clause line."
    );
});
