import test from "node:test";

import { printExpression } from "../src/contracts/autofix-printing.js";
import { assertEquals } from "./assertions.js";

void test("printExpression renders MemberIndexExpression using index nodes", () => {
    const rendered = printExpression(
        {
            type: "MemberIndexExpression",
            object: { type: "Identifier", name: "arr" },
            index: { type: "Identifier", name: "i" }
        },
        ""
    );

    assertEquals(rendered, "arr[i]");
});

void test("printExpression falls back to property nodes for MemberIndexExpression", () => {
    const rendered = printExpression(
        {
            type: "MemberIndexExpression",
            object: { type: "Identifier", name: "arr" },
            property: { type: "Identifier", name: "j" }
        },
        ""
    );

    assertEquals(rendered, "arr[j]");
});

void test("printExpression renders parser-style property arrays for MemberIndexExpression", () => {
    const rendered = printExpression(
        {
            type: "MemberIndexExpression",
            object: { type: "Identifier", name: "arr" },
            property: [{ type: "Identifier", name: "k" }]
        },
        ""
    );

    assertEquals(rendered, "arr[k]");
});

void test("printExpression preserves parser member accessors for MemberIndexExpression", () => {
    const rendered = printExpression(
        {
            type: "MemberIndexExpression",
            object: { type: "Identifier", name: "_player_verb_struct" },
            property: [
                {
                    type: "MemberIndexExpression",
                    object: { type: "Identifier", name: "_verb_array" },
                    property: [{ type: "Identifier", name: "_i" }]
                }
            ],
            accessor: "[$"
        },
        ""
    );

    assertEquals(rendered, "_player_verb_struct[$_verb_array[_i]]");
});

void test("printExpression parenthesizes nested ternary branches", () => {
    const rendered = printExpression(
        {
            type: "ConditionalExpression",
            test: { type: "Identifier", name: "outer" },
            consequent: {
                type: "ConditionalExpression",
                test: { type: "Identifier", name: "leftCondition" },
                consequent: { type: "Identifier", name: "leftValue" },
                alternate: { type: "Identifier", name: "leftFallback" }
            },
            alternate: {
                type: "ConditionalExpression",
                test: { type: "Identifier", name: "rightCondition" },
                consequent: { type: "Identifier", name: "rightValue" },
                alternate: { type: "Identifier", name: "rightFallback" }
            }
        },
        ""
    );

    assertEquals(
        rendered,
        "outer ? (leftCondition ? leftValue : leftFallback) : (rightCondition ? rightValue : rightFallback)"
    );
});
