/**
 * Tests for the shared runner context helpers (`runner-context.ts`).
 *
 * These helpers were extracted from `runner.ts` to lift the discover/bind
 * ceremony and the follow-loop bookkeeping out of the action orchestrators.
 * The tests here pin down the contracts the orchestrators rely on:
 *
 * 1. `followRunnerLogs` keeps a "highest seen timestamp" cursor across ticks
 *    so the same entry is never emitted twice.
 * 2. `followRunnerLogs` invokes the caller-supplied `rebind` callback on
 *    every poll tick to keep the bound project root in sync with the store.
 * 3. `followRunnerLogs` resolves exactly once the window elapses, even when
 *    no entries were observed.
 * 4. `followRunnerLogs` rejects malformed parameter bags (missing callbacks)
 *    with a `TypeError` so misconfiguration fails fast.
 * 5. `resolveBoundRunnerState` discovers the project root from the caller-
 *    supplied options and pre-binds the shared runner state store to it.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    followRunnerLogs,
    type FollowRunnerLogsParameters,
    resolveBoundRunnerState
} from "../src/commands/runner-context.js";
import { getRunnerStateStore, type RunnerLogEntry } from "../src/modules/runtime/index.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";

/**
 * Per-test scratch directory. Each test gets its own tmpdir so concurrent
 * runs cannot trample each other's `runner-state.json` and the runner state
 * store singleton can be re-bound cleanly between tests.
 */
