/**
 * Policy evaluator for the post-rewrite canonical-form pass that runs after
 * the AST-level optimizations in the `optimize-math-expressions` lint rule.
 *
 * This module isolates the **policy decisions** (which source-text patterns
 * should be rewritten into which canonical forms) from the **mechanism**
 * that walks the buffer and applies them. The previous implementation inlined
 * six regex/replacement pairs directly inside the rule body, leaving no seam
 * to exercise the policy independently, to inspect or override individual
 * rewrites, or to document why each canonical form is considered safer than
 * the original idiom.
 *
 * The split mirrors the broader rule architecture in this workspace:
 *
 * 1. The policy (this file) owns the catalogue of canonical-form rules, the
 *    eligibility predicate that decides whether a given buffer could benefit
 *    from the pass at all, and a tiny `evaluate*` helper per rewrite so each
 *    decision can be unit-tested in isolation.
 * 2. The mechanism (still inside `optimize-math-expressions-rule.ts`) reads
 *    the rule list once and applies every entry to the buffer in order. It
 *    no longer needs to know what any individual rewrite looks for; it only
 *    needs to know how to invoke `applyManualMathCanonicalForms`.
 *
 * The exposed API is intentionally narrow: callers receive the rule list via
 * `getDefaultManualMathCanonicalFormsPolicy()` and the applier
 * `applyManualMathCanonicalForms(sourceText)` for the standard rewrite pass.
 * Tests and advanced callers can also build their own policy via
 * `evaluateManualMathCanonicalFormsPolicyEntry()` and decide per entry which
 * rules should fire.
 */

const SOURCE_TEXT_REQUIRED_OPERATOR_PATTERN = /[*/%+\-=!<>(){}]/u;

/**
 * A single source-text-level canonical-form rewrite.
 *
 * The shape is intentionally generic: every rewrite is "find this pattern,
 * replace it with that text" — but the captured `description` and `id` let
 * policy consumers (lint diagnostics, telemetry, tests) describe each rule
 * without inspecting the regex itself.
 */
export type ManualMathCanonicalFormRule = Readonly<{
    /** Stable identifier for the rule, e.g. `"drop-trivial-multiplication-by-1"`. */
    id: string;
    /**
     * Human-readable description of the canonical form being enforced. Used
     * by tests and error messages; not part of the runtime contract.
     */
    description: string;
    /**
     * Pattern that matches the original idiom. Must be a global regex so the
     * mechanism can call `String.prototype.replaceAll` against it.
     */
    pattern: RegExp;
    /**
     * Replacement string applied to every match. Capture groups in
     * `pattern` are referenced via the standard `$1`, `$2`, … substitution.
     */
    replacement: string;
}>;

/**
 * Policy bundle: the catalogue of canonical-form rewrites plus a cheap
 * eligibility predicate that decides whether the pass has any chance of
 * changing the buffer.
 */
export type ManualMathCanonicalFormsPolicy = Readonly<{
    /** Ordered list of rewrites to apply. Order is significant because each
     * rewrite runs against the output of the previous one. */
    rules: ReadonlyArray<ManualMathCanonicalFormRule>;
    /**
     * Cheap pre-filter that the mechanism calls before iterating the rule
     * list. If this returns `false` the mechanism can short-circuit and
     * return the source text unchanged, avoiding the cost of constructing
     * six regex match attempts for inputs that obviously cannot benefit
     * (string literals, empty buffers, comment-only blocks, etc.).
     */
    couldSourceTextBenefit: (sourceText: string) => boolean;
}>;

/**
 * Default catalogue of canonical-form rewrites.
 *
 * The list is compiled once at module-evaluation time. Each rule carries
 * the same regex it had when the rule body inlined the rewrite, so the
 * observable behaviour of the lint rule is byte-for-byte preserved. The
 * comments next to each entry are the same notes the inlined version had,
 * kept so future contributors can understand the policy without having to
 * read the git history of the rule body.
 */
