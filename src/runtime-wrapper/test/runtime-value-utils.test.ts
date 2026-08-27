import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import { Core } from "@gmloop/core";

import {
    areNumbersApproximatelyEqual,
    cloneObjectEntries,
    getErrorMessage,
    isArrayBufferLike,
    isArrayBufferViewLike,
    isBinaryDataLike,
    isErrorLike,
    isNonEmptyArray,
    isNonEmptyString,
    parseJsonWithContext,
    readCxcDxStore,
    readRuntimeObjectPool,
    toArray,
    trimArrayToMaxSize
} from "../src/browser/support/runtime-value-utils.js";

/**
 * These tests pin the polymorphism contract for the runtime wrapper's value
 * helpers. Before the refactor, the helpers used `value instanceof ArrayBuffer`
 * and `ArrayBuffer.isView(value)` to discriminate payloads. Both checks fail
 * for cross-realm collaborators and for duck-typed substitutes produced by
 * browser shims or test doubles, so the tests below intentionally construct
 * collaborators that *do not* satisfy those constructor checks yet expose the
 * same surface. The capability probes must accept them to honour the
 * shared contract documented in `Core.isArrayBufferLike` / `Core.isBinaryDataLike`.
 */

void describe("runtime-value-utils — polymorphism guardrails", () => {
    void describe("isArrayBufferLike", () => {
        void it("accepts a native ArrayBuffer instance", () => {
            const buffer = new ArrayBuffer(16);
            assert.equal(isArrayBufferLike(buffer), true);
        });

        void it("accepts an ArrayBuffer from a different execution realm", () => {
            const realm = vm.createContext({});
            const foreignBuffer = vm.runInContext("new ArrayBuffer(16)", realm);
            // Sanity check: the foreign buffer should NOT satisfy `instanceof ArrayBuffer`
            // because each realm owns its own ArrayBuffer constructor.
            assert.equal(
                foreignBuffer instanceof ArrayBuffer,
                false,
                "precondition: foreign-realm buffers must fail instanceof checks"
            );
            assert.equal(isArrayBufferLike(foreignBuffer), true);
        });

        void it("accepts a duck-typed buffer lookalike (object with byteLength + slice)", () => {
            const bufferLike = {
                byteLength: 16,
                slice: () => new ArrayBuffer(8)
            };
            assert.equal(isArrayBufferLike(bufferLike), true);
        });

        void it("rejects lookalikes missing slice or byteLength", () => {
            assert.equal(isArrayBufferLike({ byteLength: 16 }), false);
            assert.equal(isArrayBufferLike({ slice: () => {} }), false);
            assert.equal(isArrayBufferLike(null), false);
            assert.equal(isArrayBufferLike(undefined), false);
            assert.equal(isArrayBufferLike("ArrayBuffer"), false);
        });
    });

    void describe("isArrayBufferViewLike", () => {
        void it("accepts typed-array views and DataView instances", () => {
            assert.equal(isArrayBufferViewLike(new Uint8Array(8)), true);
            assert.equal(isArrayBufferViewLike(new Int32Array(4)), true);
            assert.equal(isArrayBufferViewLike(new DataView(new ArrayBuffer(8))), true);
        });

        void it("accepts a typed array from a different execution realm", () => {
            const realm = vm.createContext({});
            const foreignView = vm.runInContext("new Uint8Array(8)", realm);
            // Sanity check: the foreign view should NOT satisfy the realm-local
            // `instanceof Uint8Array` because each realm owns its own typed-array
            // constructor, even though `ArrayBuffer.isView` happens to return
            // true for cross-realm views (it inspects internal slots).
            assert.equal(
                foreignView instanceof Uint8Array,
                false,
                "precondition: foreign-realm views must fail instanceof Uint8Array checks"
            );
            assert.equal(isArrayBufferViewLike(foreignView), true);
        });

        void it("accepts a duck-typed view wrapped in a Proxy where ArrayBuffer.isView returns false", () => {
            // `ArrayBuffer.isView` inspects the internal `[[ViewedArrayBuffer]]`
            // slot and rejects proxies or duck-typed substitutes that lack it,
            // even when they expose the documented surface. The capability probe
            // below accepts such substitutes so the runtime wrapper can safely
            // normalise payloads produced by browser shims or test doubles.
            const realm = vm.createContext({});
            const proxiedViewLike = vm.runInContext(
                `new Proxy({ buffer: new ArrayBuffer(8), byteOffset: 0, byteLength: 8 }, {})`,
                realm
            );
            assert.equal(
                ArrayBuffer.isView(proxiedViewLike),
                false,
                "precondition: duck-typed proxies must fail ArrayBuffer.isView checks"
            );
            assert.equal(isArrayBufferViewLike(proxiedViewLike), true);
        });

        void it("accepts a duck-typed view lookalike (object with buffer + byteOffset + byteLength)", () => {
            const viewLike = { buffer: new ArrayBuffer(8), byteOffset: 0, byteLength: 8 };
            assert.equal(isArrayBufferViewLike(viewLike), true);
        });

        void it("rejects lookalikes missing buffer, byteOffset, or byteLength", () => {
            assert.equal(isArrayBufferViewLike(new ArrayBuffer(8)), false, "ArrayBuffer itself is not a view");
            assert.equal(isArrayBufferViewLike({ byteOffset: 0, byteLength: 8 }), false, "missing buffer");
            assert.equal(
                isArrayBufferViewLike({ buffer: new ArrayBuffer(8), byteLength: 8 }),
                false,
                "missing byteOffset"
            );
            assert.equal(
                isArrayBufferViewLike({ buffer: new ArrayBuffer(8), byteOffset: 0 }),
                false,
                "missing byteLength"
            );
            assert.equal(isArrayBufferViewLike({ buffer: "not-an-object", byteOffset: 0, byteLength: 8 }), false);
            assert.equal(isArrayBufferViewLike(null), false);
            assert.equal(isArrayBufferViewLike(undefined), false);
            assert.equal(isArrayBufferViewLike("Uint8Array"), false);
        });
    });

    void describe("isBinaryDataLike", () => {
        void it("accepts a real ArrayBuffer", () => {
            assert.equal(isBinaryDataLike(new ArrayBuffer(8)), true);
        });

        void it("accepts typed-array views and DataView instances", () => {
            assert.equal(isBinaryDataLike(new Uint8Array(8)), true);
            assert.equal(isBinaryDataLike(new Int32Array(4)), true);
            assert.equal(isBinaryDataLike(new DataView(new ArrayBuffer(8))), true);
        });

        void it("accepts a duck-typed ArrayBuffer substitute", () => {
            const bufferLike = { byteLength: 16, slice: () => new ArrayBuffer(8) };
            assert.equal(isBinaryDataLike(bufferLike), true);
        });

        void it("accepts a duck-typed ArrayBufferView substitute", () => {
            const viewLike = { buffer: new ArrayBuffer(8), byteOffset: 0, byteLength: 8 };
            assert.equal(isBinaryDataLike(viewLike), true);
        });

        void it("rejects non-binary values", () => {
            assert.equal(isBinaryDataLike(null), false);
            assert.equal(isBinaryDataLike("binary"), false);
            assert.equal(isBinaryDataLike([1, 2, 3]), false);
            assert.equal(isBinaryDataLike({}), false);
        });
    });

    void describe("isErrorLike", () => {
        void it("accepts a native Error instance", () => {
            assert.equal(isErrorLike(new Error("boom")), true);
        });

        void it("accepts an Error from a different execution realm", () => {
            const realm = vm.createContext({});
            const foreignError = vm.runInContext("new Error('foreign boom')", realm);
            // Sanity check: the foreign error should NOT satisfy `instanceof Error`
            // because each realm owns its own Error constructor.
            assert.equal(
                foreignError instanceof Error,
                false,
                "precondition: foreign-realm errors must fail instanceof checks"
            );
            assert.equal(isErrorLike(foreignError), true);
        });

        void it("accepts duck-typed error lookalikes", () => {
            assert.equal(isErrorLike({ message: "boom" }), true);
            assert.equal(isErrorLike({ message: "boom", name: "CustomError" }), true);
        });

        void it("rejects non-error values", () => {
            assert.equal(isErrorLike(null), false);
            assert.equal(isErrorLike(undefined), false);
            assert.equal(isErrorLike("boom"), false);
            assert.equal(isErrorLike({ message: 42 }), false);
        });
    });

    void describe("getErrorMessage", () => {
        void it("extracts the message from a duck-typed error", () => {
            assert.equal(getErrorMessage({ message: "duck-typed boom" }), "duck-typed boom");
        });

        void it("returns the value as-is when it is a string", () => {
            assert.equal(getErrorMessage("plain string error"), "plain string error");
        });

        void it("falls back to the default message for non-error values", () => {
            assert.equal(getErrorMessage(42), "Unknown error");
            assert.equal(getErrorMessage(42, { fallback: "Custom fallback" }), "Custom fallback");
        });

        void it("invokes a function fallback for non-error values", () => {
            const formatted = getErrorMessage(42, {
                fallback: (error: unknown) => `fallback(${JSON.stringify(error)})`
            });
            assert.equal(formatted, "fallback(42)");
        });

        void it("extracts the message from a cross-realm error", () => {
            const realm = vm.createContext({});
            const foreignError = vm.runInContext("new Error('foreign realm message')", realm);
            assert.equal(getErrorMessage(foreignError), "foreign realm message");
        });
    });

    void describe("parseJsonWithContext", () => {
        void it("parses valid JSON", () => {
            const parsed = parseJsonWithContext('{"a":1}', { description: "fixture" });
            assert.deepEqual(parsed, { a: 1 });
        });

        void it("throws a SyntaxError annotated with context on invalid JSON", () => {
            assert.throws(
                () => parseJsonWithContext("{not valid", { description: "fixture" }),
                (error: unknown): error is SyntaxError =>
                    error instanceof SyntaxError && error.message.startsWith("Failed to parse fixture:")
            );
        });

        void it("preserves the original parse error as the cause", () => {
            try {
                parseJsonWithContext("not-json", { description: "fixture", source: "memory.json" });
                assert.fail("expected parseJsonWithContext to throw");
            } catch (error) {
                assert.ok(error instanceof SyntaxError);
                assert.ok(
                    error.cause instanceof Error,
                    "cause should be the original SyntaxError raised by JSON.parse"
                );
            }
        });
    });

    void describe("toArray", () => {
        void it("wraps a non-array value in an array", () => {
            assert.deepEqual(toArray(1), [1]);
        });

        void it("returns arrays unchanged", () => {
            const array = [1, 2, 3];
            assert.equal(toArray(array), array);
        });
    });

    void describe("isNonEmptyString", () => {
        void it("accepts non-empty strings", () => {
            assert.equal(isNonEmptyString("hello"), true);
        });

        void it("rejects empty strings and non-strings", () => {
            assert.equal(isNonEmptyString(""), false);
            assert.equal(isNonEmptyString(null), false);
            assert.equal(isNonEmptyString(42), false);
        });
    });

    void describe("isNonEmptyArray", () => {
        void it("accepts non-empty arrays", () => {
            assert.equal(isNonEmptyArray([1]), true);
        });

        void it("rejects empty arrays and non-arrays", () => {
            assert.equal(isNonEmptyArray([]), false);
            assert.equal(isNonEmptyArray("string"), false);
            assert.equal(isNonEmptyArray(null), false);
        });
    });

    void describe("cloneObjectEntries", () => {
        void it("clones object entries while preserving primitive entries", () => {
            const primitive = 1;
            const objectEntry = { a: 1 };
            const result = cloneObjectEntries([primitive, objectEntry] as Array<number | Record<string, number>>);

            assert.equal(result[0], primitive, "primitives should be preserved by reference");
            assert.notEqual(result[1], objectEntry, "object entries should be cloned");
            assert.deepEqual(result[1], { a: 1 });
        });
    });

    void describe("areNumbersApproximatelyEqual", () => {
        void it("treats values within the floating-point tolerance as equal", () => {
            assert.equal(areNumbersApproximatelyEqual(1, 1 + Number.EPSILON), true);
        });

        void it("rejects values outside the tolerance", () => {
            assert.equal(areNumbersApproximatelyEqual(1, 1.5), false);
        });

        void it("treats bit-identical values as equal without tolerance math", () => {
            // The strict-equality fast path must report `Infinity` and
            // `-Infinity` as equal to themselves. Without it, the helper
            // computes `Math.abs(Infinity - Infinity) === NaN`, which fails
            // the `<=` comparison and yields `false` — a behaviour that
            // silently misclassifies sentinel comparisons in callers such
            // as `calculatePercentile`.
            assert.equal(areNumbersApproximatelyEqual(Infinity, Infinity), true);
            assert.equal(areNumbersApproximatelyEqual(-Infinity, -Infinity), true);
        });

        void it("rejects NaN inputs without conflating them with measured values", () => {
            // NaN is never equal to anything — including itself. The fast
            // path correctly returns `false` for `NaN === NaN`, and the
            // non-finite guard rejects any comparison involving NaN so
            // that callers cannot accidentally accept NaN as a valid
            // measurement.
            assert.equal(areNumbersApproximatelyEqual(Number.NaN, 1), false);
            assert.equal(areNumbersApproximatelyEqual(1, Number.NaN), false);
            assert.equal(areNumbersApproximatelyEqual(Number.NaN, Number.NaN), false);
        });

        void it("rejects mixed finite and non-finite inputs", () => {
            // A finite measurement must never compare equal to a sentinel
            // value, even though both satisfy the scaled-tolerance
            // predicate against any other finite number.
            assert.equal(areNumbersApproximatelyEqual(Infinity, 1), false);
            assert.equal(areNumbersApproximatelyEqual(-Infinity, 1), false);
            assert.equal(areNumbersApproximatelyEqual(1, Infinity), false);
            assert.equal(areNumbersApproximatelyEqual(1, -Infinity), false);
        });

        void it("absorbs scaled rounding error beyond the bare EPSILON window", () => {
            // The 4× scaled tolerance must accept values that differ from
            // their rounded target by up to ~4 × Number.EPSILON × scale.
            // At scale = 1000, that window is roughly 8.9e-13, which is
            // enough to absorb the rounding noise that
            // `(percentile / 100) * (length - 1)` accumulates when the
            // mathematical result is an integer.
            const scale = 1000;
            const drift = Number.EPSILON * scale * 3;
            assert.equal(
                areNumbersApproximatelyEqual(scale, scale + drift),
                true,
                "scaled tolerance must absorb rounding error within 4× EPSILON × scale"
            );
        });
    });

    void describe("readCxcDxStore", () => {
        void it("returns the _dx store when present", () => {
            const dx = { foo: 1 };
            const globalScope = { _cx: { _dx: dx } } as Record<string, unknown>;
            assert.equal(readCxcDxStore(globalScope), dx);
        });

        void it("returns undefined when _cx or _dx is missing", () => {
            assert.equal(readCxcDxStore({}), undefined);
            assert.equal(readCxcDxStore({ _cx: {} }), undefined);
        });

        void it("returns undefined when _cx or _dx is a primitive", () => {
            assert.equal(readCxcDxStore({ _cx: 42 }), undefined);
            assert.equal(readCxcDxStore({ _cx: { _dx: "not-an-object" } }), undefined);
        });
    });

    void describe("readRuntimeObjectPool", () => {
        void it("returns the room object pool when present", () => {
            const pool: Array<unknown> = [{ id: 1 }];
            const globalScope = {
                g_RunRoom: {
                    m_Active: { pool }
                }
            } as Record<string, unknown>;
            assert.equal(readRuntimeObjectPool(globalScope), pool);
        });

        void it("returns undefined when the active room or pool is missing", () => {
            assert.equal(readRuntimeObjectPool({}), undefined);
            assert.equal(readRuntimeObjectPool({ g_RunRoom: {} }), undefined);
            assert.equal(
                readRuntimeObjectPool({
                    g_RunRoom: { m_Active: { pool: "not-an-array" } }
                }),
                undefined
            );
        });

        void it("returns undefined when g_RunRoom or m_Active is a primitive", () => {
            assert.equal(readRuntimeObjectPool({ g_RunRoom: 42 }), undefined);
            assert.equal(readRuntimeObjectPool({ g_RunRoom: { m_Active: "not-an-object" } }), undefined);
        });
    });

    void describe("contract symmetry with Core probes", () => {
        void it("exposes the same ArrayBufferLike classification as Core.isArrayBufferLike", () => {
            const samples: Array<unknown> = [
                new ArrayBuffer(8),
                { byteLength: 8, slice: () => new ArrayBuffer(4) },
                { byteLength: 8 },
                null,
                "string"
            ];
            for (const sample of samples) {
                assert.equal(
                    isArrayBufferLike(sample),
                    Core.isArrayBufferLike(sample),
                    "mismatch between local isArrayBufferLike and Core.isArrayBufferLike"
                );
            }
        });

        void it("exposes the same binary-data classification as Core.isBinaryDataLike", () => {
            const samples: Array<unknown> = [
                new ArrayBuffer(8),
                new Uint8Array(8),
                new DataView(new ArrayBuffer(8)),
                { byteLength: 8, slice: () => new ArrayBuffer(4) },
                { buffer: new ArrayBuffer(8), byteOffset: 0, byteLength: 8 },
                null,
                "string"
            ];
            for (const sample of samples) {
                assert.equal(
                    isBinaryDataLike(sample),
                    Core.isBinaryDataLike(sample),
                    "mismatch between local isBinaryDataLike and Core.isBinaryDataLike"
                );
            }
        });

        void it("exposes the same ArrayBufferView classification as Core.isArrayBufferViewLike", () => {
            const samples: Array<unknown> = [
                new Uint8Array(8),
                new Int32Array(4),
                new DataView(new ArrayBuffer(8)),
                new ArrayBuffer(8),
                { buffer: new ArrayBuffer(8), byteOffset: 0, byteLength: 8 },
                { byteOffset: 0, byteLength: 8 },
                null,
                "string"
            ];
            for (const sample of samples) {
                assert.equal(
                    isArrayBufferViewLike(sample),
                    Core.isArrayBufferViewLike(sample),
                    "mismatch between local isArrayBufferViewLike and Core.isArrayBufferViewLike"
                );
            }
        });

        void it("exposes the same error classification as Core.isErrorLike", () => {
            const samples: Array<unknown> = [
                new Error("boom"),
                { message: "boom" },
                { message: "boom", name: "Custom" },
                { message: 42 },
                null,
                undefined,
                "string"
            ];
            for (const sample of samples) {
                assert.equal(
                    isErrorLike(sample),
                    Core.isErrorLike(sample),
                    "mismatch between local isErrorLike and Core.isErrorLike"
                );
            }
        });
    });

    void describe("trimArrayToMaxSize", () => {
        void it("leaves the array unchanged when max size is unbounded (zero)", () => {
            const array = [1, 2, 3, 4, 5];
            trimArrayToMaxSize(array, 0);

            assert.deepEqual(array, [1, 2, 3, 4, 5]);
        });

        void it("leaves the array unchanged when max size is negative", () => {
            const array = [1, 2, 3];
            trimArrayToMaxSize(array, -1);

            assert.deepEqual(array, [1, 2, 3]);
        });

        void it("leaves the array unchanged when within limit", () => {
            const array = [1, 2, 3, 4, 5];
            trimArrayToMaxSize(array, 5);

            assert.deepEqual(array, [1, 2, 3, 4, 5]);
        });

        void it("leaves the array unchanged when under limit", () => {
            const array = [1, 2];
            trimArrayToMaxSize(array, 5);

            assert.deepEqual(array, [1, 2]);
        });

        void it("removes oldest entries when exceeding limit", () => {
            const array = [1, 2, 3, 4, 5, 6, 7, 8];
            trimArrayToMaxSize(array, 3);

            assert.deepEqual(array, [6, 7, 8]);
        });

        void it("handles empty array", () => {
            const array: Array<number> = [];
            trimArrayToMaxSize(array, 3);

            assert.deepEqual(array, []);
        });
    });
});
