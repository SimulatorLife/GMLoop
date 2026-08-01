import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ensureMap,
    ensureSet,
    getIterableSize,
    hasFunction,
    hasIterableItems,
    isAggregateErrorLike,
    isArrayBufferLike,
    isArrayBufferViewLike,
    isBinaryDataLike,
    isDateLike,
    isErrorLike,
    isMapLike,
    isRegExpLike,
    isSetLike,
    isUint8ArrayLike
} from "../src/utils/capability-probes.js";

void describe("capability probes", () => {
    void it("detects callable properties", () => {
        const method = Symbol("method");
        const target = {
            run() {},
            [method]() {}
        };

        assert.equal(hasFunction(target, "run"), true);
        assert.equal(hasFunction(target, method), true);
        assert.equal(hasFunction({ run: 1 }, "run"), false);
        assert.equal(hasFunction(null, "run"), false);
    });

    void it("detects error-like values", () => {
        assert.equal(isErrorLike(new Error("boom")), true);
        assert.equal(isErrorLike({ message: "boom", name: "Custom" }), true);
        assert.equal(isErrorLike({ message: 42 }), false);
        assert.equal(isAggregateErrorLike(new AggregateError([], "boom")), true);
        assert.equal(isAggregateErrorLike({ message: "boom", errors: [new Error("x")] }), true);
        assert.equal(isAggregateErrorLike({ message: "boom" }), false);
    });

    void it("identifies regexp-like inputs", () => {
        assert.equal(isRegExpLike(/abc/), true);
        const regExpLike = {
            exec: () => null,
            test: () => true
        };
        assert.equal(isRegExpLike(regExpLike), true);
        assert.equal(isRegExpLike({ test: () => true }), false);
    });

    void it("guards map-like collaborators", () => {
        const base = new Map([["key", 1]]);
        const mapLike = {
            get(key) {
                return base.get(key);
            },
            set(key, value) {
                base.set(key, value);
                return this;
            },
            has(key) {
                return base.has(key);
            },
            [Symbol.iterator]() {
                return base[Symbol.iterator]();
            }
        };

        assert.equal(isMapLike(base), true);
        assert.equal(isMapLike(mapLike), true);
        assert.equal(hasIterableItems(mapLike), true);
        assert.equal(hasIterableItems(new Map()), false);
        assert.equal(getIterableSize(mapLike), 1);
    });

    void it("guards set-like collaborators", () => {
        const base = new Set(["value"]);
        const setLike = {
            add(value) {
                base.add(value);
                return this;
            },
            has(value) {
                return base.has(value);
            },
            [Symbol.iterator]() {
                return base[Symbol.iterator]();
            }
        };

        assert.equal(isSetLike(base), true);
        assert.equal(isSetLike(setLike), true);
        assert.equal(hasIterableItems(setLike), true);
        assert.equal(hasIterableItems(new Set()), false);
        assert.equal(getIterableSize(setLike), 1);
    });

    void it("counts iterables without explicit size", () => {
        const iterable = {
            *[Symbol.iterator]() {
                yield "a";
                yield "b";
            }
        };

        assert.equal(getIterableSize(iterable), 2);
    });

    void it("treats invalid iterator results as empty iterables", () => {
        const invalidIteratorResult = {
            [Symbol.iterator]() {
                return {};
            }
        };

        assert.equal(hasIterableItems(invalidIteratorResult), false);
        assert.equal(getIterableSize(invalidIteratorResult), 0);
        assert.equal(ensureMap(invalidIteratorResult).size, 0);
    });

    void it("treats iterator factory failures as empty iterables", () => {
        const throwingIterable = {
            [Symbol.iterator]() {
                throw new Error("boom");
            }
        };

        assert.equal(hasIterableItems(throwingIterable), false);
        assert.equal(getIterableSize(throwingIterable), 0);
        assert.equal(ensureMap(throwingIterable).size, 0);
    });

    void it("ensures set-like collaborators remain writable", () => {
        const existing = new Set(["macro"]);
        assert.equal(ensureSet(existing), existing);

        const fromArray = ensureSet(["macro", "macro"]);
        assert.deepEqual([...fromArray], ["macro"]);

        assert.equal(ensureSet("macro").size, 0);
    });

    void it("coerces map-like collaborators into normalized maps", () => {
        const base = new Map([["id", { status: "passed" }]]);
        const adapter = {
            get(key) {
                return base.get(key);
            },
            set(key, value) {
                base.set(key, value);
                return this;
            },
            has(key) {
                return base.has(key);
            },
            entries() {
                return base.entries();
            }
        };

        const normalized = ensureMap(adapter);
        assert.equal(normalized, adapter);

        const fromObject = ensureMap({
            id: { status: "failed" }
        });

        assert.equal(fromObject instanceof Map, true);
        assert.equal((fromObject.get("id") as { status: string } | undefined)?.status, "failed");
    });

    void it("ignores invalid iterable shapes when normalizing maps", () => {
        assert.equal(ensureMap(new Set(["value"])).size, 0);

        const invalidIterable = {
            [Symbol.iterator]() {
                return ["value"][Symbol.iterator]();
            }
        };

        assert.equal(ensureMap(invalidIterable).size, 0);
    });

    void it("detects date-like values", () => {
        const realDate = new Date();
        assert.equal(isDateLike(realDate), true);

        const dateLike = {
            toISOString: () => "2026-02-14T08:00:00.000Z",
            getTime: () => 1_739_516_400_000,
            getFullYear: () => 2026
        };
        assert.equal(isDateLike(dateLike), true);

        assert.equal(isDateLike({ toISOString: () => "2026-02-14" }), false);
        assert.equal(isDateLike({ getTime: () => 123 }), false);
        assert.equal(isDateLike(null), false);
        assert.equal(isDateLike("2026-02-14"), false);
    });

    void it("detects ArrayBuffer-like values", () => {
        const realBuffer = new ArrayBuffer(16);
        assert.equal(isArrayBufferLike(realBuffer), true);

        const bufferLike = {
            byteLength: 16,
            slice: () => new ArrayBuffer(8)
        };
        assert.equal(isArrayBufferLike(bufferLike), true);

        assert.equal(isArrayBufferLike({ byteLength: 16 }), false);
        assert.equal(isArrayBufferLike({ slice: () => {} }), false);
        assert.equal(isArrayBufferLike(null), false);
    });

    void it("detects ArrayBufferView-like values", () => {
        const uint8Array = new Uint8Array(16);
        assert.equal(isArrayBufferViewLike(uint8Array), true);

        const int32Array = new Int32Array(8);
        assert.equal(isArrayBufferViewLike(int32Array), true);

        const dataView = new DataView(new ArrayBuffer(16));
        assert.equal(isArrayBufferViewLike(dataView), true);

        const viewLike = {
            buffer: new ArrayBuffer(16),
            byteOffset: 0,
            byteLength: 16
        };
        assert.equal(isArrayBufferViewLike(viewLike), true);

        assert.equal(isArrayBufferViewLike({ buffer: new ArrayBuffer(8) }), false);
        assert.equal(isArrayBufferViewLike(new ArrayBuffer(16)), false);
        assert.equal(isArrayBufferViewLike(null), false);
    });

    void it("detects binary data (ArrayBuffer or ArrayBufferView)", () => {
        const buffer = new ArrayBuffer(16);
        const uint8 = new Uint8Array(16);
        const dataView = new DataView(new ArrayBuffer(16));

        assert.equal(isBinaryDataLike(buffer), true);
        assert.equal(isBinaryDataLike(uint8), true);
        assert.equal(isBinaryDataLike(dataView), true);

        const bufferLike = {
            byteLength: 16,
            slice: () => new ArrayBuffer(8)
        };
        assert.equal(isBinaryDataLike(bufferLike), true);

        const viewLike = {
            buffer: new ArrayBuffer(16),
            byteOffset: 0,
            byteLength: 16
        };
        assert.equal(isBinaryDataLike(viewLike), true);

        assert.equal(isBinaryDataLike(null), false);
        assert.equal(isBinaryDataLike("binary"), false);
        assert.equal(isBinaryDataLike([1, 2, 3]), false);
    });

    void it("detects Uint8Array-like values specifically", () => {
        const uint8 = new Uint8Array(16);
        assert.equal(isUint8ArrayLike(uint8), true);

        const uint8Clamped = new Uint8ClampedArray(16);
        assert.equal(isUint8ArrayLike(uint8Clamped), true);

        const int32 = new Int32Array(8);
        assert.equal(isUint8ArrayLike(int32), false);

        const uint8Like = {
            buffer: new ArrayBuffer(16),
            byteOffset: 0,
            byteLength: 16,
            BYTES_PER_ELEMENT: 1
        };
        assert.equal(isUint8ArrayLike(uint8Like), true);

        const int32Like = {
            buffer: new ArrayBuffer(16),
            byteOffset: 0,
            byteLength: 16,
            BYTES_PER_ELEMENT: 4
        };
        assert.equal(isUint8ArrayLike(int32Like), false);

        assert.equal(isUint8ArrayLike(new ArrayBuffer(16)), false);
        assert.equal(isUint8ArrayLike(null), false);
    });
});
