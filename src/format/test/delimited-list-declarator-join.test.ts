import assert from "node:assert/strict";
import { test } from "node:test";

import { joinDeclaratorPartsWithCommas } from "../src/printer/delimited-list.js";

/**
 * Enforces the formatter/linter boundary contract (target-state.md §2.2, §3.2)
 * for the declarator-joining helper that used to live in its own
 * `variable-declarator-layout.ts` module. The helper is purely a
 * doc-fragment interleaving utility, so the format workspace owns it. It
 * has been folded into `delimited-list.ts` so all comma-separated list
 * utilities sit next to one another.
 */
void test("joinDeclaratorPartsWithCommas inserts ', ' between every pair of parts", () => {
    assert.deepStrictEqual(joinDeclaratorPartsWithCommas(["a", "b", "c"]), ["a", ", ", "b", ", ", "c"]);
});

void test("joinDeclaratorPartsWithCommas returns a copy for a single-element array", () => {
    assert.deepStrictEqual(joinDeclaratorPartsWithCommas(["only"]), ["only"]);
});

void test("joinDeclaratorPartsWithCommas returns an empty array when there are no parts", () => {
    assert.deepStrictEqual(joinDeclaratorPartsWithCommas([]), []);
});

void test("joinDeclaratorPartsWithCommas preserves non-string doc fragments verbatim", () => {
    const docMarker = { kind: "doc-fragment" };
    const result = joinDeclaratorPartsWithCommas([docMarker, "second", docMarker]);

    assert.deepStrictEqual(result, [docMarker, ", ", "second", ", ", docMarker]);
});
