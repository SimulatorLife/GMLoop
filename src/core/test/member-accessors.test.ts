import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../index.js";
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

void describe("Core.resolveNodeName", () => {
    void it("returns the name of a well-formed IdentifierNode", () => {
        assert.equal(Core.resolveNodeName({ type: "Identifier", name: "score" }), "score");
    });

    void it("returns the name from a VariableDeclarator id", () => {
        const declarator = { type: "VariableDeclarator", id: { type: "Identifier", name: "x" }, init: null };
        assert.equal(Core.resolveNodeName(declarator.id), "x");
    });

    void it("returns the name from a MemberDotExpression property", () => {
        const member = {
            type: "MemberDotExpression",
            object: { type: "Identifier", name: "self" },
            property: { type: "Identifier", name: "hp" }
        };
        assert.equal(Core.resolveNodeName(member.property), "hp");
    });

    void it("returns the name from a MemberDotExpression object", () => {
        const member = {
            type: "MemberDotExpression",
            object: { type: "Identifier", name: "self" },
            property: { type: "Identifier", name: "hp" }
        };
        assert.equal(Core.resolveNodeName(member.object), "self");
    });

    void it("returns the name from a NewExpression expression", () => {
        const newExpression = { type: "NewExpression", expression: { type: "Identifier", name: "Player" } };
        assert.equal(Core.resolveNodeName(newExpression.expression), "Player");
    });

    void it("returns the name from a FunctionDeclaration id", () => {
        const fn = { type: "FunctionDeclaration", id: { type: "Identifier", name: "build" } };
        assert.equal(Core.resolveNodeName(fn.id), "build");
    });

    void it("returns the name from a DefaultParameter left", () => {
        const def = { type: "DefaultParameter", left: { type: "Identifier", name: "count" } };
        assert.equal(Core.resolveNodeName(def.left), "count");
    });

    void it("falls through to the object's name field for non-Identifier shapes", () => {
        assert.equal(Core.resolveNodeName({ type: "MemberDotExpression", name: "fake" }), "fake");
        assert.equal(Core.resolveNodeName({ type: "Literal", value: "score" }), null);
    });

    void it("returns null when an IdentifierNode has a non-string name", () => {
        const integerNamed: Record<string, unknown> = { type: "Identifier", name: 42 };
        const nullNamed: Record<string, unknown> = { type: "Identifier", name: null };
        const undefinedNamed: Record<string, unknown> = { type: "Identifier", name: undefined };
        assert.equal(Core.resolveNodeName(integerNamed as Parameters<typeof Core.resolveNodeName>[0]), null);
        assert.equal(Core.resolveNodeName(nullNamed as Parameters<typeof Core.resolveNodeName>[0]), null);
        assert.equal(Core.resolveNodeName(undefinedNamed as Parameters<typeof Core.resolveNodeName>[0]), null);
    });

    void it("returns null for null and undefined", () => {
        assert.equal(Core.resolveNodeName(null), null);
        assert.equal(Core.resolveNodeName(undefined), null);
    });

    void it("returns the name from objects missing the type field", () => {
        assert.equal(Core.resolveNodeName({ name: "score" }), "score");
    });
});
