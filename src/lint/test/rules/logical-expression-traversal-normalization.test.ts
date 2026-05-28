import assert from "node:assert/strict";
import { test } from "node:test";

import { type MutableGameMakerAstNode } from "@gmloop/core";

import { applyLogicalNormalizationWithChangeMetadata } from "../../src/rules/gml/transforms/logical-expression-traversal-normalization.js";

type MutableRecord = Record<string, unknown>;

void test("simplifyStatementList: splicing during iteration skips the next element", () => {
    // This test exposes a bug where `body.splice(i + 1, 1)` mutates the array
    // during the for-loop, causing the loop index `i` to no longer point at the
    // intended next element after a replacement.  The loop advances `i` by 1
    // unconditionally, so when splice shortens the array by 1 the element that
    // was originally at index i+2 ends up at index i+1 and never gets visited.
    //
    // We construct a body of three IfStatements where the first two match the
    // `if (cond) { return true; } return false;` pattern.  After collapsing
    // statements[0] and statements[1] into a single ternary, statements[1] is
    // removed from the array, and the loop advances to i=1.  At that point
    // the array has length 2 and body[1] is the original third element (which
    // we name thirdIf to make it easy to track).  Because i is no longer <
    // body.length - 1, the third IfStatement is never examined.  The bug
    // therefore manifests as: body.length == 2 and body[1] === secondIf.
    // The fix (iterating over a stable snapshot and using reverse splice) keeps
    // body.length == 3 and body[2] === thirdIf.

    // In GML, booleans are Literal nodes with string values "true"/"false".
    // (There is no separate BooleanLiteral node type.)
    const makeBooleanReturnPattern = (id: string, cond: string) => {
        const innerBlock = {
            type: "BlockStatement",
            body: [{ type: "ReturnStatement", argument: { type: "Literal", value: "true" } }]
        };
        const outerIf = { type: "IfStatement", test: { type: "Identifier", name: cond }, consequent: innerBlock };
        const returnFalse = { type: "ReturnStatement", argument: { type: "Literal", value: "false" } };
        return { id, ifNode: outerIf, returnFalse };
    };

    const first = makeBooleanReturnPattern("first", "cond1");
    const second = makeBooleanReturnPattern("second", "cond2");
    const third = makeBooleanReturnPattern("third", "cond3");

    const body: Array<MutableRecord> = [
        first.ifNode,
        first.returnFalse,
        second.ifNode,
        second.returnFalse,
        third.ifNode,
        third.returnFalse
    ];

    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    assert.equal(Array.isArray(ast.body), true);
    const normalizedBody = ast.body as Array<MutableRecord>;

    // After the fix, all three pairs should be collapsed.
    // Without the fix (bug), only the first two pairs are visited, leaving
    // the third pair intact in the output.
    assert.equal(
        normalizedBody.length,
        3,
        `Expected 3 ternary returns but got ${normalizedBody.length}; at least one pair was not visited`
    );

    assert.equal(
        normalizedBody[2]?.type,
        "ReturnStatement",
        "Third pair was not visited; element at index 2 should be a ReturnStatement"
    );
});

void test("logical normalization traverses array entries from a stable snapshot when siblings mutate the list", () => {
    const doubleNegationNode: MutableRecord = {
        type: "UnaryExpression",
        operator: "!",
        argument: {
            type: "UnaryExpression",
            operator: "!",
            argument: {
                type: "Identifier",
                name: "flag"
            }
        }
    };

    const body: Array<MutableRecord> = [];

    const mutatingNode: MutableRecord = {
        type: "SyntheticMutationNode",
        get trigger(): null {
            body.splice(0, 1);
            return null;
        }
    };

    body.push(mutatingNode, doubleNegationNode);

    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body
    };

    const result = applyLogicalNormalizationWithChangeMetadata(ast);

    assert.equal(result.changed, true);
    assert.equal(Array.isArray(ast.body), true);

    const normalizedBody = ast.body as Array<MutableRecord>;
    assert.equal(normalizedBody.length, 1);
    assert.equal(normalizedBody[0]?.type, "Identifier");
    assert.equal((normalizedBody[0] as { name?: string }).name, "flag");
});

