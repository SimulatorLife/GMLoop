/**
 * Tests for the `inlineControlFlowBlockMargin` formatter option.
 *
 * The margin is a per-call buffer (in characters) that is added to the
 * inline-length estimate before it is compared to `printWidth`:
 *  - A positive margin makes the formatter more conservative, requiring
 *    additional headroom before a block is kept inline.
 *  - A negative margin makes the formatter more aggressive, allowing the
 *    inline form to exceed `printWidth` by the configured amount.
 *  - The default of `0` reproduces the legacy behaviour exactly.
 *
 * Each test exercises a representative GML snippet through the high-level
 * `Format.format` entry point and asserts the resulting line layout.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Format } from "../src/index.js";
import {
    INLINE_BLOCK_MIDDLE_OVERHEAD,
    INLINE_BLOCK_PREFIX_OVERHEAD,
    INLINE_BLOCK_SUFFIX_OVERHEAD,
    INLINE_BLOCK_TOTAL_OVERHEAD
} from "../src/printer/constants.js";

/**
 * Top-level return-guard snippet. The inline form (`if (ready) { return; }`)
 * is 22 characters long, but the formatter only keeps it once `printWidth`
 * reaches the empirically observed threshold (23). The single-character gap
 * is the Prettier group's conservative "fits" margin, which is orthogonal
 * to the formatter's own inline-block length estimate.
 */
const TOP_LEVEL_RETURN_GUARD = ["if (ready) return;", "counter += 1;", ""].join("\n");

const TOP_LEVEL_RETURN_GUARD_INLINE = ["if (ready) { return; }", "counter += 1;", ""].join("\n");

/**
 * Nested return-guard snippet. The inline form fits only when `printWidth`
 * is large enough to absorb the four-space indent on top of the 22-character
 * inline block.
 */
const NESTED_RETURN_GUARD = ["function demo() {", "    if (ready) return;", "    counter += 1;", "}", ""].join("\n");

const NESTED_RETURN_GUARD_INLINE = [
    "function demo() {",
    "    if (ready) { return; }",
    "    counter += 1;",
    "}",
    ""
].join("\n");

const NESTED_RETURN_GUARD_EXPANDED = [
    "function demo() {",
    "    if (ready) {",
    "        return;",
    "    }",
    "    counter += 1;",
    "}",
    ""
].join("\n");

const NESTED_EXPRESSION_GUARD = [
    "function bump() {",
    "    if (ready) counter += 1;",
    "    return counter;",
    "}",
    ""
].join("\n");

const NESTED_EXPRESSION_GUARD_EXPANDED = [
    "function bump() {",
    "    if (ready) {",
    "        counter += 1;",
    "    }",
    "    return counter;",
    "}",
    ""
].join("\n");

