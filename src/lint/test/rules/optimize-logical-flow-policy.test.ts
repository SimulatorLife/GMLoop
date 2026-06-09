/**
 * Unit tests for the optimize-logical-flow-policy module.
 *
 * These tests verify that the policy evaluation logic is correct and
 * independent from the mechanism code that applies rewrites.  Each test
 * case documents the expected behavior of the policy decision so the rule's
 * eligibility contract is explicit and reviewable.
 *
 * The policy is the "what should be normalized?" layer; the rule's visitor
 * is the "how do we normalize and report it?" layer.  Mixing the two
 * obscured the eligibility contract — these tests pin it down.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Core } from "@gmloop/core";

import {
    DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS,
    evaluateAreComparableAssignmentTargetsEquivalent,
    evaluateCanBooleanLiteralComparisonBenefitFromNormalization,
    evaluateCanIfStatementBenefitFromNormalization,
    evaluateCanLogicalExpressionBenefitFromNormalization,
    evaluateCanUnaryExpressionBenefitFromNormalization,
    evaluateHasLogicalNormalizationSignal,
    evaluateIsElsePrefixedIfAtIndex,
    evaluateIsIfNodeInElseIfChain,
    evaluateIsUndefinedCheckAgainstTarget,
    evaluateLogicalFlowCandidate,
    evaluateUnsafeCommentSyntax,
    optimizeLogicalFlowPolicy
} from "../../src/rules/gml/rules/optimize-logical-flow-policy.js";

// ---------------------------------------------------------------------------
// evaluateHasLogicalNormalizationSignal
// ---------------------------------------------------------------------------

void test("evaluateHasLogicalNormalizationSignal detects symbolic and keyword operators", () => {
    const positiveSamples = [
        "a && b",
        "a || b",
        "!ready",
        "ready and done",
        "ready or done",
        "not ready",
        "if (true)",
        "if (false)"
    ];

    for (const sample of positiveSamples) {
        assert.strictEqual(
            evaluateHasLogicalNormalizationSignal(sample),
            true,
            `Expected '${sample}' to be detected as containing a logical signal`
        );
    }
});

void test("evaluateHasLogicalNormalizationSignal returns false for arithmetic-only expressions", () => {
    const negativeSamples = ["a + b", "a * b", "x - y", "x / y", "(a + b) * c", "value", "42"];

    for (const sample of negativeSamples) {
        assert.strictEqual(
            evaluateHasLogicalNormalizationSignal(sample),
            false,
            `Expected '${sample}' to NOT be detected as containing a logical signal`
        );
    }
});

void test("DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS exposes the expected regex shapes", () => {
    assert.ok(Object.isFrozen(DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS));
    assert.ok(DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS.logicalNormalizationSignal instanceof RegExp);
    assert.ok(DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS.commentSequence instanceof RegExp);
    assert.strictEqual(DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS.logicalNormalizationSignal.flags, "u");
    assert.strictEqual(DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS.commentSequence.flags, "u");
});

// ---------------------------------------------------------------------------
// evaluateUnsafeCommentSyntax
// ---------------------------------------------------------------------------

void test("evaluateUnsafeCommentSyntax returns false when no comment markers are present", () => {
    const samples = ["a && b", "x + 1", "ready"];

    for (const sample of samples) {
        assert.strictEqual(evaluateUnsafeCommentSyntax(sample), false);
    }
});

void test("evaluateUnsafeCommentSyntax returns true for line comments", () => {
    const samples = ["a && b // trailing comment", "// header\nbody"];

    for (const sample of samples) {
        assert.strictEqual(evaluateUnsafeCommentSyntax(sample), true);
    }
});

void test("evaluateUnsafeCommentSyntax returns true for block comments", () => {
    const samples = ["a /* inline */ && b", "/* header */\nbody"];

    for (const sample of samples) {
        assert.strictEqual(evaluateUnsafeCommentSyntax(sample), true);
    }
});

void test("evaluateUnsafeCommentSyntax returns false for string-literal slashes that look like comments", () => {
    // A double slash inside a string literal must not be misread as a line comment.
    const sample = 'message = "https://example.com/path";';
    assert.strictEqual(evaluateUnsafeCommentSyntax(sample), false);
});

