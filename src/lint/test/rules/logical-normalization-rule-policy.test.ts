/**
 * Unit tests for the shared logical-normalization policy module.
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
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import {
    evaluateIsElsePrefixedIfAtIndex,
    evaluateIsIfNodeInElseIfChain,
    evaluateUnsafeCommentSyntax
} from "../../src/rules/gml/rules/logical-normalization-rule-policy.js";

// ---------------------------------------------------------------------------
// evaluateUnsafeCommentSyntax
// ---------------------------------------------------------------------------

void test("evaluateUnsafeCommentSyntax returns false when no comment markers are present", () => {
    const samples = ["a && b", "x + 1", "ready"];

    for (const sample of samples) {
        assert.strictEqual(evaluateUnsafeCommentSyntax(sample), false);
    }
});

void test("evaluateUnsafeCommentSyntax short-circuits without scanning empty input", () => {
    // Empty input must not allocate a scan state and must not throw.
    assert.strictEqual(evaluateUnsafeCommentSyntax(""), false);
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
// Regression: the surviving policy evaluators must keep the same call
// surface the rule mechanism depends on (positional string argument, no
// longer accepts a polymorphic signal-pattern parameter).
// ---------------------------------------------------------------------------

void test("evaluateUnsafeCommentSyntax has the simplified single-argument signature", () => {
    assert.strictEqual(evaluateUnsafeCommentSyntax.length, 1);
});

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

// ---------------------------------------------------------------------------
// Surface-area regression: the policy module's evaluator set is intentionally
// narrow — only the predicates the rule mechanism actually consumes are
// exported. Adding a new evaluator that nothing calls recreates the dead
// abstraction layer this simplification removed.
// ---------------------------------------------------------------------------

void test("policy evaluators match the set the rule mechanism consumes", async () => {
    const rulesDirectory = path.dirname(fileURLToPath(import.meta.url));
    const policySourcePath = path.resolve(
        rulesDirectory,
        "../../../src/rules/gml/rules/logical-normalization-rule-policy.ts"
    );
    const factorySourcePath = path.resolve(
        rulesDirectory,
        "../../../src/rules/gml/rules/logical-normalization-rule-factory.ts"
    );
    const preferDirectBooleanReturnSourcePath = path.resolve(
        rulesDirectory,
        "../../../src/rules/gml/rules/prefer-direct-boolean-return-rule.ts"
    );

    const policyModule = await import("../../src/rules/gml/rules/logical-normalization-rule-policy.js");

    const expectedEvaluatorNames = [
        "evaluateUnsafeCommentSyntax",
        "evaluateIsElsePrefixedIfAtIndex",
        "evaluateIsIfNodeInElseIfChain",
        "evaluateCanDirectBooleanReturnBenefitFromNormalization"
    ] as const;

    const exportedEvaluatorNames = Object.keys(policyModule).filter((name) => name.startsWith("evaluate"));

    assert.deepStrictEqual(
        exportedEvaluatorNames.toSorted(),
        [...expectedEvaluatorNames].toSorted(),
        "policy module must only export evaluators the rule mechanism consumes"
    );

    // Sanity-check: each surviving evaluator is referenced by at least one
    // rule module's source. If a future contributor deletes a caller without
    // removing the export, this assertion catches the orphan before it can
    // drift into a dead abstraction layer again.
    const factorySource = await readFile(factorySourcePath, "utf8");
    const preferDirectBooleanReturnSource = await readFile(preferDirectBooleanReturnSourcePath, "utf8");
    const policySource = await readFile(policySourcePath, "utf8");

    for (const name of expectedEvaluatorNames) {
        const referencedByRule = factorySource.includes(name) || preferDirectBooleanReturnSource.includes(name);
        const exportedHere = policySource.includes(`export function ${name}`);

        assert.ok(referencedByRule, `${name} must be referenced by at least one rule module`);
        assert.ok(exportedHere, `${name} must still be exported from the policy module`);
    }
});