void describe("inlineControlFlowBlockMargin option", () => {
    void it("exposes a default of 0 in the formatter option catalog", () => {
        const catalog = Format.projectFormatOptionCatalog;
        const entry = catalog.find((option) => option.name === "inlineControlFlowBlockMargin");

        assert.ok(entry, "inlineControlFlowBlockMargin should be present in the catalog");
        assert.strictEqual(entry?.defaultValue, 0);
        assert.strictEqual(entry?.description.includes("printWidth"), true);
    });

    void it("keeps the legacy default behaviour when the margin is unset", async () => {
        const formatted = await Format.format(NESTED_RETURN_GUARD, { allowInlineControlFlowBlocks: true });
        assert.strictEqual(formatted, NESTED_RETURN_GUARD_INLINE);
    });

    void it("forces the expanded form when a positive margin eliminates the headroom", async () => {
        // `printWidth` 23 is the smallest value at which the inline form is
        // ordinarily kept. Adding a margin of `1` tips the estimate over the
        // boundary, so the formatter falls back to the expanded form.
        const formatted = await Format.format(TOP_LEVEL_RETURN_GUARD, {
            allowInlineControlFlowBlocks: true,
            printWidth: 23,
            inlineControlFlowBlockMargin: 1
        });

        const expanded = ["if (ready) {", "    return;", "}", "counter += 1;", ""].join("\n");

        assert.strictEqual(formatted, expanded);
    });

    void it("keeps the inline form when a positive margin still leaves headroom", async () => {
        const formatted = await Format.format(TOP_LEVEL_RETURN_GUARD, {
            allowInlineControlFlowBlocks: true,
            printWidth: 24,
            inlineControlFlowBlockMargin: 1
        });

        assert.strictEqual(formatted, TOP_LEVEL_RETURN_GUARD_INLINE);
    });

    void it("applies the margin to expression guards as well as return guards", async () => {
        const formatted = await Format.format(NESTED_EXPRESSION_GUARD, {
            allowInlineControlFlowBlocks: true,
            printWidth: 26,
            inlineControlFlowBlockMargin: 1
        });

        // A positive margin eliminates the headroom, so the formatter expands
        // the braced form across multiple lines.
        assert.strictEqual(formatted, NESTED_EXPRESSION_GUARD_EXPANDED);
    });

    void it("lets a negative margin permit inline blocks that exceed printWidth", async () => {
        // The inline form `if (ready) { return; }` is 22 characters long. With
        // a `printWidth` of 22 it is rejected by the formatter's own length
        // check (which sits 1 char below the Prettier group's conservative
        // threshold). A negative margin of `-5` flips the check, allowing the
        // inline form to be used.
        const source = "if (ready) return;\ncounter += 1;\n";
        const expected = "if (ready) { return; }\ncounter += 1;\n";

        const formatted = await Format.format(source, {
            allowInlineControlFlowBlocks: true,
            printWidth: 22,
            inlineControlFlowBlockMargin: -5
        });

        assert.strictEqual(
            formatted,
            expected,
            "expected the inline form to be permitted when a negative margin offsets the over-budget length"
        );
    });

    void it("has no effect when allowInlineControlFlowBlocks is false", async () => {
        const formatted = await Format.format(NESTED_RETURN_GUARD, {
            allowInlineControlFlowBlocks: false,
            inlineControlFlowBlockMargin: -100
        });

        // When inline control-flow blocks are disabled the formatter always
        // expands the guarded form, regardless of the margin value.
        assert.strictEqual(
            formatted,
            NESTED_RETURN_GUARD_EXPANDED,
            "expected the expanded form because inline control-flow blocks are disabled"
        );
    });

    void it("is forwarded through extractProjectFormatOptions", () => {
        const options = Format.extractProjectFormatOptions({
            inlineControlFlowBlockMargin: 4,
            printWidth: 100,
            lintRules: { "gml/no-globalvar": "error" }
        });

        assert.deepEqual(options, {
            inlineControlFlowBlockMargin: 4,
            printWidth: 100
        });
    });
});

void describe("INLINE_BLOCK_*_OVERHEAD constants", () => {
    void it("derives prefix, middle, suffix, and total values from the inline format strings", () => {
        // The constants are derived from the literal strings the printer emits
        // for an inline control-flow block. Re-asserting the values keeps the
        // estimator in lockstep with the printer if the literals ever change.
        assert.strictEqual(INLINE_BLOCK_PREFIX_OVERHEAD, " (".length);
        assert.strictEqual(INLINE_BLOCK_MIDDLE_OVERHEAD, ") { ".length);
        assert.strictEqual(INLINE_BLOCK_SUFFIX_OVERHEAD, " }".length);
        assert.strictEqual(
            INLINE_BLOCK_TOTAL_OVERHEAD,
            INLINE_BLOCK_PREFIX_OVERHEAD + INLINE_BLOCK_MIDDLE_OVERHEAD + INLINE_BLOCK_SUFFIX_OVERHEAD
        );
    });
});
