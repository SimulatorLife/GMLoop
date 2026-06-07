import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
    DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES,
    evaluateOptionStoreEvictionPolicy,
    resolveOptionStoreMaxEntries
} from "../src/identifier-case/option-store-policy.js";

void test("evaluateOptionStoreEvictionPolicy returns zero when store is within bounds", () => {
    const decision = evaluateOptionStoreEvictionPolicy({
        currentStoreSize: 100,
        maxEntries: 200
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateOptionStoreEvictionPolicy returns correct overflow when store exceeds max", () => {
    const decision = evaluateOptionStoreEvictionPolicy({
        currentStoreSize: 10,
        maxEntries: 3
    });
    assert.equal(decision.entriesToEvict, 7);
});

void test("evaluateOptionStoreEvictionPolicy returns zero when current equals max", () => {
    const decision = evaluateOptionStoreEvictionPolicy({
        currentStoreSize: 5,
        maxEntries: 5
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateOptionStoreEvictionPolicy returns zero when maxEntries is zero (eviction disabled)", () => {
    const decision = evaluateOptionStoreEvictionPolicy({
        currentStoreSize: 1000,
        maxEntries: 0
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateOptionStoreEvictionPolicy returns zero when maxEntries is Infinity (unbounded)", () => {
    const decision = evaluateOptionStoreEvictionPolicy({
        currentStoreSize: 1000,
        maxEntries: Infinity
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateOptionStoreEvictionPolicy returns zero when current is at the limit", () => {
    const decision = evaluateOptionStoreEvictionPolicy({
        currentStoreSize: 128,
        maxEntries: 128
    });
    assert.equal(decision.entriesToEvict, 0);
});

void test("evaluateOptionStoreEvictionPolicy handles one entry over limit", () => {
    const decision = evaluateOptionStoreEvictionPolicy({
        currentStoreSize: 101,
        maxEntries: 100
    });
    assert.equal(decision.entriesToEvict, 1);
});

void test("evaluateOptionStoreEvictionPolicy is pure and idempotent", () => {
    const input = { currentStoreSize: 500, maxEntries: 100 };

    const decision1 = evaluateOptionStoreEvictionPolicy(input);
    const decision2 = evaluateOptionStoreEvictionPolicy(input);

    assert.deepEqual(decision1, decision2);
    assert.equal(decision1.entriesToEvict, 400);
});

void test("resolveOptionStoreMaxEntries returns default when input is null", () => {
    const result = resolveOptionStoreMaxEntries(null);
    assert.equal(result, DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES);
});

void test("resolveOptionStoreMaxEntries returns default when input is undefined", () => {
    const result = resolveOptionStoreMaxEntries(undefined);
    assert.equal(result, DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES);
});

void test("resolveOptionStoreMaxEntries returns default when input is not an object", () => {
    const result = resolveOptionStoreMaxEntries("not an object");
    assert.equal(result, DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES);
});

void test("resolveOptionStoreMaxEntries returns default when options object lacks the key", () => {
    const result = resolveOptionStoreMaxEntries({ someOtherKey: 64 });
    assert.equal(result, DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES);
});

void test("resolveOptionStoreMaxEntries returns default when value is NaN", () => {
    const result = resolveOptionStoreMaxEntries({ gmlIdentifierCaseOptionStoreMaxEntries: Number.NaN });
    assert.equal(result, DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES);
});

void test("resolveOptionStoreMaxEntries returns default when value is non-finite (not Infinity)", () => {
    const result = resolveOptionStoreMaxEntries({ gmlIdentifierCaseOptionStoreMaxEntries: Infinity });
    assert.equal(result, Infinity);
});

void test("resolveOptionStoreMaxEntries returns 0 for negative numbers", () => {
    const result = resolveOptionStoreMaxEntries({ gmlIdentifierCaseOptionStoreMaxEntries: -100 });
    assert.equal(result, 0);
});

void test("resolveOptionStoreMaxEntries returns floor of valid positive number", () => {
    const result = resolveOptionStoreMaxEntries({ gmlIdentifierCaseOptionStoreMaxEntries: 100.7 });
    assert.equal(result, 100);
});

void test("resolveOptionStoreMaxEntries returns 0 for values between 0 and 1", () => {
    const result = resolveOptionStoreMaxEntries({ gmlIdentifierCaseOptionStoreMaxEntries: 0.5 });
    assert.equal(result, 0);
});

void test("resolveOptionStoreMaxEntries preserves valid positive integers", () => {
    const result = resolveOptionStoreMaxEntries({ gmlIdentifierCaseOptionStoreMaxEntries: 2048 });
    assert.equal(result, 2048);
});

void test("resolveOptionStoreMaxEntries accepts custom default getter", () => {
    const result = resolveOptionStoreMaxEntries("invalid", () => 999);
    assert.equal(result, 999);
});

void test("resolveOptionStoreMaxEntries accepts custom default getter with valid input", () => {
    const result = resolveOptionStoreMaxEntries({ gmlIdentifierCaseOptionStoreMaxEntries: 64 }, () => 999);
    assert.equal(result, 64);
});

void test("DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES equals 128", () => {
    assert.equal(DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES, 128);
});