// ---------------------------------------------------------------------------
// evaluateIsElsePrefixedIfAtIndex
// ---------------------------------------------------------------------------

void test("evaluateIsElsePrefixedIfAtIndex recognises the 'else if' prefix", () => {
    const sourceText = "if (a) { return 1; } else if (b) { return 2; }";
    const ifKeywordIndex = sourceText.indexOf("if (b)");
    assert.strictEqual(evaluateIsElsePrefixedIfAtIndex(sourceText, ifKeywordIndex), true);
});

void test("evaluateIsElsePrefixedIfAtIndex returns false for a top-level 'if'", () => {
    const sourceText = "var x = 1;\nif (a) { return x; }";
    const ifKeywordIndex = sourceText.indexOf("if (a)");
    assert.strictEqual(evaluateIsElsePrefixedIfAtIndex(sourceText, ifKeywordIndex), false);
});

void test("evaluateIsElsePrefixedIfAtIndex returns false when the prefix is not 'else'", () => {
    const sourceText = "value + if (a) { x }";
    const ifKeywordIndex = sourceText.indexOf("if (a)");
    assert.strictEqual(evaluateIsElsePrefixedIfAtIndex(sourceText, ifKeywordIndex), false);
});

void test("evaluateIsElsePrefixedIfAtIndex returns false at the start of the file", () => {
    const sourceText = "if (a) { return 1; }";
    const ifKeywordIndex = sourceText.indexOf("if (a)");
    assert.strictEqual(evaluateIsElsePrefixedIfAtIndex(sourceText, ifKeywordIndex), false);
});

// ---------------------------------------------------------------------------
// evaluateIsIfNodeInElseIfChain
// ---------------------------------------------------------------------------

function attachParent(node: unknown, parent: unknown): void {
    Object.defineProperty(node, "parent", {
        value: parent,
        configurable: true,
        enumerable: false,
        writable: true
    });
}

void test("evaluateIsIfNodeInElseIfChain returns true when an if is the alternate of another if", () => {
    const outer: { type: string; alternate: unknown } = { type: "IfStatement", alternate: undefined };
    const inner: { type: string; parent?: unknown } = { type: "IfStatement" };
    attachParent(inner, outer);
    outer.alternate = inner;

    assert.strictEqual(evaluateIsIfNodeInElseIfChain(inner), true);
});

void test("evaluateIsIfNodeInElseIfChain returns true when wrapped in a single-statement block", () => {
    const grandParent: { type: string; alternate: unknown } = { type: "IfStatement", alternate: undefined };
    const block: { type: string; body: unknown[]; parent?: unknown } = { type: "BlockStatement", body: [] };
    const inner: { type: string; parent?: unknown } = { type: "IfStatement" };
    block.body = [inner];
    attachParent(inner, block);
    attachParent(block, grandParent);
    grandParent.alternate = block;

    assert.strictEqual(evaluateIsIfNodeInElseIfChain(inner), true);
});

void test("evaluateIsIfNodeInElseIfChain returns false for a top-level if", () => {
    const inner: { type: string; parent?: unknown } = { type: "IfStatement" };
    attachParent(inner, { type: "Program", body: [inner] });

    assert.strictEqual(evaluateIsIfNodeInElseIfChain(inner), false);
});

void test("evaluateIsIfNodeInElseIfChain returns false for a non-if node", () => {
    const expressionStatement: { type: string; parent?: unknown } = { type: "ExpressionStatement" };
    attachParent(expressionStatement, { type: "Program", body: [expressionStatement] });

    assert.strictEqual(evaluateIsIfNodeInElseIfChain(expressionStatement), false);
});

// ---------------------------------------------------------------------------
// evaluateCanBooleanLiteralComparisonBenefitFromNormalization
// ---------------------------------------------------------------------------

void test("evaluateCanBooleanLiteralComparisonBenefitFromNormalization detects == true patterns", () => {
    const node = {
        type: "BinaryExpression",
        operator: "==",
        left: { type: "Literal", value: true },
        right: { type: "Identifier", name: "ready" }
    };
    assert.strictEqual(evaluateCanBooleanLiteralComparisonBenefitFromNormalization(node), true);
});

