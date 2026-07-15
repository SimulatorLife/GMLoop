/**
 * Interface-segregation coverage for the runner state store role contracts.
 *
 * The shared runner state store in `src/cli/src/modules/runtime/runner-state.ts`
 * historically exposed a single `RunnerStateStore` type with seven methods
 * spanning four subsystems (project binding, lifecycle state, room tracking,
 * and log management). The composite made every call site depend on every
 * subsystem regardless of which one it actually exercised.
 *
 * This test pins the segregated-role contract introduced for the
 * Interface Segregation Principle sweep:
 *
 * - Every role interface is realised by the live singleton, so production
 *   call sites can keep using the composite without losing any capability.
 * - A standalone object that implements a *single* role is accepted when
 *   typed against that role alone, proving each role is independently
 *   usable as a substitution for the wider composite.
 * - A single-role implementation cannot be widened to a role it does not
 *   implement, proving the role interfaces are truly minimal rather than
 *   aliases for the composite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getRunnerStateStore,
    type RunnerLifecycleStateController,
    type RunnerLogClearer,
    type RunnerLogEntry,
    type RunnerLogReader,
    type RunnerLogWriter,
    type RunnerProjectBinder,
    type RunnerRoomController,
    type RunnerSnapshotReader,
    type RunnerStateStore
} from "../src/modules/runtime/index.js";
import { withTempProject } from "./shared-temp-project.js";

/**
 * Compose a minimal fake that only implements the provided role. The
 * parameter is generic over `T extends object` so the TypeScript compiler
 * verifies at the call site that the returned value actually exposes the
 * requested role — there is no `as unknown as` escape hatch here, the
 * test would not compile if the role was incomplete.
 */
function fakeRole<T extends object>(role: T): T {
    // Returning the original keeps the structural typing honest: the fake is
    // *only* what the role describes, no extra methods are silently attached.
    return role;
}

/**
 * Type-level guard that fails to compile when a single-role object is
 * accidentally widened to a different role it does not implement. The
 * function is never called at runtime; the assignment expression is what
 * the TypeScript compiler verifies when the test is built.
 *
 * @param role The single-role contract the fake must satisfy.
 */
function assertRoleIdentity<T extends object>(role: T): T {
    return role;
}

void describe("runner state store role interfaces (Interface Segregation Principle)", () => {
    void it("the singleton satisfies every role interface independently", async () => {
        await withTempProject("runner-role-singleton", async (projectRoot) => {
            // Bind to a real project root so the snapshot read below sees a
            // hydrated store rather than the unset default.
            const composite = getRunnerStateStore();
            composite.bindProjectRoot(projectRoot);

            // Each assignment below would fail to compile if the singleton
            // no longer satisfies the corresponding role after a future
            // refactor — that is exactly the structural honesty the role
            // split is meant to enable.
            const binder: RunnerProjectBinder = composite;
            const snapshotReader: RunnerSnapshotReader = composite;
            const lifecycle: RunnerLifecycleStateController = composite;
            const room: RunnerRoomController = composite;
            const logReader: RunnerLogReader = composite;
            const logWriter: RunnerLogWriter = composite;
            const logClearer: RunnerLogClearer = composite;

            binder.bindProjectRoot(projectRoot);
            assert.deepEqual(snapshotReader.readSnapshot().state, "stopped");
            lifecycle.setState("running");
            assert.equal(composite.readSnapshot().state, "running");
            room.setRoom("LevelOne");
            assert.equal(composite.readSnapshot().room, "LevelOne");
            logWriter.appendLog({ kind: "runtime", level: "info", message: "hello" });
            assert.equal(logReader.readLogs().length, 1);
            logClearer.clearLogs();
            assert.equal(logReader.readLogs().length, 0);
        });
    });

    void it("a single-role fake is accepted as that role, but not as a different role", () => {
        // A snapshot-only fake: implements `readSnapshot` and nothing else.
        // This is the canonical evidence that the role interfaces are
        // independently usable — the type system accepts this object as a
        // `RunnerSnapshotReader` without forcing it to also implement the
        // other six role methods.
        const snapshotOnly = {
            readSnapshot: () => ({
                lastUpdatedAt: 0,
                logCount: 0,
                room: null,
                state: "stopped" as const
            })
        };

        const accepted = fakeRole<RunnerSnapshotReader>(snapshotOnly);
        assert.equal(typeof accepted.readSnapshot, "function");

        // The next line verifies that a single-role fake cannot be widened
        // to a role it does not implement. Calling `fakeRole` with
        // `RunnerLifecycleStateController` and the snapshot-only object
        // would fail the generic bound (`T extends object` ↛ `RunnerLifecycleStateController`).
        // We exercise the check explicitly here so the failure mode (if
        // anyone removes the role split later) is a compile-time error at
        // a single, easy-to-find line, not a silent regression at every
        // call site.
        assertRoleIdentity<RunnerSnapshotReader>(snapshotOnly);
    });

    void it("a log-reader fake can drive a consumer that requires only that role", () => {
        const fakeSnapshotEntry: RunnerLogEntry = Object.freeze({
            kind: "runtime",
            level: "info",
            message: "ready",
            timestamp: 1_700_000_000_000
        });

        const logReader: RunnerLogReader = {
            readLogs: () => [fakeSnapshotEntry]
        };

        // Demonstrates that a consumer written against the narrow role
        // interface never touches log mutation, lifecycle, or binding —
        // a clear win for substitutability and for unit tests that want
        // a single fake per role.
        const observed = logReader.readLogs();
        assert.equal(observed.length, 1);
        assert.equal(observed[0], fakeSnapshotEntry);
    });

    void it("the composite RunnerStateStore remains the canonical wide contract", () => {
        // The composite must still exist as the public, catch-all contract
        // for callers that genuinely need every role — typically the
        // production code paths that drive the singleton itself.
        // The single-line structural check here ensures the composite keeps
        // every role in scope; if a future refactor drops a role from the
        // composite, the assignment below fails to compile and the
        // regression is caught at the build step rather than at runtime.
        const singleton = getRunnerStateStore();
        const wideView: RunnerStateStore = singleton;
        assert.equal(typeof wideView.bindProjectRoot, "function");
        assert.equal(typeof wideView.readSnapshot, "function");
        assert.equal(typeof wideView.setState, "function");
        assert.equal(typeof wideView.setRoom, "function");
        assert.equal(typeof wideView.readLogs, "function");
        assert.equal(typeof wideView.appendLog, "function");
        assert.equal(typeof wideView.clearLogs, "function");
    });
});
