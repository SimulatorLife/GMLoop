/**
 * Shared runner context helpers for the `runner` CLI command.
 *
 * The runner command set in `runner.ts` used to repeat the same three-step
 * ceremony in every action handler:
 *
 *   1. discover the project root from the user's CLI options
 *   2. fetch the shared runner state store singleton
 *   3. bind that store to the resolved project root
 *
 * The follow-logs action additionally mixed the follow-loop bookkeeping
 * (polling cadence, "advance past the last seen timestamp" cursor, window
 * deadline, and the setInterval/clearInterval lifecycle) into the same
 * function that drove the action. That made the orchestrator hard to read
 * and impossible to unit-test without spinning up the singleton.
 *
 * This module extracts the low-level work into two focused helpers so the
 * action handlers can read as a sequence of high-level delegation steps at a
 * single abstraction layer:
 *
 * - {@link resolveBoundRunnerState} centralises the discover/get/bind ceremony.
 * - {@link followRunnerLogs} owns the polling/cursor/window bookkeeping.
 *
 * Both helpers keep the original behavioural contract intact: the project
 * root is still re-bound on every follow tick, the cursor still advances to
 * the newest entry's timestamp, and the loop still resolves after the
 * configured window elapses.
 */
import { Core } from "@gmloop/core";

import { getRunnerStateStore, type RunnerLogEntry, type RunnerLogKind } from "../modules/runtime/index.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

/**
 * Inputs accepted by the runner context helpers. Mirrors the subset of the
 * runner command's option bag that scopes an action to a project root.
 */
export interface RunnerContextOptions {
    path?: string;
    project?: string;
}

/**
 * The result of {@link resolveBoundRunnerState}: a fully-prepared project root
 * paired with the shared runner state store that has already been bound to
 * that project root. Consumers should treat this as the single entry point
 * for any runner action that needs to read or mutate the on-disk state.
 */
export interface BoundRunnerState {
    projectRoot: string;
    runnerStateStore: ReturnType<typeof getRunnerStateStore>;
}

/**
 * Resolve the project root for a runner invocation and bind the shared
 * runner state store to it. Centralises the discover/get/bind ceremony that
 * every runner action previously duplicated.
 *
 * @param options - Runner context inputs, typically a Commander options bag.
 * @returns The resolved project root and a pre-bound state store, ready to
 *   be read from or written to.
 */
export async function resolveBoundRunnerState(options: RunnerContextOptions): Promise<BoundRunnerState> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    return { projectRoot, runnerStateStore };
}

/**
 * Read filtering options for {@link followRunnerLogs.readLogs}. Mirrors the
 * subset of the runner state store's `readLogs` contract that the follow
 * loop needs to forward.
 */
export interface FollowRunnerLogsReadOptions {
    errorsOnly?: boolean;
    filter?: string;
    kind?: "all" | RunnerLogKind;
}

/**
 * Parameters accepted by {@link followRunnerLogs}. The contract is deliberately
 * dependency-injection style: the orchestrator owns the concrete `readLogs`
 * and `rebind` operations (so the helper does not reach into the singleton
 * state store) and the `emit` callback decides how each batch is reported.
 */
export interface FollowRunnerLogsParameters {
    /**
     * Invoked once for every batch of new log entries discovered during the
     * follow window. The batch is the exact `Array.filter` slice of entries
     * that were observed since the previous call — the caller does not need
     * to perform any additional dedup bookkeeping. The callback is invoked
     * synchronously inside the poll tick, so it should not block.
     */
    emit: (entries: ReadonlyArray<RunnerLogEntry>) => void;
    /**
     * Polling interval in milliseconds. Defaults to `100` to mirror the
     * historical behaviour of the inlined follow loop.
     */
    intervalMs?: number;
    /**
     * Invoked on every poll tick before reading logs. Mirrors the original
     * orchestrator's habit of re-asserting the project root on each tick so
     * that on-disk changes to the project pointer are picked up even during
     * a short follow window.
     */
    rebind: () => void;
    /**
     * Reads the current log snapshot from the runner state store. The follow
     * helper filters the returned array down to entries with a timestamp
     * greater than the cursor that was advanced on the previous tick.
     */
    readLogs: (options: FollowRunnerLogsReadOptions) => ReadonlyArray<RunnerLogEntry>;
    /**
     * Maximum total follow duration in milliseconds. The follow loop
     * resolves once the loop has been alive for at least this long.
     * Defaults to `750` to mirror the historical behaviour.
     */
    windowMs?: number;
}

/**
 * Poll the runner state store for new log entries until the configured
 * window elapses, emitting each fresh batch to the caller-supplied
 * {@link FollowRunnerLogsParameters.emit} callback.
 *
 * Encapsulates the cursor bookkeeping that the follow action previously
 * performed inline:
 *
 * - tracks the highest-seen `timestamp` so the same entry is never emitted
 *   twice across polls;
 * - filters incoming entries down to those with a timestamp greater than
 *   the cursor;
 * - advances the cursor to the newest entry's timestamp on every batch;
 * - bounds the loop to a deterministic window without leaking the
 *   `setInterval` handle.
 *
 * The helper resolves after the window elapses, regardless of how many (or
 * how few) entries were observed. If any of the caller-supplied callbacks
 * (`rebind`, `readLogs`, or `emit`) throws, the helper clears the polling
 * interval and rejects with the original error so the timer is never left
 * dangling — without that cleanup the interval would keep the Node
 * process alive and the outer promise would never settle, leaving the
 * caller blocked indefinitely.
 */
export async function followRunnerLogs(parameters: FollowRunnerLogsParameters): Promise<void> {
    const { emit, readLogs, rebind } = parameters;
    if (typeof emit !== "function") {
        throw new TypeError("followRunnerLogs requires an emit callback.");
    }
    if (typeof readLogs !== "function") {
        throw new TypeError("followRunnerLogs requires a readLogs function.");
    }
    if (typeof rebind !== "function") {
        throw new TypeError("followRunnerLogs requires a rebind function.");
    }

    const intervalMs = parameters.intervalMs ?? 100;
    const windowMs = parameters.windowMs ?? 750;
    const startedAt = Date.now();
    let lastTimestamp = startedAt - 1;

    await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
            // The try/catch is the only thing standing between a throwing
            // callback and a leaked timer: if any of `rebind`, `readLogs`,
            // or `emit` throws, the clearInterval call further down would
            // be skipped and the interval would keep the process alive.
            try {
                rebind();
                const freshEntries = readLogs({}).filter((entry) => entry.timestamp > lastTimestamp);
                if (freshEntries.length > 0) {
                    const newestEntry = freshEntries.at(-1);
                    if (newestEntry) {
                        lastTimestamp = newestEntry.timestamp;
                    }
                    emit(freshEntries);
                }

                if (Date.now() - startedAt >= windowMs) {
                    clearInterval(interval);
                    resolve();
                }
            } catch (error) {
                clearInterval(interval);
                reject(
                    Core.isErrorLike(error) ? error : new Error(`followRunnerLogs callback threw: ${String(error)}`)
                );
            }
        }, intervalMs);
    });
}
