import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";

import {
    calculateElapsedNanoseconds,
    formatElapsedNanosecondsAsMilliseconds
} from "../src/shared/timing/verbose-timing.js";

void test("calculateElapsedNanoseconds measures a real process.hrtime.bigint() span", () => {
    const startedAtNanoseconds = process.hrtime.bigint();
    const completedAtNanoseconds = process.hrtime.bigint();

    const elapsed = calculateElapsedNanoseconds({
        startedAtNanoseconds,
        completedAtNanoseconds
    });

    assert.equal(typeof elapsed, "bigint");
    assert.ok(elapsed >= 0n);
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
