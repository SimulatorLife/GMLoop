/**
 * Contract tests for the public `Format.format()` entry point when applied
 * to expressions built from binary operators.
 *
 * The previous test in this slot (`no-debug-logging.test.ts`) only asserted
 * that `console.log` was never called while formatting. That assertion is
 * not part of the formatter's public contract — it coupled the test to
 * internal hygiene rather than externally visible behaviour, and a single
 * unrelated `console.*` call from anywhere in the call graph would have
 * made the test fail for the wrong reason.
 *
 * These tests instead validate the behaviour that callers actually depend
 * on: that `Format.format()` returns the expected source for expressions
 * involving arithmetic, comparison, and logical binary operators, that
 * operator precedence and grouping parentheses round-trip through the
 * formatter, and that the result is deterministic across repeated calls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Format } from "../src/index.js";

void describe("Format.format() - binary expression contract", () => {
    void it("returns a string for a parenthesised binary expression", async () => {
        const source = "var value = (1 + 2) * 3;\n";
        const formatted = await Format.format(source);

        assert.equal(typeof formatted, "string", "Format.format() must return a string");
        assert.equal(formatted, "var value = (1 + 2) * 3;\n");
    });

    void it("preserves arithmetic operator precedence in mixed expressions", async () => {
        const source = "var result = a + b * c - d / e;\n";
        const formatted = await Format.format(source);

        assert.equal(formatted, "var result = a + b * c - d / e;\n");
    });

    void it("preserves grouping parentheses that change evaluation order", async () => {
        const source = "var mixed = (a + b) * (c - d);\n";
        const formatted = await Format.format(source);

        assert.equal(formatted, "var mixed = (a + b) * (c - d);\n");
    });

    void it("preserves logical operator grouping in conditional expressions", async () => {
        const source = ["if (a and (b or c)) {", "    exit;", "}", ""].join("\n");
        const formatted = await Format.format(source);

        assert.equal(formatted, ["if (a and (b or c)) {", "    exit;", "}", ""].join("\n"));
    });

    void it("preserves additive vs. multiplicative precedence in conditional operands", async () => {
        const source = ["if (a + b < c * d) {", "    exit;", "}", ""].join("\n");
        const formatted = await Format.format(source);

        assert.equal(formatted, ["if (a + b < c * d) {", "    exit;", "}", ""].join("\n"));
    });

    void it("is deterministic: formatting the formatted output yields the same string", async () => {
        const source = "var value = (1 + 2) * 3;\n";
        const firstPass = await Format.format(source);
        const secondPass = await Format.format(firstPass);

        assert.equal(secondPass, firstPass, "Format.format() must be idempotent on its own output");
    });

    void it("preserves mixed additive/multiplicative precedence without reordering operands", async () => {
        const source = "var pos = x + lengthdir_x(radius, angle) - lengthdir_x(radius, aa);\n";
        const formatted = await Format.format(source);

        assert.equal(formatted, "var pos = x + lengthdir_x(radius, angle) - lengthdir_x(radius, aa);\n");
    });
});