async function withFreshRunnerState<T>(run: (projectRoot: string) => Promise<T>): Promise<T> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-runner-context-"));
    await writeFile(path.join(projectRoot, "gmloop.json"), "{}\n", "utf8");
    try {
        return await run(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
}

/**
 * Build a synthetic `RunnerLogEntry` with the given timestamp and message.
 * Keeping the entry shape local to the test file ensures the cursor
 * assertions read against the same data the helper actually filters.
 */
function buildEntry(timestamp: number, message: string): RunnerLogEntry {
    return Object.freeze({
        kind: "runtime",
        level: "info",
        message,
        timestamp
    });
}

void test("followRunnerLogs emits each fresh batch exactly once and stops at the window", async () => {
    await withFreshRunnerState(async () => {
        // The follow cursor is initialised to `Date.now() - 1`, so synthetic
        // entries must use timestamps that fall after that baseline for the
        // helper to ever observe them.
        const baseline = Date.now() + 10_000;
        const firstBatch = [buildEntry(baseline + 1, "a"), buildEntry(baseline + 2, "b")];
        const secondBatch = [buildEntry(baseline + 3, "c")];
        let callIndex = 0;
        const emitted: Array<ReadonlyArray<RunnerLogEntry>> = [];

        const parameters: FollowRunnerLogsParameters = {
            emit: (entries) => {
                emitted.push(entries);
            },
            intervalMs: 5,
            readLogs: () => {
                const batch = callIndex === 0 ? firstBatch : callIndex === 1 ? secondBatch : [];
                callIndex += 1;
                return batch;
            },
            rebind: () => {},
            windowMs: 30
        };

        await followRunnerLogs(parameters);

        assert.equal(emitted.length, 2, "Two non-empty batches should be emitted");
        assert.deepEqual([...emitted[0]], [...firstBatch], "First emit must be the first batch in arrival order");
        assert.deepEqual(
            [...emitted[1]],
            [...secondBatch],
            "Second emit must be the second batch; the first batch must not be re-emitted"
        );
    });
});

void test("followRunnerLogs does not re-emit entries observed on a previous tick", async () => {
    await withFreshRunnerState(async () => {
        const baseline = Date.now() + 10_000;
        const stableSnapshot = [buildEntry(baseline + 1, "a"), buildEntry(baseline + 2, "b")];
        const emitted: Array<ReadonlyArray<RunnerLogEntry>> = [];

        const parameters: FollowRunnerLogsParameters = {
            emit: (entries) => {
                emitted.push(entries);
            },
            intervalMs: 5,
            readLogs: () => stableSnapshot,
            rebind: () => {},
            windowMs: 25
        };

        await followRunnerLogs(parameters);

        assert.equal(emitted.length, 1, "A stable snapshot should only produce a single batch");
        assert.deepEqual([...emitted[0]], [...stableSnapshot]);
    });
});

void test("followRunnerLogs rebinds the runner state on every tick", async () => {
    await withFreshRunnerState(async () => {
        const rebindCalls: Array<unknown> = [];
        let tickCount = 0;

        const parameters: FollowRunnerLogsParameters = {
            emit: () => {},
            intervalMs: 5,
            readLogs: () => {
                tickCount += 1;
                return [];
            },
            rebind: () => {
                rebindCalls.push(tickCount);
            },
            windowMs: 20
        };

        await followRunnerLogs(parameters);

        assert.ok(
            rebindCalls.length >= 2,
            `Expected at least two rebinds across the window; observed ${rebindCalls.length}`
        );
        assert.deepEqual(rebindCalls, [...rebindCalls], "Rebind calls should be recorded in invocation order");
    });
});

void test("followRunnerLogs resolves silently when no entries are ever observed", async () => {
    await withFreshRunnerState(async () => {
        const emitted: Array<ReadonlyArray<RunnerLogEntry>> = [];
        const parameters: FollowRunnerLogsParameters = {
            emit: (entries) => {
                emitted.push(entries);
            },
            intervalMs: 5,
            readLogs: () => [],
            rebind: () => {},
            windowMs: 20
        };

        await followRunnerLogs(parameters);

        assert.equal(emitted.length, 0, "An empty feed should never produce a batch");
    });
});

void test("followRunnerLogs rejects malformed parameter bags", async () => {
    await withFreshRunnerState(async () => {
        const stub: Pick<FollowRunnerLogsParameters, "readLogs" | "rebind" | "emit"> = {
            emit: () => {},
            readLogs: () => [],
            rebind: () => {}
        };

        await assert.rejects(
            followRunnerLogs({
                readLogs: stub.readLogs,
                rebind: stub.rebind
                // missing emit
            } as unknown as FollowRunnerLogsParameters),
            /emit callback/
        );

        await assert.rejects(
            followRunnerLogs({ emit: stub.emit, rebind: stub.rebind } as unknown as FollowRunnerLogsParameters),
            /readLogs function/
        );

        await assert.rejects(
            followRunnerLogs({ emit: stub.emit, readLogs: stub.readLogs } as unknown as FollowRunnerLogsParameters),
            /rebind function/
        );
    });
});

/**
 * Wrap `setInterval`/`clearInterval` for the duration of `action` so tests
 * can observe how many polling handles a helper owns at any point. A handle
 * is recorded when `setInterval` returns it and removed when the matching
 * `clearInterval` runs, mirroring the lifecycle the runtime actually
 * maintains.
 */
async function withTrackedIntervals<Result>(
    action: (tracker: { activeCount: () => number }) => Promise<Result>
): Promise<Result> {
    // `setInterval` returns either a `number` (DOM typings) or a
    // `NodeJS.Timeout` depending on which lib is active, so the tracker
    // stores handles as `unknown` and bridges the two type signatures via
    // casts at the wrapper boundary.
    const activeHandles = new Set<unknown>();

    const originalSetInterval = globalThis.setInterval;
    const replacementSetInterval = ((handler: () => void, ms?: number, ...args: Array<unknown>) => {
        const handle = originalSetInterval(handler, ms, ...args);
        activeHandles.add(handle);
        return handle;
    }) as typeof setInterval;

    const originalClearInterval = globalThis.clearInterval;
    const replacementClearInterval = ((handle: ReturnType<typeof setInterval>) => {
        activeHandles.delete(handle);
        return originalClearInterval(handle);
    }) as typeof clearInterval;

    return withTemporaryProperty(globalThis, "setInterval", replacementSetInterval, () =>
        withTemporaryProperty(globalThis, "clearInterval", replacementClearInterval, () =>
            action({ activeCount: () => activeHandles.size })
        )
    );
}

void test("followRunnerLogs clears its interval and rejects when rebind throws", async () => {
    await withFreshRunnerState(async () => {
        const boom = new Error("rebind blew up");
        const parameters: FollowRunnerLogsParameters = {
            emit: () => {},
            intervalMs: 5,
            // readLogs is never reached; rebind is the first callback invoked on
            // every tick and is therefore the cheapest way to short-circuit.
            readLogs: () => [],
            rebind: () => {
                throw boom;
            },
            // The window must be longer than the time we wait for the first
            // tick so the test exercises the error path, not the happy-path
            // window-exit branch. The interval fires every 5 ms so 500 ms is
            // ample headroom to observe the throw.
            windowMs: 500
        };

        await withTrackedIntervals(async (tracker) => {
            // Sanity: no interval is alive before the call starts.
            assert.equal(tracker.activeCount(), 0, "No interval should be active before the call");

            await assert.rejects(followRunnerLogs(parameters), (error: unknown) => error === boom);

            // The follow loop must clear its interval even when a callback
            // throws; otherwise the timer would pin the Node process and
            // leak the handle across the rest of the program lifetime.
            assert.equal(
                tracker.activeCount(),
                0,
                "followRunnerLogs must clear its setInterval handle when a callback throws"
            );
        });
    });
});

void test("followRunnerLogs clears its interval and rejects when readLogs throws", async () => {
    await withFreshRunnerState(async () => {
        const boom = new Error("readLogs blew up");
        const parameters: FollowRunnerLogsParameters = {
            emit: () => {},
            intervalMs: 5,
            readLogs: () => {
                throw boom;
            },
            rebind: () => {},
            windowMs: 500
        };

        await withTrackedIntervals(async (tracker) => {
            await assert.rejects(followRunnerLogs(parameters), (error: unknown) => error === boom);
            assert.equal(
                tracker.activeCount(),
                0,
                "followRunnerLogs must clear its setInterval handle when readLogs throws"
            );
        });
    });
});

void test("followRunnerLogs clears its interval and rejects when emit throws", async () => {
    await withFreshRunnerState(async () => {
        const baseline = Date.now();
        const boom = new Error("emit blew up");
        const parameters: FollowRunnerLogsParameters = {
            emit: () => {
                throw boom;
            },
            intervalMs: 5,
            // readLogs always returns a non-empty batch so the emit callback
            // is reached on the first tick.
            readLogs: () => [buildEntry(baseline + 1, "boom")],
            rebind: () => {},
            windowMs: 500
        };

        await withTrackedIntervals(async (tracker) => {
            await assert.rejects(followRunnerLogs(parameters), (error: unknown) => error === boom);
            assert.equal(
                tracker.activeCount(),
                0,
                "followRunnerLogs must clear its setInterval handle when emit throws"
            );
        });
    });
});

void test("resolveBoundRunnerState binds the singleton state store to the discovered root", async () => {
    await withFreshRunnerState(async (projectRoot) => {
        const bound = await resolveBoundRunnerState({ project: projectRoot });

        assert.equal(bound.projectRoot, projectRoot);
        // Binding must return the same singleton the production code uses so
        // downstream actions can rely on the standard state-store contract.
        assert.equal(bound.runnerStateStore, getRunnerStateStore());
    });
});

void test("resolveBoundRunnerState prefers --project over --path", async () => {
    await withFreshRunnerState(async (projectRoot) => {
        const otherPath = path.join(os.tmpdir(), "gmloop-runner-context-other");

        const bound = await resolveBoundRunnerState({
            path: otherPath,
            project: projectRoot
        });

        assert.equal(bound.projectRoot, projectRoot, "--project should win over --path");
    });
});
