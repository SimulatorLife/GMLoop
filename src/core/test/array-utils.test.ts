import assert from "node:assert/strict";
import test from "node:test";

// Node deprecated the loose equality helpers (for example `assert.equal`).
// These tests intentionally rely on the strict variants so future refactors do
// not reintroduce the legacy assertions. Behaviour has been revalidated via
// `pnpm test src/shared/test/array-utils.test.js`.
import {
    asArray,
    compactArray,
    findLastIndex,
    isNonEmptyArray,
    mergeUniqueValues,
    pushUnique,
    toArray,
    toArrayFromIterable,
    toMutableArray,
    uniqueArray
} from "../src/utils/array.js";

void test("toArray wraps non-array values", () => {
    assert.deepEqual(toArray("value"), ["value"]);
    assert.deepEqual(toArray(0), [0]);
    assert.deepEqual(toArray(false), [false]);
});

void test("toArray preserves arrays", () => {
    const input = [1, 2, 3];
    assert.strictEqual(toArray(input), input);
});

void test("toArray normalizes nullish values to empty arrays", () => {
    assert.deepEqual(toArray(null), []);
    assert.deepEqual(toArray(), []);
});

void test("asArray returns arrays unchanged", () => {
    const input = [1, 2, 3];
    assert.strictEqual(asArray(input), input);
});

void test("asArray normalizes non-arrays to empty arrays", () => {
    assert.deepEqual(asArray(null), []);
    assert.deepEqual(asArray(), []);
    assert.deepEqual(asArray("value"), []);
});

void test("isNonEmptyArray identifies arrays with elements", () => {
    assert.strictEqual(isNonEmptyArray([0]), true);
    assert.strictEqual(isNonEmptyArray([]), false);
    assert.strictEqual(isNonEmptyArray(null), false);
});

void test("uniqueArray removes duplicates while preserving order", () => {
    assert.deepEqual(uniqueArray(["alpha", "beta", "alpha", "gamma", "beta"]), ["alpha", "beta", "gamma"]);
});

void test("mergeUniqueValues combines unique values and can coerce entries", () => {
    const result = mergeUniqueValues(["alpha", "beta"], ["beta", "", "gamma", null], {
        coerce: (value) => (typeof value === "string" && value.length > 0 ? value : null),
        freeze: false
    });

    assert.deepEqual(result, ["alpha", "beta", "gamma"]);
    assert.ok(!Object.isFrozen(result));
});

void test("toArrayFromIterable snapshots arrays before mutation", () => {
    const input = ["alpha", "beta"];

    const snapshot = toArrayFromIterable(input);

    assert.notStrictEqual(snapshot, input);
    assert.deepEqual(snapshot, input);

    snapshot.push("gamma");

    assert.deepEqual(input, ["alpha", "beta"]);
    assert.deepEqual(snapshot, ["alpha", "beta", "gamma"]);
});

void test("uniqueArray supports iterables and optional freezing", () => {
    const result = uniqueArray(new Set(["one", "two", "one"]), {
        freeze: true
    });

    assert.deepEqual(result, ["one", "two"]);
    assert.ok(Object.isFrozen(result));
});

void test("compactArray removes falsy entries while preserving order", () => {
    assert.deepEqual(compactArray([0, "", "alpha", false, "beta", null]), ["alpha", "beta"]);
});

void test("compactArray tolerates iterables and optional freezing", () => {
    const iterable = new Set(["first", "", "second"]);
    const result = compactArray(iterable, { freeze: true });

    assert.deepEqual(result, ["first", "second"]);
    assert.ok(Object.isFrozen(result));
});

void test("compactArray normalizes nullish inputs to empty arrays", () => {
    assert.deepEqual(compactArray(null), []);
    assert.deepEqual(compactArray(), []);
});

void test("compactArray ignores non-iterable values", () => {
    assert.deepEqual(compactArray({ value: "alpha" }), []);
});

void test("pushUnique appends values that are not present", () => {
    const entries = ["alpha"];

    const added = pushUnique(entries, "beta");

    assert.strictEqual(added, true);
    assert.deepEqual(entries, ["alpha", "beta"]);
});

void test("pushUnique skips existing values", () => {
    const entries = ["alpha", "beta"];

    const added = pushUnique(entries, "alpha");

    assert.strictEqual(added, false);
    assert.deepEqual(entries, ["alpha", "beta"]);
});

void test("pushUnique can use a custom equality comparator", () => {
    const entries = [{ id: 1 }, { id: 2 }];

    const added = pushUnique(entries, { id: 2 }, { isEqual: (existing, candidate) => existing.id === candidate.id });

    assert.strictEqual(added, false);
    assert.strictEqual(entries.length, 2);
});

void test("pushUnique throws when provided a non-array target", () => {
    assert.throws(() => pushUnique(null, "value"), /requires an array/i);
});

void test("findLastIndex returns the index of the last matching element", () => {
    const entries = [1, 2, 3, 2, 1];

    const index = findLastIndex(entries, (value) => value === 2);

    assert.strictEqual(index, 3);
});

void test("findLastIndex returns -1 when no element matches", () => {
    const entries = [1, 2, 3];

    const index = findLastIndex(entries, (value) => value === 5);

    assert.strictEqual(index, -1);
});

void test("findLastIndex returns -1 for null input", () => {
    const index = findLastIndex(null, () => true);

    assert.strictEqual(index, -1);
});

void test("toMutableArray returns the original array when clone is false", () => {
    const input = [1, 2, 3];
    const result = toMutableArray(input);

    assert.strictEqual(result, input);
});

void test("toMutableArray returns a new array when clone is true", () => {
    const input = [1, 2, 3];
    const result = toMutableArray(input, { clone: true });

    assert.notStrictEqual(result, input);
    assert.deepEqual(result, input);
});

void test("toMutableArray returns empty array for null input", () => {
    assert.deepEqual(toMutableArray(null), []);
    assert.deepEqual(toMutableArray(undefined), []);
});

void test("toMutableArray does not copy doc comment flags by default", () => {
    const input = [1, 2, 3] as any;
    input._preserveDescriptionBreaks = true;
    input._suppressLeadingBlank = true;
    input._blockCommentDocs = true;

    const result = toMutableArray(input, { clone: true }) as any;

    assert.strictEqual(result._preserveDescriptionBreaks, undefined);
    assert.strictEqual(result._suppressLeadingBlank, undefined);
    assert.strictEqual(result._blockCommentDocs, undefined);
});

void test("findLastIndex returns -1 for undefined input", () => {
    const index = findLastIndex(undefined, () => true);

    assert.strictEqual(index, -1);
});

void test("findLastIndex provides index and array to predicate", () => {
    const entries = ["a", "b", "c"];
    const calls: Array<{ value: string; index: number; array: string[] }> = [];

    findLastIndex(entries, (value, index, array) => {
        calls.push({ value, index, array });
        return false;
    });

    assert.strictEqual(calls.length, 3);
    assert.deepEqual(calls[0], { value: "c", index: 2, array: entries });
    assert.deepEqual(calls[1], { value: "b", index: 1, array: entries });
    assert.deepEqual(calls[2], { value: "a", index: 0, array: entries });
});
