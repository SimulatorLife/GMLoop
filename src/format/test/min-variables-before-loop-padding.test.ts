/**
 * Tests for the `minVariablesBeforeLoopPadding` formatter option.
 *
 * The option controls the minimum number of contiguous top-level variable
 * declarations that must precede a loop before the formatter inserts an
 * extra blank-line padding between the variable block and the loop. The
 * default of `4` preserves the legacy heuristic; larger values make the
 * formatter less aggressive (more variable lines required before the
 * padding is added); `0` disables the heuristic entirely and the formatter
 * never inserts the extra blank line on top of what the source already
 * carries.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gmlFormatComponents } from "../src/components/default-format-components.js";
import { Format } from "../src/index.js";
import {
    DEFAULT_INLINE_CONTROL_FLOW_BLOCK_MARGIN,
    MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING
} from "../src/printer/constants.js";

/**
 * Source with four contiguous top-level variable declarations followed by
 * a `for` loop and no extra blank line between them. The legacy heuristic
 * (default threshold of `4`) should add the blank line; lower thresholds
 * should preserve the source spacing.
 */
const FOUR_VARS_THEN_LOOP_NO_BLANK = [
    "var a = 1;",
    "var b = 2;",
    "var c = 3;",
    "var d = 4;",
    "for (var i = 0; i < 10; i += 1) {}",
    ""
].join("\n");

const FOUR_VARS_THEN_LOOP_WITH_PADDING = [
    "var a = 1;",
    "var b = 2;",
    "var c = 3;",
    "var d = 4;",
    "",
    "for (var i = 0; i < 10; i += 1) {}",
    ""
].join("\n");

/**
 * Source with three contiguous top-level variable declarations followed
 * by a `for` loop and no extra blank line between them. The default
 * threshold of `4` must NOT add the blank line because the block is
 * smaller than the threshold.
 */
const THREE_VARS_THEN_LOOP_NO_BLANK = [
    "var a = 1;",
    "var b = 2;",
    "var c = 3;",
    "for (var i = 0; i < 10; i += 1) {}",
    ""
].join("\n");

void describe("minVariablesBeforeLoopPadding option", () => {
    void it("exposes the canonical default in the formatter option catalog", () => {
        const catalog = Format.projectFormatOptionCatalog;
        const entry = catalog.find((option) => option.name === "minVariablesBeforeLoopPadding");

        assert.ok(entry, "minVariablesBeforeLoopPadding should be present in the catalog");
        assert.strictEqual(entry?.defaultValue, MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING);
        assert.strictEqual(
            entry?.description.includes("variable declarations"),
            true,
            "description should mention variable declarations"
        );
    });

    void it("registers the option in the gmlFormatComponents options bag", () => {
        assert.ok(
            Object.hasOwn(gmlFormatComponents.options, "minVariablesBeforeLoopPadding"),
            "minVariablesBeforeLoopPadding should be registered in gmlFormatComponents.options"
        );
        assert.strictEqual(
            gmlFormatComponents.options.minVariablesBeforeLoopPadding.default,
            MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING
        );
    });

    void it("preserves the legacy default behavior when the option is unset", async () => {
        const formatted = await Format.format(FOUR_VARS_THEN_LOOP_NO_BLANK);
        assert.strictEqual(formatted, FOUR_VARS_THEN_LOOP_WITH_PADDING);
    });

    void it("skips the padding when the variable block is smaller than the default threshold", async () => {
        const formatted = await Format.format(THREE_VARS_THEN_LOOP_NO_BLANK);
        assert.strictEqual(formatted, THREE_VARS_THEN_LOOP_NO_BLANK);
    });

    void it("skips the padding when the threshold is raised above the variable block size", async () => {
        const formatted = await Format.format(FOUR_VARS_THEN_LOOP_NO_BLANK, { minVariablesBeforeLoopPadding: 5 });
        assert.strictEqual(formatted, FOUR_VARS_THEN_LOOP_NO_BLANK);
    });

    void it("adds the padding when the threshold is lowered below the variable block size", async () => {
        const formatted = await Format.format(FOUR_VARS_THEN_LOOP_NO_BLANK, { minVariablesBeforeLoopPadding: 3 });
        assert.strictEqual(formatted, FOUR_VARS_THEN_LOOP_WITH_PADDING);
    });

    void it("disables the heuristic when the threshold is zero", async () => {
        const formatted = await Format.format(FOUR_VARS_THEN_LOOP_NO_BLANK, { minVariablesBeforeLoopPadding: 0 });
        assert.strictEqual(formatted, FOUR_VARS_THEN_LOOP_NO_BLANK);
    });

    void it("falls back to the default for malformed option values", async () => {
        // Negative values pass Prettier's option validation but should fall
        // back to the printer's safe default rather than enabling padding
        // unconditionally. Non-numeric values are rejected upstream by
        // Prettier's option normalizer; callers see an explicit error there
        // rather than silently mutated defaults.
        const negative = await Format.format(FOUR_VARS_THEN_LOOP_NO_BLANK, { minVariablesBeforeLoopPadding: -3 });

        assert.strictEqual(negative, FOUR_VARS_THEN_LOOP_WITH_PADDING);
    });

    void it("is forwarded through extractProjectFormatOptions", () => {
        const options = Format.extractProjectFormatOptions({
            minVariablesBeforeLoopPadding: 2,
            printWidth: 100,
            lintRules: { "gml/no-globalvar": "error" }
        });

        assert.deepEqual(options, {
            minVariablesBeforeLoopPadding: 2,
            printWidth: 100
        });
    });
});

void describe("centralized formatter constants", () => {
    void it("exposes the inline control-flow margin default through the constants module", () => {
        // The constant exists and is a finite number so the printer fallback,
        // the components default, and the catalog entry can reference it
        // through the same canonical identifier.
        assert.strictEqual(typeof DEFAULT_INLINE_CONTROL_FLOW_BLOCK_MARGIN, "number");
        assert.ok(Number.isFinite(DEFAULT_INLINE_CONTROL_FLOW_BLOCK_MARGIN));
        assert.strictEqual(DEFAULT_INLINE_CONTROL_FLOW_BLOCK_MARGIN, 0);
    });

    void it("exposes the variable-before-loop padding threshold through the constants module", () => {
        assert.strictEqual(typeof MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING, "number");
        assert.ok(Number.isFinite(MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING));
        assert.ok(MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING > 0);
    });

    void it("keeps the catalog default in lockstep with the constants module", () => {
        // The catalog default must reference the same constant the printer
        // fallback uses, so changing one without the other cannot silently
        // drift the user-visible default away from the runtime fallback.
        const catalog = Format.projectFormatOptionCatalog;
        const entry = catalog.find((option) => option.name === "minVariablesBeforeLoopPadding");

        assert.strictEqual(entry?.defaultValue, MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING);
    });
});
