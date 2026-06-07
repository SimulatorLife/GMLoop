import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
    readRuntimeProjectState,
    type RuntimeProjectState,
    writeRuntimeProjectState
} from "../src/modules/runtime/project-state-store.js";
import { withTempProject } from "./shared-temp-project.js";

/**
 * Coverage for the runtime project state store.
 *
 * The store is the canonical writer/reader pair for `.gmloop/runtime/state.json`
 * under each project root. These tests exercise the public round-trip plus the
 * trailing-newline contract surfaced by `Core.stringifyJsonForFile` so future
 * refactors of the helper integration cannot silently change the on-disk shape.
 */
void describe("runtime project state store", () => {
    void it("returns the empty state when no state file exists", async () => {
        await withTempProject("runtime-state-empty", async (projectRoot) => {
            const state = readRuntimeProjectState(projectRoot);

            assert.deepEqual(state, {
                globals: {},
                instances: {},
                logs: []
            });
        });
    });

    void it("round-trips a populated state through write and read", async () => {
        await withTempProject("runtime-state-roundtrip", async (projectRoot) => {
            const state: RuntimeProjectState = {
                globals: { score: 99, playerName: "Ada" },
                instances: {
                    "obj_player#0": { x: 12, y: 34 },
                    "obj_enemy#1": { hp: 7 }
                },
                logs: [
                    { message: "second", timestamp: 200 },
                    { message: "first", timestamp: 100 }
                ]
            };

            writeRuntimeProjectState(projectRoot, state);
            const roundTripped = readRuntimeProjectState(projectRoot);

            assert.deepEqual(roundTripped.globals, state.globals);
            assert.deepEqual(roundTripped.instances, state.instances);
            assert.deepEqual(
                roundTripped.logs.map((entry) => entry.message),
                ["first", "second"]
            );
            assert.deepEqual(
                roundTripped.logs.map((entry) => entry.timestamp),
                [100, 200]
            );
        });
    });

    void it("writes deterministic, newline-terminated JSON via the shared helper", async () => {
        await withTempProject("runtime-state-shape", async (projectRoot) => {
            const state: RuntimeProjectState = {
                globals: { zebra: 1, apple: 2 },
                instances: {},
                logs: []
            };

            writeRuntimeProjectState(projectRoot, state);

            const statePath = path.join(projectRoot, ".gmloop", "runtime", "state.json");
            const raw = readFileSync(statePath, "utf8");

            // Trailing newline comes from Core.stringifyJsonForFile's default
            // `includeTrailingNewline: true`; preserving it keeps the on-disk
            // shape stable across the workspace.
            assert.ok(raw.endsWith("\n"));
            assert.ok(!raw.endsWith("\n\n"));

            // Keys are sorted (alphabetical) by Core.sortObjectKeys so the
            // serialized output is deterministic across runs and platforms.
            const appleIndex = raw.indexOf('"apple"');
            const zebraIndex = raw.indexOf('"zebra"');
            assert.ok(appleIndex !== -1 && zebraIndex !== -1, "globals keys should be present");
            assert.ok(appleIndex < zebraIndex, "globals keys should be alphabetically sorted");
        });
    });
});