void test("evaluateCanBooleanLiteralComparisonBenefitFromNormalization detects != true patterns", () => {
    const node = {
        type: "BinaryExpression",
        operator: "!=",
        left: { type: "Literal", value: true },
        right: { type: "Identifier", name: "ready" }
    };
    assert.strictEqual(evaluateCanBooleanLiteralComparisonBenefitFromNormalization(node), true);
});

void test("evaluateCanBooleanLiteralComparisonBenefitFromNormalization rejects non-comparison operators", () => {
    const node = {
        type: "BinaryExpression",
        operator: "+",
        left: { type: "Literal", value: true },
        right: { type: "Identifier", name: "ready" }
    };
    assert.strictEqual(evaluateCanBooleanLiteralComparisonBenefitFromNormalization(node), false);
});

void test("evaluateCanBooleanLiteralComparisonBenefitFromNormalization rejects boolean-vs-boolean", () => {
    const node = {
        type: "BinaryExpression",
        operator: "==",
        left: { type: "Literal", value: true },
        right: { type: "Literal", value: false }
    };
    assert.strictEqual(evaluateCanBooleanLiteralComparisonBenefitFromNormalization(node), false);
});

// ---------------------------------------------------------------------------
// evaluateCanUnaryExpressionBenefitFromNormalization
// ---------------------------------------------------------------------------

void test("evaluateCanUnaryExpressionBenefitFromNormalization detects !! patterns", () => {
    const node = {
        type: "UnaryExpression",
        operator: "!",
        argument: { type: "UnaryExpression", operator: "!" }
    };
    assert.strictEqual(evaluateCanUnaryExpressionBenefitFromNormalization(node), true);
});

void test("evaluateCanUnaryExpressionBenefitFromNormalization detects De Morgan patterns", () => {
    const patterns = [
        {
            type: "UnaryExpression",
            operator: "!",
            argument: {
                type: "LogicalExpression",
                operator: "&&",
                left: { type: "Identifier", name: "a" },
                right: { type: "Identifier", name: "b" }
            }
        },
        {
            type: "UnaryExpression",
            operator: "!",
            argument: {
                type: "BinaryExpression",
                operator: "||",
                left: { type: "Identifier", name: "a" },
                right: { type: "Identifier", name: "b" }
            }
        }
    ];

    for (const pattern of patterns) {
        assert.strictEqual(evaluateCanUnaryExpressionBenefitFromNormalization(pattern), true);
    }
});

void test("evaluateCanUnaryExpressionBenefitFromNormalization rejects non-negation operators", () => {
    const node = {
        type: "UnaryExpression",
        operator: "-",
        argument: { type: "Identifier", name: "x" }
    };
    assert.strictEqual(evaluateCanUnaryExpressionBenefitFromNormalization(node), false);
});

void test("evaluateCanUnaryExpressionBenefitFromNormalization rejects !identifier", () => {
    const node = {
        type: "UnaryExpression",
        operator: "!",
        argument: { type: "Identifier", name: "ready" }
    };
    assert.strictEqual(evaluateCanUnaryExpressionBenefitFromNormalization(node), false);
});

// ---------------------------------------------------------------------------
// evaluateCanLogicalExpressionBenefitFromNormalization
// ---------------------------------------------------------------------------

void test("evaluateCanLogicalExpressionBenefitFromNormalization detects boolean-literal operands", () => {
    const patterns = [
        {
            type: "LogicalExpression",
            operator: "&&",
            left: { type: "Literal", value: true },
            right: { type: "Identifier", name: "ready" }
        },
        {
            type: "LogicalExpression",
            operator: "||",
            left: { type: "Identifier", name: "ready" },
            right: { type: "Literal", value: false }
        }
    ];

    for (const pattern of patterns) {
        assert.strictEqual(evaluateCanLogicalExpressionBenefitFromNormalization(pattern), true);
    }
});

