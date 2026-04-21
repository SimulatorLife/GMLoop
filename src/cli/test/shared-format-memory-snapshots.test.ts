import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
    DEFAULT_MAX_IN_MEMORY_SNAPSHOTS,
    MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR
} from "../src/commands/format-memory-constants.js";
import {
    applyMaxInMemorySnapshotsEnvOverride,
    getDefaultMaxInMemorySnapshots,
    setDefaultMaxInMemorySnapshots
} from "../src/runtime-options/format-memory-snapshots.js";

const originalEnvValue = process.env[MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR];

afterEach(() => {
    if (originalEnvValue === undefined) {
        delete process.env[MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR];
    } else {
        process.env[MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR] = originalEnvValue;
    }

    setDefaultMaxInMemorySnapshots(DEFAULT_MAX_IN_MEMORY_SNAPSHOTS);
    applyMaxInMemorySnapshotsEnvOverride();
});

void describe("format memory snapshot runtime options", () => {
    void it("exposes the default snapshot limit", () => {
        assert.equal(getDefaultMaxInMemorySnapshots(), DEFAULT_MAX_IN_MEMORY_SNAPSHOTS);
    });

    void it("allows overriding the default snapshot limit", () => {
        setDefaultMaxInMemorySnapshots(8);
        assert.equal(getDefaultMaxInMemorySnapshots(), 8);
    });

    void it("applies environment overrides", () => {
        process.env[MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR] = "12";
        applyMaxInMemorySnapshotsEnvOverride();

        assert.equal(getDefaultMaxInMemorySnapshots(), 12);
    });

    void it("ignores invalid environment values", () => {
        process.env[MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR] = "invalid";
        applyMaxInMemorySnapshotsEnvOverride();

        assert.equal(getDefaultMaxInMemorySnapshots(), DEFAULT_MAX_IN_MEMORY_SNAPSHOTS);
    });
});