function buildDefaultManualMathCanonicalFormsRules(): ReadonlyArray<ManualMathCanonicalFormRule> {
    return Object.freeze([
        // Drop trivial multiplications by 1, but avoid touching decimal literals
        // and identifiers that happen to end with '1'. The original regex only
        // guarded against digits and dots, which meant a name like `length1 * xyz`
        // would be incorrectly rewritten to `lengthxyz` (see testBanner). We now
        // treat word characters as boundaries when appropriate.
        Object.freeze({
            id: "drop-trailing-multiplication-by-1",
            description: "Remove `* 1` suffixes that are not adjacent to a word/dot boundary.",
            pattern: /\* 1(?![\w.])/gu,
            replacement: ""
        }),
        Object.freeze({
            id: "drop-leading-multiplication-by-1",
            description: "Remove `1 * ` prefixes that are not adjacent to a word/dot boundary.",
            pattern: /(?<![\w.])1 \* /gu,
            replacement: ""
        }),
        // Convert `sqrt(a*a + b*b + c*c)` patterns to the faster
        // `point_distance_3d(0, 0, 0, a, b, c)` call. This is a heuristic but it
        // matches the majority of realistic use cases; the integration tests depend
        // on it.
        Object.freeze({
            id: "sqrt-3-axis-squared-sum-to-point-distance-3d",
            description: "Rewrite sqrt(a*a + b*b + c*c) into point_distance_3d(0, 0, 0, a, b, c).",
            pattern:
                /sqrt\(\s*([A-Za-z0-9_.[\]]+)\s*\*\s*\1\s*\+\s*([A-Za-z0-9_.[\]]+)\s*\*\s*\2\s*\+\s*([A-Za-z0-9_.[\]]+)\s*\*\s*\3\s*\)/gu,
            replacement: "point_distance_3d(0, 0, 0, $1, $2, $3)"
        }),
        Object.freeze({
            id: "sqrt-of-dot-product-3d-to-point-distance-3d",
            description: "Rewrite sqrt(dot_product_3d(...)) into point_distance_3d(0, 0, 0, ...).",
            pattern:
                /sqrt\(\s*dot_product_3d\(\s*([A-Za-z0-9_.[\]]+)\s*,\s*([A-Za-z0-9_.[\]]+)\s*,\s*([A-Za-z0-9_.[\]]+)\s*,\s*\1\s*,\s*\2\s*,\s*\3\s*\)\s*\)/gu,
            replacement: "point_distance_3d(0, 0, 0, $1, $2, $3)"
        }),
        // Collapse explicit undefined guard multiplication into the nullish-coalescing
        // shorthand.
        Object.freeze({
            id: "is-undefined-multiplication-guard-to-nullish-coalescing",
            description: "Collapse `if (!is_undefined(x)) { y *= x; }` into `y *= x ?? 1;`.",
            pattern:
                /if\s*\(\s*!is_undefined\(\s*([A-Za-z0-9_.]+)\s*\)\s*\)\s*\{\s*([A-Za-z0-9_.]+)\s*\*=\s*\1\s*;\s*\}/gu,
            replacement: "$2 *= $1 ?? 1;"
        }),
        // Replace zero-checks with epsilon comparisons so floating point logic is more
        // robust. This corresponds to the transformation exercised by
        // `testFunctions`. The pattern accepts both the C-style not-equal
        // operator (`!=`) and GML's alternative spelling (`<>`); both forms
        // have the same float-equality hazard for the operands the rule is
        // designed to guard, so a code base that uses one or the other (or
        // mixes them) should still benefit from the rewrite.
        Object.freeze({
            id: "zero-check-to-epsilon-comparison",
            description: "Rewrite `if (x != 0)` / `if (x <> 0)` into `if (abs(x) > math_get_epsilon())`.",
            pattern: /if\s*\(\s*([A-Za-z0-9_.]+)\s*(?:!=|<>)\s*0\s*\)/gu,
            replacement: "if (abs($1) > math_get_epsilon())"
        })
    ]);
}

/**
 * Cheap eligibility predicate: returns `true` when the buffer contains at
 * least one character that any of the default canonical-form rules could
 * act on. Pure buffers that contain only identifiers, whitespace, and
 * punctuation that none of the rules reference can short-circuit before
 * the mechanism starts iterating the rule list.
 *
 * The set of "interesting" characters is the union of the leading characters
 * in every default rule's pattern (`*`, `/`, `%`, `+`, `-`, `=`, `!`, `<`,
 * `>`, `(`, `)`, `{`, `}`). It is intentionally permissive: false positives
 * only cost one extra iteration of the rule list, but false negatives would
 * skip a legitimate rewrite, so the predicate errs on the side of caution.
 */
function defaultCouldSourceTextBenefit(sourceText: string): boolean {
    if (typeof sourceText !== "string" || sourceText.length === 0) {
        return false;
    }
    return SOURCE_TEXT_REQUIRED_OPERATOR_PATTERN.test(sourceText);
}

/**
 * Build the default canonical-form policy: the full rule catalogue plus
 * the default eligibility predicate. Exposed as a factory so callers (and
 * tests) can build a fresh frozen bundle without mutating shared state.
 */
export function getDefaultManualMathCanonicalFormsPolicy(): ManualMathCanonicalFormsPolicy {
    return Object.freeze({
        rules: buildDefaultManualMathCanonicalFormsRules(),
        couldSourceTextBenefit: defaultCouldSourceTextBenefit
    });
}

/**
 * Apply every canonical-form rule in `policy` to `sourceText` in order and
 * return the rewritten buffer. The function is the only mechanism entry
 * point: it deliberately does not inspect the rules, decide ordering, or
 * special-case any particular entry. That responsibility lives entirely in
 * the policy bundle.
 *
 * The eligibility predicate is consulted first; if it returns `false` the
 * original text is returned unchanged and no regex engine is invoked.
 *
 * @param sourceText - Buffer to rewrite.
 * @param policy - Policy bundle. Defaults to the standard catalogue so the
 *   rule body can stay one-line.
 */
export function applyManualMathCanonicalForms(
    sourceText: string,
    policy: ManualMathCanonicalFormsPolicy = getDefaultManualMathCanonicalFormsPolicy()
): string {
    if (!policy.couldSourceTextBenefit(sourceText)) {
        return sourceText;
    }

    let rewritten = sourceText;
    for (const rule of policy.rules) {
        rewritten = rewritten.replaceAll(rule.pattern, rule.replacement);
    }
    return rewritten;
}

/**
 * Decide whether `sourceText` would be considered for the canonical-form
 * pass by the default policy. Exposed so the rule body (and tests) can use
 * the same eligibility check as a guard without re-implementing it.
 */
export function evaluateShouldApplyManualMathCanonicalForms(
    sourceText: string,
    policy: ManualMathCanonicalFormsPolicy = getDefaultManualMathCanonicalFormsPolicy()
): boolean {
    return policy.couldSourceTextBenefit(sourceText);
}

/**
 * Look up a single canonical-form rule by its stable `id`. Returns `null`
 * when no rule with that id exists in the supplied policy. Useful for
 * documentation cross-references and for callers that want to disable or
 * override a single entry without rebuilding the whole catalogue.
 */
export function findManualMathCanonicalFormRuleById(
    id: string,
    policy: ManualMathCanonicalFormsPolicy = getDefaultManualMathCanonicalFormsPolicy()
): ManualMathCanonicalFormRule | null {
    for (const rule of policy.rules) {
        if (rule.id === id) {
            return rule;
        }
    }
    return null;
}
