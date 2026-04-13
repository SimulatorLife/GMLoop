import assert from "node:assert/strict";
import test from "node:test";

import { Core } from "../src/index.js";
import {
    assertPlainObject,
    coalesceOption,
    describeValueWithArticle,
    getOrCreateMapEntry,
    hasMethods,
    incrementMapValue,
    isObjectLike,
    isPlainObject,
    withDefinedValue,
    withObjectLike
} from "../src/utils/object.js";

void test("isPlainObject accepts non-null object literals", () => {
    assert.strictEqual(isPlainObject({}), true);
    assert.strictEqual(isPlainObject(Object.create(null), { allowNullPrototype: true }), true);
});

void test("isPlainObject rejects arrays, null, and primitives", () => {
    assert.strictEqual(isPlainObject([]), false);
    assert.strictEqual(isPlainObject(null), false);
    assert.strictEqual(isPlainObject(42), false);
    assert.strictEqual(isPlainObject("value"), false);
});

void test("assertPlainObject returns the validated reference", () => {
    const target = {};
    assert.strictEqual(assertPlainObject(target), target);
});

void test("assertPlainObject throws with descriptive error messages", () => {
    assert.throws(() => assertPlainObject(null), TypeError);
    assert.throws(
        () =>
            assertPlainObject([], {
                errorMessage: "Custom plain object error"
            }),
        (error) => error instanceof TypeError && /Custom plain object error/.test(error.message)
    );
});

void test("isObjectLike returns true for non-null objects", () => {
    assert.strictEqual(isObjectLike({}), true);
    assert.strictEqual(isObjectLike(Object.create(null)), true);
    assert.strictEqual(isObjectLike([]), true);
});

void test("isObjectLike returns false for primitives and functions", () => {
    assert.strictEqual(isObjectLike(null), false);
    assert.strictEqual(isObjectLike(), false);
    assert.strictEqual(isObjectLike(0), false);
    assert.strictEqual(isObjectLike(""), false);
    assert.strictEqual(isObjectLike(Symbol("s")), false);
    assert.strictEqual(
        isObjectLike(() => {}),
        false
    );
});

void test("withObjectLike invokes success branch for objects", () => {
    const target = {};
    const result = withObjectLike(
        target,
        (value) => {
            assert.strictEqual(value, target);
            return "ok";
        },
        () => "fallback"
    );

    assert.strictEqual(result, "ok");
});

void test("withObjectLike falls back when value is not object-like", () => {
    let called = false;
    const result = withObjectLike(
        null,
        () => {
            called = true;
            return "ok";
        },
        () => "fallback"
    );

    assert.strictEqual(called, false);
    assert.strictEqual(result, "fallback");
});

void test("withObjectLike returns fallback value when provided directly", () => {
    const result = withObjectLike(null, () => "ok", "fallback-value");
    assert.strictEqual(result, "fallback-value");
});

void test("withDefinedValue invokes callback when value is defined", () => {
    let callCount = 0;
    const result = withDefinedValue(42, (value) => {
        callCount++;
        assert.strictEqual(value, 42);
        return value * 2;
    });

    assert.strictEqual(callCount, 1);
    assert.strictEqual(result, 84);
});

void test("withDefinedValue uses provided fallback when value is undefined", () => {
    let fallbackCalls = 0;
    const result = withDefinedValue(
        undefined,
        () => {
            throw new Error("onDefined should not run");
        },
        () => {
            fallbackCalls++;
            return "fallback";
        }
    );

    assert.strictEqual(fallbackCalls, 1);
    assert.strictEqual(result, "fallback");
});

void test("withDefinedValue returns undefined when no fallback is provided", () => {
    let called = false;
    const result = withDefinedValue(undefined, () => {
        called = true;
        return "value";
    });

    assert.strictEqual(called, false);
    assert.strictEqual(result, undefined);
});

void test("coalesceOption returns the first non-nullish property", () => {
    const source = {
        __internalValue: null,
        publicValue: "result"
    };

    const value = coalesceOption(source, ["__internalValue", "publicValue"], {
        fallback: "fallback"
    });

    assert.strictEqual(value, "result");
});

