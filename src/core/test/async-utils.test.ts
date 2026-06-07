import assert from "node:assert/strict";
import { test } from "node:test";

// Node.js deprecated the loose equality helpers (e.g. assert.equal) in the
// `node:assert` module. This test suite migrates to the /strict subpath and
// strict helpers (assert.strictEqual, assert.deepStrictEqual) for value- and
// type-exact comparisons. Behaviour parity with the original calls is
// validated via: pnpm test src/core/test/async-utils.test.js
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
    assert.strictEqual(called, false);
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

void test("runInParallel eagerly starts all callbacks unlike runSequentially", async () => {
    // Historical note: this suite previously asserted Date.now() durations to prove
    // parallelism. That approach is flaky in busy CI environments where scheduler
    // jitter can invert close timing comparisons.
    const startedInParallel: Array<number> = [];
    let releaseParallelCallbacks: () => void;
    const parallelGate = new Promise<void>((resolve) => {
        releaseParallelCallbacks = resolve;
    });

    const parallelResultsPromise = runInParallel([1, 2, 3], async (value) => {
        startedInParallel.push(value);
        await parallelGate;
        return value;
    });

    assert.deepEqual(
        startedInParallel,
        [1, 2, 3],
        "runInParallel should invoke every callback before any callback is released"
    );
    releaseParallelCallbacks();
    await parallelResultsPromise;

    const startedInSequence: Array<number> = [];
    let releaseFirstSequentialCallback: () => void;
    const firstSequentialGate = new Promise<void>((resolve) => {
        releaseFirstSequentialCallback = resolve;
    });

    const sequentialResultsPromise = runSequentially([1, 2, 3], async (value) => {
        startedInSequence.push(value);
        if (value === 1) {
            await firstSequentialGate;
        }
    });

    await Promise.resolve();
    assert.strictEqual(
        startedInSequence.length,
        1,
        "runSequentially should not invoke the next callback until the current callback settles"
    );
    assert.strictEqual(startedInSequence[0], 1);
    releaseFirstSequentialCallback();
    await sequentialResultsPromise;
    assert.deepStrictEqual(startedInSequence, [1, 2, 3]);
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

    assert.strictEqual(maxConcurrent, 2, "Should never exceed concurrency limit of 2");
    assert.deepStrictEqual(results, [2, 4, 6, 8, 10, 12], "Results should be in order");
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

void test("runInParallelWithLimit starts up to the limit immediately and backfills as tasks settle", async () => {
    // This scenario replaces a historical wall-clock benchmark that compared Date.now()
    // durations between sequential/limited/unlimited modes. That benchmark was flaky:
    // CI scheduler jitter could make near-equal durations invert, causing sporadic failures.
    // We now verify deterministic scheduling semantics with explicit promise gates.
    const started: Array<number> = [];
    const releaseByTask = new Map<number, () => void>();

    const resultsPromise = runInParallelWithLimit(
        [1, 2, 3, 4],
        async (value) => {
            started.push(value);
            await new Promise<void>((resolve) => {
                releaseByTask.set(value, resolve);
            });
            return value * 10;
        },
        2
    );

    // Only two tasks should begin before any task is released.
    assert.deepEqual(started, [1, 2], "Exactly `limit` tasks should start immediately");

    const releaseTaskOne = releaseByTask.get(1);
    assert.ok(releaseTaskOne, "First task release handle should be registered");
    releaseTaskOne();
    for (let microtaskTurn = 0; microtaskTurn < 5; microtaskTurn += 1) {
        await Promise.resolve();
    }
    assert.equal(started.length, 3, "Exactly one queued task should start after releasing one active task");
    assert.deepEqual(started.slice(0, 3), [1, 2, 3], "Third task should begin only after one active task settles");

    const releaseTaskTwo = releaseByTask.get(2);
    assert.ok(releaseTaskTwo, "Second task release handle should be registered");
    releaseTaskTwo();
    for (let microtaskTurn = 0; microtaskTurn < 5; microtaskTurn += 1) {
        await Promise.resolve();
    }
    assert.deepEqual(started, [1, 2, 3, 4], "Fourth task should begin after the second slot becomes available");

    for (const taskId of [3, 4]) {
        const releaseTask = releaseByTask.get(taskId);
        assert.ok(releaseTask, `Task ${taskId} release handle should be registered`);
        releaseTask();
    }

    const results = await resultsPromise;
    assert.deepEqual(results, [10, 20, 30, 40], "Result ordering should remain stable");
});