void test("evaluateCanLogicalExpressionBenefitFromNormalization detects nested logical operands", () => {
    const node = {
        type: "LogicalExpression",
        operator: "&&",
        left: {
            type: "LogicalExpression",
            operator: "||",
            left: { type: "Identifier", name: "a" },
            right: { type: "Identifier", name: "b" }
        },
        right: { type: "Identifier", name: "c" }
    };
    assert.strictEqual(evaluateCanLogicalExpressionBenefitFromNormalization(node), true);
});

void test("evaluateCanLogicalExpressionBenefitFromNormalization rejects simple non-nested logical", () => {
    const node = {
        type: "LogicalExpression",
        operator: "&&",
        left: { type: "Identifier", name: "ready" },
        right: { type: "Identifier", name: "ok" }
    };
    assert.strictEqual(evaluateCanLogicalExpressionBenefitFromNormalization(node), false);
});

// ---------------------------------------------------------------------------
// evaluateAreComparableAssignmentTargetsEquivalent
// ---------------------------------------------------------------------------

void test("evaluateAreComparableAssignmentTargetsEquivalent matches identical identifiers", () => {
    const left = { type: "Identifier", name: "score" };
    const right = { type: "Identifier", name: "score" };
    assert.strictEqual(evaluateAreComparableAssignmentTargetsEquivalent(left, right), true);
});

void test("evaluateAreComparableAssignmentTargetsEquivalent rejects different identifiers", () => {
    const left = { type: "Identifier", name: "score" };
    const right = { type: "Identifier", name: "total" };
    assert.strictEqual(evaluateAreComparableAssignmentTargetsEquivalent(left, right), false);
});

void test("evaluateAreComparableAssignmentTargetsEquivalent matches identical member-dot chains", () => {
    const left = {
        type: "MemberDotExpression",
        object: { type: "Identifier", name: "player" },
        property: { type: "Identifier", name: "score" }
    };
    const right = {
        type: "MemberDotExpression",
        object: { type: "Identifier", name: "player" },
        property: { type: "Identifier", name: "score" }
    };
    assert.strictEqual(evaluateAreComparableAssignmentTargetsEquivalent(left, right), true);
});

void test("evaluateAreComparableAssignmentTargetsEquivalent rejects mismatched member types", () => {
    const dotNode = {
        type: "MemberDotExpression",
        object: { type: "Identifier", name: "player" },
        property: { type: "Identifier", name: "score" }
    };
    const indexNode = {
        type: "MemberIndexExpression",
        object: { type: "Identifier", name: "player" },
        index: { type: "Literal", value: 0 }
    };
    assert.strictEqual(evaluateAreComparableAssignmentTargetsEquivalent(dotNode, indexNode), false);
});

void test("evaluateAreComparableAssignmentTargetsEquivalent rejects non-record inputs", () => {
    assert.strictEqual(evaluateAreComparableAssignmentTargetsEquivalent(null, null), false);
    assert.strictEqual(evaluateAreComparableAssignmentTargetsEquivalent("score", "score"), false);
    assert.strictEqual(evaluateAreComparableAssignmentTargetsEquivalent(42, 42), false);
});

// ---------------------------------------------------------------------------
// evaluateIsUndefinedCheckAgainstTarget
// ---------------------------------------------------------------------------

void test("evaluateIsUndefinedCheckAgainstTarget detects is_undefined(x) matching the target", () => {
    const condition = {
        type: "CallExpression",
        callee: { type: "Identifier", name: "is_undefined" },
        arguments: [{ type: "Identifier", name: "x" }]
    };
    const target = { type: "Identifier", name: "x" };
    assert.strictEqual(evaluateIsUndefinedCheckAgainstTarget(condition, target), true);
});

void test("evaluateIsUndefinedCheckAgainstTarget rejects is_undefined on a different target", () => {
    const condition = {
        type: "CallExpression",
        callee: { type: "Identifier", name: "is_undefined" },
        arguments: [{ type: "Identifier", name: "y" }]
    };
    const target = { type: "Identifier", name: "x" };
    assert.strictEqual(evaluateIsUndefinedCheckAgainstTarget(condition, target), false);
});

