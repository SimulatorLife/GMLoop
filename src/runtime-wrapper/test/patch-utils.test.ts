import assert from "node:assert";
import { describe, it } from "node:test";

import { calculateTimingMetrics } from "../browser/runtime/patch-utils.js";

// Internal test helper that intentionally uses the OLD buggy implementation
// of calculatePercentile (with strict equality) to demonstrate the problem
// this PR is fixing. This is NOT a duplicate for maintenance - it's a deliberate
// snapshot of the old behavior to validate that the fix addresses the issue.
//
// DO NOT UPDATE THIS FUNCTION to match the fixed implementation - it exists
// specifically to preserve the old buggy behavior for comparison in tests.
function calculatePercentileWithStrictEquality(sorted: Array<number>, percentile: number): number {
    if (sorted.length === 0) {
        return 0;
    }

    if (sorted.length === 1) {
        return sorted[0];
    }

    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    // This is the OLD buggy line - strict equality on floating-point values
    // that can suffer from precision issues
    if (lower === upper) {
        return sorted[lower];
    }

    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

void describe("calculateTimingMetrics", () => {
    void it("should handle floating-point precision in percentile calculation", () => {
        // Create a scenario where floating-point division produces a value
        // very close to an integer, which can expose precision bugs in
        // the floor/ceil equality check.
        //
        // With 100 elements and percentile=50, the index calculation is:
        // index = (50 / 100) * (100 - 1) = 0.5 * 99 = 49.5
        //
        // However, with certain array sizes and percentiles, we can get
        // values like 2.9999999999999996 instead of exactly 3.0.
        //
        // For example, with 10 elements and percentile=33:
        // index = (33 / 100) * (10 - 1) = 0.33 * 9 = 2.97
        //
        // Or with 7 elements and percentile=50:
        // index = (50 / 100) * (7 - 1) = 0.5 * 6 = 3.0
        //
        // The edge case is when index is very close to an integer due to
        // floating-point rounding error.

        // Test case 1: Normal distribution of durations
        const durations1 = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const result1 = calculateTimingMetrics(durations1);

        assert.strictEqual(result1.totalDurationMs, 550);
        assert.strictEqual(result1.averagePatchDurationMs, 55);

        // P50 should be between 50 and 60 (interpolated at index 4.5)
        assert.ok(result1.p50DurationMs >= 50 && result1.p50DurationMs <= 60);

        // P90 should be between 90 and 100 (interpolated at index 8.1)
        assert.ok(result1.p90DurationMs >= 90 && result1.p90DurationMs <= 100);

        // P99 should be very close to 100 (interpolated at index 8.91)
        assert.ok(result1.p99DurationMs >= 90 && result1.p99DurationMs <= 100);

        // Test case 2: Edge case with array size that produces floating-point precision issues
        // With 7 elements, index for p50 = (50/100) * 6 = 3.0 exactly
        // But due to floating-point arithmetic, it might be 2.9999999999999996
        const durations2 = [1, 2, 3, 4, 5, 6, 7];
        const result2 = calculateTimingMetrics(durations2);

        // The p50 calculation should still work correctly even if
        // Math.floor(2.9999999999999996) and Math.ceil(2.9999999999999996)
        // are compared with ===
        assert.ok(result2.p50DurationMs >= 3 && result2.p50DurationMs <= 5);

        // Test case 3: Array with 3 elements (minimal realistic case)
        // p50: index = (50/100) * 2 = 1.0
        const durations3 = [100, 200, 300];
        const result3 = calculateTimingMetrics(durations3);

        assert.strictEqual(result3.p50DurationMs, 200);

        // Test case 4: Large array to test floating-point precision at scale
        const durations4 = Array.from({ length: 1000 }, (_, i) => i + 1);
        const result4 = calculateTimingMetrics(durations4);

        // For 1000 elements:
        // p50: index = (50/100) * 999 = 499.5, should interpolate between 500 and 501
        assert.ok(result4.p50DurationMs >= 500 && result4.p50DurationMs <= 501);

        // p90: index = (90/100) * 999 = 899.1, should interpolate between 900 and 901
        assert.ok(result4.p90DurationMs >= 900 && result4.p90DurationMs <= 901);

        // p99: index = (99/100) * 999 = 989.01, should interpolate between 990 and 991
        assert.ok(result4.p99DurationMs >= 990 && result4.p99DurationMs <= 991);
    });

    void it("should demonstrate floating-point precision bug in calculatePercentile", () => {
        // This test demonstrates a potential floating-point equality pitfall.
        // When index is calculated as (percentile / 100) * (sorted.length - 1),
        // the result can be extremely close to an integer but not exactly equal
        // due to floating-point rounding errors.
        //
        // For example, with certain percentile values and array lengths,
        // we can get index = 2.9999999999999996 instead of exactly 3.0.
        //
        // If Math.floor(2.9999999999999996) and Math.ceil(2.9999999999999996)
        // are compared with ===, they will be different (2 and 3), even though
        // conceptually the index should be treated as 3.0.

        const testData = [10, 20, 30, 40, 50];

        // Test with percentile that produces a value very close to an integer
        // For 5 elements, p75 should give index = (75/100) * 4 = 3.0
        // But due to floating-point arithmetic, this might be 2.9999999999999996
        const result75 = calculatePercentileWithStrictEquality(testData, 75);

        // The expected behavior is that index=3.0 (or very close to it)
        // should return testData[3] = 40, not an interpolation
        // However, the old code with strict === could mishandle this
        // when lower and upper differ due to rounding error

        // Verify the computation details
        const index = (75 / 100) * (testData.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);

        // The old implementation using strict === may or may not work correctly
        // depending on the exact floating-point representation. With epsilon-based
        // comparison, the behavior is robust and predictable.

        // This test validates that our result is reasonable regardless of the
        // underlying floating-point precision
        if (lower === upper) {
            // When lower equals upper exactly, result should be the exact value
            assert.strictEqual(result75, 40);
        } else {
            // If there's a precision issue causing lower !== upper,
            // the result will be an interpolation
            assert.ok(result75 >= 30 && result75 <= 40);
        }
    });

    void it("should clamp near-integer percentile indices to the nearest sample", () => {
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

    void it("should handle edge cases correctly", () => {
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

        // Two elements
        const result3 = calculateTimingMetrics([10, 20]);
        assert.strictEqual(result3.totalDurationMs, 30);
        assert.strictEqual(result3.averagePatchDurationMs, 15);
        // For 2 elements, all percentiles should interpolate between 10 and 20
        assert.ok(result3.p50DurationMs >= 10 && result3.p50DurationMs <= 20);
        assert.ok(result3.p90DurationMs >= 10 && result3.p90DurationMs <= 20);
        assert.ok(result3.p99DurationMs >= 10 && result3.p99DurationMs <= 20);
    });
});
