/**
 * Tests for the optimizeLogicalExpressionsTransform, focusing on the
 * `containsCallExpression` guard that prevents loop-condition hoisting when
 * the loop body has side-effectful function calls, on correct handling of
 * member-access paths of varying depth, and on the snapshot-based merge
 * semantics used by the redundant-temporary-return elimination pass.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { optimizeLogicalExpressionsTransform } from "../../src/rules/gml/transforms/logical-expression-optimize-logical-expressions.js";

/**
 * Returns a `VariableDeclaration` of the shape produced by the parser for
 * `var <name> = <init>`. Tests build top-level bodies that contain sequences
 * of these declarations followed by matching `ReturnStatement`s so the
 * redundant-temporary-return elimination pass can fold them together.
 */
function buildVariableDeclaration(name: string, initValue: string | number): any {
    return {
        type: "VariableDeclaration",
        declarations: [
            {
                type: "VariableDeclarator",
                id: { type: "Identifier", name },
                init: { type: "Literal", value: initValue }
            }
        ]
    };
}

/**
 * Returns a `ReturnStatement` of the shape produced by the parser for
 * `return <expression>`. The argument is left as a raw object so tests can
 * describe both identifiers (matching a temporary) and literals (non-matching)
 * with the same helper.
 */
function buildReturnStatement(argument: any): any {
    return { type: "ReturnStatement", argument };
}

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

void describe("optimizeLogicalExpressionsTransform – redundant temporary return elimination", () => {
    void it("folds a single `var x = …; return x;` pair into a single return", () => {
        const ast = {
            type: "Program",
            body: [buildVariableDeclaration("temp", "5"), buildReturnStatement({ type: "Identifier", name: "temp" })]
        };

        optimizeLogicalExpressionsTransform.transform(ast, {});

        assert.strictEqual(ast.body.length, 1, "the pair should collapse into a single ReturnStatement");
        assert.strictEqual(ast.body[0].type, "ReturnStatement");
        assert.strictEqual(ast.body[0].argument.type, "Literal");
        assert.strictEqual(ast.body[0].argument.value, "5");
    });

    void it("folds every adjacent `var x = …; return x;` pair in a chain", () => {
        // Regression for the in-place splice loop previously used by the
        // redundant-temporary-return elimination pass. The old implementation
        // relied on a forward index loop that spliced the merged pair back
        // into `statements` and then advanced with an explicit `continue` —
        // a coupling that silently skipped the second pair if the loop body
        // ever grew an unconditional `index += 1` after the splice. Three
        // adjacent pairs would expose that bug: after the first merge the
        // second pair would shift into the splice's removed slot and would
        // only be inspected at the wrong pair position. The snapshot-based
        // accumulator used by the current implementation inspects every
        // original pair position regardless of how many slots were absorbed,
        // so all three pairs collapse in a single pass.
        const ast = {
            type: "Program",
            body: [
                buildVariableDeclaration("a", "1"),
                buildReturnStatement({ type: "Identifier", name: "a" }),
                buildVariableDeclaration("b", "2"),
                buildReturnStatement({ type: "Identifier", name: "b" }),
                buildVariableDeclaration("c", "3"),
                buildReturnStatement({ type: "Identifier", name: "c" })
            ]
        };

        optimizeLogicalExpressionsTransform.transform(ast, {});

        assert.strictEqual(
            ast.body.length,
            3,
            "every adjacent pair should collapse; leftover declarations indicate the inspection index drifted"
        );
        for (const [index, entry] of ast.body.entries()) {
            assert.strictEqual(
                entry.type,
                "ReturnStatement",
                `body[${index}] should be a ReturnStatement after collapsing all three pairs`
            );
        }
        assert.strictEqual(ast.body[0].argument.value, "1");
        assert.strictEqual(ast.body[1].argument.value, "2");
        assert.strictEqual(ast.body[2].argument.value, "3");
    });

    void it("leaves non-adjacent pairs and non-matching shapes untouched", () => {
        // The accumulation loop must only collapse a (declaration, return)
        // pair when both nodes sit at the current snapshot position. Any
        // intervening statement breaks adjacency, and any return whose
        // argument is not the temporary that was just declared must survive
        // into the accumulator verbatim so callers can rely on a
        // deterministic pass-through.
        const unrelated = { type: "ExpressionStatement", expression: { type: "Identifier", name: "noop" } };
        const ast = {
            type: "Program",
            body: [
                buildVariableDeclaration("a", "1"),
                buildReturnStatement({ type: "Identifier", name: "a" }),
                unrelated,
                buildVariableDeclaration("b", "2"),
                buildReturnStatement({ type: "Literal", value: "non-temporary" })
            ]
        };

        optimizeLogicalExpressionsTransform.transform(ast, {});

        assert.strictEqual(ast.body.length, 4, "only the first adjacent pair collapses");
        assert.strictEqual(ast.body[0].type, "ReturnStatement", "first pair collapses to a ReturnStatement");
        assert.strictEqual(ast.body[0].argument.value, "1");
        assert.strictEqual(ast.body[1], unrelated, "the unrelated statement survives unchanged");
        assert.strictEqual(ast.body[2].type, "VariableDeclaration", "the non-adjacent declaration survives unchanged");
        assert.strictEqual(ast.body[3].type, "ReturnStatement", "the non-matching return survives unchanged");
    });

    void it("preserves the original array contents when no pair is eligible", () => {
        // The accumulation path replaces `statements` only when at least one
        // pair collapsed; otherwise it leaves the original array untouched
        // (including element identity) so callers downstream of the transform
        // can rely on reference-equality for the no-op case.
        const expr = { type: "ExpressionStatement", expression: { type: "Identifier", name: "noop" } };
        const ast = { type: "Program", body: [expr] };

        optimizeLogicalExpressionsTransform.transform(ast, {});

        assert.strictEqual(ast.body.length, 1);
        assert.strictEqual(ast.body[0], expr, "unchanged elements must keep their reference");
    });
});
