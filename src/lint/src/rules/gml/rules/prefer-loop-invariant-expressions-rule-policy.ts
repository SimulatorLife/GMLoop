/**
 * Policy evaluator for the `gml/prefer-loop-invariant-expressions` lint rule.
 *
 * This module separates the **policy decisions** (which identifier names are
 * treated as pure, which expressions are eligible for hoisting, which AST
 * shapes are unsafe replacement targets, and which hoist variable names to
 * prefer) from the **mechanism** that walks the AST, picks the best candidate
 * per loop, and emits the autofix that injects the cached declaration.
 *
 * The previous implementation inlined every constant and predicate directly
 * into the rule body. That left no seam to exercise the policy independently,
 * to swap in alternative purity/hoist catalogues for testing, or to inspect
 * the decision logic without parsing the visitor wiring. By extracting the
 * policy here we get:
 *
 * 1. Each predicate is a pure function that is unit-testable in isolation.
 * 2. The rule mechanism imports the policy namespace and depends on stable
 *    evaluator entry points — no shared mutable state, no regex strings
 *    recomputed per call.
 * 3. Future contributors can extend the rule (for example, by adding a new
 *    safe-builtin) by editing one frozen set without touching the autofix
 *    pipeline.
 *
 * The exposed API is a small set of `evaluate*` helpers grouped under the
 * `preferLoopInvariantExpressionsRulePolicy` namespace. The mechanism code in
 * `prefer-loop-invariant-expressions-rule.ts` is the sole consumer.
 */

import { Core } from "@gmloop/core";

import {
    type AstNodeRecord,
    type AstNodeWithType,
    isAstNodeRecord,
    isIdentifierNode,
    unwrapParenthesizedExpression,
    walkAstNodes
} from "../rule-base-helpers.js";

const { createStringCommentScanState, advanceStringCommentScan } = Core;

/**
 * Names of GML built-in functions the rule treats as deterministic and
 * side-effect-free.  Hoisting a call to one of these into a cached
 * declaration is observably equivalent to recomputing it on every
 * iteration, so the rewrite is safe.
 *
 * The catalogue is intentionally conservative: anything that reads or
 * writes instance state (`variable_instance_get`, `random`, …) is
 * deliberately omitted even when it appears pure at the surface.
 */
const PURE_FUNCTION_NAMES: ReadonlySet<string> = Object.freeze(
    new Set([
        // Math - absolute value
        "abs",
        // Math - trigonometry
        "dcos",
        "dsin",
        "dtan",
        "cos",
        "sin",
        "tan",
        // Math - rounding
        "floor",
        "ceil",
        "round",
        "frac",
        // Math - min/max
        "min",
        "max",
        "clamp",
        // Math - interpolation
        "lerp",
        "lerp_angle",
        // Math - geometry
        "point_distance",
        "point_distance_3d",
        "point_direction",
        "dot_product",
        "dot_product_3d",
        "dot_product_normalize",
        "dot_product_3d_normalize",
        // Math - other
        "sqrt",
        "sqr",
        "power",
        "ln",
        "log2",
        "log10",
        "exp",
        "sign",
        "deg_to_rad",
        "rad_to_deg",
        // String - length & search
        "string_length",
        "string_byte_length",
        "string_pos",
        "string_pos_ext",
        "string_count",
        "string_last_pos",
        // String - case
        "string_lower",
        "string_upper",
        "string_lettersdigits",
        "string_letters",
        "string_digits",
        "string_repeat",
        // String - content
        "string_char_at",
        "string_ord_at",
        "string_copy",
        "string_delete",
        "string_insert",
        "string_replace",
        "string_replace_all",
        "string_concat",
        "string_format",
        "string_hash_to_file",
        // Type queries
        "is_array",
        "is_bool",
        "is_int32",
        "is_int64",
        "is_ptr",
        "is_real",
        "is_string",
        "is_struct",
        "is_undefined",
        "is_vec2",
        "is_vec3",
        "is_vec4",
        "typeof",
        // Conversions
        "ord",
        "chr"
    ])
);

/**
 * Identifiers whose values change between iterations of the same loop (or
 * between program runs) and therefore must never be hoisted, even when the
 * caller never mutates them inside the loop.
 */
