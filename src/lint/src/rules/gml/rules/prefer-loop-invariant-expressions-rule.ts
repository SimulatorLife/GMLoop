import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import {
    type AstNodeRecord,
    type AstNodeWithType,
    type CommentTokenRangeIndex,
    createCommentTokenRangeIndex,
    createMeta,
    getLineIndentationAtOffset,
    isAstNodeRecord,
    isAstNodeWithType,
    isIdentifierNode,
    rangeContainsCommentToken,
    unwrapParenthesizedExpression,
    walkAstNodes,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";

type LoopNode = AstNodeWithType &
    Readonly<{
        type: "ForStatement" | "WhileStatement" | "RepeatStatement" | "DoUntilStatement";
        body: unknown;
        update?: unknown;
    }>;

type LoopContainerContext = Readonly<{
    loopNode: LoopNode;
}>;

type LoopMutationSummary = Readonly<{
    declaredInsideLoop: ReadonlySet<string>;
    mutatedIdentifierNames: ReadonlySet<string>;
    mutatedMemberRoots: ReadonlySet<string>;
    hasImpureCall: boolean;
}>;

type ExpressionAssessment = Readonly<{
    complexity: number;
    readsMemberAccess: boolean;
}>;

type LoopCandidate = Readonly<{
    expressionNode: AstNodeWithType;
    expressionStart: number;
    expressionEnd: number;
    preferredHoistName: string;
    score: number;
}>;

type LoopCandidateAnalysis = Readonly<{
    bestCandidate: LoopCandidate | null;
    replacementCandidates: ReadonlyArray<LoopCandidate>;
}>;

type ParentVisitContext = Readonly<{
    node: AstNodeWithType;
    parent: AstNodeWithType | null;
    parentKey: string | null;
}>;

type LoopReplacementTarget = Readonly<{
    expressionStart: number;
    expressionEnd: number;
}>;

/**
 * Set of known-pure GML builtin function names.
 *
 * These functions are deterministic and side-effect-free — their output depends
 * only on their inputs and they do not mutate state or produce observable
 * effects. This list is more permissive than the original 3-function list
 * (`abs`, `dcos`, `point_distance`) but remains conservative to avoid hoisting
 * builtins with hidden state dependencies (e.g., `random`, `variable_instance_get`).
 *
 * Covers: math (abs, sin/cos/tan variants, floor/ceil/round, min/max, lerp,
 * point_distance, sqrt, power, frac), string (length/concat/replace/find
 * variants, upper/lower, char_at/ord), array (create/push/pop/shift variants
 * — not pure by GML semantics but safe to hoist when args don't alias),
 * type (is_*), conversion (string(), real(), ord(), chr()).
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

const NON_DETERMINISTIC_IDENTIFIER_NAMES = new Set<string>([
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
]);

const SAFE_INDEX_ACCESSORS = new Set<string>(["[", "[@"]);
const GENERATED_HOIST_IDENTIFIER_PATTERN = /^cached_(?:value|condition|text)(?:_\d+)?$/u;

function normalizeIdentifierName(identifierName: string): string {
    return Core.toNormalizedLowerCaseString(identifierName);
}

function isLoopNode(node: unknown): node is LoopNode {
    return Core.isLoopLikeNode(node);
}

function isGeneratedHoistIdentifierName(identifierName: string): boolean {
    return GENERATED_HOIST_IDENTIFIER_PATTERN.test(identifierName);
}

function readIdentifierName(node: unknown): string | null {
    if (!isIdentifierNode(node)) {
        return null;
    }

    return node.name;
}

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

function collectLoopContainerContexts(programNode: unknown): ReadonlyArray<LoopContainerContext> {
    const contexts: Array<LoopContainerContext> = [];

    walkAstNodesWithParent(programNode, (visitContext) => {
        const { node, parent, parentKey, parentIndex } = visitContext;
        if (!isLoopNode(node)) {
            return;
        }

        if (parent === null || parentKey !== "body" || typeof parentIndex !== "number") {
            return;
        }

        if (parent.type !== "Program" && parent.type !== "BlockStatement") {
            return;
        }

        contexts.push(
            Object.freeze({
                loopNode: node
            })
        );
    });

    return contexts;
}

function collectIdentifierNamesInProgram(programNode: unknown): ReadonlySet<string> {
    const names = new Set<string>();

    walkAstNodes(programNode, (node) => {
        const identifierName = readIdentifierName(node);
        if (identifierName) {
            names.add(identifierName);
        }
    });

    return names;
}

function collectNormalizedIdentifierNames(identifierNames: ReadonlySet<string>): Set<string> {
    const normalizedNames = new Set<string>();
    for (const identifierName of identifierNames) {
        normalizedNames.add(normalizeIdentifierName(identifierName));
    }

    return normalizedNames;
}

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

function isPureFunctionName(functionName: string | null): boolean {
    if (!functionName) {
        return false;
    }

    return PURE_FUNCTION_NAMES.has(normalizeIdentifierName(functionName));
}

function isIdentifierInvariant(identifierName: string, mutationSummary: LoopMutationSummary): boolean {
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

function collectLoopMutationSummary(loopNode: LoopNode): LoopMutationSummary {
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
            if (!isPureFunctionName(callName)) {
                hasImpureCall = true;
            }
            return;
        }

        if (node.type === "NewExpression") {
            hasImpureCall = true;
        }
    };

    walkAstNodes(loopNode.body, inspectNode);
    if (isAstNodeRecord(loopNode.update)) {
        walkAstNodes(loopNode.update, inspectNode);
    }

    return Object.freeze({
        declaredInsideLoop,
        mutatedIdentifierNames,
        mutatedMemberRoots,
        hasImpureCall
    });
}

function isDisallowedContextForReplacement(parent: AstNodeWithType | null, parentKey: string | null): boolean {
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

function shouldSkipGeneratedHoistInitializer(parent: AstNodeWithType | null, parentKey: string | null): boolean {
    if (parentKey !== "init" || parent?.type !== "VariableDeclarator") {
        return false;
    }

    const identifierName = readIdentifierName(parent.id);
    return identifierName ? isGeneratedHoistIdentifierName(identifierName) : false;
}

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

function evaluateCallExpressionHoistability(
    callExpression: AstNodeRecord,
    mutationSummary: LoopMutationSummary,
    assessmentCache: WeakMap<AstNodeRecord, ExpressionAssessment | null>
): ExpressionAssessment | null {
    const functionName = Core.getCallExpressionIdentifierName(callExpression);
    if (!isPureFunctionName(functionName)) {
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

function evaluateExpressionHoistability(
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
                isIdentifierInvariant(normalizedExpression.name, mutationSummary)
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

function choosePreferredHoistName(
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

function collectLoopCandidateAnalysis(parameters: {
    commentTokenRangeIndex: CommentTokenRangeIndex;
    loopContext: LoopContainerContext;
    mutationSummary: LoopMutationSummary;
    assessmentCache: WeakMap<AstNodeRecord, ExpressionAssessment | null>;
}): LoopCandidateAnalysis {
    let bestCandidate: LoopCandidate | null = null;
    const replacementCandidates: LoopCandidate[] = [];
    const rootNode = parameters.loopContext.loopNode.body;
    if (!isAstNodeWithType(rootNode)) {
        return Object.freeze({
            bestCandidate,
            replacementCandidates: Object.freeze(replacementCandidates)
        });
    }

    const stack: ParentVisitContext[] = [{ node: rootNode, parent: null, parentKey: null }];
    const seen = new WeakSet<object>();

    while (stack.length > 0) {
        const visitContext = stack.pop();
        if (!visitContext) {
            continue;
        }

        const { node, parent, parentKey } = visitContext;
        const nodeObject = node as object;
        if (seen.has(nodeObject)) {
            continue;
        }

        seen.add(nodeObject);

        if (node.type === "ParenthesizedExpression") {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        if (isDisallowedContextForReplacement(parent, parentKey)) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        if (shouldSkipGeneratedHoistInitializer(parent, parentKey)) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        const expressionStart = Core.getNodeStartIndex(node);
        const expressionEnd = Core.getNodeEndIndex(node);
        if (
            typeof expressionStart !== "number" ||
            typeof expressionEnd !== "number" ||
            expressionEnd <= expressionStart
        ) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        const assessment = evaluateExpressionHoistability(node, parameters.mutationSummary, parameters.assessmentCache);
        if (!assessment) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        const minimumComplexity = node.type === "TemplateStringExpression" ? 2 : 3;
        if (assessment.complexity < minimumComplexity) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        if (parameters.mutationSummary.hasImpureCall && assessment.readsMemberAccess) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        if (rangeContainsCommentToken(parameters.commentTokenRangeIndex, expressionStart, expressionEnd)) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        const preferredHoistName = choosePreferredHoistName(parent, parentKey, node);
        const score = assessment.complexity * 1000 + (expressionEnd - expressionStart);
        const candidate: LoopCandidate = {
            expressionNode: node,
            expressionStart,
            expressionEnd,
            preferredHoistName,
            score
        };

        replacementCandidates.push(candidate);

        if (
            bestCandidate === null ||
            candidate.score > bestCandidate.score ||
            (candidate.score === bestCandidate.score && candidate.expressionStart < bestCandidate.expressionStart)
        ) {
            bestCandidate = candidate;
        }
    }

    return Object.freeze({
        bestCandidate,
        replacementCandidates: Object.freeze(replacementCandidates)
    });
}

function pushChildNodesForLoopCandidateTraversal(stack: ParentVisitContext[], node: AstNodeWithType): void {
    if (isLoopNode(node)) {
        return;
    }

    for (const key of Object.keys(node)) {
        if (key === "parent") {
            continue;
        }

        const value = node[key];
        if (Array.isArray(value)) {
            for (let index = value.length - 1; index >= 0; index -= 1) {
                const child = value[index];
                if (!isAstNodeWithType(child)) {
                    continue;
                }

                stack.push({
                    node: child,
                    parent: node,
                    parentKey: key
                });
            }

            continue;
        }

        if (!isAstNodeWithType(value)) {
            continue;
        }

        stack.push({
            node: value,
            parent: node,
            parentKey: key
        });
    }
}

function collectEquivalentLoopReplacementTargets(
    replacementCandidates: ReadonlyArray<LoopCandidate>,
    targetExpressionNode: AstNodeWithType
): ReadonlyArray<LoopReplacementTarget> {
    const replacementTargets: LoopReplacementTarget[] = [];

    for (const candidate of replacementCandidates) {
        if (!Core.areExpressionNodesEquivalentIgnoringParentheses(candidate.expressionNode, targetExpressionNode)) {
            continue;
        }

        replacementTargets.push(
            Object.freeze({
                expressionStart: candidate.expressionStart,
                expressionEnd: candidate.expressionEnd
            })
        );
    }

    return replacementTargets;
}

function resolveUniqueHoistIdentifierName(parameters: {
    preferredName: string;
    normalizedLocalIdentifierNames: ReadonlySet<string>;
}): string | null {
    const baseName = parameters.preferredName.length > 0 ? parameters.preferredName : "cached_value";
    for (let suffix = 0; suffix <= 1000; suffix += 1) {
        const candidateName = suffix === 0 ? baseName : `${baseName}_${suffix}`;
        if (!parameters.normalizedLocalIdentifierNames.has(normalizeIdentifierName(candidateName))) {
            return candidateName;
        }
    }

    return null;
}

/**
 * Creates the `gml/prefer-loop-invariant-expressions` rule.
 *
 * The rule hoists a single provably-safe invariant expression per loop into a
 * cached `var` declaration inserted immediately before the loop.
 */
export function createPreferLoopInvariantExpressionsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const sourceText = context.sourceCode.text;
                    const lineEnding = Core.dominantLineEnding(sourceText);
                    const localIdentifierNames = new Set(collectIdentifierNamesInProgram(programNode));
                    const normalizedLocalIdentifierNames = collectNormalizedIdentifierNames(localIdentifierNames);
                    const loopContexts = collectLoopContainerContexts(programNode);
                    const commentTokenRangeIndex = createCommentTokenRangeIndex(sourceText);

                    for (const loopContext of loopContexts) {
                        const mutationSummary = collectLoopMutationSummary(loopContext.loopNode);
                        const assessmentCache = new WeakMap<AstNodeRecord, ExpressionAssessment | null>();
                        const candidateAnalysis = collectLoopCandidateAnalysis({
                            commentTokenRangeIndex,
                            loopContext,
                            mutationSummary,
                            assessmentCache
                        });
                        const { bestCandidate } = candidateAnalysis;
                        if (!bestCandidate) {
                            continue;
                        }

                        const hoistIdentifierName = resolveUniqueHoistIdentifierName({
                            preferredName: bestCandidate.preferredHoistName,
                            normalizedLocalIdentifierNames
                        });
                        if (!hoistIdentifierName) {
                            continue;
                        }

                        localIdentifierNames.add(hoistIdentifierName);
                        normalizedLocalIdentifierNames.add(normalizeIdentifierName(hoistIdentifierName));

                        const loopStart = Core.getNodeStartIndex(loopContext.loopNode);
                        if (typeof loopStart !== "number") {
                            continue;
                        }

                        const indentation = getLineIndentationAtOffset(sourceText, loopStart);
                        const declarationInsertionStart = loopStart - indentation.length;
                        const expressionText = sourceText.slice(
                            bestCandidate.expressionStart,
                            bestCandidate.expressionEnd
                        );
                        const replacementTargets = collectEquivalentLoopReplacementTargets(
                            candidateAnalysis.replacementCandidates,
                            bestCandidate.expressionNode
                        );
                        const declarationText =
                            `${indentation}var ${hoistIdentifierName} = ${expressionText};` + `${lineEnding}`;

                        context.report({
                            node: bestCandidate.expressionNode,
                            messageId: definition.messageId,
                            fix: (fixer) => [
                                fixer.replaceTextRange(
                                    [declarationInsertionStart, declarationInsertionStart],
                                    declarationText
                                ),
                                ...replacementTargets.map((replacementTarget) =>
                                    fixer.replaceTextRange(
                                        [replacementTarget.expressionStart, replacementTarget.expressionEnd],
                                        hoistIdentifierName
                                    )
                                )
                            ]
                        });
                    }
                }
            });
        }
    });
}
