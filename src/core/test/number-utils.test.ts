import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    areNumbersApproximatelyEqual,
    clamp,
    isFiniteNumber,
    toNormalizedInteger,
    toNumber
} from "../src/utils/number.js";

void describe("number-utils", () => {
    void describe("isFiniteNumber", () => {
        void it("returns true for finite numbers", () => {
            assert.equal(isFiniteNumber(0), true);
            assert.equal(isFiniteNumber(42), true);
            assert.equal(isFiniteNumber(-13.5), true);
        });

        void it("returns false for non-number values", () => {
            assert.equal(isFiniteNumber(null), false);
            assert.equal(isFiniteNumber(), false);
            assert.equal(isFiniteNumber("10"), false);
            assert.equal(isFiniteNumber(Number.NaN), false);
            assert.equal(isFiniteNumber(Infinity), false);
            assert.equal(isFiniteNumber(-Infinity), false);
        });
    });

    void describe("toNumber", () => {
        void it("returns a finite number unchanged", () => {
            assert.equal(toNumber(0), 0);
            assert.equal(toNumber(42), 42);
            assert.equal(toNumber(-13.5), -13.5);
        });

        void it("returns null for non-number values", () => {
            assert.equal(toNumber(null), null);
            assert.equal(toNumber(undefined), null);
            assert.equal(toNumber("10"), null);
            // NaN, Infinity, -Infinity: typeof returns "number" per JS semantics,
            // so toNumber preserves them (consistent with existing call sites
            // that use `typeof x === "number" ? x : null`).
            assert.equal(toNumber(Number.NaN), Number.NaN);
            assert.equal(toNumber(Infinity), Infinity);
            assert.equal(toNumber(-Infinity), -Infinity);
        });
    });

    void describe("toNormalizedInteger", () => {
        void it("returns truncated integers for finite numbers", () => {
            assert.equal(toNormalizedInteger(10), 10);
            assert.equal(toNormalizedInteger(3.9), 3);
            assert.equal(toNormalizedInteger(-2.4), -2);
            assert.equal(toNormalizedInteger(-0.5), 0);
        });

        void it("returns null for non-finite inputs", () => {
            assert.equal(toNormalizedInteger(Number.NaN), null);
            assert.equal(toNormalizedInteger(Infinity), null);
            assert.equal(toNormalizedInteger(-Infinity), null);
            assert.equal(toNormalizedInteger("10"), null);
            assert.equal(toNormalizedInteger(), null);
        });
    });

    void describe("clamp", () => {
        void it("returns value unchanged when within range", () => {
            assert.equal(clamp(5, 0, 10), 5);
            assert.equal(clamp(0, 0, 10), 0);
            assert.equal(clamp(10, 0, 10), 10);
        });

        void it("returns min when value is below range", () => {
            assert.equal(clamp(-5, 0, 10), 0);
            assert.equal(clamp(-1, 0, 100), 0);
        });

        void it("returns max when value is above range", () => {
            assert.equal(clamp(15, 0, 10), 10);
            assert.equal(clamp(200, 0, 100), 100);
        });

        void it("works with negative ranges", () => {
            assert.equal(clamp(-3, -5, -1), -3);
            assert.equal(clamp(0, -5, -1), -1);
            assert.equal(clamp(-10, -5, -1), -5);
        });
    });

    void describe("areNumbersApproximatelyEqual", () => {
        void it("treats values within the tolerance window as equal", () => {
            const delta = Number.EPSILON * 3;

            assert.equal(areNumbersApproximatelyEqual(1, 1 + delta), true);
            assert.equal(areNumbersApproximatelyEqual(0, delta), true);
        });

        void it("treats values outside the tolerance window as different", () => {
            const delta = Number.EPSILON * 6;

            assert.equal(areNumbersApproximatelyEqual(1, 1 + delta), false);
            assert.equal(areNumbersApproximatelyEqual(0, delta), false);
        });

        void it("never matches non-finite numbers", () => {
            assert.equal(areNumbersApproximatelyEqual(Number.NaN, 1), false);
            assert.equal(areNumbersApproximatelyEqual(1, Infinity), false);
            assert.equal(areNumbersApproximatelyEqual(-Infinity, Infinity), false);
        });
    });
});
