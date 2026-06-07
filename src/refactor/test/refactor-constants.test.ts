import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT,
    CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES,
    CODEMOD_READ_THROUGH_CACHE_MIN_ENTRIES,
    DUPLICATE_EDIT_CHECK_MAX_SET_SIZE,
    RENAME_VALIDATION_CACHE_MAX_SIZE
} from "../src/refactor-constants.js";

void describe("RefactorConstants", () => {
    void describe("RENAME_VALIDATION_CACHE_MAX_SIZE", () => {
        void it("should be a positive integer suitable for cache sizing", () => {
            assert.ok(Number.isInteger(RENAME_VALIDATION_CACHE_MAX_SIZE), "must be an integer");
            assert.ok(RENAME_VALIDATION_CACHE_MAX_SIZE > 0, "must be positive");
        });

        void it("should be large enough for meaningful IDE rename sessions", () => {
            // Interactive rename dialogs may validate hundreds of intermediate names
            assert.ok(RENAME_VALIDATION_CACHE_MAX_SIZE >= 1000, "should accommodate interactive sessions");
        });
    });

    void describe("APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT", () => {
        void it("should be a positive integer for concurrent I/O operations", () => {
            assert.ok(Number.isInteger(APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT), "must be an integer");
            assert.ok(APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT > 0, "must be positive");
        });

        void it("should be conservative to avoid saturating disk queues on slow storage", () => {
            // Higher values on fast NVMe, but conservative default avoids issues
            assert.ok(APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT <= 32, "should remain conservative");
        });
    });

    void describe("CODEMOD_READ_THROUGH_CACHE_MIN_ENTRIES", () => {
        void it("should be a positive integer representing floor cache allocation", () => {
            assert.ok(Number.isInteger(CODEMOD_READ_THROUGH_CACHE_MIN_ENTRIES), "must be an integer");
            assert.ok(CODEMOD_READ_THROUGH_CACHE_MIN_ENTRIES > 0, "must be positive");
        });

        void it("should be less than or equal to the maximum to allow dynamic sizing", () => {
            assert.ok(
                CODEMOD_READ_THROUGH_CACHE_MIN_ENTRIES <= CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES,
                "min must not exceed max"
            );
        });
    });

    void describe("CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES", () => {
        void it("should be a positive integer representing ceiling cache allocation", () => {
            assert.ok(Number.isInteger(CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES), "must be an integer");
            assert.ok(CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES > 0, "must be positive");
        });

        void it("should be greater than or equal to the minimum for meaningful sizing", () => {
            assert.ok(
                CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES >= CODEMOD_READ_THROUGH_CACHE_MIN_ENTRIES,
                "max must be at least min"
            );
        });
    });

    void describe("DUPLICATE_EDIT_CHECK_MAX_SET_SIZE", () => {
        void it("should be a positive integer for duplicate detection threshold", () => {
            assert.ok(Number.isInteger(DUPLICATE_EDIT_CHECK_MAX_SET_SIZE), "must be an integer");
            assert.ok(DUPLICATE_EDIT_CHECK_MAX_SET_SIZE > 0, "must be positive");
        });

        void it("should be large enough for typical edit batches", () => {
            // Powers of two work well with hash table internals
            assert.ok(DUPLICATE_EDIT_CHECK_MAX_SET_SIZE >= 256, "should be large enough for typical edit batches");
        });
    });

    void describe("relative relationships", () => {
        void it("rename validation cache max size should be appropriate for interactive use", () => {
            // Should be large enough to hold many intermediate rename states
            assert.ok(
                RENAME_VALIDATION_CACHE_MAX_SIZE >= DUPLICATE_EDIT_CHECK_MAX_SET_SIZE,
                "rename cache should be substantially larger than edit check threshold"
            );
        });

        void it("codemod cache should have sufficient range between min and max", () => {
            const range = CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES - CODEMOD_READ_THROUGH_CACHE_MIN_ENTRIES;
            assert.ok(range >= 256, "min/max should have meaningful range for dynamic sizing");
        });
    });
});