const NON_DETERMINISTIC_IDENTIFIER_NAMES: ReadonlySet<string> = Object.freeze(
    new Set([
        "current_time",
        "current_year",
        "current_month",
        "current_day",
        "current_weekday",
        "current_hour",
        "current_minute",
        "current_second",
        "date_current_datetime",
        "date_current_date",
        "date_current_time"
    ])
);

/**
 * Acceptable accessor strings for `MemberIndexExpression` nodes whose
 * indexing operand is a hoist candidate. Anything outside this set (for
 * example a `[@-1]` from-end accessor or a `[?...]` struct accessor) is
 * treated as unsafe to hoist.
 */
const SAFE_INDEX_ACCESSORS: ReadonlySet<string> = Object.freeze(new Set(["[", "[@"]));

/**
 * Regex used to detect identifiers that this rule itself has previously
 * generated.  When we see one of these as the `init` of a `var` we know the
 * declaration was already produced by a prior pass and must not be hoisted
 * again into an ancestor loop.
 */
const GENERATED_HOIST_IDENTIFIER_PATTERN = /^cached_(?:value|condition|text)(?:_\d+)?$/u;

/**
 * Regex matching the leading characters of a compound-assignment operator.
 * The rule refuses to hoist expressions that contain a compound assignment
 * in the loop control segment, because rewriting those positions would
 * silently change update semantics.
 */
const COMPOUND_ASSIGNMENT_OPERATOR_PATTERN = /^(?:\?\?=|[+\-*/%|&^]=)/u;

/**
 * Summary of mutations performed inside a single loop body.  Built once
 * per loop by the mechanism code and reused by every policy predicate that
 * needs to know whether a name is loop-local or has been mutated.
 */
export type LoopMutationSummary = Readonly<{
    /** Normalized identifier names introduced by `var`/`var ... = ...` declarations inside the loop. */
    declaredInsideLoop: ReadonlySet<string>;
    /** Normalized identifier names that appear on the LHS of an assignment or inc/dec inside the loop. */
    mutatedIdentifierNames: ReadonlySet<string>;
    /** Normalized root names of member expressions that are written inside the loop. */
    mutatedMemberRoots: ReadonlySet<string>;
    /** True if the loop body contains a call expression to a non-pure function or a `new` expression. */
    hasImpureCall: boolean;
}>;

/**
 * Per-node assessment produced by the hoistability evaluator.  Encodes
 * enough information for the mechanism to decide whether the candidate is
 * worth promoting (via `complexity`) and whether it touches a member that
 * might be mutated elsewhere in the loop (via `readsMemberAccess`).
 */
export type ExpressionAssessment = Readonly<{
    /** Heuristic cost of the expression; the mechanism compares it against the configured minimum. */
    complexity: number;
    /** True if the expression reads through a member dot/index; used to gate hoisting when the loop contains impure calls. */
    readsMemberAccess: boolean;
}>;

/**
 * Normalize an identifier name to the form used as the lookup key for all
 * other policy sets (`PURE_FUNCTION_NAMES`, `NON_DETERMINISTIC_IDENTIFIER_NAMES`,
 * mutation summaries).  GML is case-insensitive at the source level, so all
 * catalogues are pre-normalized and every lookup goes through this helper.
 */
export function normalizeIdentifierName(identifierName: string): string {
    return Core.toNormalizedLowerCaseString(identifierName);
}

/**
 * Decide whether a GML built-in function name should be treated as pure.
 *
 * Returns `false` for `null` and empty strings so callers don't need to
 * special-case the "no callee name known" path before calling.
 */
export function evaluateIsPureFunctionName(functionName: string | null): boolean {
    if (!functionName) {
        return false;
    }
    return PURE_FUNCTION_NAMES.has(normalizeIdentifierName(functionName));
}

/**
 * Decide whether `identifierName` is safe to treat as loop-invariant given
 * the mutation summary.  A name is invariant when it is not loop-local,
 * not mutated inside the loop, and not in the non-deterministic catalogue.
 */
export function evaluateIsIdentifierInvariant(identifierName: string, mutationSummary: LoopMutationSummary): boolean {
    const normalizedIdentifierName = normalizeIdentifierName(identifierName);
    if (!normalizedIdentifierName) {
        return false;
    }
    if (NON_DETERMINISTIC_IDENTIFIER_NAMES.has(normalizedIdentifierName)) {
        return false;
    }
    if (
        mutationSummary.declaredInsideLoop.has(normalizedIdentifierName) ||
        mutationSummary.mutatedIdentifierNames.has(normalizedIdentifierName)
    ) {
        return false;
    }
    return true;
}

