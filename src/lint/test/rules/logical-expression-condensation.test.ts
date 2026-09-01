/**
 * Tests for the logical-expression-condensation transform.
 *
 * These tests focus on the loop-mutability hazard in `condenseWithinStatements`:
 * both `tryExtractEarlyExitGuardClause` and `tryCondenseIfStatement` rewrite
 * the array slot at the current index (splicing in N+1 items, or replacing
 * in place), so the traversal must not advance past the rewritten slot on
 * success. The original implementation relied on `for (...; index++)` with a
 * bare `continue` after the splice, which silently skipped the freshly
 * inserted element because the unconditional `index++` stepped over it on the
 * next iteration. The fixed implementation drives the index manually and
 * re-enters the same slot when a rewrite occurs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyLogicalExpressionCondensation } from "../../src/rules/gml/transforms/logical-expression-condensation.js";

type AnyRecord = Record<string, unknown>;

function makeEarlyExitReturn(): AnyRecord {
    // `return;` with no argument — the canonical early-exit shape that
    // `extractEarlyExitStatement` accepts.
    return { type: "ReturnStatement" };
}

function makeIfElseGuardExtractable(): AnyRecord {
    return {
        type: "IfStatement",
        test: { type: "Identifier", name: "ready" },
        consequent: {
            type: "BlockStatement",
            body: [
                { type: "ExpressionStatement", expression: { type: "Identifier", name: "side_effect_one" } },
                { type: "ExpressionStatement", expression: { type: "Identifier", name: "side_effect_two" } }
            ]
        },
        alternate: makeEarlyExitReturn()
    };
}

void test("condenseWithinStatements re-evaluates the slot filled by an extracted guard clause", () => {
    // The original loop had `for (let i = 0; i < length; i++)` with a `continue`
    // after `splice`, so the freshly inserted guardIf at the original index was
    // never re-visited. The test pins the structural contract: the new
    // guardIf lives at the original index, the inlined consequent statements
    // follow, and the function still walks through the rest of the body so a
    // trailing condensable IfStatement is processed. A regression that lets
    // the loop skip the rewritten slot would either leave the guardIf in the
    // wrong position or fail to fold the trailing IfStatement into a return.
    const ast: AnyRecord = {
        type: "Program",
        body: [
            makeIfElseGuardExtractable(),
            {
                type: "IfStatement",
                test: { type: "Identifier", name: "cond" },
                consequent: {
                    type: "BlockStatement",
                    body: [{ type: "ReturnStatement", argument: { type: "Literal", value: "true" } }]
                },
                alternate: { type: "ReturnStatement", argument: { type: "Literal", value: "false" } }
            }
        ]
    };

    applyLogicalExpressionCondensation(ast);

    const body = ast.body as Array<AnyRecord>;

    // 1. The original IfStatement was replaced by a new guardIf at index 0
    //    followed by the two inlined consequent statements. No statements are
    //    lost: 1 -> 3 (guardIf + 2 inlined statements).
    assert.equal(body.length, 4, "guard extraction should produce 1 + N statements from 1");
    assert.equal(body[0]?.type, "IfStatement", "slot 0 should hold the new guardIf");
    const guardIf = body[0] as { alternate?: unknown; consequent?: { body?: unknown[] } };
    assert.equal(guardIf.alternate, null, "extracted guardIf must have no alternate");
    assert.ok(
        Array.isArray(guardIf.consequent?.body) && guardIf.consequent.body.length === 1,
        "guardIf consequent should be a single-statement block holding the early exit"
    );

    // 2. The inlined consequent statements occupy slots 1 and 2 — exactly the
    //    statements that previously lived inside the consequent block. The
    //    outer loop must walk past them; otherwise the trailing IfStatement
    //    would never be reached.
    assert.equal((body[1] as { expression?: { name?: string } })?.expression?.name, "side_effect_one");
    assert.equal((body[2] as { expression?: { name?: string } })?.expression?.name, "side_effect_two");

    // 3. The trailing if/else with boolean returns is collapsed into a single
    //    ReturnStatement at slot 3. This is only reachable if the loop
    //    advanced past the inlined block — i.e. it did not get stuck
    //    re-processing the guardIf forever or bail out early.
    assert.equal(body[3]?.type, "ReturnStatement", "trailing if/else should be condensed to a return");
});

void test("condenseWithinStatements re-evaluates the slot filled by a condensed if-else return", () => {
    // Symmetric case: when `tryCondenseIfStatement` rewrites the slot, the
    // 1:1 replacement lands a fresh ReturnStatement at the same index. The
    // bug skipped re-visiting it. The condensed ReturnStatement has a fresh
    // argument AST (`argumentAst`), so visiting it is a no-op today, but
    // future passes that touch ReturnStatement arguments would be silently
    // bypassed. The structural test below pins the rewrite outcome so a
    // regression that drops the rewrite entirely is caught.
    const ast: AnyRecord = {
        type: "Program",
        body: [
            {
                type: "IfStatement",
                test: { type: "Identifier", name: "ok" },
                consequent: {
                    type: "BlockStatement",
                    body: [{ type: "ReturnStatement", argument: { type: "Literal", value: "true" } }]
                },
                alternate: { type: "ReturnStatement", argument: { type: "Literal", value: "false" } }
            }
        ]
    };

    applyLogicalExpressionCondensation(ast);

    const body = ast.body as Array<AnyRecord>;

    // The if/else must collapse into a single ReturnStatement. The buggy
    // variant of the loop would still produce this output (the bug only
    // affected re-visitation, not the rewrite itself), so this assertion
    // guards against accidental over-correction: a future change that
    // removes the rewrite would be caught here.
    assert.equal(body.length, 1, "if/else with returns should condense to a single return");
    assert.equal(body[0]?.type, "ReturnStatement", "condensed slot should be a ReturnStatement");
    assert.equal(
        (body[0] as { argument?: { name?: string } })?.argument?.name,
        "ok",
        "condensed return should carry the original test identifier"
    );
});

void test("condenseWithinStatements continues past inlined consequent statements to the next outer statement", () => {
    // Verifies that after the guard extraction splice, the loop advances
    // through the inlined consequent statements (which now sit at index 1+)
    // and still reaches a regular statement placed after the original
    // IfStatement. With the buggy `index++`-in-header pattern, the loop would
    // still process these statements correctly because they sit *after* the
    // rewritten slot — but the test documents and pins that contract.
    const ast: AnyRecord = {
        type: "Program",
        body: [
            makeIfElseGuardExtractable(),
            { type: "ExpressionStatement", expression: { type: "Identifier", name: "trailing" } }
        ]
    };

    applyLogicalExpressionCondensation(ast);

    const body = ast.body as Array<AnyRecord>;
    assert.equal(body.length, 4, "guard extraction should produce 1 + N statements from 1");
    assert.equal(
        (body[3] as { expression?: { name?: string } })?.expression?.name,
        "trailing",
        "trailing statement after the guard must remain in the body"
    );
});
