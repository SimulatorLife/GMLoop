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