/**
 * Decide whether an identifier name matches the pattern used by this rule
 * for its generated hoist variables.  Used both to detect re-hoisting of
 * prior passes and to populate the local-identifier set when reserving a
 * new hoist name.
 */
export function evaluateIsGeneratedHoistIdentifierName(identifierName: string): boolean {
    return GENERATED_HOIST_IDENTIFIER_PATTERN.test(identifierName);
}

/**
 * Decide whether a candidate AST node is in a context where replacing it
 * with a hoist reference would change semantics.  Examples include the
 * left-hand side of an assignment (which is the assignment target, not a
 * value being read) and the argument of an inc/dec expression.
 */
export function evaluateIsDisallowedContextForReplacement(
    parent: AstNodeWithType | null,
    parentKey: string | null
): boolean {
    if (!parent || !parentKey) {
        return true;
    }

    if (parent.type === "AssignmentExpression" && parentKey === "left") {
        return true;
    }

    if (parent.type === "VariableDeclarator" && parentKey === "id") {
        return true;
    }

    if (Core.isIncDecNode(parent) && parentKey === "argument") {
        return true;
    }

    if (parent.type === "CallExpression" && parentKey === "object") {
        return true;
    }

    if (parent.type === "MemberDotExpression" && parentKey === "property") {
        return true;
    }

    if (parent.type === "NewExpression" && parentKey === "expression") {
        return true;
    }

    return false;
}

/**
 * Decide whether the current node is the `init` of a `var` that this rule
 * previously produced (i.e. a generated hoist declaration).  When that is
 * the case the visitor must not hoist the declaration itself into an
 * ancestor loop — that would silently change semantics.
 */
export function evaluateShouldSkipGeneratedHoistInitializer(
    parent: AstNodeWithType | null,
    parentKey: string | null
): boolean {
    if (parentKey !== "init" || parent?.type !== "VariableDeclarator") {
        return false;
    }
    const identifierName = readIdentifierName(parent.id);
    return identifierName ? evaluateIsGeneratedHoistIdentifierName(identifierName) : false;
}

/**
 * Decide whether `sourceSegment` contains a compound-assignment operator
 * when scanning past strings and comments.  Used by the loop-control scan
 * to skip loops whose header or trailer performs `+=` / `*=` / `??=` style
 * updates that the rule cannot safely rewrite.
 */
export function evaluateSourceSegmentContainsCompoundAssignment(sourceSegment: string): boolean {
    const scanState = createStringCommentScanState();
    let index = 0;
    while (index < sourceSegment.length) {
        const scannedIndex = advanceStringCommentScan(sourceSegment, sourceSegment.length, index, scanState, true);
        if (scannedIndex !== index) {
            index = scannedIndex;
            continue;
        }

        if (COMPOUND_ASSIGNMENT_OPERATOR_PATTERN.test(sourceSegment.slice(index))) {
            return true;
        }

        index += 1;
    }
    return false;
}

/**
 * Choose a name for the cached hoist declaration based on the kind of
 * expression being hoisted and the syntactic slot it sits in.  The
 * heuristic is the same one the rule has always used:
 *
 * - Template string expressions → `cached_text`.
 * - Conditions of an `if`/`while`/`for`/`do…until` → `cached_condition`.
 * - Everything else → `cached_value`.
 */
export function evaluateChoosePreferredHoistName(
    parentNode: AstNodeWithType | null,
    parentKey: string | null,
    candidateNode: AstNodeWithType
): string {
    if (candidateNode.type === "TemplateStringExpression") {
        return "cached_text";
    }

    if (
        parentNode !== null &&
        parentKey === "test" &&
        (parentNode.type === "IfStatement" ||
            parentNode.type === "WhileStatement" ||
            parentNode.type === "ForStatement" ||
            parentNode.type === "DoUntilStatement")
    ) {
        return "cached_condition";
    }

    return "cached_value";
}

/**
 * Read the `name` field off an `Identifier` node, returning `null` for any
 * other shape so callers can compose it without a separate type guard.
 */
function readIdentifierName(node: unknown): string | null {
    if (!isIdentifierNode(node)) {
        return null;
    }
    return node.name;
}

/**
 * Recursively read the root identifier name of a member-access chain.  For
 * `player.xp[0]` this returns `"player"`.  Returns `null` for chains whose
 * root is not an identifier (for example `[0].x`).
 */
