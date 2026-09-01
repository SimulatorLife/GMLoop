import assert from "node:assert/strict";
import test from "node:test";

import { Format } from "../src/index.js";
import { PROJECT_FORMAT_OPTION_CATALOG } from "../src/options/project-config-catalog.js";

void test("PROJECT_FORMAT_OPTION_CATALOG exposes formatter-owned option entries", () => {
    const entries = PROJECT_FORMAT_OPTION_CATALOG;

    assert.ok(entries.some((entry) => entry.name === "printWidth" && entry.defaultValue === 120));
    assert.ok(
        entries.some(
            (entry) =>
                entry.name === "allowInlineControlFlowBlocks" && entry.description.includes("control-flow blocks")
        )
    );
    assert.ok(entries.some((entry) => entry.name === "trailingComma" && entry.defaultValue === "none"));
});

void test("every catalog entry is recognised by extractProjectFormatOptions", () => {
    // The extractProjectFormatOptions allowlist is derived from the catalog, so
    // any name registered as a formatter-owned option must round-trip through
    // the extractor. This guards against a future contributor adding a catalog
    // entry without wiring it into project-config.ts.
    const config: Record<string, unknown> = {};
    for (const entry of PROJECT_FORMAT_OPTION_CATALOG) {
        config[entry.name] = entry.defaultValue;
    }

    const extracted = Format.extractProjectFormatOptions(config);

    for (const entry of PROJECT_FORMAT_OPTION_CATALOG) {
        assert.equal(
            extracted[entry.name],
            entry.defaultValue,
            `expected catalog entry "${entry.name}" to be extracted by extractProjectFormatOptions`
        );
    }

    assert.equal(
        Object.keys(extracted).length,
        PROJECT_FORMAT_OPTION_CATALOG.length,
        "extractProjectFormatOptions should not expose more keys than the catalog declares"
    );
});

void test("extractProjectFormatOptions ignores keys that are not in the catalog", () => {
    const extracted = Format.extractProjectFormatOptions({
        printWidth: 80,
        unknownFormatterKey: true,
        lintRules: { "gml/no-globalvar": "error" },
        semantic: { index: "sqlite" }
    });

    assert.deepEqual(extracted, { printWidth: 80 });
});