void test("evaluateIsUndefinedCheckAgainstTarget detects x == undefined", () => {
    const condition = {
        type: "BinaryExpression",
        operator: "==",
        left: { type: "Identifier", name: "x" },
        right: { type: "Identifier", name: "undefined" }
    };
    const target = { type: "Identifier", name: "x" };
    assert.strictEqual(evaluateIsUndefinedCheckAgainstTarget(condition, target), true);
});

void test("evaluateIsUndefinedCheckAgainstTarget detects undefined == x", () => {
    const condition = {
        type: "BinaryExpression",
        operator: "==",
        left: { type: "Identifier", name: "undefined" },
        right: { type: "Identifier", name: "x" }
    };
    const target = { type: "Identifier", name: "x" };
    assert.strictEqual(evaluateIsUndefinedCheckAgainstTarget(condition, target), true);
});

void test("evaluateIsUndefinedCheckAgainstTarget rejects non-equality operators", () => {
    const condition = {
        type: "BinaryExpression",
        operator: "!=",
        left: { type: "Identifier", name: "x" },
        right: { type: "Identifier", name: "undefined" }
    };
    const target = { type: "Identifier", name: "x" };
    assert.strictEqual(evaluateIsUndefinedCheckAgainstTarget(condition, target), false);
});

// ---------------------------------------------------------------------------
// evaluateCanIfStatementBenefitFromNormalization
// ---------------------------------------------------------------------------

void test("evaluateCanIfStatementBenefitFromNormalization detects if/else return true/false", () => {
    const node = {
        type: "IfStatement",
        test: { type: "Identifier", name: "ready" },
        consequent: { type: "ReturnStatement", argument: { type: "Literal", value: true } },
        alternate: { type: "ReturnStatement", argument: { type: "Literal", value: false } }
    };
    assert.strictEqual(evaluateCanIfStatementBenefitFromNormalization(node), true);
});

void test("evaluateCanIfStatementBenefitFromNormalization detects if/else x = A; else x = B;", () => {
    const node = {
        type: "IfStatement",
        test: { type: "Identifier", name: "ready" },
        consequent: {
            type: "ExpressionStatement",
            expression: {
                type: "AssignmentExpression",
                operator: "=",
                left: { type: "Identifier", name: "x" },
                right: { type: "Literal", value: 1 }
            }
        },
        alternate: {
            type: "ExpressionStatement",
            expression: {
                type: "AssignmentExpression",
                operator: "=",
                left: { type: "Identifier", name: "x" },
                right: { type: "Literal", value: 2 }
            }
        }
    };
    assert.strictEqual(evaluateCanIfStatementBenefitFromNormalization(node), true);
});

void test("evaluateCanIfStatementBenefitFromNormalization detects if (is_undefined(x)) x = y", () => {
    const node = {
        type: "IfStatement",
        test: {
            type: "CallExpression",
            callee: { type: "Identifier", name: "is_undefined" },
            arguments: [{ type: "Identifier", name: "x" }]
        },
        consequent: {
            type: "ExpressionStatement",
            expression: {
                type: "AssignmentExpression",
                operator: "=",
                left: { type: "Identifier", name: "x" },
                right: { type: "Literal", value: 0 }
            }
        }
    };
    assert.strictEqual(evaluateCanIfStatementBenefitFromNormalization(node), true);
});

void test("evaluateCanIfStatementBenefitFromNormalization rejects a no-shape if", () => {
    const node = {
        type: "IfStatement",
        test: { type: "Identifier", name: "ready" },
        consequent: {
            type: "ExpressionStatement",
            expression: {
                type: "CallExpression",
                callee: { type: "Identifier", name: "do_something" },
                arguments: []
            }
        }
    };
    assert.strictEqual(evaluateCanIfStatementBenefitFromNormalization(node), false);
});

// ---------------------------------------------------------------------------
// evaluateLogicalFlowCandidate
// ---------------------------------------------------------------------------

void test("evaluateLogicalFlowCandidate returns both flags off for arithmetic-only text", () => {
    const evaluation = evaluateLogicalFlowCandidate({
        fullSourceText: "var x = 1 + 2;",
        sourceText: "1 + 2",
        nodeStartIndex: 8
    });
    assert.deepStrictEqual(evaluation, {
        hasLogicalSignal: false,
        hasUnsafeComment: false
    });
});