function readRootIdentifierName(node: unknown): string | null {
    const current = unwrapParenthesizedExpression(node);
    if (!isAstNodeRecord(current)) {
        return null;
    }

    if (current.type === "Identifier") {
        return typeof current.name === "string" ? current.name : null;
    }

    if (current.type === "MemberDotExpression" || current.type === "MemberIndexExpression") {
        return readRootIdentifierName(current.object);
    }

    return null;
}

/**
 * Collect the normalized mutation summary for a single loop body.  Walks
 * the body, tracking local declarations, mutated identifiers and roots,
 * and whether the body makes any non-pure calls or `new` expressions.
 *
 * The summary is `Object.freeze`-wrapped so consumers can rely on it being
 * immutable; mutating sets are not exposed outside the function.
 */
export function collectLoopMutationSummary(loopNode: unknown): LoopMutationSummary {
    const declaredInsideLoop = new Set<string>();
    const mutatedIdentifierNames = new Set<string>();
    const mutatedMemberRoots = new Set<string>();
    let hasImpureCall = false;

    const inspectNode = (node: unknown): void => {
        if (!isAstNodeRecord(node)) {
            return;
        }

        if (node.type === "VariableDeclarator") {
            const declaredName = readIdentifierName(node.id);
            if (declaredName) {
                const normalizedName = normalizeIdentifierName(declaredName);
                declaredInsideLoop.add(normalizedName);
                mutatedIdentifierNames.add(normalizedName);
            }
            return;
        }

        if (node.type === "AssignmentExpression") {
            collectMutatedNamesFromTarget(node.left, mutatedIdentifierNames, mutatedMemberRoots);
            return;
        }

        if (Core.isIncDecNode(node)) {
            collectMutatedNamesFromTarget(node.argument, mutatedIdentifierNames, mutatedMemberRoots);
            return;
        }

        if (node.type === "CallExpression") {
            const callName = Core.getCallExpressionIdentifierName(node);
            if (!evaluateIsPureFunctionName(callName)) {
                hasImpureCall = true;
            }
            return;
        }

        if (node.type === "NewExpression") {
            hasImpureCall = true;
        }
    };

    walkAstNodes(loopNode, inspectNode);

    return Object.freeze({
        declaredInsideLoop,
        mutatedIdentifierNames,
        mutatedMemberRoots,
        hasImpureCall
    });
}

/**
 * Add the identifier names reachable through `targetNode` to the supplied
 * mutation tracking sets.  Handles identifier and member-access targets
 * (recursing into nested member chains so deeply-nested writes are
 * tracked).
 */
function collectMutatedNamesFromTarget(
    targetNode: unknown,
    mutatedIdentifierNames: Set<string>,
    mutatedMemberRoots: Set<string>
): void {
    const normalizedTarget = unwrapParenthesizedExpression(targetNode);
    if (!isAstNodeRecord(normalizedTarget)) {
        return;
    }

    if (normalizedTarget.type === "Identifier") {
        if (typeof normalizedTarget.name === "string") {
            mutatedIdentifierNames.add(normalizeIdentifierName(normalizedTarget.name));
        }
        return;
    }

    if (normalizedTarget.type === "MemberDotExpression" || normalizedTarget.type === "MemberIndexExpression") {
        const rootIdentifierName = readRootIdentifierName(normalizedTarget.object);
        if (rootIdentifierName) {
            mutatedMemberRoots.add(normalizeIdentifierName(rootIdentifierName));
        }
        collectMutatedNamesFromTarget(normalizedTarget.object, mutatedIdentifierNames, mutatedMemberRoots);
    }
}

/**
 * Recursively evaluate whether an expression can be hoisted.  Returns an
 * `ExpressionAssessment` describing the cost and member-touching behaviour
 * when the expression is hoistable, or `null` when any sub-expression
 * disqualifies it.
 *
 * The assessment is memoized via the supplied `WeakMap` so each AST node
 * is evaluated at most once per loop pass.  Pure helpers used by this
 * evaluator are imported from `@gmloop/core` so behaviour stays consistent
 * with the rest of the rule pipeline.
 */
