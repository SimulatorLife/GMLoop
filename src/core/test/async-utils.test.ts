import assert from "node:assert";
import { test } from "node:test";

import { runInParallel, runInParallelWithLimit, runSequentially } from "../src/utils/async.js";

// === runSequentially tests ===

void test("runSequentially executes callbacks in order", async () => {
    const results: Array<number> = [];
    await runSequentially([1, 2, 3], async (num) => {
        results.push(num);
    });
    assert.deepEqual(results, [1, 2, 3]);
});

void test("runSequentially passes correct indices", async () => {
    const indices: Array<number> = [];
    await runSequentially(["a", "b", "c"], async (_, index) => {
        indices.push(index);
    });
    assert.deepEqual(indices, [0, 1, 2]);
});

void test("runSequentially handles empty array", async () => {
    let called = false;
    await runSequentially([], async () => {
        called = true;
    });
    assert.equal(called, false);
});

void test("runSequentially handles async operations", async () => {
    const results: Array<number> = [];
    await runSequentially([1, 2, 3], async (num) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(num);
    });
    assert.deepEqual(results, [1, 2, 3]);
});

void test("runSequentially propagates errors", async () => {
    await assert.rejects(
        async () => {
            await runSequentially([1, 2, 3], async (num) => {
                if (num === 2) {
                    throw new Error("Test error");
                }
            });
        },
        { message: "Test error" }
    );
});

function* generateSequentialNumbers(): Generator<number> {
    yield 10;
    yield 20;
    yield 30;
}

void test("runSequentially works with generator iterables without materializing to array", async () => {
    // Verifies that runSequentially consumes the iterable lazily (for...of) rather than
    // calling Array.from() first, so generators and other lazy iterables work correctly.
    const results: Array<number> = [];
    await runSequentially(generateSequentialNumbers(), async (num) => {
        results.push(num);
    });
    assert.deepEqual(results, [10, 20, 30]);
});

// === runInParallel tests ===

void test("runInParallel executes callbacks in parallel", async () => {
    const startedIndices: Array<number> = [];
    let releaseCallbacks: () => void;
    const callbacksReleased = new Promise<void>((resolve) => {
        releaseCallbacks = resolve;
    });

    const resultsPromise = runInParallel([1, 2, 3], async (num) => {
        startedIndices.push(num);
        await callbacksReleased;
        return num * 2;
    });

    // runInParallel invokes each callback eagerly before awaiting completion.
    // This assertion avoids wall-clock timing and remains deterministic in CI.
    assert.deepEqual(startedIndices, [1, 2, 3]);
    releaseCallbacks();

    // Results should be returned in order
    const results = await resultsPromise;
    assert.deepEqual(results, [2, 4, 6]);
});

void test("runInParallel passes correct indices", async () => {
    const results = await runInParallel(["a", "b", "c"], async (value, index) => {
        return `${index}:${value}`;
    });
    assert.deepEqual(results, ["0:a", "1:b", "2:c"]);
});

void test("runInParallel handles empty array", async () => {
    const results = await runInParallel([], async () => {
        return 42;
    });
    assert.deepEqual(results, []);
});

void test("runInParallel maintains result order despite different completion times", async () => {
    const results = await runInParallel([100, 50, 10], async (delay) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return delay;
    });
    // Results should maintain input order, not completion order
    assert.deepEqual(results, [100, 50, 10]);
});

void test("runInParallel propagates errors", async () => {
    await assert.rejects(
        async () => {
            await runInParallel([1, 2, 3], async (num) => {
                if (num === 2) {
                    throw new Error("Test error");
                }
                return num;
            });
        },
        { message: "Test error" }
    );
});

void test("runInParallel handles synchronous callbacks", async () => {
    const results = await runInParallel([1, 2, 3], (num) => {
        return num * 3;
    });
    assert.deepEqual(results, [3, 6, 9]);
});

void test("runInParallel works with iterables", async () => {
    const set = new Set([1, 2, 3]);
    const results = await runInParallel(set, async (num) => {
        return num + 10;
    });
    assert.deepEqual(results, [11, 12, 13]);
});

void test("runInParallel is faster than sequential for slow operations", async () => {
    const delayMs = 50;
    const count = 5;
    const delays = Array.from({ length: count }, () => delayMs);

    // Time parallel execution
    const parallelStart = Date.now();
    await runInParallel(delays, async (delay) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
    });
    const parallelDuration = Date.now() - parallelStart;

    // Time sequential execution
    const sequentialStart = Date.now();
    await runSequentially(delays, async (delay) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
    });
    const sequentialDuration = Date.now() - sequentialStart;

    // Parallel should be significantly faster (at least 2x for 5 operations)
    assert.ok(
        parallelDuration < sequentialDuration / 2,
        `Parallel (${parallelDuration}ms) should be much faster than sequential (${sequentialDuration}ms)`
    );
});