void test("evaluateLogicalFlowCandidate returns hasLogicalSignal=true for a boolean comparison", () => {
    const evaluation = evaluateLogicalFlowCandidate({
        fullSourceText: "if (x == true) {}",
        sourceText: "x == true",
        nodeStartIndex: 4
    });
    assert.strictEqual(evaluation.hasLogicalSignal, true);
    assert.strictEqual(evaluation.hasUnsafeComment, false);
});

void test("evaluateLogicalFlowCandidate returns hasUnsafeComment=true when a comment is present", () => {
    const evaluation = evaluateLogicalFlowCandidate({
        fullSourceText: "if (a && b // comment\n) {}",
        sourceText: "a && b // comment",
        nodeStartIndex: 4
    });
    assert.strictEqual(evaluation.hasUnsafeComment, true);
});

void test("evaluateLogicalFlowCandidate returns frozen evaluation objects", () => {
    const evaluation = evaluateLogicalFlowCandidate({
        fullSourceText: "x && y",
        sourceText: "x && y",
        nodeStartIndex: 0
    });
    assert.ok(Object.isFrozen(evaluation));
});

// ---------------------------------------------------------------------------
// optimizeLogicalFlowPolicy namespace
// ---------------------------------------------------------------------------

void test("optimizeLogicalFlowPolicy namespace exposes the expected evaluators", () => {
    const expectedKeys = [
        "evaluateLogicalFlowCandidate",
        "evaluateUnsafeCommentSyntax",
        "evaluateHasLogicalNormalizationSignal",
        "evaluateIsElsePrefixedIfAtIndex",
        "evaluateIsIfNodeInElseIfChain",
        "evaluateCanIfStatementBenefitFromNormalization",
        "evaluateCanBooleanLiteralComparisonBenefitFromNormalization",
        "evaluateCanUnaryExpressionBenefitFromNormalization",
        "evaluateCanLogicalExpressionBenefitFromNormalization",
        "evaluateIsUndefinedCheckAgainstTarget",
        "evaluateAreComparableAssignmentTargetsEquivalent",
        "DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS"
    ] as const;

    for (const key of expectedKeys) {
        assert.ok(Object.hasOwn(optimizeLogicalFlowPolicy, key), `optimizeLogicalFlowPolicy.${key} should be exported`);
    }

    // Each evaluator should be the exact function the rule mechanism imports.
    assert.strictEqual(optimizeLogicalFlowPolicy.evaluateIsIfNodeInElseIfChain, evaluateIsIfNodeInElseIfChain);
    assert.strictEqual(
        optimizeLogicalFlowPolicy.evaluateCanIfStatementBenefitFromNormalization,
        evaluateCanIfStatementBenefitFromNormalization
    );
    assert.strictEqual(optimizeLogicalFlowPolicy.evaluateUnsafeCommentSyntax, evaluateUnsafeCommentSyntax);
    assert.strictEqual(
        optimizeLogicalFlowPolicy.DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS,
        DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS
    );
});

void test("optimizeLogicalFlowPolicy is frozen", () => {
    assert.ok(Object.isFrozen(optimizeLogicalFlowPolicy));
});

// ---------------------------------------------------------------------------
// Smoke check: the policy helpers coexist with the existing Core helpers
// used by the mechanism code (no accidental shadowing).
// ---------------------------------------------------------------------------

void test("the policy evaluators consume the same Core helpers the mechanism uses", () => {
    // If this ever changes, the policy's behaviour will diverge from the
    // mechanism's expectations — keep the dependency explicit.
    assert.strictEqual(typeof Core.unwrapParenthesizedExpression, "function");
    assert.strictEqual(typeof Core.isObjectLike, "function");
    assert.strictEqual(typeof Core.getBooleanLiteralValue, "function");
    assert.strictEqual(typeof Core.isBooleanLiteral, "function");
    assert.strictEqual(typeof Core.isIdentifierBoundaryCharacter, "function");
    assert.strictEqual(typeof Core.advanceStringCommentScan, "function");
    assert.strictEqual(typeof Core.createStringCommentScanState, "function");
});