void test("coalesceOption respects the fallback when object is not object-like", () => {
    const value = coalesceOption(null, ["missing"], { fallback: "fallback" });
    assert.strictEqual(value, "fallback");
});

void test("coalesceOption skips null values and returns the fallback", () => {
    const source = { configured: null };

    const value = coalesceOption(source, "configured", {
        fallback: "fallback"
    });

    assert.strictEqual(value, "fallback");
});

void test("getOrCreateMapEntry initializes values on demand", () => {
    const store = new Map();

    const entry = getOrCreateMapEntry(store, "key", () => ({ created: true }));

    assert.deepStrictEqual(entry, { created: true });
    assert.strictEqual(store.get("key"), entry);
});

void test("getOrCreateMapEntry reuses existing entries without invoking initializer", () => {
    const store = new Map();
    const initial = getOrCreateMapEntry(store, "key", () => ({ count: 1 }));

    const reused = getOrCreateMapEntry(store, "key", () => {
        throw new Error("initializer should not run for existing entry");
    });

    assert.strictEqual(reused, initial);
});

void test("getOrCreateMapEntry works with WeakMap instances", () => {
    const store = new WeakMap();
    const key = {};

    const value = getOrCreateMapEntry(store, key, () => ({ hits: 0 }));
    const again = getOrCreateMapEntry(store, key, () => ({ hits: 1 }));

    assert.strictEqual(again, value);
});

void test("describeValueWithArticle formats common value types", () => {
    assert.strictEqual(describeValueWithArticle(null), "null");
    assert.strictEqual(describeValueWithArticle(), "undefined");
    assert.strictEqual(describeValueWithArticle([]), "an array");
    assert.strictEqual(describeValueWithArticle("value"), "a string");
    assert.strictEqual(describeValueWithArticle(Symbol("s")), "a symbol");
    assert.strictEqual(describeValueWithArticle(new Map()), "a Map object");
});

void test("describeValueWithArticle accepts custom empty string labels", () => {
    assert.strictEqual(describeValueWithArticle("", { emptyStringLabel: "an empty string" }), "an empty string");
});

void test("incrementMapValue initializes missing entries with fallback", () => {
    const store = new Map();

    const result = incrementMapValue(store, "key");

    assert.strictEqual(result, 1);
    assert.strictEqual(store.get("key"), 1);
});

void test("incrementMapValue coerces existing values before incrementing", () => {
    const store = new Map([
        ["alpha", "2"],
        ["beta", undefined]
    ]);

    const alpha = incrementMapValue(store, "alpha", 3);
    const beta = incrementMapValue(store, "beta", 2, { fallback: 5 });

    assert.strictEqual(alpha, 5);
    assert.strictEqual(store.get("alpha"), 5);
    assert.strictEqual(beta, 7);
    assert.strictEqual(store.get("beta"), 7);
});

void test("incrementMapValue throws when store lacks map methods", () => {
    assert.throws(() => incrementMapValue(null, "key"), /store must provide get and set functions/);
});

void test("snapshotProperties creates a shallow copy of specified properties", () => {
    const source = {
        name: "test",
        value: 42,
        flag: true,
        nested: { deep: "data" },
        extra: "ignored"
    };

    const snapshot = Core.snapshotProperties(source, ["name", "value", "flag", "nested"] as const);

    assert.strictEqual(snapshot.name, "test");
    assert.strictEqual(snapshot.value, 42);
    assert.strictEqual(snapshot.flag, true);
    assert.strictEqual(snapshot.nested, source.nested);
    assert.strictEqual(Object.keys(snapshot).length, 4);
});

void test("snapshotProperties handles missing properties by including undefined", () => {
    const source: { existing: string; missing?: string } = { existing: "value" };
    const snapshot = Core.snapshotProperties(source, ["existing", "missing"] as const);

    assert.strictEqual(snapshot.existing, "value");
    assert.strictEqual(snapshot.missing, undefined);
    assert.strictEqual(Object.keys(snapshot).length, 2);
});

