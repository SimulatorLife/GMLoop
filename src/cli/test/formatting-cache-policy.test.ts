import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateFormattingCacheEvictionPolicy } from "../src/modules/formatting/cache-eviction-policy.js";

void describe("formatting cache eviction policy", () => {
    void it("retains entries while the cache is within its limit", () => {
        assert.deepEqual(
            evaluateFormattingCacheEvictionPolicy({
                currentCacheSize: 3,
                maxEntries: 3
            }),
            { action: "retain" }
        );
    });

    void it("treats zero and non-finite limits as unbounded", () => {
        for (const maxEntries of [0, Number.NaN, Infinity, -Infinity]) {
            assert.deepEqual(
                evaluateFormattingCacheEvictionPolicy({
                    currentCacheSize: 100,
                    maxEntries
                }),
                { action: "retain" }
            );
        }
    });

    void it("returns the exact number of oldest overflow entries to evict", () => {
        assert.deepEqual(
            evaluateFormattingCacheEvictionPolicy({
                currentCacheSize: 10,
                maxEntries: 3
            }),
            {
                action: "evict-oldest",
                entriesToEvict: 7
            }
        );
    });

    void it("preserves eviction behavior for an explicit fractional limit", () => {
        assert.deepEqual(
            evaluateFormattingCacheEvictionPolicy({
                currentCacheSize: 3,
                maxEntries: 2.5
            }),
            {
                action: "evict-oldest",
                entriesToEvict: 1
            }
        );
    });

    void it("requests a full clear for a negative limit", () => {
        assert.deepEqual(
            evaluateFormattingCacheEvictionPolicy({
                currentCacheSize: 3,
                maxEntries: -1
            }),
            { action: "clear" }
        );
    });
});