export function evaluateExpressionHoistability(
    expressionNode: unknown,
    mutationSummary: LoopMutationSummary,
    assessmentCache: WeakMap<AstNodeRecord, ExpressionAssessment | null>
): ExpressionAssessment | null {
    const normalizedExpression = unwrapParenthesizedExpression(expressionNode);
    if (!isAstNodeRecord(normalizedExpression)) {
        return null;
    }

    if (assessmentCache.has(normalizedExpression)) {
        return assessmentCache.get(normalizedExpression) ?? null;
    }

    let assessment: ExpressionAssessment | null;
    switch (normalizedExpression.type) {
        case "Literal": {
            assessment = { complexity: 1, readsMemberAccess: false };
            break;
        }
        case "Identifier": {
            assessment =
                typeof normalizedExpression.name === "string" &&
                evaluateIsIdentifierInvariant(normalizedExpression.name, mutationSummary)
                    ? { complexity: 1, readsMemberAccess: false }
                    : null;
            break;
        }
        case "UnaryExpression": {
            const argumentAssessment = evaluateExpressionHoistability(
                normalizedExpression.argument,
                mutationSummary,
                assessmentCache
            );
            assessment = argumentAssessment
                ? {
                      complexity: argumentAssessment.complexity + 1,
                      readsMemberAccess: argumentAssessment.readsMemberAccess
                  }
                : null;
            break;
        }
        case "BinaryExpression": {
            const leftAssessment = evaluateExpressionHoistability(
                normalizedExpression.left,
                mutationSummary,
                assessmentCache
            );
            const rightAssessment = evaluateExpressionHoistability(
                normalizedExpression.right,
                mutationSummary,
                assessmentCache
            );
            assessment =
                leftAssessment && rightAssessment
                    ? {
                          complexity: leftAssessment.complexity + rightAssessment.complexity + 1,
                          readsMemberAccess: leftAssessment.readsMemberAccess || rightAssessment.readsMemberAccess
                      }
                    : null;
            break;
        }
        case "TernaryExpression": {
            const testAssessment = evaluateExpressionHoistability(
                normalizedExpression.test,
                mutationSummary,
                assessmentCache
            );
            const consequentAssessment = evaluateExpressionHoistability(
                normalizedExpression.consequent,
                mutationSummary,
                assessmentCache
            );
            const alternateAssessment = evaluateExpressionHoistability(
                normalizedExpression.alternate,
                mutationSummary,
                assessmentCache
            );
            assessment =
                testAssessment && consequentAssessment && alternateAssessment
                    ? {
                          complexity:
                              testAssessment.complexity +
                              consequentAssessment.complexity +
                              alternateAssessment.complexity +
                              1,
                          readsMemberAccess:
                              testAssessment.readsMemberAccess ||
                              consequentAssessment.readsMemberAccess ||
                              alternateAssessment.readsMemberAccess
                      }
                    : null;
            break;
        }
        case "TemplateStringExpression": {
            assessment = evaluateTemplateStringExpressionHoistability(
                normalizedExpression,
                mutationSummary,
                assessmentCache
            );
            break;
        }
        case "MemberDotExpression":
        case "MemberIndexExpression": {
            assessment = evaluateMemberAccessHoistability(normalizedExpression, mutationSummary, assessmentCache);
            break;
        }
        case "CallExpression": {
            assessment = evaluateCallExpressionHoistability(normalizedExpression, mutationSummary, assessmentCache);
            break;
        }
        default: {
            assessment = null;
            break;
        }
    }

    assessmentCache.set(normalizedExpression, assessment);
    return assessment;
}

/**
 * Hoistability assessment for `TemplateStringExpression` nodes.  Iterates
 * the template's atoms and returns `null` as soon as any atom fails its own
 * hoistability assessment; otherwise sums complexity and propagates
 * member-access flags.
 */
function evaluateTemplateStringExpressionHoistability(
    templateExpression: AstNodeRecord,
    mutationSummary: LoopMutationSummary,
    assessmentCache: WeakMap<AstNodeRecord, ExpressionAssessment | null>
): ExpressionAssessment | null {
    const atomNodes = Array.isArray(templateExpression.atoms) ? templateExpression.atoms : [];
    let complexity = 1;
    let readsMemberAccess = false;

    for (const atom of atomNodes) {
        if (!isAstNodeRecord(atom) || atom.type === "TemplateStringText") {
            continue;
        }

        const atomAssessment = evaluateExpressionHoistability(atom, mutationSummary, assessmentCache);
        if (!atomAssessment) {
            return null;
        }

        complexity += atomAssessment.complexity;
        readsMemberAccess = readsMemberAccess || atomAssessment.readsMemberAccess;
    }

    return { complexity, readsMemberAccess };
}

