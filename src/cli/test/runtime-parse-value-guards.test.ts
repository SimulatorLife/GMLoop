import assert from "node:assert/strict";
import { test } from "node:test";

import { __runtimeTestHelpers__ } from "../src/commands/runtime.js";

const { isSerializableRuntimeValue, sanitizeRuntimeValue, sanitizeCallArguments } = __runtimeTestHelpers__;

void test("isSerializableRuntimeValue returns true for primitives", () => {
    assert.equal(isSerializableRuntimeValue(true), true);
    assert.equal(isSerializableRuntimeValue(false), true);
    assert.equal(isSerializableRuntimeValue(null), true);
    assert.equal(isSerializableRuntimeValue(0), true);
    assert.equal(isSerializableRuntimeValue(42), true);
    assert.equal(isSerializableRuntimeValue(""), true);
    assert.equal(isSerializableRuntimeValue("hello"), true);
});

void test("isSerializableRuntimeValue returns true for arrays of primitives", () => {
    assert.equal(isSerializableRuntimeValue([]), true);
    assert.equal(isSerializableRuntimeValue([1, 2, 3]), true);
    assert.equal(isSerializableRuntimeValue(["a", "b"]), true);
    assert.equal(isSerializableRuntimeValue([true, null, 42, "text"]), true);
    assert.equal(
        isSerializableRuntimeValue([
            [1, 2],
            [3, 4]
        ]),
        true
    );
});

void test("isSerializableRuntimeValue returns false for objects and non-serializable values", () => {
    assert.equal(isSerializableRuntimeValue({}), false);
    assert.equal(isSerializableRuntimeValue({ key: "value" }), false);
    assert.equal(isSerializableRuntimeValue([{ a: 1 }]), false);
    assert.equal(isSerializableRuntimeValue([undefined]), false);
    assert.equal(isSerializableRuntimeValue(Symbol("sym")), false);
    assert.equal(
        isSerializableRuntimeValue(() => {}),
        false
    );
    assert.equal(isSerializableRuntimeValue(new Date()), false);
});

void test("sanitizeRuntimeValue preserves primitives", () => {
    assert.equal(sanitizeRuntimeValue("hp", true), true);
    assert.equal(sanitizeRuntimeValue("hp", 42), 42);
    assert.equal(sanitizeRuntimeValue("hp", "hello"), "hello");
    assert.equal(sanitizeRuntimeValue("hp", null), null);
    assert.deepEqual(sanitizeRuntimeValue("hp", [1, 2, 3]), [1, 2, 3]);
    assert.deepEqual(sanitizeRuntimeValue("hp", ["a", null, 42]), ["a", null, 42]);
});

void test("sanitizeRuntimeValue replaces undefined with null", () => {
    assert.equal(sanitizeRuntimeValue("hp", undefined), null);
});

void test("sanitizeRuntimeValue replaces non-serializable objects with null", () => {
    assert.equal(sanitizeRuntimeValue("hp", {}), null);
    assert.equal(sanitizeRuntimeValue("data", { x: 1, y: 2 }), null);
});

void test("sanitizeRuntimeValue replaces arrays containing non-primitives with null", () => {
    assert.equal(sanitizeRuntimeValue("list", [{}]), null);
    assert.equal(sanitizeRuntimeValue("list", [1, { a: 1 }]), null);
});

void test("sanitizeCallArguments preserves arrays", () => {
    assert.deepEqual(sanitizeCallArguments([]), []);
    assert.deepEqual(sanitizeCallArguments([1, true, "text"]), [1, true, "text"]);
});

void test("sanitizeCallArguments wraps non-array values in a single-element array", () => {
    assert.deepEqual(sanitizeCallArguments(42), [42]);
    assert.deepEqual(sanitizeCallArguments("hello"), ["hello"]);
    assert.deepEqual(sanitizeCallArguments({ a: 1 }), [{ a: 1 }]);
    assert.deepEqual(sanitizeCallArguments(null), [null]);
});
