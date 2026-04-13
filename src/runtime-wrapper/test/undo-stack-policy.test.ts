import assert from "node:assert/strict";
import test from "node:test";

import { trimArrayToMaxSize } from "../src/runtime/undo-stack-policy.js";

void test("trimArrayToMaxSize leaves the array unchanged when max size is unbounded (zero)", () => {
    const array = [1, 2, 3, 4, 5];
    trimArrayToMaxSize(array, 0);

    assert.deepEqual(array, [1, 2, 3, 4, 5]);
});

void test("trimArrayToMaxSize leaves the array unchanged when max size is negative", () => {
    const array = [1, 2, 3];
    trimArrayToMaxSize(array, -1);

    assert.deepEqual(array, [1, 2, 3]);
});

void test("trimArrayToMaxSize leaves the array unchanged when within limit", () => {
    const array = [1, 2, 3, 4, 5];
    trimArrayToMaxSize(array, 5);

    assert.deepEqual(array, [1, 2, 3, 4, 5]);
});

void test("trimArrayToMaxSize leaves the array unchanged when under limit", () => {
    const array = [1, 2];
    trimArrayToMaxSize(array, 5);

    assert.deepEqual(array, [1, 2]);
});

void test("trimArrayToMaxSize removes oldest entries when exceeding limit", () => {
    const array = [1, 2, 3, 4, 5, 6, 7, 8];
    trimArrayToMaxSize(array, 3);

    assert.deepEqual(array, [6, 7, 8]);
});

void test("trimArrayToMaxSize handles empty array", () => {
    const array: Array<number> = [];
    trimArrayToMaxSize(array, 3);

    assert.deepEqual(array, []);
});
