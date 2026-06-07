import assert from "node:assert/strict";
import { test } from "node:test";

import { Core } from "@gmloop/core";

/**
 * Regression tests for null-safety in doc-comment type normalization.
 *
 * Background: `normalizeGameMakerType` tokenizes type strings into segments.
 * `findNextNonWhitespaceSegment` looks up a nearby segment's `.value` property
 * and calls `.trim()` on it. If a malformed segment carries a `null` or non-string
 * `value`, the original code would throw `TypeError: Cannot read properties of
 * null/undefined (reading 'trim')`. The fix uses `getNonEmptyTrimmedString` as a
 * safe wrapper so `.trim()` is only called on actual strings.
 */

void test("normalizeGameMakerType does not throw when called with a string containing angle-bracket separators", () => {
    // "Array<number>" tokenizes to: identifier "Array", separator "<",
    // identifier "number", separator ">". The whitespace-checking logic
    // reads nextToken.value.trim() — this would throw if value were null.
    const input = "Array<number>";
    assert.doesNotThrow(() => {
        Core.normalizeGameMakerType(input);
    });
});

void test(
    "normalizeDocCommentTypeAnnotations does not throw when a type annotation " + "contains angle brackets",
    () => {
        const input = "/// @param {Array<number>} value";
        assert.doesNotThrow(() => {
            Core.normalizeDocCommentTypeAnnotations(input);
        });
    }
);

void test("normalizeGameMakerType returns non-string inputs unchanged", () => {
    assert.strictEqual(Core.normalizeGameMakerType(null as any), null);
    assert.strictEqual(Core.normalizeGameMakerType(undefined as any), undefined);
    assert.strictEqual(Core.normalizeGameMakerType(42 as any), 42);
});

void test("normalizeDocCommentTypeAnnotations returns non-string inputs unchanged", () => {
    assert.strictEqual(Core.normalizeDocCommentTypeAnnotations(null as any), null);
    assert.strictEqual(Core.normalizeDocCommentTypeAnnotations(undefined as any), undefined);
    assert.strictEqual(Core.normalizeDocCommentTypeAnnotations(123 as any), 123);
});
