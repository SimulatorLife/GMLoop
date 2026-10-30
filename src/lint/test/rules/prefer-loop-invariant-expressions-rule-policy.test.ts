/**
 * Unit tests for the policy evaluator extracted from the
 * `gml/prefer-loop-invariant-expressions` rule.
 *
 * The policy module owns every pure decision in the rule: the pure-function
 * catalogue, the non-deterministic identifier catalogue, mutation analysis,
 * hoistability assessment, name selection, and the auxiliary skip guards.
 * These tests exercise the policy in isolation so the eligibility contract
 * is reviewable without booting the ESLint visitor or parsing GML.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    collectLoopMutationSummary,
    evaluateChoosePreferredHoistName,
    evaluateExpressionHoistability,
    evaluateIsDisallowedContextForReplacement,
    evaluateIsGeneratedHoistIdentifierName,
    evaluateIsIdentifierInvariant,
    evaluateIsPureFunctionName,
    evaluateShouldSkipGeneratedHoistInitializer,
    evaluateSourceSegmentContainsCompoundAssignment,
    type ExpressionAssessment,
    type LoopMutationSummary,
    normalizeIdentifierName,
    preferLoopInvariantExpressionsRulePolicy
} from "../../src/rules/gml/rules/prefer-loop-invariant-expressions-rule-policy.js";

const { NON_DETERMINISTIC_IDENTIFIER_NAMES, PURE_FUNCTION_NAMES, SAFE_INDEX_ACCESSORS } =
    preferLoopInvariantExpressionsRulePolicy;

function emptyMutationSummary(): LoopMutationSummary {
    return Object.freeze({
        declaredInsideLoop: new Set<string>(),
        mutatedIdentifierNames: new Set<string>(),
        mutatedMemberRoots: new Set<string>(),
        hasImpureCall: false
    });
}

// ---------------------------------------------------------------------------
// Constant catalogues
// ---------------------------------------------------------------------------

void test("PURE_FUNCTION_NAMES is frozen and exposes the expected pure math builtins", () => {
    assert.ok(Object.isFrozen(PURE_FUNCTION_NAMES));
    assert.strictEqual(PURE_FUNCTION_NAMES.has("abs"), true);
    assert.strictEqual(PURE_FUNCTION_NAMES.has("sqrt"), true);
    assert.strictEqual(PURE_FUNCTION_NAMES.has("point_distance"), true);
    assert.strictEqual(PURE_FUNCTION_NAMES.has("clamp"), true);
});

void test("PURE_FUNCTION_NAMES excludes known impure builtins", () => {
    assert.strictEqual(PURE_FUNCTION_NAMES.has("random"), false);
    assert.strictEqual(PURE_FUNCTION_NAMES.has("variable_instance_get"), false);
    assert.strictEqual(PURE_FUNCTION_NAMES.has("instance_create"), false);
    assert.strictEqual(PURE_FUNCTION_NAMES.has("alarm_set"), false);
});

void test("NON_DETERMINISTIC_IDENTIFIER_NAMES is frozen and lists the time/date builtins", () => {
    assert.ok(Object.isFrozen(NON_DETERMINISTIC_IDENTIFIER_NAMES));
    assert.strictEqual(NON_DETERMINISTIC_IDENTIFIER_NAMES.has("current_time"), true);
    assert.strictEqual(NON_DETERMINISTIC_IDENTIFIER_NAMES.has("current_year"), true);
    assert.strictEqual(NON_DETERMINISTIC_IDENTIFIER_NAMES.has("date_current_datetime"), true);
    assert.strictEqual(NON_DETERMINISTIC_IDENTIFIER_NAMES.has("score"), false);
});

void test("SAFE_INDEX_ACCESSORS is frozen and contains only the allowed array accessors", () => {
    assert.ok(Object.isFrozen(SAFE_INDEX_ACCESSORS));
    assert.strictEqual(SAFE_INDEX_ACCESSORS.has("["), true);
    assert.strictEqual(SAFE_INDEX_ACCESSORS.has("[@"), true);
    assert.strictEqual(SAFE_INDEX_ACCESSORS.has("?"), false);
    assert.strictEqual(SAFE_INDEX_ACCESSORS.has("[?"), false);
});

// ---------------------------------------------------------------------------
// normalizeIdentifierName
// ---------------------------------------------------------------------------

void test("normalizeIdentifierName lowercases and trims identifiers", () => {
    assert.strictEqual(normalizeIdentifierName("FooBar"), "foobar");
    assert.strictEqual(normalizeIdentifierName("  foo  "), "foo");
    assert.strictEqual(normalizeIdentifierName(""), "");
});

// ---------------------------------------------------------------------------
// evaluateIsPureFunctionName
// ---------------------------------------------------------------------------

void test("evaluateIsPureFunctionName accepts normalized pure names", () => {
    assert.strictEqual(evaluateIsPureFunctionName("abs"), true);
    assert.strictEqual(evaluateIsPureFunctionName("ABS"), true);
    assert.strictEqual(evaluateIsPureFunctionName("Point_Distance"), true);
});

void test("evaluateIsPureFunctionName rejects unknown names and null", () => {
    assert.strictEqual(evaluateIsPureFunctionName("random"), false);
    assert.strictEqual(evaluateIsPureFunctionName(""), false);
    assert.strictEqual(evaluateIsPureFunctionName(null), false);
});

// ---------------------------------------------------------------------------
// evaluateIsIdentifierInvariant
// ---------------------------------------------------------------------------

void test("evaluateIsIdentifierInvariant accepts names not declared or mutated inside the loop", () => {
    assert.strictEqual(evaluateIsIdentifierInvariant("score", emptyMutationSummary()), true);
});

void test("evaluateIsIdentifierInvariant rejects names declared inside the loop", () => {
    const summary: LoopMutationSummary = Object.freeze({
        declaredInsideLoop: new Set<string>(["score"]),
        mutatedIdentifierNames: new Set<string>(["score"]),
        mutatedMemberRoots: new Set<string>(),
        hasImpureCall: false
    });
    assert.strictEqual(evaluateIsIdentifierInvariant("score", summary), false);
    assert.strictEqual(evaluateIsIdentifierInvariant("SCORE", summary), false);
});

void test("evaluateIsIdentifierInvariant rejects names mutated inside the loop", () => {
    const summary: LoopMutationSummary = Object.freeze({
        declaredInsideLoop: new Set<string>(),
        mutatedIdentifierNames: new Set<string>(["score"]),
        mutatedMemberRoots: new Set<string>(),
        hasImpureCall: false
    });
    assert.strictEqual(evaluateIsIdentifierInvariant("score", summary), false);
});

void test("evaluateIsIdentifierInvariant rejects non-deterministic identifiers", () => {
    assert.strictEqual(evaluateIsIdentifierInvariant("current_time", emptyMutationSummary()), false);
    assert.strictEqual(evaluateIsIdentifierInvariant("date_current_date", emptyMutationSummary()), false);
});

void test("evaluateIsIdentifierInvariant rejects empty strings", () => {
    assert.strictEqual(evaluateIsIdentifierInvariant("", emptyMutationSummary()), false);
});

// ---------------------------------------------------------------------------
// evaluateIsGeneratedHoistIdentifierName
// ---------------------------------------------------------------------------

void test("evaluateIsGeneratedHoistIdentifierName matches the rule's generated cache names", () => {
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName("cached_value"), true);
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName("cached_condition"), true);
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName("cached_text"), true);
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName("cached_value_1"), true);
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName("cached_text_42"), true);
});

void test("evaluateIsGeneratedHoistIdentifierName rejects unrelated names", () => {
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName("cached_sum"), false);
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName("value"), false);
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName("Cached_Value"), false);
    assert.strictEqual(evaluateIsGeneratedHoistIdentifierName(""), false);
});

// ---------------------------------------------------------------------------
// evaluateShouldSkipGeneratedHoistInitializer
// ---------------------------------------------------------------------------

void test("evaluateShouldSkipGeneratedHoistInitializer returns true for generated var inits", () => {
    const declarator = {
        type: "VariableDeclarator",
        id: { type: "Identifier", name: "cached_value" }
    };
    assert.strictEqual(evaluateShouldSkipGeneratedHoistInitializer(declarator, "init"), true);
});

void test("evaluateShouldSkipGeneratedHoistInitializer returns false for non-init slots", () => {
    const declarator = {
        type: "VariableDeclarator",
        id: { type: "Identifier", name: "cached_value" }
    };
    assert.strictEqual(evaluateShouldSkipGeneratedHoistInitializer(declarator, "id"), false);
});

void test("evaluateShouldSkipGeneratedHoistInitializer returns false when the parent is not a VariableDeclarator", () => {
    const expressionStatement = {
        type: "ExpressionStatement",
        expression: { type: "Identifier", name: "cached_value" }
    };
    assert.strictEqual(evaluateShouldSkipGeneratedHoistInitializer(expressionStatement, "init"), false);
});

void test("evaluateShouldSkipGeneratedHoistInitializer returns false for non-generated names", () => {
    const declarator = {
        type: "VariableDeclarator",
        id: { type: "Identifier", name: "score" }
    };
    assert.strictEqual(evaluateShouldSkipGeneratedHoistInitializer(declarator, "init"), false);
});

// ---------------------------------------------------------------------------
// evaluateIsDisallowedContextForReplacement
// ---------------------------------------------------------------------------

void test("evaluateIsDisallowedContextForReplacement rejects null parent or key", () => {
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(null, null), true);
    assert.strictEqual(evaluateIsDisallowedContextForReplacement({ type: "ExpressionStatement" }, null), true);
});

void test("evaluateIsDisallowedContextForReplacement rejects assignment LHS, declarator id, and inc/dec", () => {
    const assignmentLhs = { type: "AssignmentExpression" };
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(assignmentLhs, "left"), true);

    const declaratorId = { type: "VariableDeclarator" };
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(declaratorId, "id"), true);

    const incDec = { type: "IncDecExpression" };
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(incDec, "argument"), true);
});

void test("evaluateIsDisallowedContextForReplacement rejects the callee slot of calls and new expressions", () => {
    const callExpression = { type: "CallExpression" };
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(callExpression, "object"), true);

    const newExpression = { type: "NewExpression" };
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(newExpression, "expression"), true);
});

void test("evaluateIsDisallowedContextForReplacement rejects member-dot property slots", () => {
    const memberDot = { type: "MemberDotExpression" };
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(memberDot, "property"), true);
});

void test("evaluateIsDisallowedContextForReplacement accepts ordinary expression slots", () => {
    const binaryExpression = { type: "BinaryExpression" };
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(binaryExpression, "left"), false);
    assert.strictEqual(evaluateIsDisallowedContextForReplacement(binaryExpression, "right"), false);
});

// ---------------------------------------------------------------------------
// evaluateSourceSegmentContainsCompoundAssignment
// ---------------------------------------------------------------------------

void test("evaluateSourceSegmentContainsCompoundAssignment detects each operator form", () => {
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment("x += 1;"), true);
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment("x -= 1;"), true);
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment("x *= 1;"), true);
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment("x /= 1;"), true);
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment("x %= 1;"), true);
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment("x ??= 1;"), true);
});

void test("evaluateSourceSegmentContainsCompoundAssignment returns false for plain arithmetic", () => {
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment("x + 1"), false);
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment("x = y"), false);
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment(""), false);
});

void test("evaluateSourceSegmentContainsCompoundAssignment ignores compound-assignment-shaped tokens inside strings", () => {
    // The compound-assignment check must scan past string literals so a
    // string like '"x += 1"' does not trip the guard.
    assert.strictEqual(evaluateSourceSegmentContainsCompoundAssignment('msg = "x += 1";'), false);
});

// ---------------------------------------------------------------------------
// evaluateChoosePreferredHoistName
// ---------------------------------------------------------------------------

void test("evaluateChoosePreferredHoistName picks cached_text for template string expressions", () => {
    const templateString = { type: "TemplateStringExpression" };
    assert.strictEqual(evaluateChoosePreferredHoistName(null, null, templateString), "cached_text");
});

void test("evaluateChoosePreferredHoistName picks cached_condition for control-flow test slots", () => {
    const ifStatement = { type: "IfStatement" };
    const whileStatement = { type: "WhileStatement" };
    const forStatement = { type: "ForStatement" };
    const doUntilStatement = { type: "DoUntilStatement" };
    const binary = { type: "BinaryExpression" };

    assert.strictEqual(evaluateChoosePreferredHoistName(ifStatement, "test", binary), "cached_condition");
    assert.strictEqual(evaluateChoosePreferredHoistName(whileStatement, "test", binary), "cached_condition");
    assert.strictEqual(evaluateChoosePreferredHoistName(forStatement, "test", binary), "cached_condition");
    assert.strictEqual(evaluateChoosePreferredHoistName(doUntilStatement, "test", binary), "cached_condition");
});

void test("evaluateChoosePreferredHoistName picks cached_value for non-control-flow slots", () => {
    const binary = { type: "BinaryExpression" };
    assert.strictEqual(evaluateChoosePreferredHoistName(null, null, binary), "cached_value");
    assert.strictEqual(evaluateChoosePreferredHoistName(binary, "left", binary), "cached_value");
});

// ---------------------------------------------------------------------------
// collectLoopMutationSummary
// ---------------------------------------------------------------------------

void test("collectLoopMutationSummary tracks local declarations and mutations", () => {
    const loopBody = {
        type: "BlockStatement",
        body: [
            {
                type: "VariableDeclaration",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: "local" },
                        init: null
                    }
                ]
            },
            {
                type: "ExpressionStatement",
                expression: {
                    type: "AssignmentExpression",
                    operator: "=",
                    left: { type: "Identifier", name: "counter" },
                    right: { type: "Literal", value: 1 }
                }
            },
            {
                type: "ExpressionStatement",
                expression: {
                    type: "IncDecExpression",
                    argument: { type: "Identifier", name: "counter" }
                }
            }
        ]
    };

    const summary = collectLoopMutationSummary(loopBody);
    assert.strictEqual(summary.declaredInsideLoop.has("local"), true);
    assert.strictEqual(summary.mutatedIdentifierNames.has("counter"), true);
});

void test("collectLoopMutationSummary flags impure calls", () => {
    const loopBody = {
        type: "BlockStatement",
        body: [
            {
                type: "ExpressionStatement",
                expression: {
                    type: "CallExpression",
                    object: { type: "Identifier", name: "draw_sprite" },
                    arguments: []
                }
            }
        ]
    };

    const summary = collectLoopMutationSummary(loopBody);
    assert.strictEqual(summary.hasImpureCall, true);
});

void test("collectLoopMutationSummary keeps pure-function calls as non-impure", () => {
    const loopBody = {
        type: "BlockStatement",
        body: [
            {
                type: "ExpressionStatement",
                expression: {
                    type: "CallExpression",
                    object: { type: "Identifier", name: "abs" },
                    arguments: [{ type: "Literal", value: -1 }]
                }
            }
        ]
    };

    const summary = collectLoopMutationSummary(loopBody);
    assert.strictEqual(summary.hasImpureCall, false);
});

void test("collectLoopMutationSummary flags new expressions as impure", () => {
    const loopBody = {
        type: "BlockStatement",
        body: [
            {
                type: "ExpressionStatement",
                expression: {
                    type: "NewExpression",
                    expression: { type: "Identifier", name: "Obj" },
                    arguments: []
                }
            }
        ]
    };

    const summary = collectLoopMutationSummary(loopBody);
    assert.strictEqual(summary.hasImpureCall, true);
});

void test("collectLoopMutationSummary tracks mutated member roots", () => {
    const loopBody = {
        type: "BlockStatement",
        body: [
            {
                type: "ExpressionStatement",
                expression: {
                    type: "AssignmentExpression",
                    operator: "=",
                    left: {
                        type: "MemberDotExpression",
                        object: { type: "Identifier", name: "player" },
                        property: { type: "Identifier", name: "score" }
                    },
                    right: { type: "Literal", value: 1 }
                }
            }
        ]
    };

    const summary = collectLoopMutationSummary(loopBody);
    assert.strictEqual(summary.mutatedMemberRoots.has("player"), true);
    assert.strictEqual(summary.mutatedIdentifierNames.has("player"), true);
});

// ---------------------------------------------------------------------------
// evaluateExpressionHoistability
// ---------------------------------------------------------------------------

function hoistabilityCache(): WeakMap<object, ExpressionAssessment | null> {
    return new WeakMap<object, ExpressionAssessment | null>();
}

void test("evaluateExpressionHoistability assigns complexity 1 to literals", () => {
    const literal = { type: "Literal", value: 42 };
    const assessment = evaluateExpressionHoistability(literal, emptyMutationSummary(), hoistabilityCache());
    assert.deepStrictEqual(assessment, { complexity: 1, readsMemberAccess: false });
});

void test("evaluateExpressionHoistability accepts invariant identifiers", () => {
    const identifier = { type: "Identifier", name: "score" };
    const assessment = evaluateExpressionHoistability(identifier, emptyMutationSummary(), hoistabilityCache());
    assert.deepStrictEqual(assessment, { complexity: 1, readsMemberAccess: false });
});

void test("evaluateExpressionHoistability rejects mutated identifiers", () => {
    const identifier = { type: "Identifier", name: "counter" };
    const summary: LoopMutationSummary = Object.freeze({
        declaredInsideLoop: new Set<string>(),
        mutatedIdentifierNames: new Set<string>(["counter"]),
        mutatedMemberRoots: new Set<string>(),
        hasImpureCall: false
    });
    const assessment = evaluateExpressionHoistability(identifier, summary, hoistabilityCache());
    assert.strictEqual(assessment, null);
});

void test("evaluateExpressionHoistability rejects non-deterministic identifiers", () => {
    const identifier = { type: "Identifier", name: "current_time" };
    const assessment = evaluateExpressionHoistability(identifier, emptyMutationSummary(), hoistabilityCache());
    assert.strictEqual(assessment, null);
});

void test("evaluateExpressionHoistability sums binary-expression complexity", () => {
    const binary = {
        type: "BinaryExpression",
        operator: "+",
        left: { type: "Literal", value: 1 },
        right: { type: "Literal", value: 2 }
    };
    const assessment = evaluateExpressionHoistability(binary, emptyMutationSummary(), hoistabilityCache());
    assert.deepStrictEqual(assessment, { complexity: 3, readsMemberAccess: false });
});

void test("evaluateExpressionHoistability marks member access as readsMemberAccess", () => {
    const memberAccess = {
        type: "MemberDotExpression",
        object: { type: "Identifier", name: "player" },
        property: { type: "Identifier", name: "score" }
    };
    const assessment = evaluateExpressionHoistability(memberAccess, emptyMutationSummary(), hoistabilityCache());
    assert.deepStrictEqual(assessment, { complexity: 2, readsMemberAccess: true });
});

void test("evaluateExpressionHoistability accepts pure-function calls", () => {
    const call = {
        type: "CallExpression",
        object: { type: "Identifier", name: "abs" },
        arguments: [{ type: "Literal", value: -5 }]
    };
    const assessment = evaluateExpressionHoistability(call, emptyMutationSummary(), hoistabilityCache());
    assert.deepStrictEqual(assessment, { complexity: 2, readsMemberAccess: false });
});

void test("evaluateExpressionHoistability rejects impure-function calls", () => {
    const call = {
        type: "CallExpression",
        object: { type: "Identifier", name: "draw_sprite" },
        arguments: []
    };
    const assessment = evaluateExpressionHoistability(call, emptyMutationSummary(), hoistabilityCache());
    assert.strictEqual(assessment, null);
});

void test("evaluateExpressionHoistability returns null for unknown node types", () => {
    const opaque = { type: "OpaqueExpression" };
    const assessment = evaluateExpressionHoistability(opaque, emptyMutationSummary(), hoistabilityCache());
    assert.strictEqual(assessment, null);
});

void test("evaluateExpressionHoistability recurses through unary expressions", () => {
    const unary = {
        type: "UnaryExpression",
        operator: "-",
        argument: { type: "Literal", value: 5 }
    };
    const assessment = evaluateExpressionHoistability(unary, emptyMutationSummary(), hoistabilityCache());
    assert.deepStrictEqual(assessment, { complexity: 2, readsMemberAccess: false });
});

void test("evaluateExpressionHoistability fails when one ternary branch is non-hoistable", () => {
    const ternary = {
        type: "TernaryExpression",
        test: { type: "Identifier", name: "ready" },
        consequent: { type: "Literal", value: 1 },
        alternate: { type: "Identifier", name: "counter" }
    };
    const summary: LoopMutationSummary = Object.freeze({
        declaredInsideLoop: new Set<string>(),
        mutatedIdentifierNames: new Set<string>(["counter"]),
        mutatedMemberRoots: new Set<string>(),
        hasImpureCall: false
    });
    const assessment = evaluateExpressionHoistability(ternary, summary, hoistabilityCache());
    assert.strictEqual(assessment, null);
});

void test("evaluateExpressionHoistability accepts a fully-hoistable ternary", () => {
    const ternary = {
        type: "TernaryExpression",
        test: { type: "Identifier", name: "ready" },
        consequent: { type: "Literal", value: 1 },
        alternate: { type: "Literal", value: 2 }
    };
    const assessment = evaluateExpressionHoistability(ternary, emptyMutationSummary(), hoistabilityCache());
    assert.deepStrictEqual(assessment, { complexity: 4, readsMemberAccess: false });
});

void test("evaluateExpressionHoistability memoizes per-node assessments", () => {
    const identifier = { type: "Identifier", name: "score" };
    const cache = hoistabilityCache();
    const first = evaluateExpressionHoistability(identifier, emptyMutationSummary(), cache);
    const second = evaluateExpressionHoistability(identifier, emptyMutationSummary(), cache);
    assert.strictEqual(first, second);
});

// ---------------------------------------------------------------------------
// preferLoopInvariantExpressionsRulePolicy namespace
// ---------------------------------------------------------------------------

void test("preferLoopInvariantExpressionsRulePolicy exposes the expected evaluators", () => {
    const expectedKeys = [
        "evaluateIsPureFunctionName",
        "evaluateIsIdentifierInvariant",
        "evaluateIsGeneratedHoistIdentifierName",
        "evaluateIsDisallowedContextForReplacement",
        "evaluateShouldSkipGeneratedHoistInitializer",
        "evaluateSourceSegmentContainsCompoundAssignment",
        "evaluateChoosePreferredHoistName",
        "evaluateExpressionHoistability",
        "collectLoopMutationSummary",
        "normalizeIdentifierName",
        "SAFE_INDEX_ACCESSORS",
        "PURE_FUNCTION_NAMES",
        "NON_DETERMINISTIC_IDENTIFIER_NAMES"
    ] as const;

    assert.ok(Object.isFrozen(preferLoopInvariantExpressionsRulePolicy));

    for (const key of expectedKeys) {
        assert.ok(
            Object.hasOwn(preferLoopInvariantExpressionsRulePolicy, key),
            `preferLoopInvariantExpressionsRulePolicy.${key} should be exported`
        );
    }

    // Each evaluator should be the exact function the rule mechanism imports.
    assert.strictEqual(preferLoopInvariantExpressionsRulePolicy.evaluateIsPureFunctionName, evaluateIsPureFunctionName);
    assert.strictEqual(preferLoopInvariantExpressionsRulePolicy.collectLoopMutationSummary, collectLoopMutationSummary);
    assert.strictEqual(
        preferLoopInvariantExpressionsRulePolicy.evaluateSourceSegmentContainsCompoundAssignment,
        evaluateSourceSegmentContainsCompoundAssignment
    );
    assert.strictEqual(preferLoopInvariantExpressionsRulePolicy.SAFE_INDEX_ACCESSORS, SAFE_INDEX_ACCESSORS);
    assert.strictEqual(preferLoopInvariantExpressionsRulePolicy.PURE_FUNCTION_NAMES, PURE_FUNCTION_NAMES);
    assert.strictEqual(
        preferLoopInvariantExpressionsRulePolicy.NON_DETERMINISTIC_IDENTIFIER_NAMES,
        NON_DETERMINISTIC_IDENTIFIER_NAMES
    );
});
