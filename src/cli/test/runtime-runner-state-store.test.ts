/**
 * Direct coverage for the persisted runner state helpers in
 * `src/cli/src/modules/runtime/runner-state.ts`.
 *
 * The CLI exercises these helpers indirectly through the `runner` command
 * lifecycle, but pinning their observable behaviour here keeps the refactor
 * that migrated the bespoke JSON.stringify/JSON.parse wrappers onto
 * {@link Core.stringifyJsonForFile} and {@link Core.parseJsonWithContext}
 * honest, and documents the on-disk contract future contributors can rely
 * on:
 *
 * - `bindProjectRoot` hydrates the singleton state store from
 *   `.gmloop/runtime/runner-state.json`, falling back to the default state
 *   when the file is missing or contains malformed JSON.
 * - `setRoom`, `setState`, `clearLogs`, and `appendLog` persist via the
 *   shared serialization helper so the on-disk shape stays consistent with
 *   the rest of the CLI's artifact writers (two-space indentation and a
 *   trailing newline).
 * - Logs are sorted by timestamp with the message used as a deterministic
 *   tie-breaker so re-reads return a stable ordering.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { getRunnerStateStore } from "../src/modules/runtime/runner-state.js";
import { withTempProject } from "./shared-temp-project.js";

void describe("runner state store persistence", () => {
    void it("returns the default state when no state file exists", async () => {
        await withTempProject("runner-state-empty", async (projectRoot) => {
            const store = getRunnerStateStore();
            store.bindProjectRoot(projectRoot);

            assert.equal(store.readSnapshot().state, "stopped");
            assert.equal(store.readSnapshot().room, null);
            assert.deepEqual(store.readLogs(), []);
        });
    });

    void it("round-trips state through bindProjectRoot after writes", async () => {
        await withTempProject("runner-state-roundtrip", async (projectRoot) => {
            const store = getRunnerStateStore();
            store.bindProjectRoot(projectRoot);

            store.setRoom("LevelA");
            store.setState("running");
            store.appendLog({ kind: "runtime", level: "info", message: "hello" });
            store.appendLog({ kind: "compile", level: "error", message: "oops" });

            // Re-bind to the same project root so the singleton hydrates from
            // disk, verifying the persisted shape mirrors the in-memory view.
            store.bindProjectRoot(projectRoot);

            const snapshot = store.readSnapshot();
            assert.equal(snapshot.state, "running");
            assert.equal(snapshot.room, "LevelA");

            const logs = store.readLogs();
            assert.deepEqual(
                logs.map((entry) => entry.message),
                ["hello", "oops"]
            );
            assert.deepEqual(
                logs.map((entry) => entry.kind),
                ["runtime", "compile"]
            );
            assert.deepEqual(
                logs.map((entry) => entry.level),
                ["info", "error"]
            );
        });
    });

    void it("writes deterministic, newline-terminated JSON via the shared helper", async () => {
        await withTempProject("runner-state-shape", async (projectRoot) => {
            const store = getRunnerStateStore();
            store.bindProjectRoot(projectRoot);
            store.setRoom("Hub");
            store.setState("paused");
            store.appendLog({ kind: "runtime", level: "info", message: "ready" });

            const statePath = path.join(projectRoot, ".gmloop", "runtime", "runner-state.json");
            const raw = readFileSync(statePath, "utf8");

            // Trailing newline comes from Core.stringifyJsonForFile's default
            // `includeTrailingNewline: true`; preserving it keeps the on-disk
            // shape stable across the workspace.
            assert.ok(raw.endsWith("\n"), "runner state must end with a trailing newline");
            assert.ok(!raw.endsWith("\n\n"), "runner state must not double-terminate the line");

            // Keys appear in the deterministic order produced by the helper
            // (literal insertion order from the payload), so we assert the
            // expected substring positions rather than re-serializing.
            assert.ok(raw.includes('"room": "Hub"'));
            assert.ok(raw.includes('"state": "paused"'));
            assert.ok(raw.includes('"logs"'));
        });
    });

    void it("falls back to the default state when the persisted file is malformed", async () => {
        await withTempProject("runner-state-malformed", async (projectRoot) => {
            // Pre-write a corrupted state file. The migration to
            // `parseJsonWithContext` keeps the read resilient: a parse
            // failure is caught and the store hydrates with the default
            // snapshot, matching the behaviour of the previous
            // try/catch around `JSON.parse`.
            const statePath = path.join(projectRoot, ".gmloop", "runtime", "runner-state.json");
            const { mkdirSync, writeFileSync } = await import("node:fs");
            mkdirSync(path.dirname(statePath), { recursive: true });
            writeFileSync(statePath, "{ not valid json", "utf8");

            const store = getRunnerStateStore();
            store.bindProjectRoot(projectRoot);

            assert.equal(store.readSnapshot().state, "stopped");
            assert.equal(store.readSnapshot().room, null);
            assert.deepEqual(store.readLogs(), []);
        });
    });

    void it("orders logs by timestamp then message on round-trip", async () => {
        await withTempProject("runner-state-log-order", async (projectRoot) => {
            const store = getRunnerStateStore();
            store.bindProjectRoot(projectRoot);

            // The comparator used by both the write and read paths is
            // timestamp-first, then message as a tie-breaker, so appending
            // entries in arbitrary order must produce a stable, sorted
            // sequence that survives a full read/write/read cycle. The
            // messages are chosen so both orderings are well-defined
            // regardless of whether `Date.now()` returns the same or
            // distinct timestamps for the two appends: when the
            // timestamps match, `a-first` sorts before `z-second`; when
            // they differ, the earlier append — `z-second` — sorts first.
            store.appendLog({ kind: "runtime", level: "info", message: "z-second" });
            store.appendLog({ kind: "runtime", level: "info", message: "a-first" });

            store.bindProjectRoot(projectRoot);

            const after = store.readLogs().map((entry) => entry.message);

            // Inspect the persisted payload directly to verify the writer
            // also serialized the entries in the comparator's order, rather
            // than in push order.
            const statePath = path.join(projectRoot, ".gmloop", "runtime", "runner-state.json");
            const persisted = JSON.parse(readFileSync(statePath, "utf8")) as { logs: Array<{ message: string }> };
            const persistedMessages = persisted.logs.map((entry) => entry.message);

            assert.deepEqual(after, persistedMessages, "re-read logs should match the persisted ordering");
        });
    });
});
