import assert from "node:assert/strict";
import { test } from "node:test";

import { cloneObjectEntries } from "../src/utils/array.js";

void test("cloneObjectEntries shallowly clones object entries", () => {
    const original = [{ value: 1 }, { value: 2 }];
    const cloned = cloneObjectEntries(original);

    assert.notEqual(cloned, original);
    assert.deepEqual(cloned, original);
    assert.notEqual(cloned[0], original[0]);
    assert.notEqual(cloned[1], original[1]);
});

void test("cloneObjectEntries preserves non-object entries", () => {
    const original = [1, null, "text"];
    const cloned = cloneObjectEntries(original);

    assert.deepEqual(cloned, original);
    assert.strictEqual(cloned[0], original[0]);
    assert.strictEqual(cloned[1], original[1]);
    assert.strictEqual(cloned[2], original[2]);
});

void test("cloneObjectEntries normalizes nullish input to empty arrays", () => {
    assert.deepEqual(cloneObjectEntries(null), []);
    assert.deepEqual(cloneObjectEntries(), []);
});

void test("cloneObjectEntries fast path for single-element array", () => {
    const original = [{ value: 42 }];
    const cloned = cloneObjectEntries(original);

    assert.notEqual(cloned, original);
    assert.deepEqual(cloned, original);
    assert.notEqual(cloned[0], original[0]);
});

void test("cloneObjectEntries single-element non-object fast path passes value through unchanged", () => {
    // Both 42 and null hit the same isObjectLike===false branch of the
    // length===1 fast path; covering both confirms it isn't accidentally
    // relying on truthiness rather than an object-shape check.
    for (const value of [42, null]) {
        const original = [value];
        const cloned = cloneObjectEntries(original);

        assert.deepEqual(cloned, original);
        assert.strictEqual(cloned[0], original[0]);
        assert.strictEqual(cloned.length, 1);
    }
});
