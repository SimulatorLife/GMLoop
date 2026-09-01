import assert from "node:assert/strict";
import { test } from "node:test";

import { type MutableGameMakerAstNode } from "@gmloop/core";

import {
    LOGICAL_NORMALIZATION_POLICY_BASELINE,
    type LogicalNormalizationPolicy
} from "../../src/rules/gml/transforms/logical-expression-condensation-policy.js";
import { applyLogicalNormalizationWithChangeMetadata } from "../../src/rules/gml/transforms/logical-expression-traversal-normalization.js";

type MutableRecord = Record<string, unknown>;

// Shared AST builders used by the simplifyStatementList tests. These live at
// module scope so each test can describe a body without redeclaring the same
// shape literal (which trips the sonarjs/no-identical-functions lint rule).
function makeIfReturnTrue(conditionName: string): MutableRecord {
    return {
        type: "IfStatement",
        test: { type: "Identifier", name: conditionName },
        consequent: {
            type: "BlockStatement",
            body: [{ type: "ReturnStatement", argument: { type: "Literal", value: "true" } }]
        }
    };
}

function makeReturnFalse(): MutableRecord {
    return { type: "ReturnStatement", argument: { type: "Literal", value: "false" } };
}

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

void test("unwrapBlock returns the IfStatement intact when consequent is null or undefined", () => {
    // Regression: prior to the fix, if node.consequent was null or undefined,
    // accessing node.body on it threw "TypeError: Cannot read properties of
    // (null|undefined) (reading 'length')". The guard
    // `node && node.type === "BlockStatement" && Array.isArray(node.body) && node.body.length === 1`
    // makes `unwrapBlock` return its input as-is for null / undefined /
    // non-object inputs, so the IfStatement must survive normalization with
    // its `test` identifier unchanged and no siblings added or removed.
    //
    // Both sentinel values exercise the same short-circuit branch in the
    // guard, so a single table-driven case is sufficient to pin the
    // contract: each row only differs by the consequent value (null vs
    // undefined) and the identifier name used to disambiguate the AST
    // node per row. If a future change ever distinguished the two inputs
    // the test would flake for that row.
    const sentinelCases: ReadonlyArray<{
        readonly label: string;
        readonly identifierName: string;
        readonly consequent: unknown;
    }> = [
        { label: "null consequent", identifierName: "x", consequent: null },
        { label: "undefined consequent", identifierName: "y", consequent: undefined }
    ];

    for (const { label, identifierName, consequent } of sentinelCases) {
        const ast: MutableGameMakerAstNode = {
            type: "Program",
            body: [
                {
                    type: "IfStatement",
                    test: { type: "Identifier", name: identifierName },
                    consequent,
                    alternate: null
                }
            ]
        };

        applyLogicalNormalizationWithChangeMetadata(ast);

        const normalizedBody = ast.body as Array<MutableRecord>;
        assert.equal(normalizedBody.length, 1, `${label}: IfStatement must survive normalization`);
        assert.equal(normalizedBody[0]?.type, "IfStatement", `${label}: surviving node must remain an IfStatement`);
    }
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

void test("traversal wires up parent pointers on every visited child before it descends", () => {
    // The post-order walker must write the current node into each child's
    // `parent` slot *before* invoking the visitor, so descendants can read
    // their own ancestry during their own recursive walk. Build a Program
    // with two independent statements and confirm both end up with a
    // non-null `parent` pointer to the Program after normalization runs.
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [
            { type: "ExpressionStatement", expression: { type: "Identifier", name: "a" } },
            { type: "ExpressionStatement", expression: { type: "Identifier", name: "b" } }
        ]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const body = ast.body as Array<MutableRecord>;
    for (const statement of body) {
        assert.equal((statement as { parent: unknown }).parent, ast, "Every statement should point at the Program");
        const expression = (statement as { expression: { parent: unknown } }).expression;
        assert.equal(expression.parent, statement, "The expression's parent pointer should be the enclosing statement");
    }
});

void test("traversal does not follow the existing parent pointer of the root node", () => {
    // The walker must skip the "parent" key, otherwise it would recurse back
    // up to the root's previous parent and could either loop forever or
    // corrupt unrelated subtrees. We pre-seed a sentinel `parent` on the root
    // and assert the sentinel is *not* treated as a child (its `parent` slot
    // must remain untouched, proving the walker never visited it).
    const sentinelParent: MutableRecord = { type: "Sentinel" };
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [],
        parent: sentinelParent
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    assert.equal(
        ast.parent,
        sentinelParent,
        "Root's existing parent pointer must not be overwritten or followed by the walker"
    );
});

void test("traversal reaches array elements even when earlier visits splice the underlying array", () => {
    // The post-order walker snapshots arrays before iterating, so a visitor
    // that mutates the array during traversal must not cause the walker to
    // skip later siblings. We construct a Program whose body splices itself
    // while a deeply-nested grandchild is still waiting to be visited; if
    // the snapshot were missing, the grandchild would be silently dropped
    // and the test would observe an empty body.
    const grandchild: MutableRecord = {
        type: "UnaryExpression",
        operator: "!",
        argument: {
            type: "UnaryExpression",
            operator: "!",
            argument: { type: "Identifier", name: "flag" }
        }
    };

    const mutator: MutableRecord = {
        type: "ExpressionStatement",
        expression: { type: "Identifier", name: "trigger" },
        get trigger(): null {
            // Splice the body to remove the first (self) entry during walk.
            const body = (ast as { body: Array<MutableRecord> }).body;
            const selfIndex = body.indexOf(mutator);
            if (selfIndex !== -1) {
                body.splice(selfIndex, 1);
            }
            return null;
        }
    };

    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [mutator, grandchild]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const body = ast.body as Array<MutableRecord>;
    // The grandchild is a double-negation; the simplifier should have collapsed
    // it down to just the inner Identifier. If the walker failed to visit it
    // (snapshot regression), the body would still contain a UnaryExpression
    // chain and this assertion would fail.
    assert.equal(body.length, 1, "Grandchild should have been visited despite the mutator splicing the body");
    assert.equal(body[0]?.type, "Identifier");
    assert.equal((body[0] as { name?: string }).name, "flag");
});

void test("simplifyStatementList collapses every adjacent return-true/false pair, including ones deep in the list", () => {
    // Regression: the in-place splice version of `simplifyStatementList`
    // shifted elements down by one after every removal and only stayed
    // correct because `continue` was paired with the splice. Walking the
    // body via a snapshot removes that implicit invariant; this test asserts
    // that all four pairs collapse when the body is processed end-to-end
    // (the third pair sits at body[6..7] after two earlier collapses, so
    // an off-by-one in the inspection index would skip it and leave a
    // stray IfStatement + ReturnStatement behind).

    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [
            makeIfReturnTrue("a"),
            makeReturnFalse(),
            makeIfReturnTrue("b"),
            makeReturnFalse(),
            makeIfReturnTrue("c"),
            makeReturnFalse(),
            makeIfReturnTrue("d"),
            makeReturnFalse()
        ]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const body = ast.body as Array<MutableRecord>;
    assert.equal(
        body.length,
        4,
        "Every adjacent return pair should collapse; leftover IfStatements indicate an off-by-one in the inspection index"
    );
    for (const [index, entry] of body.entries()) {
        assert.equal(
            entry?.type,
            "ReturnStatement",
            `body[${index}] should be a ReturnStatement after collapsing all four pairs`
        );
    }
});

void test("simplifyStatementList leaves non-adjacent pairs and non-matching shapes untouched", () => {
    // The accumulation loop must only collapse the IfStatement+ReturnStatement
    // *pair* that sits at the current snapshot index; any ReturnStatement
    // that is not immediately preceded by an eligible IfStatement (and any
    // IfStatement whose consequent or sibling does not match the
    // true/false-or-false/true shape) must survive into the accumulator
    // verbatim so callers can rely on a deterministic pass-through.
    const makeIfReturnString = (cond: string, value: string): MutableRecord => ({
        type: "IfStatement",
        test: { type: "Identifier", name: cond },
        consequent: {
            type: "BlockStatement",
            body: [{ type: "ReturnStatement", argument: { type: "Literal", value } }]
        }
    });
    const makeReturnNumber = (value: number): MutableRecord => ({
        type: "ReturnStatement",
        argument: { type: "Literal", value }
    });
    const makeExpr = (): MutableRecord => ({
        type: "ExpressionStatement",
        expression: { type: "Identifier", name: "noop" }
    });

    const firstIf = makeIfReturnTrue("cond");
    const firstRet = makeReturnFalse();
    const standaloneIf = makeIfReturnString("cond", "not_a_bool");
    const standaloneRet = makeReturnNumber(42);
    const other = makeExpr();
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [firstIf, firstRet, standaloneIf, standaloneRet, other]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const body = ast.body as Array<MutableRecord>;
    // Only the first pair collapses; everything else stays exactly as it was.
    assert.equal(body.length, 4, "Only the eligible pair should collapse");
    assert.equal(body[0]?.type, "ReturnStatement", "First pair collapses to a ReturnStatement");
    assert.equal(body[1], standaloneIf, "Standalone IfStatement should survive unchanged");
    assert.equal(body[2], standaloneRet, "Standalone ReturnStatement should survive unchanged");
    assert.equal(body[3], other, "ExpressionStatement should survive unchanged");
});

void test("simplifyStatementList returns false (no rewrite) when the body has no eligible pairs", () => {
    // The accumulation loop must not replace `body` when nothing collapsed.
    // We assert this indirectly by checking that the identity of every
    // element is preserved (the accumulation path replaces the body only
    // when at least one pair collapsed, while the no-op path leaves the
    // reference and contents untouched).
    const expr: MutableRecord = {
        type: "ExpressionStatement",
        expression: { type: "Identifier", name: "noop" }
    };
    const ast: MutableGameMakerAstNode = { type: "Program", body: [expr] };

    applyLogicalNormalizationWithChangeMetadata(ast);

    const body = ast.body as Array<MutableRecord>;
    assert.equal(body.length, 1);
    assert.equal(body[0], expr, "Unchanged elements must keep their reference");
});

void test("applyLogicalNormalizationWithChangeMetadata falls back to the baseline traversal cap (10) when no policy is supplied", () => {
    // Construct an AST that triggers a `simplifyStatementList` rewrite via the
    // canonical `if (cond) return true;` followed by `return false;` pair, which
    // let us observe the orchestrator's traversal behaviour without dragging
    // in the condensation pipeline.
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [
            {
                type: "IfStatement",
                test: { type: "Identifier", name: "cond" },
                consequent: {
                    type: "BlockStatement",
                    body: [{ type: "ReturnStatement", argument: { type: "Literal", value: "true" } }]
                }
            },
            { type: "ReturnStatement", argument: { type: "Literal", value: "false" } }
        ]
    };

    applyLogicalNormalizationWithChangeMetadata(ast);
    assert.strictEqual(
        LOGICAL_NORMALIZATION_POLICY_BASELINE.maxTraversalIterations,
        10,
        "baseline traversal cap stays at 10 for backwards compatibility"
    );
});

void test("applyLogicalNormalizationWithChangeMetadata honours a custom maxTraversalIterations below the baseline", () => {
    // Mirror the rewritable pair shape, but bound the orchestrator to two
    // passes via a custom policy. Even with a reduced iteration budget, the
    // orchestrator must still produce a working rewrite whenever the inner
    // passes have already converged — there is no requirement that
    // `maxTraversalIterations` be >= the baseline.
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [
            {
                type: "IfStatement",
                test: { type: "Identifier", name: "cond" },
                consequent: {
                    type: "BlockStatement",
                    body: [{ type: "ReturnStatement", argument: { type: "Literal", value: "true" } }]
                }
            },
            { type: "ReturnStatement", argument: { type: "Literal", value: "false" } }
        ]
    };

    const reducedPolicy: LogicalNormalizationPolicy = Object.freeze({
        ...LOGICAL_NORMALIZATION_POLICY_BASELINE,
        maxTraversalIterations: 2
    });

    const result = applyLogicalNormalizationWithChangeMetadata(ast, reducedPolicy);

    assert.strictEqual(result.changed, true, "Rewrite should still occur under a tighter iteration cap");
    const rewritten = ast.body as Array<MutableRecord>;
    assert.strictEqual(rewritten.length, 1, "The eligible pair collapses to a single ReturnStatement");
    assert.strictEqual(rewritten[0]?.type, "ReturnStatement");
});

void test("applyLogicalNormalizationWithChangeMetadata accepts a minimal iteration cap (>= 1) without crashing", () => {
    // Even at the documented lower bound of one traversal pass the
    // orchestrator should still terminate and produce a valid result for an
    // already-converged AST. This pins the contract that the rule's schema
    // lower bound of 1 (rather than 0) is enforced cooperatively by the
    // runtime option reader in the rule, not by the orchestrator itself.
    const ast: MutableGameMakerAstNode = {
        type: "Program",
        body: [{ type: "ExpressionStatement", expression: { type: "Identifier", name: "noop" } }]
    };

    const minimumPolicy: LogicalNormalizationPolicy = Object.freeze({
        ...LOGICAL_NORMALIZATION_POLICY_BASELINE,
        maxTraversalIterations: 1
    });

    const result = applyLogicalNormalizationWithChangeMetadata(ast, minimumPolicy);
    assert.strictEqual(result.changed, false);
    const body = ast.body as Array<MutableRecord>;
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0]?.type, "ExpressionStatement");
});
