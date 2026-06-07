import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
    DEFAULT_LOOKUP_CACHE_MAX_ENTRIES,
    evaluateLookupCacheEvictionPolicy,
    resolveLookupCacheMaxEntries
} from "../src/scopes/lookup-cache-policy.js";

void test("evaluateLookupCacheEvictionPolicy returns zero when cache is within bounds", () => {
    const decision = evaluateLookupCacheEvictionPolicy({
        currentCacheSize: 100,
        maxEntries: 200
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateLookupCacheEvictionPolicy returns correct overflow when cache exceeds max", () => {
    const decision = evaluateLookupCacheEvictionPolicy({
        currentCacheSize: 10,
        maxEntries: 3
    });
    assert.equal(decision.entriesToEvict, 7);
});

void test("evaluateLookupCacheEvictionPolicy returns zero when current equals max", () => {
    const decision = evaluateLookupCacheEvictionPolicy({
        currentCacheSize: 5,
        maxEntries: 5
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateLookupCacheEvictionPolicy returns zero when maxEntries is zero (no limit)", () => {
    const decision = evaluateLookupCacheEvictionPolicy({
        currentCacheSize: 1000,
        maxEntries: 0
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateLookupCacheEvictionPolicy returns zero when maxEntries is negative", () => {
    const decision = evaluateLookupCacheEvictionPolicy({
        currentCacheSize: 1000,
        maxEntries: -5
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateLookupCacheEvictionPolicy handles one entry over limit", () => {
    const decision = evaluateLookupCacheEvictionPolicy({
        currentCacheSize: 101,
        maxEntries: 100
    });
    assert.equal(decision.entriesToEvict, 1);
});

void test("evaluateLookupCacheEvictionPolicy is pure and idempotent", () => {
    const input = { currentCacheSize: 500, maxEntries: 100 };

    const decision1 = evaluateLookupCacheEvictionPolicy(input);
    const decision2 = evaluateLookupCacheEvictionPolicy(input);

    assert.deepEqual(decision1, decision2);
    assert.equal(decision1.entriesToEvict, 400);
});

void test("resolveLookupCacheMaxEntries returns default when input is null", () => {
    const result = resolveLookupCacheMaxEntries(null, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
});

void test("resolveLookupCacheMaxEntries returns default when input is undefined", () => {
    const result = resolveLookupCacheMaxEntries(undefined, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
});

void test("resolveLookupCacheMaxEntries returns default when input is not a number", () => {
    const result = resolveLookupCacheMaxEntries("invalid", DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
});

void test("resolveLookupCacheMaxEntries returns default when input is NaN", () => {
    const result = resolveLookupCacheMaxEntries(Number.NaN, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
});

void test("resolveLookupCacheMaxEntries returns default when input is Infinity", () => {
    const result = resolveLookupCacheMaxEntries(Infinity, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
});

void test("resolveLookupCacheMaxEntries returns 1 for negative numbers (floored to negative then max with 1)", () => {
    // The original implementation uses Math.max(1, Math.floor(value)),
    // which means negative numbers are floored to a negative value,
    // then max(1, negative) returns 1.
    const result = resolveLookupCacheMaxEntries(-100, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, 1);
});

void test("resolveLookupCacheMaxEntries returns floor of valid positive number", () => {
    const result = resolveLookupCacheMaxEntries(100.7, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, 100);
});

void test("resolveLookupCacheMaxEntries returns at least 1 for fractional values less than 1", () => {
    const result = resolveLookupCacheMaxEntries(0.5, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, 1);
});

void test("resolveLookupCacheMaxEntries returns at least 1 for zero", () => {
    const result = resolveLookupCacheMaxEntries(0, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, 1);
});

void test("resolveLookupCacheMaxEntries preserves valid positive integers", () => {
    const result = resolveLookupCacheMaxEntries(2048, DEFAULT_LOOKUP_CACHE_MAX_ENTRIES);
    assert.equal(result, 2048);
});

void test("resolveLookupCacheMaxEntries ignores custom default when input is valid", () => {
    const result = resolveLookupCacheMaxEntries(500, 10_000);
    assert.equal(result, 500);
});

void test("DEFAULT_LOOKUP_CACHE_MAX_ENTRIES equals 2048", () => {
    assert.equal(DEFAULT_LOOKUP_CACHE_MAX_ENTRIES, 2048);
});
