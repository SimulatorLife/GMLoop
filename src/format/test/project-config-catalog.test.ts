import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_FORMAT_OPTION_CATALOG } from "../src/options/project-config-catalog.js";

void test("PROJECT_FORMAT_OPTION_CATALOG exposes formatter-owned option entries", () => {
    const entries = PROJECT_FORMAT_OPTION_CATALOG;

    assert.ok(entries.some((entry) => entry.name === "printWidth" && entry.defaultValue === 100));
    assert.ok(
        entries.some(
            (entry) =>
                entry.name === "allowInlineControlFlowBlocks" && entry.description.includes("control-flow blocks")
        )
    );
    assert.ok(entries.some((entry) => entry.name === "trailingComma" && entry.defaultValue === "none"));
});