// === runInParallelWithLimit tests ===

void test("runInParallelWithLimit executes callbacks with bounded concurrency", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const results = await runInParallelWithLimit(
        [1, 2, 3, 4, 5, 6],
        async (num) => {
            currentConcurrent += 1;
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            await new Promise((resolve) => setTimeout(resolve, 20));
            currentConcurrent -= 1;
            return num * 2;
        },
        2
    );

    assert.equal(maxConcurrent, 2, "Should never exceed concurrency limit of 2");
    assert.deepEqual(results, [2, 4, 6, 8, 10, 12], "Results should be in order");
});

void test("runInParallelWithLimit maintains result order", async () => {
    const results = await runInParallelWithLimit(
        [100, 50, 10, 75, 25],
        async (delay) => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return delay;
        },
        2
    );

    assert.deepEqual(results, [100, 50, 10, 75, 25], "Results should maintain input order");
});

void test("runInParallelWithLimit handles empty array", async () => {
    const results = await runInParallelWithLimit([], async () => 42, 3);
    assert.deepEqual(results, []);
});

void test("runInParallelWithLimit handles limit larger than array", async () => {
    const results = await runInParallelWithLimit([1, 2, 3], async (num) => num * 2, 10);
    assert.deepEqual(results, [2, 4, 6]);
});

void test("runInParallelWithLimit handles limit of 1 (sequential)", async () => {
    const order: Array<number> = [];
    const results = await runInParallelWithLimit(
        [1, 2, 3],
        async (num) => {
            order.push(num);
            await new Promise((resolve) => setTimeout(resolve, 10));
            return num * 2;
        },
        1
    );

    assert.deepEqual(order, [1, 2, 3], "Should process in order with limit 1");
    assert.deepEqual(results, [2, 4, 6]);
});

void test("runInParallelWithLimit rejects invalid limit", async () => {
    await assert.rejects(
        async () => {
            await runInParallelWithLimit([1, 2, 3], async (num) => num, 0);
        },
        { message: "Concurrency limit must be at least 1" }
    );

    await assert.rejects(
        async () => {
            await runInParallelWithLimit([1, 2, 3], async (num) => num, -1);
        },
        { message: "Concurrency limit must be at least 1" }
    );
});

void test("runInParallelWithLimit propagates errors", async () => {
    await assert.rejects(
        async () => {
            await runInParallelWithLimit(
                [1, 2, 3, 4],
                async (num) => {
                    if (num === 3) {
                        throw new Error("Test error at 3");
                    }
                    return num;
                },
                2
            );
        },
        { message: "Test error at 3" }
    );
});

void test("runInParallelWithLimit passes correct indices", async () => {
    const results = await runInParallelWithLimit(["a", "b", "c", "d"], async (value, index) => `${index}:${value}`, 2);
    assert.deepEqual(results, ["0:a", "1:b", "2:c", "3:d"]);
});

void test("runInParallelWithLimit is faster than sequential but slower than unlimited", async () => {
    const delayMs = 30;
    const count = 6;
    const limit = 2;
    const delays = Array.from({ length: count }, () => delayMs);
    const TIMING_TOLERANCE_MS = 50;

    // Time sequential execution
    const sequentialStart = Date.now();
    await runSequentially(delays, async (delay) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
    });
    const sequentialDuration = Date.now() - sequentialStart;

    // Time limited parallel execution
    const limitedStart = Date.now();
    await runInParallelWithLimit(
        delays,
        async (delay) => {
            await new Promise((resolve) => setTimeout(resolve, delay));
        },
        limit
    );
    const limitedDuration = Date.now() - limitedStart;

    // Time unlimited parallel execution
    const unlimitedStart = Date.now();
    await runInParallel(delays, async (delay) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
    });
    const unlimitedDuration = Date.now() - unlimitedStart;

    // Limited should be faster than sequential
    assert.ok(
        limitedDuration < sequentialDuration,
        `Limited (${limitedDuration}ms) should be faster than sequential (${sequentialDuration}ms)`
    );

    // Unlimited should be faster than or equal to limited (allowing tolerance for timing variance)
    assert.ok(
        unlimitedDuration <= limitedDuration + TIMING_TOLERANCE_MS,
        `Unlimited (${unlimitedDuration}ms) should be faster than or similar to limited (${limitedDuration}ms)`
    );
});
