import assert from "node:assert/strict";
import test from "node:test";

import { Format } from "../src/index.js";

void test("listProjectFormatOptionCatalogEntries exposes formatter-owned option descriptions", () => {
    const entries = Format.listProjectFormatOptionCatalogEntries();

    assert.ok(entries.some((entry) => entry.name === "printWidth" && entry.defaultValue === 100));
    assert.ok(
        entries.some(
            (entry) =>
                entry.name === "allowInlineControlFlowBlocks" && entry.description.includes("control-flow blocks")
        )
    );
    assert.ok(entries.some((entry) => entry.name === "trailingComma" && entry.defaultValue === "none"));
});
