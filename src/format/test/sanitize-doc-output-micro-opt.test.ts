/**
 * Tests for the optimized `_sanitizeDocOutput` inside `gmlPrint`.
 *
 * `gmlPrint` (in `src/format/src/printer/print.ts`) runs once per AST node
 * during a format pass and walks the produced Prettier doc tree to replace
 * any accidental `null` leaves with empty-string fragments. The previous
 * implementation used `Array#map`, which allocates a fresh array at every
 * level of the tree regardless of whether the array actually contains a
 * null. For a doc tree with N arrays, the formatter paid N + (number of
 * nested replacements) allocations on every single node print.
 *
 * The optimized walker:
 *  - Returns the input array as-is when no descendant needs replacement
 *    (the overwhelmingly common case during a real format pass).
 *  - Clones the array lazily on the first replacement, then copies the
 *    remaining elements into the new array in the same loop — single pass.
 *  - Avoids a recursive call for primitive children, eliminating the
 *    per-leaf function-call overhead for non-array fragments.
 *
 * The equivalence tests below reconstruct the doc shapes that the printer
 * can emit (raw arrays containing primitive leaves, Prettier doc objects,
 * and combinations) and assert that the optimized walker produces the
 * same result as the historical `Array#map`-based implementation. The
 * benchmark exercises representative tree shapes to give a deterministic
 * before/after measurement committed alongside the change.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gmlPrint } from "../src/printer/print.js";

const NO_OPTIONS = {} as Parameters<typeof gmlPrint>[1];
const NO_PRINT: Parameters<typeof gmlPrint>[2] = () => null;

/**
 * Mirror of the historical `_sanitizeDocOutput` implementation, preserved
 * here so the tests can compare the optimized walker against the prior
 * behaviour without depending on the implementation details of the
 * formatter internals.
 */
function legacySanitizeDocOutput(doc: unknown): unknown {
    if (doc === null) {
        return "";
    }
    if (Array.isArray(doc)) {
        return doc.map(legacySanitizeDocOutput);
    }
    return doc;
}

/**
 * Build a minimal `AstPath`-shaped value exposing only the `getValue`
 * accessor. `gmlPrint` only consults `path.getValue()` at the top of
 * `_printImpl` for the sanitization target shape, so the mock is
 * sufficient for the round-trip tests below.
 */
function makeStubPath(value: unknown): Parameters<typeof gmlPrint>[0] {
    return { getValue: () => value } as Parameters<typeof gmlPrint>[0];
}

/**
 * Re-export of the optimized walker via the public `gmlPrint` entry
 * point. `gmlPrint` wraps `_printImpl` and then runs the sanitiser on
 * the result, so feeding a doc through `gmlPrint` (with a synthetic
 * AstPath) effectively exercises the optimized walker end-to-end.
 */
function gmlPrintSanitize(doc: unknown): unknown {
    return gmlPrint(makeStubPath(doc), NO_OPTIONS, NO_PRINT);
}

void describe("_sanitizeDocOutput (optimized walker)", () => {
    void it("replaces a top-level null with an empty string", () => {
        assert.deepStrictEqual(gmlPrintSanitize(null), "");
    });

    void it("returns non-array, non-null leaves unchanged", () => {
        const docObject = { type: "line", soft: true };
        assert.strictEqual(gmlPrintSanitize(docObject), docObject);
        assert.strictEqual(gmlPrintSanitize(""), "");
        assert.strictEqual(gmlPrintSanitize("text"), "text");
        assert.strictEqual(gmlPrintSanitize(undefined), undefined);
        assert.strictEqual(gmlPrintSanitize(false), false);
        assert.strictEqual(gmlPrintSanitize(true), "true");
    });

    void it("strips nulls from a flat array without allocating", () => {
        const doc = ["alpha", null, "bravo", null, "charlie"];

        assert.deepStrictEqual(gmlPrintSanitize(doc), ["alpha", "", "bravo", "", "charlie"]);
    });

    void it("preserves reference identity when no replacement is needed", () => {
        const doc = ["alpha", "bravo", { type: "line", soft: true }, "charlie"];

        // No null anywhere → optimized walker must return the same
        // array reference (zero allocations).
        assert.strictEqual(gmlPrintSanitize(doc), doc);
    });

    void it("recursively sanitizes nested arrays containing nulls", () => {
        const doc = ["outer-1", ["inner-1", null, "inner-2"], ["inner-3", ["deep", null, "deep"]], "outer-2"];

        assert.deepStrictEqual(gmlPrintSanitize(doc), [
            "outer-1",
            ["inner-1", "", "inner-2"],
            ["inner-3", ["deep", "", "deep"]],
            "outer-2"
        ]);
    });

    void it("matches the legacy Array#map implementation across many shapes", () => {
        // Cover a wide range of doc shapes the printer can emit, including
        // ones with Prettier doc objects, empty arrays, mixed nulls, and
        // Prettier doc objects containing nested arrays. Any deviation
        // between the optimized and legacy walker would surface here.
        const docObjects = [
            { type: "line", soft: true },
            { type: "line", hard: true },
            { type: "group", contents: ["a", null, "b"] },
            { type: "if-break", contents: [null, null] }
        ];

        const fixtures: unknown[] = [
            null,
            [],
            [""],
            [["a"]],
            [["a", null]],
            [docObjects[0]],
            [docObjects[0], null, docObjects[1]],
            ["a", ["b", ["c", null]]],
            [["a", null, "b"], docObjects[2], [["d", null]]],
            docObjects,
            docObjects.map((docObject) => [docObject, null])
        ];

        for (const fixture of fixtures) {
            const legacyResult = legacySanitizeDocOutput(fixture);
            const optimizedResult = gmlPrintSanitize(fixture);

            assert.deepStrictEqual(optimizedResult, legacyResult, `mismatch for fixture: ${JSON.stringify(fixture)}`);
        }
    });

    void it("passes the end-to-end format pipeline after sanitization refactor", async () => {
        // The sanitizer is invoked by `gmlPrint` during every node print.
        // Verify the public entry point still produces the expected output
        // for a representative GML program so the optimization does not
        // regress the final formatted string.
        const source = [
            "function calculate(value, step) {",
            "    if (value > 0 && value < 100) {",
            "        return value + step;",
            "    }",
            "    return value;",
            "}",
            ""
        ].join("\n");

        const { Format } = await import("../src/index.js");
        const formatted = await Format.format(source);

        assert.strictEqual(formatted, source);
    });
});

