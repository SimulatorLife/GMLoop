import assert from "node:assert/strict";
import { test } from "node:test";

import {
    calculateElapsedNanoseconds,
    formatElapsedNanosecondsAsMilliseconds,
    readMonotonicNanoseconds
} from "../src/shared/timing/elapsed-time.js";

void test("readMonotonicNanoseconds returns a bigint timestamp", () => {
    const timestamp = readMonotonicNanoseconds();
    assert.equal(typeof timestamp, "bigint");
    assert.ok(timestamp > 0n);
});

void test("calculateElapsedNanoseconds clamps negative values to zero", () => {
    const elapsed = calculateElapsedNanoseconds({
        startedAtNanoseconds: 15n,
        completedAtNanoseconds: 10n
    });

    assert.equal(elapsed, 0n);
});

void test("formatElapsedNanosecondsAsMilliseconds renders two decimal places", () => {
    assert.equal(formatElapsedNanosecondsAsMilliseconds(0n), "0.00ms");
    assert.equal(formatElapsedNanosecondsAsMilliseconds(12_340_000n), "12.34ms");
    assert.equal(formatElapsedNanosecondsAsMilliseconds(12_349_999n), "12.34ms");
});
