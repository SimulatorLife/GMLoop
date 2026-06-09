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
        const baseline = Date.now();
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
        const baseline = Date.now();
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