void test("logical normalization handles reused IfStatement references without skipping later siblings", () => {
    const sharedIfNode: MutableRecord = {
        type: "IfStatement",
        test: {
            type: "Identifier",
            name: "shared_condition"
        },
        consequent: {
            type: "BlockStatement",
            body: [
                {
                    type: "ReturnStatement",
                    argument: {
                        type: "Literal",
                        value: "true"
                    }
                }
            ]
        }
    };

    const body: Array<MutableRecord> = [
        sharedIfNode,
        {
            type: "ExpressionStatement",
            expression: {
                type: "Literal",
                value: "noop"
            }
        },
        sharedIfNode,
        {
            type: "ReturnStatement",
            argument: {
                type: "Literal",
                value: "false"
            }
        }
    ];

    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    assert.equal(Array.isArray(ast.body), true);
    const normalizedBody = ast.body as Array<MutableRecord>;

    assert.equal(
        normalizedBody[2]?.type,
        "ReturnStatement",
        "Expected the later repeated IfStatement reference to still be simplified with its trailing return"
    );
    assert.equal((normalizedBody[2]?.argument as { name?: string })?.name, "shared_condition");
});

void test("unwrapBlock returns node intact when consequent is null (guarded against TypeError)", () => {
    // Regression: prior to the fix, if node.consequent was null, accessing
    // node.body on it threw "TypeError: Cannot read properties of null (reading 'length')".
    // The guard `node && node.type === "BlockStatement" && Array.isArray(node.body)`
    // makes unwrapBlock return the node as-is for null / undefined / non-object inputs.
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [
            {
                type: "IfStatement",
                test: { type: "Identifier", name: "x" },
                consequent: null as unknown,
                alternate: null
            }
        ]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const normalizedBody = ast.body as Array<MutableRecord>;
    assert.equal(normalizedBody.length, 1);
    assert.equal(normalizedBody[0]?.type, "IfStatement");
});

void test("unwrapBlock handles undefined consequent without throwing", () => {
    // Same guard applies when consequent is undefined rather than null.
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [
            {
                type: "IfStatement",
                test: { type: "Identifier", name: "y" },
                consequent: undefined as unknown,
                alternate: null
            }
        ]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const normalizedBody = ast.body as Array<MutableRecord>;
    assert.equal(normalizedBody.length, 1);
    assert.equal(normalizedBody[0]?.type, "IfStatement");
});

void test("unwrapBlock guards consequent in simplifyIfStatement else-if path", () => {
    // simplifyIfStatement: consequent=null, alternate valid — alternate guard
    // in `node.alternate ? unwrapBlock(node.alternate) : null` is safe.  But
    // `consequent && consequent.type` guard on line 242 guards against null.
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [
            {
                type: "IfStatement",
                test: { type: "Identifier", name: "z" },
                consequent: null as unknown,
                alternate: { type: "ReturnStatement", argument: { type: "Literal", value: "false" } }
            }
        ]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const normalizedBody = ast.body as Array<MutableRecord>;
    assert.equal(normalizedBody.length, 1);
    assert.equal(normalizedBody[0]?.type, "IfStatement");
});

void test("simplifyStatementList guards unwrapBlock(current.consequent) with consequent check", () => {
    // The simplifyStatementList path: current.consequent is null, so unwrapBlock
    // should return null.  The subsequent `consequent && consequent.type === "ReturnStatement"`
    // guard prevents TypeError on consequent.type.
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [
            {
                type: "IfStatement",
                test: { type: "Identifier", name: "cond" },
                consequent: null as unknown,
                alternate: null
            },
            {
                type: "ReturnStatement",
                argument: { type: "Literal", value: "false" }
            }
        ]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const normalizedBody = ast.body as Array<MutableRecord>;
    assert.equal(normalizedBody.length, 2);
    assert.equal(normalizedBody[0]?.type, "IfStatement");
    assert.equal(normalizedBody[1]?.type, "ReturnStatement");
});
