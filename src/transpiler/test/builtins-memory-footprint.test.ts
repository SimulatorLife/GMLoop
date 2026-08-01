import assert from "node:assert/strict";
import { test } from "node:test";

import { emitBuiltinFunction, isBuiltinFunction } from "../src/emitter/builtins.js";

/**
 * Regression tests for the builtin function emitter.
 *
 * The emitter relies on Core.loadManualFunctionNames() for lookup (which
 * lazily loads and caches ~1787 function names internally). No local
 * cache is maintained in builtins.ts — the Core layer handles caching.
 */

void test("isBuiltinFunction recognizes known builtins", () => {
    assert.ok(isBuiltinFunction("abs"), "Expected abs to be recognized as a builtin");
    assert.ok(!isBuiltinFunction("totally_not_a_builtin"), "Expected custom name to be rejected");
});

void test("isBuiltinFunction returns consistent results on repeated calls", () => {
    const first = isBuiltinFunction("floor");
    const second = isBuiltinFunction("floor");

    assert.strictEqual(first, second, "Repeated lookups should return the same result");
    assert.ok(first, "floor should be a known builtin");
});

void test("emitBuiltinFunction formats builtin calls", () => {
    const result = emitBuiltinFunction("abs", ["value"]);
    assert.strictEqual(result, "abs(value)", "Should emit a standard builtin call");
});

void test("emitBuiltinFunction formats zero-argument calls", () => {
    const result = emitBuiltinFunction("game_end", []);
    assert.strictEqual(result, "game_end()", "Should emit empty parentheses for zero-argument calls");
});

void test("emitBuiltinFunction formats single-argument calls", () => {
    const result = emitBuiltinFunction("floor", ["x"]);
    assert.strictEqual(result, "floor(x)", "Should emit single-argument call without trailing comma");
});

void test("emitBuiltinFunction formats multi-argument builtin calls", () => {
    const samples = ["abs", "floor", "string", "show_debug_message", "draw_text"];

    for (const name of samples) {
        const args = ["arg1", "arg2"];
        const result = emitBuiltinFunction(name, args);
        const expected = `${name}(arg1, arg2)`;

        assert.strictEqual(result, expected, `Expected emitter for ${name} to produce "${expected}", got "${result}"`);
    }
});
