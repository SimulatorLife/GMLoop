import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DefaultValidationCachePolicy,
    DisabledValidationCachePolicy,
    type ValidationCachePolicy
} from "../src/rename-validation-cache.js";

void describe("DefaultValidationCachePolicy", () => {
    void describe("constructor", () => {
        void it("initializes with default values", () => {
            const policy = new DefaultValidationCachePolicy();
            assert.equal(policy.enabled, true);
            assert.equal(policy.maxSize, 50);
            assert.equal(policy.ttlMs, 30_000);
        });

        void it("accepts custom values", () => {
            const policy = new DefaultValidationCachePolicy(false, 100, 60_000);
            assert.equal(policy.enabled, false);
            assert.equal(policy.maxSize, 100);
            assert.equal(policy.ttlMs, 60_000);
        });
    });

    void describe("isExpired", () => {
        void it("returns false when entry is within TTL", () => {
            const policy = new DefaultValidationCachePolicy(true, 50, 30_000);
            assert.equal(policy.isExpired(0), false);
            assert.equal(policy.isExpired(15_000), false);
            assert.equal(policy.isExpired(29_999), false);
        });

        void it("returns true when entry age equals or exceeds TTL", () => {
            const policy = new DefaultValidationCachePolicy(true, 50, 30_000);
            assert.equal(policy.isExpired(30_000), true);
            assert.equal(policy.isExpired(60_000), true);
        });
    });

    void describe("shouldStore", () => {
        void it("returns false when disabled", () => {
            const policy = new DefaultValidationCachePolicy(false, 50, 30_000);
            assert.equal(policy.shouldStore(0), false);
            assert.equal(policy.shouldStore(10), false);
        });

        void it("returns false when maxSize is 0", () => {
            const policy = new DefaultValidationCachePolicy(true, 0, 30_000);
            assert.equal(policy.shouldStore(0), false);
        });

        void it("returns true when enabled with positive maxSize", () => {
            const policy = new DefaultValidationCachePolicy(true, 50, 30_000);
            assert.equal(policy.shouldStore(0), true);
            assert.equal(policy.shouldStore(49), true);
            assert.equal(policy.shouldStore(100), true);
        });
    });

    void describe("shouldEvict", () => {
        void it("returns false when disabled", () => {
            const policy = new DefaultValidationCachePolicy(false, 50, 30_000);
            assert.equal(policy.shouldEvict(50), false);
            assert.equal(policy.shouldEvict(100), false);
        });

        void it("returns false when maxSize is 0", () => {
            const policy = new DefaultValidationCachePolicy(true, 0, 30_000);
            assert.equal(policy.shouldEvict(0), false);
        });

        void it("returns false when cache is below maxSize", () => {
            const policy = new DefaultValidationCachePolicy(true, 50, 30_000);
            assert.equal(policy.shouldEvict(0), false);
            assert.equal(policy.shouldEvict(49), false);
        });

        void it("returns true when cache size equals or exceeds maxSize", () => {
            const policy = new DefaultValidationCachePolicy(true, 50, 30_000);
            assert.equal(policy.shouldEvict(50), true);
            assert.equal(policy.shouldEvict(100), true);
        });
    });
});

void describe("DisabledValidationCachePolicy", () => {
    void describe("constructor", () => {
        void it("has correct default values", () => {
            const policy = new DisabledValidationCachePolicy();
            assert.equal(policy.enabled, false);
            assert.equal(policy.maxSize, 0);
            assert.equal(policy.ttlMs, 0);
        });
    });

    void describe("isExpired", () => {
        void it("always returns true", () => {
            const policy = new DisabledValidationCachePolicy();
            assert.equal(policy.isExpired(0), true);
            assert.equal(policy.isExpired(999_999_999), true);
        });
    });

    void describe("shouldStore", () => {
        void it("always returns false", () => {
            const policy = new DisabledValidationCachePolicy();
            assert.equal(policy.shouldStore(0), false);
            assert.equal(policy.shouldStore(100), false);
        });
    });

    void describe("shouldEvict", () => {
        void it("always returns false", () => {
            const policy = new DisabledValidationCachePolicy();
            assert.equal(policy.shouldEvict(0), false);
            assert.equal(policy.shouldEvict(100), false);
        });
    });
});

void describe("ValidationCachePolicy interface", () => {
    void it("can be implemented by custom classes", () => {
        // Custom policy with inverted TTL behavior for testing
        class InvertedTtlPolicy implements ValidationCachePolicy {
            public readonly enabled = true;
            public readonly maxSize = 10;
            public readonly ttlMs = 5000;

            isExpired(entryAgeMs: number): boolean {
                // Inverted: expires when age is LESS than TTL (immediate expiry)
                return entryAgeMs < this.ttlMs;
            }

            shouldStore(_currentSize: number): boolean {
                return this.enabled;
            }

            shouldEvict(currentSize: number): boolean {
                return currentSize >= this.maxSize;
            }
        }

        const customPolicy = new InvertedTtlPolicy();
        assert.equal(customPolicy.enabled, true);
        assert.equal(customPolicy.maxSize, 10);
        assert.equal(customPolicy.isExpired(0), true);
        assert.equal(customPolicy.isExpired(10_000), false);
    });

    void it("allows read-only access to policy properties", () => {
        const policy = new DefaultValidationCachePolicy(true, 100, 60_000);

        // TypeScript interface guarantees readonly, but we can verify runtime behavior
        assert.equal(policy.enabled, true);
        assert.equal(policy.maxSize, 100);
        assert.equal(policy.ttlMs, 60_000);
    });
});