/**
 * Hoistability assessment for member-access expressions.  Both `MemberDot`
 * and `MemberIndex` shapes are handled, with the latter constrained to the
 * `SAFE_INDEX_ACCESSORS` set and to single-property indexing.  The root
 * identifier must not be loop-local, mutated, or member-mutated.
 */
function evaluateMemberAccessHoistability(
    expression: AstNodeRecord,
    mutationSummary: LoopMutationSummary,
    assessmentCache: WeakMap<AstNodeRecord, ExpressionAssessment | null>
): ExpressionAssessment | null {
    const objectAssessment = evaluateExpressionHoistability(expression.object, mutationSummary, assessmentCache);
    const rootIdentifierName = readRootIdentifierName(expression.object);
    if (!objectAssessment || !rootIdentifierName) {
        return null;
    }

    const normalizedRootIdentifierName = normalizeIdentifierName(rootIdentifierName);
    if (
        mutationSummary.declaredInsideLoop.has(normalizedRootIdentifierName) ||
        mutationSummary.mutatedIdentifierNames.has(normalizedRootIdentifierName) ||
        mutationSummary.mutatedMemberRoots.has(normalizedRootIdentifierName)
    ) {
        return null;
    }

    if (expression.type === "MemberDotExpression") {
        return readIdentifierName(expression.property)
            ? { complexity: objectAssessment.complexity + 1, readsMemberAccess: true }
            : null;
    }

    if (typeof expression.accessor !== "string" || !SAFE_INDEX_ACCESSORS.has(expression.accessor)) {
        return null;
    }

    const properties = Array.isArray(expression.property) ? expression.property : [];
    if (properties.length !== 1) {
        return null;
    }

    const propertyAssessment = evaluateExpressionHoistability(properties[0], mutationSummary, assessmentCache);
    if (!propertyAssessment) {
        return null;
    }

    return {
        complexity: objectAssessment.complexity + propertyAssessment.complexity + 1,
        readsMemberAccess: true
    };
}

/**
 * Hoistability assessment for `CallExpression` nodes.  Only calls to
 * functions in `PURE_FUNCTION_NAMES` are eligible; non-pure callees
 * (including member calls and dynamic dispatches) return `null` here so
 * the mechanism does not promote them.
 */
function evaluateCallExpressionHoistability(
    callExpression: AstNodeRecord,
    mutationSummary: LoopMutationSummary,
    assessmentCache: WeakMap<AstNodeRecord, ExpressionAssessment | null>
): ExpressionAssessment | null {
    const functionName = Core.getCallExpressionIdentifierName(callExpression);
    if (!evaluateIsPureFunctionName(functionName)) {
        return null;
    }

    const callArguments = Core.getCallExpressionArguments(callExpression);
    let complexity = 1;
    let readsMemberAccess = false;

    for (const argumentNode of callArguments) {
        const argumentAssessment = evaluateExpressionHoistability(argumentNode, mutationSummary, assessmentCache);
        if (!argumentAssessment) {
            return null;
        }

        complexity += argumentAssessment.complexity;
        readsMemberAccess = readsMemberAccess || argumentAssessment.readsMemberAccess;
    }

    return { complexity, readsMemberAccess };
}

/**
 * Namespace bundling the loop-invariant hoisting policy.  Importers should
 * reach for the `evaluate*` helpers here instead of re-implementing
 * predicate logic inline; the namespace also re-exports the supporting
 * types so consumers do not need to know which file holds the
 * implementation details.
 */
export const preferLoopInvariantExpressionsRulePolicy = Object.freeze({
    evaluateIsPureFunctionName,
    evaluateIsIdentifierInvariant,
    evaluateIsGeneratedHoistIdentifierName,
    evaluateIsDisallowedContextForReplacement,
    evaluateShouldSkipGeneratedHoistInitializer,
    evaluateSourceSegmentContainsCompoundAssignment,
    evaluateChoosePreferredHoistName,
    evaluateExpressionHoistability,
    collectLoopMutationSummary,
    normalizeIdentifierName,
    SAFE_INDEX_ACCESSORS,
    PURE_FUNCTION_NAMES,
    NON_DETERMINISTIC_IDENTIFIER_NAMES
});
