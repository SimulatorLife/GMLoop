/**
 * Tests for the optimizeLogicalExpressionsTransform, focusing on the
 * `containsCallExpression` guard that prevents loop-condition hoisting when
 * the loop body has side-effectful function calls, and on correct handling of
 * member-access paths of varying depth.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { optimizeLogicalExpressionsTransform } from "../../src/rules/gml/transforms/logical-expression-optimize-logical-expressions.js";

/**
 * Returns a minimal WhileStatement AST whose condition is `a.b.length > 0`
 * (three-segment member access) wrapped in a Program node so the transform
 * can reach the top-level body array.
 */
function buildWhileAst(bodyStatements: unknown[]): any {
    return {
        type: "Program",
        body: [
            {
                type: "WhileStatement",
                test: {
                    type: "BinaryExpression",
                    operator: ">",
                    left: {
                        type: "MemberDotExpression",
                        object: {
                            type: "MemberDotExpression",
                            object: { type: "Identifier", name: "a" },
                            property: { type: "Identifier", name: "b" }
                        },
                        property: { type: "Identifier", name: "length" }
                    },
                    right: { type: "Literal", value: "0" }
                },
                body: {
                    type: "BlockStatement",
                    body: bodyStatements
                }
            }
        ]
    };
}

/**
 * Returns a minimal WhileStatement AST whose condition is `arr.length > 0`
 * (two-segment member access) wrapped in a Program node.
 *
 * Under the original implementation this path was silently rejected because
 * `isCollectibleMemberAccessNode` required ≥ 3 segments.  The generalised
 * version must hoist it identically to the three-segment case.
 */
function buildTwoSegmentWhileAst(bodyStatements: unknown[]): any {
    return {
        type: "Program",
        body: [
            {
                type: "WhileStatement",
                test: {
                    type: "BinaryExpression",
                    operator: ">",
                    left: {
                        type: "MemberDotExpression",
                        object: { type: "Identifier", name: "arr" },
                        property: { type: "Identifier", name: "length" }
                    },
                    right: { type: "Literal", value: "0" }
                },
                body: {
                    type: "BlockStatement",
                    body: bodyStatements
                }
            }
        ]
    };
}

void describe("optimizeLogicalExpressionsTransform – invariant loop-condition hoisting", () => {
    void it("does NOT hoist when the loop body contains a CallExpression", () => {
        const ast = buildWhileAst([
            {
                type: "ExpressionStatement",
                expression: {
                    // A call expression in the body means the member access
                    // might be invalidated by the call – hoisting is unsafe.
                    type: "CallExpression",
                    object: { type: "Identifier", name: "array_push" },
                    arguments: []
                }
            }
        ]);

        optimizeLogicalExpressionsTransform.transform(ast, {});

        // Body should still contain only the original WhileStatement – no
        // hoisted variable declaration was prepended.
        assert.strictEqual(ast.body.length, 1, "no declaration should be inserted before the loop");
        assert.strictEqual(ast.body[0].type, "WhileStatement");
        // The condition should remain unchanged.
        assert.strictEqual(ast.body[0].test.type, "BinaryExpression");
        assert.strictEqual(ast.body[0].test.left.type, "MemberDotExpression");
    });

    void it("DOES hoist the invariant member access when the loop body has no calls", () => {
        const ast = buildWhileAst([
            {
                type: "ExpressionStatement",
                expression: {
                    // A plain assignment – no call expression, so hoisting is safe.
                    type: "AssignmentExpression",
                    operator: "=",
                    left: { type: "Identifier", name: "x" },
                    right: { type: "Literal", value: "1" }
                }
            }
        ]);

        optimizeLogicalExpressionsTransform.transform(ast, {});

        // A hoisted var declaration should have been prepended before the loop.
        assert.strictEqual(ast.body.length, 2, "a hoisted declaration should precede the loop");
        assert.strictEqual(ast.body[0].type, "VariableDeclaration");
        assert.strictEqual(ast.body[1].type, "WhileStatement");
        // The loop condition should now reference the cached identifier, not the member chain.
        assert.strictEqual(ast.body[1].test.left.type, "Identifier");
    });

    void it("DOES hoist a two-segment invariant member access (arr.length) when the loop body has no calls", () => {
        // This test would have FAILED under the original implementation because
        // `isCollectibleMemberAccessNode` required memberPath.split(".").length >= 3,
        // and `recreateMemberPathExpression` returned null for paths with fewer
        // than 3 segments.  Both guards were overly restrictive: a two-segment
        // MemberDotExpression (e.g. `arr.length`) is a perfectly valid candidate
        // for invariant-condition hoisting.
        const ast = buildTwoSegmentWhileAst([
            {
                type: "ExpressionStatement",
                expression: {
                    type: "AssignmentExpression",
                    operator: "=",
                    left: { type: "Identifier", name: "x" },
                    right: { type: "Literal", value: "1" }
                }
            }
        ]);

        optimizeLogicalExpressionsTransform.transform(ast, {});

        // The two-segment `arr.length` must be hoisted just like `a.b.length`.
        assert.strictEqual(ast.body.length, 2, "a hoisted declaration should precede the loop");
        assert.strictEqual(ast.body[0].type, "VariableDeclaration");
        assert.strictEqual(ast.body[1].type, "WhileStatement");
        // The loop condition should reference the cached identifier.
        assert.strictEqual(ast.body[1].test.left.type, "Identifier");
    });
});
