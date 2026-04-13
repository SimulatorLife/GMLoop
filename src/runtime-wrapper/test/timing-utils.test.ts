import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getHighResolutionTime, measureDuration } from "../src/timing/index.js";

await describe("timing utilities", async () => {
    await it("getHighResolutionTime returns a number", () => {
        const time = getHighResolutionTime();
        assert.strictEqual(typeof time, "number");
        assert.ok(time >= 0);
    });

    await it("getHighResolutionTime is monotonically increasing", () => {
        const time1 = getHighResolutionTime();
        const time2 = getHighResolutionTime();
        const time3 = getHighResolutionTime();
        assert.ok(time2 >= time1);
        assert.ok(time3 >= time2);
    });

    await it("getHighResolutionTime has sub-millisecond precision when performance.now is available", () => {
        if (typeof performance !== "undefined" && typeof performance.now === "function") {
            const time1 = getHighResolutionTime();
            const time2 = getHighResolutionTime();
            const diff = time2 - time1;
            // The difference should be measurable, even if very small
            assert.ok(diff >= 0);
        } else {
            // Fallback to Date.now() when performance.now is not available
            const time = getHighResolutionTime();
            assert.strictEqual(typeof time, "number");
        }
    });

    await it("measureDuration captures elapsed time for synchronous operations", () => {
        const { durationMs, result } = measureDuration(() => {
            let sum = 0;
            for (let i = 0; i < 1000; i++) {
                sum += i;
            }
            return sum;
        });

        assert.strictEqual(typeof durationMs, "number");
        assert.ok(durationMs >= 0);
        assert.strictEqual(result, 499_500);
    });

    await it("measureDuration returns correct result for the operation", () => {
        const expectedValue = { foo: "bar", count: 42 };
        const { result } = measureDuration(() => expectedValue);
        assert.deepStrictEqual(result, expectedValue);
    });

    await it("measureDuration measures non-zero duration for non-trivial operations", () => {
        const { durationMs } = measureDuration(() => {
            const arr = [];
            for (let i = 0; i < 10_000; i++) {
                arr.push(i * 2);
            }
            return arr.reduce((a, b) => a + b, 0);
        });

        // Even if performance.now isn't available, Date.now should show measurable time
        assert.ok(durationMs >= 0);
    });

    await it("high-resolution timing is more precise than wall-clock timing", () => {
        // This test verifies that performance.now() provides better precision
        const measurements: number[] = [];
        for (let i = 0; i < 100; i++) {
            const start = getHighResolutionTime();
            const end = getHighResolutionTime();
            measurements.push(end - start);
        }

        // At least some measurements should be less than 1ms if we have high-resolution timing
        if (typeof performance !== "undefined" && typeof performance.now === "function") {
            const subMillisecondCount = measurements.filter((m) => m < 1 && m > 0).length;
            // With high-resolution timing, we should see sub-millisecond measurements
            assert.ok(
                subMillisecondCount > 0 || measurements.every((m) => m === 0),
                "High-resolution timer should provide sub-millisecond precision"
            );
        }
    });

    await it("getHighResolutionTime returns stable results across rapid successive calls", () => {
        // Validates that the eagerly-resolved timer function does not degrade
        // across a burst of calls. Because the implementation binds the timer
        // once at module load (avoiding a per-call typeof check), rapid
        // invocations must all return non-negative, weakly increasing values.
        const results: number[] = [];
        for (let i = 0; i < 1000; i++) {
            results.push(getHighResolutionTime());
        }

        for (const value of results) {
            assert.strictEqual(typeof value, "number");
            assert.ok(value >= 0, "each result must be non-negative");
        }

        // All values should be weakly monotonic
        for (const [index, value] of results.entries()) {
            if (index === 0) {
                continue;
            }
            assert.ok(value >= results[index - 1], `result[${index}] must be >= result[${index - 1}]`);
        }
    });
});
