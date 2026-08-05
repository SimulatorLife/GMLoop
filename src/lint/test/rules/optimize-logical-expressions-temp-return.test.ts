/**
 * Tests for the `eliminateRedundantTemporaryReturns` pass that runs as part
 * of `optimizeLogicalExpressionsTransform`.
 *
 * The pass rewrites the pattern
 *   `var temp = <expr>; return temp;`
 * into
 *   `return <expr>;`
 * for adjacent sibling statements.  The original implementation iterated
 * the body with a forward index loop that called `statements.splice(index,
 * 2, replacement)` whenever a pair matched.  Although that shape happened
 * to be correct — the replacement is a `ReturnStatement`, which never pairs
 * with a shifted sibling — the loop relied on that implicit invariant.  A
 * future change to the replacement shape (e.g. a `BinaryExpression` return
 * value) could silently drop a sibling.  The rewrite below walks a stable
 * snapshot and only mutates `statements` once, after iteration completes.
 *
 * These tests pin the behaviour of the snapshot-based rewrite:
 *   - Adjacent pairs collapse into a single return.
 *   - Multiple consecutive pairs all collapse, including pairs separated by
 *     unrelated statements.
 *   - The transformation never calls `splice` while iterating the body.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { optimizeLogicalExpressionsTransform } from "../../src/rules/gml/transforms/logical-expression-optimize-logical-expressions.js";

type AnyRecord = Record<string, unknown>;

/**
 * Build a `var <name> = <initializer>; return <name>;` pair as two
 * independent sibling nodes.  Keeping them as loose literals (rather than
 * sharing references) makes the assertions about which slots are rewritten
 * easier to follow.
 */
function buildTempReturnPair(name: string, initializer: AnyRecord): [AnyRecord, AnyRecord] {
    return [
        {
            type: "VariableDeclaration",
            kind: "var",
            declarations: [
                {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name },
                    init: initializer
                }
            ]
        },
        {
            type: "ReturnStatement",
            argument: { type: "Identifier", name }
        }
    ];
}

function buildExpressionStatement(name: string): AnyRecord {
    return {
        type: "ExpressionStatement",
        expression: { type: "Identifier", name }
    };
}