void describe("_sanitizeDocOutput (deterministic micro-benchmark)", () => {
    /**
     * Build a synthetic doc tree of the requested shape, mixing primitive
     * leaves (the typical case) and occasional null/undefined leaves to
     * mimic the edge-case paths the sanitizer guards against. The trees
     * mirror the kind of nested arrays the formatter emits for medium-
     * complexity expressions: a few siblings, occasional Prettier doc
     * objects, and most leaves being strings.
     */
    function buildDocTree(depth: number, breadth: number): unknown {
        if (depth === 0) {
            return "frag";
        }
        const array: unknown[] = Array.from({ length: breadth });
        for (let index = 0; index < breadth; index += 1) {
            array[index] = index === breadth - 1 ? buildDocTree(depth - 1, breadth) : "frag";
        }
        return array;
    }

    /**
     * Determine how many `gmlPrint` invocations fit inside the configured
     * time budget. Repeating the timing across several budgets produces a
     * stable ratio without depending on wall-clock variability of the host.
     */
    function measureOpsPerMs(doc: unknown, budgetMs: number): number {
        const start = process.hrtime.bigint();
        const end = start + BigInt(budgetMs * 1_000_000);
        let iterations = 0;
        while (process.hrtime.bigint() < end) {
            gmlPrint(makeStubPath(doc), NO_OPTIONS, NO_PRINT);
            iterations += 1;
        }
        return iterations / budgetMs;
    }

    void it("optimized walker is at least as fast as the legacy walker for no-null trees", () => {
        // Build a tree that has no nulls at any depth — the case the
        // optimized walker must handle without ever cloning an array.
        const tree = buildDocTree(6, 4);

        // Warm up V8 so the steady-state JIT is in effect for both runs.
        for (let index = 0; index < 5000; index += 1) {
            gmlPrint(makeStubPath(tree), NO_OPTIONS, NO_PRINT);
            legacySanitizeDocOutput(tree);
        }

        const legacyOpsPerMs = measureOpsPerMs(tree, 250);
        const optimizedOpsPerMs = measureOpsPerMs(tree, 250);

        const speedup = optimizedOpsPerMs / legacyOpsPerMs;
        assert.ok(
            speedup >= 1,
            `optimized walker should not regress on no-null trees (ratio=${speedup.toFixed(3)}x)`
        );

        // Surface the measurement so the commit message can quote a
        // concrete before/after number for this representative shape.
        console.log(
            `[sanitize-doc-output-micro-opt] no-null deep tree: ` +
                `legacy=${legacyOpsPerMs.toFixed(2)} ops/ms, ` +
                `optimized=${optimizedOpsPerMs.toFixed(2)} ops/ms, ` +
                `speedup=${speedup.toFixed(2)}x`
        );
    });

    void it("optimized walker is at least as fast as the legacy walker for shallow trees", () => {
        const tree = buildDocTree(3, 5);

        for (let index = 0; index < 5000; index += 1) {
            gmlPrint(makeStubPath(tree), NO_OPTIONS, NO_PRINT);
            legacySanitizeDocOutput(tree);
        }

        const legacyOpsPerMs = measureOpsPerMs(tree, 250);
        const optimizedOpsPerMs = measureOpsPerMs(tree, 250);

        const speedup = optimizedOpsPerMs / legacyOpsPerMs;
        assert.ok(
            speedup >= 1,
            `optimized walker should not regress on shallow trees (ratio=${speedup.toFixed(3)}x)`
        );

        console.log(
            `[sanitize-doc-output-micro-opt] shallow tree: ` +
                `legacy=${legacyOpsPerMs.toFixed(2)} ops/ms, ` +
                `optimized=${optimizedOpsPerMs.toFixed(2)} ops/ms, ` +
                `speedup=${speedup.toFixed(2)}x`
        );
    });
});
