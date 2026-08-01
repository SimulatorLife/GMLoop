/**
 * Tests for the exit-handler stale-closure guard in `createRunnerController`.
 *
 * # The Leak
 *
 * `attachProcessLogs` registers an `exit` listener that closes over the mutable
 * `activeProcess` variable. When `restart()` is called the sequence is:
 *
 *   1. `stop()`  — kills the old process, sets `activeProcess = null`
 *   2. `start()` — spawns new process, sets `activeProcess = newProcess`
 *   3. Old process async `exit` fires — without the guard this handler would
 *      unconditionally set `activeProcess = null`, nulling out the live new
 *      process reference and corrupting every subsequent `status()` call.
 *
 * # The Fix
 *
 * The exit handler compares `activeProcess` against the captured `processHandle`
 * before modifying shared state. If they differ the handler is a stale observer
 * from a previous lifecycle and returns immediately.
 */
import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createRunnerController, type RunnerSpawnFn } from "../src/modules/runtime/runner-controller.js";

// ---------------------------------------------------------------------------
// Minimal mock child process
// ---------------------------------------------------------------------------

/**
 * Bare-minimum event bus used by the mock child-process streams.
 *
 * Implemented without `EventEmitter` so the mock stays self-contained and
 * avoids the `unicorn/prefer-event-target` lint rule while still satisfying
 * the `.on(event, handler)` / `.emit(event, ...args)` surface that
 * `runner-controller` calls on `stdout`, `stderr`, and the process itself.
 */
class MinimalEventBus {
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    on(event: string, handler: (...args: unknown[]) => void): this {
        const bucket = this.listeners.get(event);
        if (bucket) {
            bucket.push(handler);
        } else {
            this.listeners.set(event, [handler]);
        }
        return this;
    }

    emit(event: string, ...args: unknown[]): void {
        const bucket = this.listeners.get(event);
        if (bucket) {
            for (const handler of bucket) {
                handler(...args);
            }
        }
    }
}

/**
 * Lightweight stand-in for `ChildProcessWithoutNullStreams`.
 *
 * Only the subset of the interface actually accessed inside `runner-controller`
 * is implemented:
 *  - `pid`, `killed` properties
 *  - `stdout` / `stderr` buses for `data` events
 *  - `on("exit", handler)` and `kill()` on the process level
 *
 * `simulateExit` is a test-only helper that fires the `exit` event
 * synchronously so tests can assert behaviour without real process teardown.
 */
class MockChildProcess extends MinimalEventBus {
    readonly stdout = new MinimalEventBus();
    readonly stderr = new MinimalEventBus();

    pid: number;
    killed = false;

    constructor(pid: number) {
        super();
        this.pid = pid;
    }

    kill(_signal?: string): boolean {
        this.killed = true;
        return true;
    }

    simulateExit(code: number | null, signal: NodeJS.Signals | null): void {
        this.emit("exit", code, signal);
    }
}

/**
 * Returns a `RunnerSpawnFn` factory whose successive calls hand back the
 * pre-created `MockChildProcess` instances in order.
 */
function createMockSpawn(processes: MockChildProcess[]): RunnerSpawnFn {
    let index = 0;
    return (_command, _args, _options) => {
        const proc = processes[index];
        if (!proc) {
            throw new Error(`createMockSpawn: no mock process at index ${index}`);
        }
        index += 1;
        return proc as unknown as ChildProcessWithoutNullStreams;
    };
}

/** Produces a throwaway project root that won't conflict with other tests. */
function makeTempProjectRoot(): string {
    return path.join(os.tmpdir(), `gmloop-runner-exit-guard-${randomUUID()}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void test("restart() exit guard: stale process exit does not null out the new process reference", () => {
    const projectRoot = makeTempProjectRoot();

    const firstProcess = new MockChildProcess(1001);
    const secondProcess = new MockChildProcess(1002);
    const mockSpawn = createMockSpawn([firstProcess, secondProcess]);

    const controller = createRunnerController(mockSpawn);
    const baseOptions = { command: "node", args: ["-e", "1"], projectRoot };

    // — Phase 1: Start the first process —
    const startResult = controller.start(baseOptions);
    assert.equal(startResult.pid, 1001);

    const statusAfterStart = controller.status(projectRoot);
    assert.equal(statusAfterStart.running, true);
    assert.equal(statusAfterStart.pid, 1001);

    // — Phase 2: Restart (stop old, start new) —
    const restartResult = controller.restart(baseOptions);
    assert.equal(restartResult.pid, 1002);

    // The new process should be active immediately after restart.
    const statusAfterRestart = controller.status(projectRoot);
    assert.equal(statusAfterRestart.running, true);
    assert.equal(statusAfterRestart.pid, 1002);

    // — Phase 3: Old process's async exit fires (the previously-leaking path) —
    firstProcess.simulateExit(0, null);

    // Without the exit-guard fix, `activeProcess` would be set to `null` here
    // and `status().running` would erroneously return false.
    const statusAfterOldExit = controller.status(projectRoot);
    assert.equal(statusAfterOldExit.running, true, "Old process exit must not corrupt the new process reference");
    assert.equal(statusAfterOldExit.pid, 1002);

    // — Cleanup: stop the new process so the state machine is tidy —
    controller.stop(projectRoot);
    assert.equal(controller.status(projectRoot).running, false);
});

void test("exit guard: natural process exit (no restart) still transitions state to stopped", () => {
    const projectRoot = makeTempProjectRoot();

    const proc = new MockChildProcess(2001);
    const mockSpawn = createMockSpawn([proc]);
    const controller = createRunnerController(mockSpawn);
    const baseOptions = { command: "node", args: ["-e", "1"], projectRoot };

    controller.start(baseOptions);
    assert.equal(controller.status(projectRoot).running, true);

    // Simulate the process crashing (not stopped via controller).
    proc.simulateExit(1, null);

    // `activeProcess === processHandle` here, so state should transition.
    const statusAfterCrash = controller.status(projectRoot);
    assert.equal(statusAfterCrash.running, false, "Natural crash must transition state to stopped");
    assert.equal(statusAfterCrash.pid, null);
});

void test("exit guard: explicit stop() followed by async exit does not overwrite stopped state", () => {
    const projectRoot = makeTempProjectRoot();

    const proc = new MockChildProcess(3001);
    const mockSpawn = createMockSpawn([proc]);
    const controller = createRunnerController(mockSpawn);
    const baseOptions = { command: "node", args: ["-e", "1"], projectRoot };

    controller.start(baseOptions);
    controller.stop(projectRoot);

    // Controller already stopped (activeProcess = null); old exit fires late.
    proc.simulateExit(0, null);

    // State should remain stopped — no double-write, no error.
    const status = controller.status(projectRoot);
    assert.equal(status.running, false);
    assert.equal(status.pid, null);
});
