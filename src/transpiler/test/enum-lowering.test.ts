import { strictEqual } from "node:assert";
import { test } from "node:test";

import type { GmlNode } from "../src/emitter/ast.js";
import { lowerEnumDeclaration } from "../src/emitter/enum-lowering.js";

interface MockMember {
    name: string;
    initializer: string | number | null;
}

const mockResolveName = (member: MockMember): string => member.name;
const customResolver = (member: MockMember): string => `PREFIX_${member.name}`;
const visitNode = String;

void test("lowerEnumDeclaration folds auto-incremented enums into a plain object literal", () => {
    const result = lowerEnumDeclaration(
        "Colors",
        [
            { name: "RED", initializer: null },
            { name: "GREEN", initializer: null }
        ],
        visitNode,
        mockResolveName
    );

    strictEqual(result, "const Colors = { RED: 0, GREEN: 1 };");
});

void test("lowerEnumDeclaration handles auto-incremented values", () => {
    const result = lowerEnumDeclaration(
        "Status",
        [
            { name: "IDLE", initializer: null },
            { name: "WALKING", initializer: null },
            { name: "RUNNING", initializer: null }
        ],
        visitNode,
        mockResolveName
    );

    strictEqual(result, "const Status = { IDLE: 0, WALKING: 1, RUNNING: 2 };");
});

void test("lowerEnumDeclaration handles explicit numeric initializers", () => {
    const result = lowerEnumDeclaration(
        "Priority",
        [
            { name: "LOW", initializer: 1 },
            { name: "HIGH", initializer: 10 }
        ],
        visitNode,
        mockResolveName
    );

    strictEqual(result, "const Priority = { LOW: 1, HIGH: 10 };");
});

void test("lowerEnumDeclaration handles explicit string initializers", () => {
    const result = lowerEnumDeclaration(
        "Keys",
        [
            { name: "ENTER", initializer: "enter" },
            { name: "ESC", initializer: "escape" }
        ],
        visitNode,
        mockResolveName
    );

    strictEqual(result.includes("__value = enter;"), true);
    strictEqual(result.includes("__value = escape;"), true);
});

void test("lowerEnumDeclaration handles expression initializers", () => {
    const result = lowerEnumDeclaration(
        "Computed",
        [{ name: "TWO", initializer: { type: "BinaryExpression" } as unknown as GmlNode }],
        () => "(1 + 1)",
        mockResolveName
    );

    strictEqual(result.includes("__value = (1 + 1);"), true);
    strictEqual(result.includes("__enum.TWO = __value;"), true);
});

void test("lowerEnumDeclaration handles mixed auto and explicit values", () => {
    const result = lowerEnumDeclaration(
        "Mixed",
        [
            { name: "FIRST", initializer: null },
            { name: "SECOND", initializer: 10 },
            { name: "THIRD", initializer: null }
        ],
        visitNode,
        mockResolveName
    );

    strictEqual(result, "const Mixed = { FIRST: 0, SECOND: 10, THIRD: 11 };");
});

void test("lowerEnumDeclaration handles empty member list", () => {
    const result = lowerEnumDeclaration("Empty", [], visitNode, mockResolveName);

    strictEqual(result, "const Empty = {};");
});

void test("lowerEnumDeclaration preserves enum name", () => {
    const result = lowerEnumDeclaration(
        "MyCustomEnum",
        [{ name: "VALUE", initializer: null }],
        visitNode,
        mockResolveName
    );

    strictEqual(result, "const MyCustomEnum = { VALUE: 0 };");
});

void test("lowerEnumDeclaration uses custom resolver for member names", () => {
    const result = lowerEnumDeclaration("Test", [{ name: "ITEM", initializer: null }], visitNode, customResolver);

    strictEqual(result, "const Test = { PREFIX_ITEM: 0 };");
});

void test("lowerEnumDeclaration quotes enum members with non-identifier names", () => {
    const result = lowerEnumDeclaration(
        "SpecialKeys",
        [
            { name: "player-name", initializer: null },
            { name: "level 1", initializer: null }
        ],
        visitNode,
        mockResolveName
    );

    strictEqual(result, 'const SpecialKeys = { "player-name": 0, "level 1": 1 };');
});

void test("lowerEnumDeclaration falls back to the runtime IIFE for hex/binary literal initializers", () => {
    // "0xFF" and "0b1010" parse as finite numbers via Number(), so they still
    // fold to a constant object literal rather than falling back.
    const result = lowerEnumDeclaration(
        "Masks",
        [
            { name: "FLAG_A", initializer: "0xFF" },
            { name: "FLAG_B", initializer: "0b1010" }
        ],
        visitNode,
        mockResolveName
    );

    strictEqual(result, "const Masks = { FLAG_A: 255, FLAG_B: 10 };");
});

void test("lowerEnumDeclaration falls back to the runtime IIFE when a later member follows a non-numeric one", () => {
    const result = lowerEnumDeclaration(
        "Keys",
        [
            { name: "ENTER", initializer: "enter" },
            { name: "ESC", initializer: null }
        ],
        visitNode,
        mockResolveName
    );

    strictEqual(result.includes("const Keys = (() => {"), true);
    strictEqual(result.includes("__value = enter;"), true);
    strictEqual(result.includes("__value += 1;"), true);
});
