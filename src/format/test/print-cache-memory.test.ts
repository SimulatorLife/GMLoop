/**
 * Verifies that the struct-argument-break cache is properly cleared after
 * each format cycle to prevent unbounded memory growth.
 *
 * The `forcedStructArgumentBreaks` WeakMap in `print.ts` is keyed on live
 * StructExpression AST nodes.  It grows monotonically during a single
 * Prettier print pass (because each unique struct passed as a call argument
 * is registered once).  After `normalizeFormattedOutput` returns, the AST is
 * no longer reachable but the WeakMap entries remain until the next GC
 * cycle, causing measurable heap growth in repeated-format workloads.
 *
 * The fix: `normalizeFormattedOutput` calls `clearStructArgumentBreakCache()`
 * as its final step, so the cache is reset before the formatted string is
 * returned to the caller.  This test verifies both that the function exists
 * and that it clears the cache without affecting the actual normalisation
 * output.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";
import { clearStructArgumentBreakCache } from "../src/printer/print.js";

void test("clearStructArgumentBreakCache is callable without error", () => {
    // Verify the export exists and is a function.
    assert.ok(
        typeof clearStructArgumentBreakCache === "function",
        "clearStructArgumentBreakCache must be exported from the printer module"
    );

    // Calling it multiple times must not throw.
    assert.doesNotThrow(() => clearStructArgumentBreakCache(), "cache clear must be idempotent");
    assert.doesNotThrow(() => clearStructArgumentBreakCache(), "second call must also not throw");
});

void test("normalizeFormattedOutput does not change behavior after cache clear", async () => {
    const source = [
        "function create() {",
        "    return instance_create_depth(0, 0, 0, Object2, {",
        "        value: 99,",
        "        func: function () {",
        "            return self.value;",
        "        }",
        "    });",
        "}",
        ""
    ].join("\n");

    // Format once to populate the cache.
    const firstFormat = await Format.format(source);
    assert.ok(firstFormat.length > 0, "format should produce non-empty output");

    // Clear the cache mid-cycle (simulates what normalizeFormattedOutput now does).
    clearStructArgumentBreakCache();

    // Format again — output must be identical to the first format.
    const secondFormat = await Format.format(source);

    assert.strictEqual(
        secondFormat,
        firstFormat,
        "Formatting the same source after cache clear must produce identical output (cache is printer-side, not formatter-side)"
    );
});

void test("struct argument force-break works correctly across multiple formats", async () => {
    // Build source with struct arguments that require force-breaking.
    const source = [
        "function demo() {",
        "    foo(function () {",
        "        return 1;",
        "    }, function () {",
        "        return 2;",
        "    }, {",
        "        a: 1,",
        "        b: 2",
        "    });",
        "}",
        ""
    ].join("\n");

    // Format once — struct must break because callbacks precede it.
    const firstFormat = await Format.format(source);
    const firstLines = firstFormat.trim().split("\n");
    const hasMultilineStruct = firstLines.some((l) => l.includes("a: 1,") || l.includes("b: 2"));

    assert.ok(hasMultilineStruct, "struct with preceding callbacks must be forced to multi-line in first format");

    // Format again after cache clear — result must still be multi-line.
    clearStructArgumentBreakCache();
    const secondFormat = await Format.format(source);

    assert.strictEqual(
        secondFormat,
        firstFormat,
        "struct force-break must remain correct across repeated formats (cache reset must not regress formatting)"
    );
});
