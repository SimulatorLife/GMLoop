/**
 * Regression tests for the `singleQuote` formatter option.
 *
 * GML strings must use double quotes only (see the
 * `.agents/skills/gmloop-gml-syntax-basics/SKILL.md` strings section). The
 * formatter preserves the source's original quote style for every string
 * literal, so the `singleQuote` option is intentionally a no-op on the
 * formatted output. These tests lock that contract in so a future contributor
 * cannot quietly introduce quote conversion that would either break GML
 * parsers or surprise downstream tooling that round-trips GML source.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Format } from "../src/index.js";
import { PROJECT_FORMAT_OPTION_CATALOG } from "../src/options/project-config-catalog.js";

const STRING_LITERAL_SAMPLES: ReadonlyArray<{
    readonly label: string;
    readonly source: string;
}> = [
    { label: "double-quoted identifier", source: 'var name = "Henry";' },
    { label: "double-quoted call argument", source: 'show_message("Hello, world!");' },
    { label: "double-quoted raw string", source: 'var _x = @"raw string";' },
    { label: "double-quoted struct property", source: 'var enemy = { name: "Slime", hp: 5 };' }
];

void describe("singleQuote option", () => {
    void it("documents the no-op contract in the project-format-option catalog", () => {
        const entry = PROJECT_FORMAT_OPTION_CATALOG.find((option) => option.name === "singleQuote");
        assert.ok(entry, "singleQuote should be present in the formatter option catalog");
        assert.strictEqual(entry?.defaultValue, false);
        // The description must make it explicit that the option has no effect
        // on string literal output, so users are not surprised when their
        // configured `singleQuote: true` does not convert quotes.
        assert.ok(
            entry?.description.includes("no effect on string literal output"),
            `singleQuote description should call out the no-op contract; received: "${entry?.description}"`
        );
        assert.ok(
            entry?.description.includes("double quotes only"),
            `singleQuote description should explain why GML forbids single-quoted strings; received: "${entry?.description}"`
        );
    });

    void it("preserves the source quote style regardless of the singleQuote value", async () => {
        for (const { label, source } of STRING_LITERAL_SAMPLES) {
            const formattedDouble = await Format.format(source, { singleQuote: false });
            const formattedSingle = await Format.format(source, { singleQuote: true });

            assert.ok(
                formattedDouble.includes('"'),
                `[${label}] formatter dropped a double-quoted string literal: ${formattedDouble}`
            );
            assert.ok(
                formattedSingle.includes('"'),
                `[${label}] singleQuote:true must not convert double-quoted strings to single quotes: ${formattedSingle}`
            );
            assert.strictEqual(
                formattedDouble,
                formattedSingle,
                `[${label}] singleQuote must not change formatter output; double=${formattedDouble} single=${formattedSingle}`
            );
        }
    });

    void it("forwards the singleQuote value through extractProjectFormatOptions without altering output", async () => {
        const source = 'var greeting = "hello";';
        const baseline = await Format.format(source, {});
        const withTrue = await Format.format(source, { singleQuote: true });
        const withFalse = await Format.format(source, { singleQuote: false });

        assert.strictEqual(baseline, withTrue);
        assert.strictEqual(baseline, withFalse);

        const extracted = Format.extractProjectFormatOptions({ singleQuote: true });
        assert.deepEqual(extracted, { singleQuote: true });
    });
});
