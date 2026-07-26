/**
 * Unit tests for the math manual-canonical-forms-policy module that runs
 * after the AST-level optimizations in `optimize-math-expressions`.
 *
 * The pass used to live as a tangle of inline `replaceAll` calls inside the
 * rule body. The tests below verify that the extracted policy module:
 *
 *   1. Preserves the byte-for-byte behaviour of every individual rewrite.
 *   2. Exposes a stable `id` + `description` for each canonical form so
 *      diagnostics and future tooling can reference the rules by name.
 *   3. Applies the rewrites in the documented order (so e.g. the trailing
 *      `* 1` removal always runs before the leading `1 * ` removal).
 *   4. Short-circuits on inputs that obviously cannot benefit, so the
 *      mechanism does not pay the regex engine cost for every buffer.
 *
 * Each test case mirrors an idiom that the previous inline implementation
 * was responsible for handling; behaviour is asserted against the *same*
 * source/expected pairs that the in-tree `optimize-math-expressions-fast-path`
 * fixture suite relies on, so this module stays a drop-in replacement.
 *
 * The module was previously named `optimize-math-manual-canonical-forms-policy`
 * and lived under `gml/rules/`. It is pure GML math-policy code (canonical-
 * form regex catalogue, per-rule evaluators, default policy list), so it now
 * sits alongside the other math helpers in `gml/math/` where its peers
 * (`math-numeric-policy.ts`, `math-scalar-condensing.ts`, etc.) already live.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    applyManualMathCanonicalForms,
    evaluateShouldApplyManualMathCanonicalForms,
    findManualMathCanonicalFormRuleById,
    getDefaultManualMathCanonicalFormsPolicy,
    type ManualMathCanonicalFormsPolicy
} from "../../src/rules/gml/math/math-manual-canonical-forms-policy.js";

const DEFAULT_POLICY = getDefaultManualMathCanonicalFormsPolicy();

void test("default policy exposes the canonical-form rule catalogue in declaration order", () => {
    const expectedIds = [
        "drop-trailing-multiplication-by-1",
        "drop-leading-multiplication-by-1",
        "sqrt-3-axis-squared-sum-to-point-distance-3d",
        "sqrt-of-dot-product-3d-to-point-distance-3d",
        "is-undefined-multiplication-guard-to-nullish-coalescing",
        "zero-check-to-epsilon-comparison"
    ];

    assert.deepStrictEqual(
        DEFAULT_POLICY.rules.map((rule) => rule.id),
        expectedIds
    );
});

void test("every default rule carries a description and a global regex", () => {
    for (const rule of DEFAULT_POLICY.rules) {
        assert.strictEqual(typeof rule.id, "string");
        assert.ok(rule.id.length > 0, `rule id must be non-empty (got "${rule.id}")`);
        assert.strictEqual(typeof rule.description, "string");
        assert.ok(rule.description.length > 0, `rule "${rule.id}" must carry a description`);
        assert.ok(rule.pattern instanceof RegExp, `rule "${rule.id}" pattern must be a RegExp`);
        assert.strictEqual(rule.pattern.global, true, `rule "${rule.id}" pattern must be global`);
        assert.strictEqual(typeof rule.replacement, "string");
    }
});

void test("default policy bundle is frozen so callers cannot mutate it at runtime", () => {
    assert.strictEqual(Object.isFrozen(DEFAULT_POLICY), true);
    assert.strictEqual(Object.isFrozen(DEFAULT_POLICY.rules), true);
    for (const rule of DEFAULT_POLICY.rules) {
        assert.strictEqual(Object.isFrozen(rule), true, `rule "${rule.id}" must be frozen`);
    }
});

void test("findManualMathCanonicalFormRuleById resolves every default rule id", () => {
    for (const expected of DEFAULT_POLICY.rules) {
        const resolved = findManualMathCanonicalFormRuleById(expected.id);
        assert.ok(resolved, `expected to resolve id "${expected.id}"`);
        assert.strictEqual(resolved.id, expected.id);
        assert.strictEqual(resolved.description, expected.description);
        assert.strictEqual(resolved.replacement, expected.replacement);
        assert.strictEqual(resolved.pattern.source, expected.pattern.source);
    }
});

void test("findManualMathCanonicalFormRuleById returns null for unknown ids", () => {
    assert.strictEqual(findManualMathCanonicalFormRuleById("does-not-exist"), null);
    assert.strictEqual(findManualMathCanonicalFormRuleById(""), null);
});

void test("drop-trailing-multiplication-by-1 only fires when the trailing 1 is at a boundary", () => {
    const rule = findManualMathCanonicalFormRuleById("drop-trailing-multiplication-by-1");
    assert.ok(rule);

    // Safe cases: identifier boundary or end-of-line.
    assert.strictEqual(rule.pattern.test("x * 1"), true);
    assert.strictEqual(rule.pattern.test("lengthdir_x(1, angle) * 1"), true);

    // Must NOT match when the right-hand side is part of a longer identifier
    // (e.g. `length1`) — see the testBanner regression in the rule's notes.
    assert.strictEqual(rule.pattern.test("length1 * xyz"), false);
    // Must NOT match when the right-hand side is a decimal literal.
    assert.strictEqual(rule.pattern.test("x * 1.5"), false);
    // Must NOT match when there is no `* 1` at all.
    assert.strictEqual(rule.pattern.test("x * 2"), false);
});

void test("drop-leading-multiplication-by-1 only fires when the leading 1 is at a boundary", () => {
    const rule = findManualMathCanonicalFormRuleById("drop-leading-multiplication-by-1");
    assert.ok(rule);

    // Safe cases: identifier boundary or start-of-line.
    assert.strictEqual(rule.pattern.test("1 * x"), true);
    assert.strictEqual(rule.pattern.test("if (1 * value > 0)"), true);

    // Must NOT match when the right-hand side is a decimal literal.
    assert.strictEqual(rule.pattern.test("1.5 * x"), false);
    // Must NOT match when preceded by a word character (e.g. identifier ending in `1`).
    assert.strictEqual(rule.pattern.test("length1 * xyz"), false);
});

void test("sqrt-3-axis-squared-sum-to-point-distance-3d captures the three operand names", () => {
    const rule = findManualMathCanonicalFormRuleById("sqrt-3-axis-squared-sum-to-point-distance-3d");
    assert.ok(rule);

    const input = "sqrt(P1toP3x * P1toP3x + P1toP3y * P1toP3y + P1toP3z * P1toP3z)";
    assert.strictEqual(rule.pattern.test(input), true);

    const replaced = input.replaceAll(rule.pattern, rule.replacement);
    assert.strictEqual(replaced, "point_distance_3d(0, 0, 0, P1toP3x, P1toP3y, P1toP3z)");

    // The pattern must reject asymmetric operands (i.e. they must all be the
    // same identifier on each side of the multiplication).
    assert.strictEqual(
        rule.pattern.test("sqrt(a * a + b * c + d * d)"),
        false,
        "asymmetric squared-sum must not match"
    );
});

void test("sqrt-of-dot-product-3d-to-point-distance-3d flattens nested calls", () => {
    const rule = findManualMathCanonicalFormRuleById("sqrt-of-dot-product-3d-to-point-distance-3d");
    assert.ok(rule);

    const input = "sqrt(dot_product_3d(a, b, c, a, b, c))";
    assert.strictEqual(rule.pattern.test(input), true);

    const replaced = input.replaceAll(rule.pattern, rule.replacement);
    assert.strictEqual(replaced, "point_distance_3d(0, 0, 0, a, b, c)");
});

void test("is-undefined-multiplication-guard-to-nullish-coalescing collapses the guard idiom", () => {
    const rule = findManualMathCanonicalFormRuleById("is-undefined-multiplication-guard-to-nullish-coalescing");
    assert.ok(rule);

    const input = "if (!is_undefined(scale)) { scale *= scale; }";
    const replaced = input.replaceAll(rule.pattern, rule.replacement);
    assert.strictEqual(replaced, "scale *= scale ?? 1;");

    // Must NOT match when the guard is *not* the explicit undefined check.
    assert.strictEqual(rule.pattern.test("if (scale != 0) { scale *= 2; }"), false);
});

void test("zero-check-to-epsilon-comparison replaces the bare-zero guard idiom", () => {
    const rule = findManualMathCanonicalFormRuleById("zero-check-to-epsilon-comparison");
    assert.ok(rule);

    const input = "if (delta != 0)";
    const replaced = input.replaceAll(rule.pattern, rule.replacement);
    assert.strictEqual(replaced, "if (abs(delta) > math_get_epsilon())");

    // Must NOT match when the comparison is not `!= 0` (e.g. `== 0` is a
    // different idiom the rule does not currently rewrite).
    assert.strictEqual(rule.pattern.test("if (delta == 0)"), false);
    assert.strictEqual(rule.pattern.test("if (delta != 1)"), false);
});

void test("applyManualMathCanonicalForms returns the source unchanged when no rule fires", () => {
    const sourceText = ["var foo = bar;", "if (foo) {", "    return baz;", "}", ""].join("\n");
    assert.strictEqual(applyManualMathCanonicalForms(sourceText), sourceText);
});

void test("applyManualMathCanonicalForms short-circuits on empty and non-string inputs", () => {
    assert.strictEqual(applyManualMathCanonicalForms(""), "");
    // The function tolerates non-string inputs by returning them verbatim,
    // matching the behaviour of the rule body which guards the call site.
    assert.strictEqual(applyManualMathCanonicalForms(undefined), undefined);
    assert.strictEqual(applyManualMathCanonicalForms(null), null);
});

void test("applyManualMathCanonicalForms drops trailing `* 1` at boundaries", () => {
    // The regex matches `* 1` only — the surrounding whitespace stays put so
    // the rewrite is purely textual. The original inline implementation had
    // the same observable behaviour, so this test pins it down.
    assert.strictEqual(applyManualMathCanonicalForms("var y = x * 1;"), "var y = x ;");
});

void test("applyManualMathCanonicalForms drops leading `1 * ` at boundaries", () => {
    assert.strictEqual(applyManualMathCanonicalForms("var y = 1 * x;"), "var y = x;");
});

void test("applyManualMathCanonicalForms leaves the length1 identifier intact", () => {
    // Regression: the inline regex only guarded against digits and dots,
    // which incorrectly rewrote `length1 * xyz` to `lengthxyz`. The boundary
    // guard now uses a word-character lookbehind so identifier-ending `1`
    // stays put.
    const sourceText = "var y = length1 * xyz;";
    assert.strictEqual(applyManualMathCanonicalForms(sourceText), sourceText);
});

void test("applyManualMathCanonicalForms rewrites sqrt squared sums to point_distance_3d", () => {
    const input = "p1_p3 = sqrt(P1toP3x * P1toP3x + P1toP3y * P1toP3y + P1toP3z * P1toP3z);";
    assert.strictEqual(
        applyManualMathCanonicalForms(input),
        "p1_p3 = point_distance_3d(0, 0, 0, P1toP3x, P1toP3y, P1toP3z);"
    );
});

void test("applyManualMathCanonicalForms flattens sqrt(dot_product_3d(...))", () => {
    const input = "d = sqrt(dot_product_3d(a, b, c, a, b, c));";
    assert.strictEqual(applyManualMathCanonicalForms(input), "d = point_distance_3d(0, 0, 0, a, b, c);");
});

void test("applyManualMathCanonicalForms collapses the is_undefined multiplication guard", () => {
    const input = "if (!is_undefined(scale)) { scale *= scale; }";
    assert.strictEqual(applyManualMathCanonicalForms(input), "scale *= scale ?? 1;");
});

void test("applyManualMathCanonicalForms rewrites zero checks to epsilon comparisons", () => {
    const input = "if (delta != 0) { apply(); }";
    assert.strictEqual(applyManualMathCanonicalForms(input), "if (abs(delta) > math_get_epsilon()) { apply(); }");
});

void test("applyManualMathCanonicalForms composes multiple rewrites in one pass", () => {
    // The chosen idioms are independent: the trailing `* 1` removal fires on
    // line 2, while the sqrt squared-sum rule fires on line 1. This proves
    // that the policy's rule ordering allows more than one entry to fire on
    // a single buffer without later rules undoing earlier work.
    const input = ["var distance = sqrt(ax * ax + ay * ay + az * az);", "var simple = x * 1;", ""].join("\n");

    const expected = ["var distance = point_distance_3d(0, 0, 0, ax, ay, az);", "var simple = x ;", ""].join("\n");

    assert.strictEqual(applyManualMathCanonicalForms(input), expected);
});

void test("evaluateShouldApplyManualMathCanonicalForms mirrors the eligibility predicate", () => {
    const policy: ManualMathCanonicalFormsPolicy = DEFAULT_POLICY;

    // Buffers with none of the policy's required operators short-circuit.
    assert.strictEqual(evaluateShouldApplyManualMathCanonicalForms("", policy), false);
    assert.strictEqual(evaluateShouldApplyManualMathCanonicalForms("plainIdentifier", policy), false);

    // Buffers containing at least one operator could potentially benefit.
    // Note: a "comment-only" buffer that happens to contain `/` will still
    // pass the eligibility check because the predicate is intentionally
    // permissive — false positives only cost one extra iteration of the
    // rule list, but false negatives would skip a legitimate rewrite.
    assert.strictEqual(evaluateShouldApplyManualMathCanonicalForms("// has slash", policy), true);
    assert.strictEqual(evaluateShouldApplyManualMathCanonicalForms("a + b", policy), true);
    assert.strictEqual(evaluateShouldApplyManualMathCanonicalForms("if (a != 0)", policy), true);
});

void test("a custom policy with no rules is a safe no-op", () => {
    const emptyPolicy: ManualMathCanonicalFormsPolicy = Object.freeze({
        rules: Object.freeze([]),
        couldSourceTextBenefit: () => false
    });

    const input = "if (delta != 0) { var y = x * 1; }";
    assert.strictEqual(applyManualMathCanonicalForms(input, emptyPolicy), input);
    assert.strictEqual(evaluateShouldApplyManualMathCanonicalForms(input, emptyPolicy), false);
});

void test("a custom policy can disable a single rule while keeping the rest", () => {
    // Caller drops the trailing-multiplication-by-1 rule; everything else is
    // inherited from the default catalogue. The composition pattern lets
    // advanced consumers tune the pass without rebuilding the regexes.
    const customPolicy: ManualMathCanonicalFormsPolicy = Object.freeze({
        rules: Object.freeze(DEFAULT_POLICY.rules.filter((rule) => rule.id !== "drop-trailing-multiplication-by-1")),
        couldSourceTextBenefit: DEFAULT_POLICY.couldSourceTextBenefit
    });

    // The leading-1 rule still fires for `1 * x`.
    assert.strictEqual(applyManualMathCanonicalForms("var y = 1 * x;", customPolicy), "var y = x;");
    // But the trailing-1 rule no longer fires for `x * 1`.
    assert.strictEqual(applyManualMathCanonicalForms("var y = x * 1;", customPolicy), "var y = x * 1;");
});