void test("restoreProperties assigns defined values and deletes undefined ones", () => {
    const target = {
        keep: "original",
        modify: "old",
        remove: "deleted",
        extra: "untouched"
    };

    const snapshot = {
        keep: "updated",
        modify: "new",
        remove: undefined
    };

    Core.restoreProperties(target, snapshot, ["keep", "modify", "remove"] as const);

    assert.strictEqual(target.keep, "updated");
    assert.strictEqual(target.modify, "new");
    assert.strictEqual(target.remove, undefined);
    assert.strictEqual(Object.hasOwn(target, "remove"), false);
    assert.strictEqual(target.extra, "untouched");
});

void test("restoreProperties handles null differently from undefined", () => {
    const target = { value: "original" };
    const snapshot = { value: null };

    Core.restoreProperties(target, snapshot, ["value"] as const);

    assert.strictEqual(target.value, null);
    assert.strictEqual(Object.hasOwn(target, "value"), true);
});

void test("snapshot and restore round-trip preserves property state", () => {
    const original = {
        a: 1,
        b: "text",
        c: undefined as number | undefined,
        d: { nested: true }
    };

    const keys = ["a", "b", "c", "d"] as const;
    const snapshot = Core.snapshotProperties(original, keys);

    // Modify original
    original.a = 999;
    original.b = "modified";
    delete original.c;
    original.d = { nested: false };

    // Restore from snapshot
    Core.restoreProperties(original, snapshot, keys);

    assert.strictEqual(original.a, 1);
    assert.strictEqual(original.b, "text");
    assert.strictEqual(original.c, undefined);
    assert.strictEqual(Object.hasOwn(original, "c"), false);
    assert.strictEqual(original.d.nested, true);
});

void test("hasMethods returns true when object has the specified method", () => {
    const obj = {
        foo: () => "bar",
        baz: 42
    };

    assert.strictEqual(hasMethods(obj, "foo"), true);
});

void test("hasMethods returns false when object does not have the specified method", () => {
    const obj = {
        foo: () => "bar",
        baz: 42
    };

    assert.strictEqual(hasMethods(obj, "nonexistent"), false);
});

void test("hasMethods returns false when property exists but is not a function", () => {
    const obj = {
        foo: () => "bar",
        baz: 42
    };

    assert.strictEqual(hasMethods(obj, "baz"), false);
});

void test("hasMethods returns false when object is null", () => {
    assert.strictEqual(hasMethods(null, "foo"), false);
});

void test("hasMethods returns false when object is undefined", () => {
    assert.strictEqual(hasMethods(undefined, "foo"), false);
});

void test("hasMethods works with class instances", () => {
    class TestClass {
        myMethod() {
            return "result";
        }
    }

    const instance = new TestClass();
    assert.strictEqual(hasMethods(instance, "myMethod"), true);
    assert.strictEqual(hasMethods(instance, "nonexistent"), false);
});

void test("hasMethods works with inherited methods like toString", () => {
    const obj = {};
    assert.strictEqual(hasMethods(obj, "toString"), true);
});

void test("hasMethods handles async functions", () => {
    const obj = {
        async asyncMethod() {
            return "result";
        }
    };

    assert.strictEqual(hasMethods(obj, "asyncMethod"), true);
});

void test("hasMethods handles arrow functions", () => {
    const obj = {
        arrowMethod: () => "result"
    };

    assert.strictEqual(hasMethods(obj, "arrowMethod"), true);
});

void test("hasMethods returns true when all specified methods exist (array)", () => {
    const obj = {
        get: () => "value",
        set: () => {},
        has: () => true
    };

    assert.strictEqual(hasMethods(obj, ["get", "set", "has"]), true);
});

void test("hasMethods returns false when any method is missing (array)", () => {
    const obj = {
        get: () => "value",
        set: () => {}
    };

    assert.strictEqual(hasMethods(obj, ["get", "set", "has"]), false);
});

void test("hasMethods returns false when any property is not a function (array)", () => {
    const obj = {
        get: () => "value",
        set: 42,
        has: () => true
    };

    assert.strictEqual(hasMethods(obj, ["get", "set", "has"]), false);
});
