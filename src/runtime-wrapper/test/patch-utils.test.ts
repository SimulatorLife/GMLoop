import assert from "node:assert";
import { describe, it } from "node:test";

import { calculateTimingMetrics } from "../browser/runtime/patch-utils.js";

void describe("calculateTimingMetrics", () => {
    void it("returns exact elements for integer percentile indices", () => {
        // When the percentile index lands exactly on an integer (e.g. 3.0), the
        // implementation should return the element at that index rather than
        // interpolating. This reflects the standard percentile convention of
        // picking the nearest sample when the fractional offset is negligible.
        const durations = [10, 20, 30, 40, 50];
        const result = calculateTimingMetrics(durations);

        // p50: index = (50/100) * 4 = 2.0 exactly → sorted[2] = 30
        assert.strictEqual(result.p50DurationMs, 30);
        // p90: index = (90/100) * 4 = 3.6 → non-integer, will interpolate
        assert.ok(result.p90DurationMs > 40);
        // p99: index = (99/100) * 4 = 3.96 → non-integer, will interpolate
        assert.ok(result.p99DurationMs > 40);
    });

    void it("produces results within the observed range", () => {
        const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const result = calculateTimingMetrics(durations);

        // All percentile results must lie between min and max of the input
        assert.ok(result.p50DurationMs >= 10 && result.p50DurationMs <= 100);
        assert.ok(result.p90DurationMs >= 10 && result.p90DurationMs <= 100);
        assert.ok(result.p99DurationMs >= 10 && result.p99DurationMs <= 100);

        // Ordering invariant: p50 ≤ p90 ≤ p99
        assert.ok(result.p50DurationMs <= result.p90DurationMs);
        assert.ok(result.p90DurationMs <= result.p99DurationMs);
    });

    void it("clamps near-integer indices to prevent interpolation artefacts", () => {
        // Construct data where the percentile index is extremely close to an
        // integer because of floating-point rounding: 0.9 * 10 =>
        // 8.999999999999998 instead of 9. Without tolerance-aware rounding,
        // interpolation would drag the 90th percentile down from the expected
        // large value at index 9.
        const durations = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1000, 1000];

        const result = calculateTimingMetrics(durations);
        assert.ok(result !== null);
        assert.strictEqual(result.p90DurationMs, 1000);
    });

    void it("returns the middle element for odd-length arrays on p50", () => {
        // p50 for any odd-length array yields an exact integer index.
        const three = calculateTimingMetrics([100, 200, 300]);
        assert.strictEqual(three.p50DurationMs, 200);

        const seven = calculateTimingMetrics([10, 20, 30, 40, 50, 60, 70]);
        assert.strictEqual(seven.p50DurationMs, 40);

        const eleven = calculateTimingMetrics([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        assert.strictEqual(eleven.p50DurationMs, 6);
    });

    void it("handles edge cases correctly", () => {
        // Empty array returns null
        const result1 = calculateTimingMetrics([]);
        assert.strictEqual(result1, null);

        // Single element
        const result2 = calculateTimingMetrics([42]);
        assert.strictEqual(result2.totalDurationMs, 42);
        assert.strictEqual(result2.averagePatchDurationMs, 42);
        assert.strictEqual(result2.p50DurationMs, 42);
        assert.strictEqual(result2.p90DurationMs, 42);
        assert.strictEqual(result2.p99DurationMs, 42);

        // Two elements — p50 index is (50/100) * 1 = 0.5 → interpolate
        const result3 = calculateTimingMetrics([10, 20]);
        assert.strictEqual(result3.totalDurationMs, 30);
        assert.strictEqual(result3.averagePatchDurationMs, 15);
        assert.ok(result3.p50DurationMs >= 10 && result3.p50DurationMs <= 20);
        assert.ok(result3.p90DurationMs >= 10 && result3.p90DurationMs <= 20);
        assert.ok(result3.p99DurationMs >= 10 && result3.p99DurationMs <= 20);
    });

    void it("computes summary statistics correctly", () => {
        const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const result = calculateTimingMetrics(durations);

        assert.strictEqual(result.totalDurationMs, 550);
        assert.strictEqual(result.averagePatchDurationMs, 55);
        assert.strictEqual(result.fastestPatchMs, 10);
        assert.strictEqual(result.slowestPatchMs, 100);
    });

    void it("interpolates non-integer p50 for even-length arrays", () => {
        // 4 elements: p50 index = (50/100) * 3 = 1.5 → interpolate
        const result = calculateTimingMetrics([10, 20, 30, 40]);
        // weight = 1.5 - 1 = 0.5 → 20 * 0.5 + 30 * 0.5 = 25
        assert.strictEqual(result.p50DurationMs, 25);
        // 6 elements: p50 index = (50/100) * 5 = 2.5 → interpolate
        const result2 = calculateTimingMetrics([1, 2, 3, 4, 5, 6]);
        // weight = 2.5 - 2 = 0.5 → 3 * 0.5 + 4 * 0.5 = 3.5
        assert.strictEqual(result2.p50DurationMs, 3.5);
    });
});