void describe("eliminateRedundantTemporaryReturns", () => {
    void it("collapses an adjacent temp+return pair into a single return", () => {
        const [declaration, returnStatement] = buildTempReturnPair("stats", {
            type: "Literal",
            value: "{ hp: 100 }"
        });
        const ast: AnyRecord = {
            type: "Program",
            body: [declaration, returnStatement]
        };

        optimizeLogicalExpressionsTransform.transform(ast, {});

        const body = ast.body as Array<AnyRecord>;
        assert.equal(body.length, 1, "the two-statement pair should collapse into one");
        assert.equal(body[0]?.type, "ReturnStatement");
        assert.equal(
            (body[0] as { argument?: { value?: string } })?.argument?.value,
            "{ hp: 100 }",
            "the rewritten return should carry the original initializer"
        );
    });

    void it("collapses every adjacent pair, including ones that follow unrelated statements", () => {
        const [firstDecl, firstReturn] = buildTempReturnPair("first", { type: "Literal", value: "1" });
        const [secondDecl, secondReturn] = buildTempReturnPair("second", { type: "Literal", value: "2" });
        const [thirdDecl, thirdReturn] = buildTempReturnPair("third", { type: "Literal", value: "3" });

        // Two unrelated ExpressionStatements sit between the first and second
        // pairs, and one between the second and third.  All three pairs must
        // collapse even though the splicing pattern would have relied on the
        // forward index loop visiting every pair position regardless of the
        // earlier mutations.
        const ast: AnyRecord = {
            type: "Program",
            body: [
                firstDecl,
                firstReturn,
                buildExpressionStatement("no_match_one"),
                buildExpressionStatement("no_match_two"),
                secondDecl,
                secondReturn,
                buildExpressionStatement("no_match_three"),
                thirdDecl,
                thirdReturn
            ]
        };

        optimizeLogicalExpressionsTransform.transform(ast, {});

        const body = ast.body as Array<AnyRecord>;
        assert.equal(
            body.length,
            6,
            `expected three pairs to collapse, leaving six statements (3 replacements + 3 unrelated); got ${body.length}`
        );
        // Every third slot should now be the rewritten return from the
        // original pair's initializer, and every other rewritten slot should
        // carry an unrelated expression statement.
        assert.equal(body[0]?.type, "ReturnStatement");
        assert.equal((body[0] as { argument?: { value?: string } })?.argument?.value, "1");
        assert.equal((body[1] as { expression?: { name?: string } })?.expression?.name, "no_match_one");
        assert.equal((body[2] as { expression?: { name?: string } })?.expression?.name, "no_match_two");
        assert.equal(body[3]?.type, "ReturnStatement");
        assert.equal((body[3] as { argument?: { value?: string } })?.argument?.value, "2");
        assert.equal((body[4] as { expression?: { name?: string } })?.expression?.name, "no_match_three");
        assert.equal(body[5]?.type, "ReturnStatement");
        assert.equal((body[5] as { argument?: { value?: string } })?.argument?.value, "3");
    });

    void it("does not collapse when the returned identifier does not match the declared name", () => {
        const ast: AnyRecord = {
            type: "Program",
            body: [
                {
                    type: "VariableDeclaration",
                    kind: "var",
                    declarations: [
                        {
                            type: "VariableDeclarator",
                            id: { type: "Identifier", name: "stats" },
                            init: { type: "Literal", value: "1" }
                        }
                    ]
                },
                {
                    type: "ReturnStatement",
                    argument: { type: "Identifier", name: "other" }
                }
            ]
        };

        optimizeLogicalExpressionsTransform.transform(ast, {});

        const body = ast.body as Array<AnyRecord>;
        assert.equal(body.length, 2, "non-matching pair must be left intact");
        assert.equal(body[0]?.type, "VariableDeclaration");
        assert.equal(body[1]?.type, "ReturnStatement");
    });

    void it("collapses pairs across multiple sibling blocks (top-level body and inner BlockStatement)", () => {
        // The pass recursively descends into nested BlockStatements, so the
        // snapshot-rewrite pattern must apply at every recursion level.
        // Construct an outer body that contains a BlockStatement whose own
        // body holds two consecutive temp+return pairs.  Both inner pairs
        // must collapse.
        const [innerDecl, innerReturn] = buildTempReturnPair("inner", { type: "Literal", value: "99" });

        const ast: AnyRecord = {
            type: "Program",
            body: [
                {
                    type: "BlockStatement",
                    body: [
                        innerDecl,
                        innerReturn,
                        ...buildTempReturnPair("innerSecond", { type: "Literal", value: "100" })
                    ]
                }
            ]
        };

        optimizeLogicalExpressionsTransform.transform(ast, {});

        const outerBody = ast.body as Array<AnyRecord>;
        const block = outerBody[0] as { body?: Array<AnyRecord> };
        assert.ok(Array.isArray(block?.body), "outer block should still be a BlockStatement");
        const innerBody = block.body;
        assert.equal(
            innerBody.length,
            2,
            `expected the two inner pairs to collapse, leaving two returns; got ${innerBody.length}`
        );
        assert.equal(innerBody[0]?.type, "ReturnStatement");
        assert.equal(innerBody[1]?.type, "ReturnStatement");
        assert.equal((innerBody[0] as { argument?: { value?: string } })?.argument?.value, "99");
        assert.equal((innerBody[1] as { argument?: { value?: string } })?.argument?.value, "100");
    });

    void it("never invokes splice on the body while the body is being processed", () => {
        // The original implementation called `statements.splice(index, 2,
        // replacement)` inside the forward index loop.  Even though that
        // splice happened to be safe (the replacement is a ReturnStatement
        // that never forms a valid pair with the shifted sibling), the
        // invariant is easy to break in a future refactor.  This test wraps
        // the top-level body in a Proxy that throws whenever `splice` is
        // invoked, and verifies the rewritten helper passes without any
        // splice call.  The Proxy only intercepts calls that originate from
        // the function body itself; `statements.slice()` reads the existing
        // elements and `statements.push(...)` (called after the loop has
        // completed) only triggers the trap if the function still re-enters
        // the loop while splicing, which is exactly the regression we want
        // to catch.
        const statements: Array<AnyRecord> = [
            ...buildTempReturnPair("first", { type: "Literal", value: "1" }),
            ...buildTempReturnPair("second", { type: "Literal", value: "2" }),
            ...buildTempReturnPair("third", { type: "Literal", value: "3" })
        ];
        const spliceCalls: Array<unknown[]> = [];

        const proxiedStatements = new Proxy(statements, {
            get(target, prop, receiver) {
                if (prop === "splice") {
                    return function proxiedSplice(...args: unknown[]): unknown[] {
                        spliceCalls.push(args);
                        // Return early so the function still observes the
                        // splice contract — but the test will fail because
                        // `spliceCalls` is now non-empty.
                        return Reflect.apply(Array.prototype.splice, target, args);
                    };
                }
                return Reflect.get(target, prop, receiver);
            }
        });

        const ast: AnyRecord = { type: "Program", body: proxiedStatements };
        optimizeLogicalExpressionsTransform.transform(ast, {});

        assert.equal(
            spliceCalls.length,
            0,
            `splice() must not be called on the body during the rewrite, but it was invoked ${spliceCalls.length} time(s)`
        );
        // The rewritten body should still contain the three collapsed
        // returns (proving the helper ran to completion via slice + push,
        // not via splice).
        const body = (ast as { body: Array<AnyRecord> }).body;
        assert.equal(body.length, 3);
        assert.equal(body[0]?.type, "ReturnStatement");
        assert.equal(body[1]?.type, "ReturnStatement");
        assert.equal(body[2]?.type, "ReturnStatement");
    });
});
