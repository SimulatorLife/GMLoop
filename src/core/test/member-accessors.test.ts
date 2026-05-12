import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isMemberAccessor,
    MEMBER_ACCESSOR_ARRAY,
    MEMBER_ACCESSOR_GRID,
    MEMBER_ACCESSOR_LIST,
    MEMBER_ACCESSOR_MAP,
    MEMBER_ACCESSOR_PRIORITY_QUEUE,
    MEMBER_ACCESSOR_STACK,
    MEMBER_ACCESSOR_VALUES,
    MEMBER_INDEX_ACCESSORS
} from "../src/ast/member-accessors.js";

void describe("member-accessors", () => {
    void describe("isMemberAccessor", () => {
        void it("returns true for every canonical accessor", () => {
            assert.strictEqual(isMemberAccessor(MEMBER_ACCESSOR_ARRAY), true);
            assert.strictEqual(isMemberAccessor(MEMBER_ACCESSOR_GRID), true);
            assert.strictEqual(isMemberAccessor(MEMBER_ACCESSOR_MAP), true);
            assert.strictEqual(isMemberAccessor(MEMBER_ACCESSOR_LIST), true);
            assert.strictEqual(isMemberAccessor(MEMBER_ACCESSOR_STACK), true);
            assert.strictEqual(isMemberAccessor(MEMBER_ACCESSOR_PRIORITY_QUEUE), true);
        });

        void it("returns false for invalid strings", () => {
            assert.strictEqual(isMemberAccessor("[invalid]"), false);
            assert.strictEqual(isMemberAccessor(""), false);
            assert.strictEqual(isMemberAccessor("ARRAY"), false);
        });

        void it("returns false for non-string inputs", () => {
            assert.strictEqual(isMemberAccessor(null), false);
            assert.strictEqual(isMemberAccessor(undefined), false);
            assert.strictEqual(isMemberAccessor(42), false);
            assert.strictEqual(isMemberAccessor({}), false);
        });
    });

    void describe("MEMBER_INDEX_ACCESSORS", () => {
        void it("contains exactly six accessors", () => {
            assert.strictEqual(MEMBER_INDEX_ACCESSORS.size, 6);
        });

        void it("has all canonical values as members", () => {
            for (const value of MEMBER_ACCESSOR_VALUES) {
                assert.strictEqual(MEMBER_INDEX_ACCESSORS.has(value), true);
            }
        });

        void it("rejects a spurious accessor string", () => {
            assert.strictEqual(MEMBER_INDEX_ACCESSORS.has("[!" as never), false);
        });
    });

    void describe("MEMBER_ACCESSOR_VALUES", () => {
        void it("has six entries in the expected order", () => {
            assert.strictEqual(MEMBER_ACCESSOR_VALUES.length, 6);
            assert.strictEqual(MEMBER_ACCESSOR_VALUES[0], "[");
            assert.strictEqual(MEMBER_ACCESSOR_VALUES[1], "[#");
            assert.strictEqual(MEMBER_ACCESSOR_VALUES[2], "[?");
            assert.strictEqual(MEMBER_ACCESSOR_VALUES[3], "[|");
            assert.strictEqual(MEMBER_ACCESSOR_VALUES[4], "[@");
            assert.strictEqual(MEMBER_ACCESSOR_VALUES[5], "[$");
        });

        void it("is immutable (Object.freeze)", () => {
            assert.throws(() => {
                (MEMBER_ACCESSOR_VALUES as unknown as string[]).push("[X]");
            }, /(?:cannot|Cannot|Attempt to).*(?:mutate|modify|assign|add|delete)|Assignment to constant|cannot add a property/i);
        });
    });
});
