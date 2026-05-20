/**
 * AST mutation helpers extracted from `math-traversal-normalization.ts`.
 *
 * This module groups together all side-effecting helpers that walk the AST,
 * locate nodes by various criteria, and mutate the tree structure — such as
 * inserting or removing declaration nodes, managing original-expression clones,
 * and finding array entries for splice operations.
 *
 * Keeping these separate improves the maintainability of the parent module and
 * allows the pure simplification functions to remain testable in isolation.
 */
import { Core, type MutableGameMakerAstNode } from "@gmloop/core";

import { findFirstAstNodeBy } from "../rule-base-helpers.js";
import { createNumericLiteral, replaceNode, replaceNodeWith } from "./math-ast-builders.js";
import { computeNumericTolerance, evaluateNumericExpression } from "./math-numeric-utils.js";
import {
    attemptCancelReciprocalRatios,
    attemptCollectDistributedScalars,
    attemptCondenseNumericChainWithMultipleBases,
    attemptCondenseScalarProduct
} from "./math-traversal-normalization.js";

const {
    isObjectLike,
    LITERAL,
    BINARY_EXPRESSION,
    CALL_EXPRESSION,
    VARIABLE_DECLARATION,
    ASSIGNMENT_EXPRESSION,
    UNARY_EXPRESSION,
    IDENTIFIER,
    MEMBER_DOT_EXPRESSION,
    MEMBER_INDEX_EXPRESSION,
    PARENTHESIZED_EXPRESSION
} = Core;

// ---------------------------------------------------------------------------
// Safe operand detection
// ---------------------------------------------------------------------------

/**
 * True when `node` is a "safe" operand for math transforms.
 *
 * A safe operand is one that can appear without brackets in generated output
 * without altering the expression's meaning.  Literal values, identifiers, and
 * member-access chains are safe; nodes carrying comments, unary operators,
 * or other complex expressions are not.
 *
 * This consolidates the identical logic that previously existed in both
 * `math-traversal-normalization.ts` and `math-lengthdir-transforms.ts`.
 */
export function isSafeOperand(node: unknown): boolean {
    if (!isObjectLike(node)) {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    switch ((node as { type?: string }).type) {
        case IDENTIFIER:
        case LITERAL:
        case MEMBER_DOT_EXPRESSION:
        case MEMBER_INDEX_EXPRESSION: {
            return true;
        }
        case PARENTHESIZED_EXPRESSION: {
            return isSafeOperand((node as { expression?: unknown }).expression);
        }
        default: {
            return false;
        }
    }
}

// ---------------------------------------------------------------------------
// Context normalization
// ---------------------------------------------------------------------------

export type ConvertManualMathTransformOptions = {
    sourceText?: string;
    originalText?: string;
    astRoot?: MutableGameMakerAstNode;
};

/**
 * Normalize a traversal context so that `astRoot` is always available.
 */
export function normalizeTraversalContext(
    ast: any,
    context: ConvertManualMathTransformOptions | null
): { astRoot: any } & ConvertManualMathTransformOptions {
    if (context && typeof context === "object") {
        if (context.astRoot && typeof context.astRoot === "object") {
            return context as { astRoot: any } & ConvertManualMathTransformOptions;
        }
        return { ...context, astRoot: ast };
    }
    return { astRoot: ast };
}

// ---------------------------------------------------------------------------
// Source-text helpers
// ---------------------------------------------------------------------------

function getSourceTextFromContext(context: any): string | null {
    if (!isObjectLike(context)) {
        return null;
    }

    const { originalText, sourceText } = context;

    if (Core.isNonEmptyString(originalText)) {
        return originalText;
    }

    if (Core.isNonEmptyString(sourceText)) {
        return sourceText;
    }

    return null;
}

/**
 * Returns the text of a trailing `//` comment on `targetLine`, or `null` if none.
 */
export function captureTrailingLineCommentValue(targetLine: number, context: any): string | null {
    if (!Number.isFinite(targetLine) || targetLine <= 0) {
        return null;
    }

    const sourceText = getSourceTextFromContext(context);
    if (typeof sourceText !== "string" || sourceText.length === 0) {
        return null;
    }

    const sanitizedText = sourceText.replaceAll("\r", "");
    const lines = sanitizedText.split("\n");
    const lineIndex = targetLine - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
        return null;
    }

    const lineText = lines[lineIndex];
    if (typeof lineText !== "string") {
        return null;
    }

    const commentIndex = lineText.indexOf("//");
    if (commentIndex === -1) {
        return null;
    }

    const commentValue = lineText.slice(commentIndex + 2).trim();
    if (commentValue.length === 0) {
        return null;
    }

    return commentValue;
}

/**
 * Attach a trailing `original` comment to the enclosing statement node.
 */
export function attachTrailingCommentToStatement(node: any, commentValue: string): void {
    if (!commentValue || typeof commentValue !== "string") {
        return;
    }

    const statement = findStatementAncestor(node);
    if (!statement) {
        return;
    }

    if (
        typeof statement._gmlManualMathOriginalComment === "string" &&
        statement._gmlManualMathOriginalComment.length > 0
    ) {
        return;
    }

    statement._gmlManualMathOriginalComment = commentValue;
}

// ---------------------------------------------------------------------------
// Statement / ancestor walkers
// ---------------------------------------------------------------------------

/**
 * Walk up the parent chain and return the first Statement node (or VariableDeclaration).
 */
export function findStatementAncestor(node: any): any {
    let current = node?.parent ?? null;
    while (current && typeof current === "object") {
        const type = typeof current.type === "string" ? current.type : null;
        if (type && (type.endsWith("Statement") || type === "VariableDeclaration")) {
            return current;
        }

        current = current.parent ?? null;
    }

    return null;
}

/**
 * Find the assignment expression whose `right` side is `target`.
 */
export function findAssignmentExpressionForRight(root: any, target: any): any {
    if (!isObjectLike(root) || !target) {
        return null;
    }

    return findFirstAstNodeBy(root, (n) => n.type === ASSIGNMENT_EXPRESSION && n.right === target);
}

/**
 * Find the variable declarator whose `init` field is `target`.
 */
export function findVariableDeclaratorForInit(root: any, target: any): any {
    if (!isObjectLike(root) || !target) {
        return null;
    }

    return findFirstAstNodeBy(root, (n) => n.type === "VariableDeclarator" && n.init === target);
}

/**
 * Find the single-declaration VariableDeclaration whose declared name is `identifierName`.
 */
export function findVariableDeclarationByName(root: any, identifierName: string): any {
    if (!isObjectLike(root) || typeof identifierName !== "string") {
        return null;
    }

    return findFirstAstNodeBy(root, (node) => {
        if (node.type !== VARIABLE_DECLARATION || !Array.isArray(node.declarations) || node.declarations.length !== 1) {
            return false;
        }

        const [declarator] = node.declarations;
        return Core.getUnwrappedIdentifierName(declarator?.id) === identifierName;
    });
}

// ---------------------------------------------------------------------------
// Array-entry search (for splice operations)
// ---------------------------------------------------------------------------

export type TargetArraySearchDirection = "forward" | "reverse";

type TargetArrayEntry = {
    nodeArray: Array<any>;
    targetIndex: number;
};

/**
 * Locate the array within `root` that directly contains `target` and return
 * both the array and the index at which `target` appears.
 *
 * Searches depth-first. Returns the first match found.
 */
export function findTargetArrayEntry(
    root: any,
    target: any,
    direction: TargetArraySearchDirection
): TargetArrayEntry | null {
    if (!isObjectLike(root) || !target) {
        return null;
    }

    const stack = [root];
    const visited = new Set();

    while (stack.length > 0) {
        const node = stack.pop();
        if (!isObjectLike(node) || visited.has(node)) {
            continue;
        }

        visited.add(node);

        if (Array.isArray(node)) {
            const targetIndex = findTargetIndexInArray(node, target, direction);
            if (targetIndex !== -1) {
                return { nodeArray: node, targetIndex };
            }

            for (const element of node) {
                stack.push(element);
            }
            continue;
        }

        for (const key of Object.keys(node)) {
            if (key === "parent") continue;
            const value = node[key];
            if (value && typeof value === "object") {
                stack.push(value);
            }
        }
    }

    return null;
}

/**
 * Find the index of `target` within `arrayNode`, searching in `direction` order.
 */
function findTargetIndexInArray(arrayNode: Array<any>, target: any, direction: TargetArraySearchDirection): number {
    if (direction === "reverse") {
        for (let index = arrayNode.length - 1; index >= 0; index -= 1) {
            if (arrayNode[index] === target) {
                return index;
            }
        }
        return -1;
    }

    for (const [index, value] of arrayNode.entries()) {
        if (value === target) {
            return index;
        }
    }

    return -1;
}

// ---------------------------------------------------------------------------
// Blank-line preservation
// ---------------------------------------------------------------------------

function shouldPreserveRemovedBlankLine(removedNode: any, nextNode: any, sourceText: string | null): boolean {
    if (!isObjectLike(nextNode)) {
        return false;
    }

    if (typeof sourceText !== "string" || sourceText.length === 0) {
        return false;
    }

    const removedEnd = Core.getNodeEndIndex(removedNode);
    const nextStart = Core.getNodeStartIndex(nextNode);

    if (removedEnd == undefined || nextStart == undefined || nextStart <= removedEnd || nextStart > sourceText.length) {
        return false;
    }

    const between = sourceText.slice(removedEnd, nextStart);

    if (between.length === 0) {
        return false;
    }

    const normalizedBetween = between.replaceAll("\r", "").replaceAll(/[ \t\f\v]/g, "");

    return normalizedBetween.includes("\n\n");
}

function preserveBlankLineIfNeeded(nodeArray: Array<any>, index: number, target: any, sourceText: string | null): any {
    const previous = nodeArray[index - 1];
    const next = nodeArray[index + 1];

    if (previous && typeof previous === "object" && shouldPreserveRemovedBlankLine(target, next, sourceText)) {
        previous._gmlForceFollowingEmptyLine = true;
        return previous;
    }

    return null;
}

/**
 * Mark the sibling immediately before `target` to carry a blank line after it
 * when `target` is removed from the AST.
 */
export function markPreviousSiblingForBlankLine(root: any, target: any, context: any): any {
    if (!isObjectLike(root) || !target) {
        return null;
    }

    const sourceText = getSourceTextFromContext(context);
    const targetEntry = findTargetArrayEntry(root, target, "forward");
    if (!targetEntry) {
        return null;
    }

    return preserveBlankLineIfNeeded(targetEntry.nodeArray, targetEntry.targetIndex, target, sourceText);
}

// ---------------------------------------------------------------------------
// Core mutation primitives
// ---------------------------------------------------------------------------

/**
 * Insert `statement` immediately before `target` within the closest enclosing array.
 *
 * Returns `true` on success.
 */
export function insertNodeBefore(root: any, target: any, statement: any): boolean {
    if (!isObjectLike(root) || !target || !statement) {
        return false;
    }

    const targetEntry = findTargetArrayEntry(root, target, "forward");
    if (!targetEntry) {
        return false;
    }

    targetEntry.nodeArray.splice(targetEntry.targetIndex, 0, statement);
    return true;
}

/**
 * Remove `target` from the closest enclosing array.
 *
 * Returns `true` on success.
 */
export function removeNodeFromAst(root: any, target: any): boolean {
    if (!isObjectLike(root) || !target) {
        return false;
    }

    const targetEntry = findTargetArrayEntry(root, target, "reverse");
    if (!targetEntry) {
        return false;
    }

    targetEntry.nodeArray.splice(targetEntry.targetIndex, 1);
    return true;
}

/**
 * Clone the declaration node that contains `node`, replace its initializer with
 * `originalExpression`, and insert the clone before the original declaration.
 *
 * Marks the original with metadata so subsequent passes know the original was
 * preserved.
 */
export function recordManualMathOriginalAssignment(context: any, node: any, originalExpression: any): void {
    if (!isObjectLike(context)) {
        return;
    }

    const root = context.astRoot;
    if (!isObjectLike(root)) {
        return;
    }

    if (!isObjectLike(originalExpression)) {
        return;
    }

    const declarator = findVariableDeclaratorForInit(root, node);
    if (!declarator) {
        return;
    }

    const baseName = Core.getUnwrappedIdentifierName(declarator.id);
    if (typeof baseName !== "string" || baseName.length === 0) {
        return;
    }

    const declaration = findVariableDeclarationByName(root, baseName);
    if (!declaration || declaration._gmlManualMathOriginalRecorded === true) {
        return;
    }

    const originalDeclaration = Core.cloneAstNode(declaration);
    if (!Core.isNode(originalDeclaration)) {
        return;
    }

    const clonedDeclaration = originalDeclaration as MutableGameMakerAstNode;

    const declarators = Array.isArray(clonedDeclaration.declarations) ? clonedDeclaration.declarations : null;
    if (!declarators || declarators.length === 0) {
        return;
    }

    const [originalDeclarator] = declarators;
    originalDeclarator.init = Core.cloneAstNode(originalExpression) ?? originalExpression;

    clonedDeclaration._gmlManualMathOriginal = true;
    clonedDeclaration._gmlManualMathOriginalComment = "original";
    if (clonedDeclaration._gmlForceFollowingEmptyLine === true) {
        delete clonedDeclaration._gmlForceFollowingEmptyLine;
    }
    clonedDeclaration._gmlSuppressFollowingEmptyLine = true;

    if (!insertNodeBefore(root, declaration, clonedDeclaration)) {
        return;
    }

    declaration._gmlManualMathOriginalRecorded = true;
    if (declaration._gmlForceFollowingEmptyLine === true) {
        delete declaration._gmlForceFollowingEmptyLine;
    }
}

/**
 * Find and remove the alias declaration (`baseName_simplified`) that corresponds
 * to `simplifiedNode`, preserving blank lines as needed and transferring any
 * associated trailing comments.
 */
export function removeSimplifiedAliasDeclaration(context: any, simplifiedNode: any): void {
    if (!isObjectLike(context)) {
        return;
    }

    const root = context.astRoot;
    if (!isObjectLike(root)) {
        return;
    }

    const declarator = findVariableDeclaratorForInit(root, simplifiedNode);
    const baseName = Core.getUnwrappedIdentifierName(declarator?.id);

    if (typeof baseName !== "string" || baseName.length === 0) {
        return;
    }

    const aliasName = `${baseName}_simplified`;
    const aliasDeclaration = findVariableDeclarationByName(root, aliasName);

    if (!aliasDeclaration) {
        return;
    }

    const aliasDeclarator = Array.isArray(aliasDeclaration.declarations) ? aliasDeclaration.declarations[0] : null;

    if (!aliasDeclarator || !areNodesEquivalent(aliasDeclarator.init, simplifiedNode)) {
        return;
    }

    const paddedNode = markPreviousSiblingForBlankLine(root, aliasDeclaration, context);

    if (!removeNodeFromAst(root, aliasDeclaration)) {
        if (paddedNode && typeof paddedNode === "object") {
            delete paddedNode._gmlForceFollowingEmptyLine;
        }
        return;
    }

    Core.suppressTrailingLineComment(simplifiedNode, aliasDeclaration?.end?.line, context?.astRoot);
}

// ---------------------------------------------------------------------------
// Equivalence checks (needed by removeSimplifiedAliasDeclaration)
// ---------------------------------------------------------------------------

/**
 * Structural equivalence for AST nodes used during alias declaration matching.
 * Mirrors the `areNodesEquivalent` implementation in math-traversal-normalization.ts.
 */
export function areNodesEquivalent(a: any, b: any): boolean {
    const left = Core.unwrapParenthesizedExpression(a);
    const right = Core.unwrapParenthesizedExpression(b);

    if (left === right) {
        return true;
    }

    if (!left || !right || left.type !== right.type) {
        return false;
    }

    if (left.type === LITERAL) {
        return left.value === right.value;
    }

    if (left.type === "Identifier" || left.type === IDENTIFIER) {
        return left.name === right.name;
    }

    if (left.type === BINARY_EXPRESSION) {
        if (left.operator !== right.operator) {
            return false;
        }

        return areNodesEquivalent(left.left, right.left) && areNodesEquivalent(left.right, right.right);
    }

    if (left.type === UNARY_EXPRESSION) {
        return left.operator === right.operator && areNodesEquivalent(left.argument, right.argument);
    }

    return false;
}

// ---------------------------------------------------------------------------
// Zero-division simplification
// ---------------------------------------------------------------------------

/**
 * Entry point: simplify all `0 / x` numerators in the AST.
 */
export function simplifyZeroDivisionNumerators(ast: any, context: any = null): void {
    if (!isObjectLike(ast)) {
        return;
    }

    const traversalContext = normalizeTraversalContext(ast, context);
    traverseZeroDivisionNumerators(ast, traversalContext);
}

/**
 * Traverse the AST and attempt zero-division simplification at each division node.
 */
export function traverseZeroDivisionNumerators(node: any, context: any): void {
    if (!isObjectLike(node)) {
        return;
    }

    if (Array.isArray(node)) {
        for (const element of node) {
            traverseZeroDivisionNumerators(element, context);
        }
        return;
    }

    if (node.type === BINARY_EXPRESSION && node.operator === "/" && trySimplifyZeroDivision(node, context)) {
        return;
    }

    for (const key of Object.keys(node)) {
        if (key === "parent") {
            continue;
        }

        const value = node[key];
        if (value && typeof value === "object") {
            traverseZeroDivisionNumerators(value, context);
        }
    }
}

function trySimplifyZeroDivision(node: any, context: any): boolean {
    if (!isObjectLike(node) || node.operator !== "/" || !node.left || !node.right) {
        return false;
    }

    if (Core.hasComment(node) || Core.hasComment(node.left) || Core.hasComment(node.right)) {
        return false;
    }

    if (Core.hasInlineCommentBetween(node.left, node.right, context)) {
        return false;
    }

    const numeratorValue = evaluateNumericExpression(node.left);
    if (numeratorValue === null) {
        return false;
    }

    if (Math.abs(numeratorValue) > computeNumericTolerance(0)) {
        return false;
    }

    const denominatorValue = evaluateNumericExpression(node.right);
    if (denominatorValue !== null && Math.abs(denominatorValue) <= computeNumericTolerance(0)) {
        return false;
    }

    const zeroLiteral = createNumericLiteral("0", node);
    if (!zeroLiteral) {
        return false;
    }

    const parentLine = node?.end?.line;
    replaceNode(node, zeroLiteral);
    Core.suppressTrailingLineComment(node, parentLine, context?.astRoot);
    removeSimplifiedAliasDeclaration(context, node);

    return true;
}

// ---------------------------------------------------------------------------
// Comment utilities
// ---------------------------------------------------------------------------

/**
 * Check whether any ancestor of `node` contains a comment that mentions "original".
 */
export function hasOriginalComment(node: any, context: any): boolean {
    let current: any = node;
    while (current) {
        if (current.comments && Array.isArray(current.comments)) {
            for (const comment of current.comments) {
                if (comment.value && comment.value.includes("original")) {
                    return true;
                }
            }
        }

        if (context && context.sourceText && typeof current.end === "number") {
            const text = context.sourceText;
            const limit = Math.min(text.length, current.end + 200);
            const snippet = text.slice(current.end, limit);
            const firstLine = snippet.split(/\r?\n/)[0];
            if (firstLine && firstLine.includes("original") && (firstLine.includes("//") || firstLine.includes("/*"))) {
                return true;
            }
        }

        current = current.parent;
        if (current && (current.type === "FunctionDeclaration" || current.type === "Program")) {
            break;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Scalar condensing
// ---------------------------------------------------------------------------

export type ScalarCondensingTarget = MutableGameMakerAstNode | Array<any>;

/**
 * Apply iterative scalar condensing to a full AST.
 */
export function applyScalarCondensing(
    ast: any,
    _context: ConvertManualMathTransformOptions | null = null
): ScalarCondensingTarget {
    if (!Core.isNode(ast)) {
        return ast as ScalarCondensingTarget;
    }

    const traversalContext = normalizeTraversalContext(ast, _context);
    const seen = new WeakSet<object>();

    const visit = (node: any, parent: any): void => {
        if (!isObjectLike(node)) {
            return;
        }

        if (Array.isArray(node)) {
            for (const element of node) {
                visit(element, parent);
            }
            return;
        }

        const objectNode = node as object;
        if (seen.has(objectNode)) {
            return;
        }
        seen.add(objectNode);

        if (parent && !node.parent) {
            Object.defineProperty(node, "parent", {
                value: parent,
                enumerable: false,
                configurable: true
            });
        }

        if (node.type === BINARY_EXPRESSION) {
            let changed = true;
            let iterationCount = 0;
            while (changed && iterationCount < 1000) {
                iterationCount += 1;
                changed = applySimplifiers(node, traversalContext, _SCALAR_CONDENSING_SIMPLIFIERS);
            }
        }

        for (const key of Object.keys(node)) {
            if (key === "parent") {
                continue;
            }

            visit(node[key], node);
        }
    };

    visit(ast, null);

    return ast as MutableGameMakerAstNode;
}

const _SCALAR_CONDENSING_SIMPLIFIERS = [
    attemptCancelReciprocalRatios,
    attemptCondenseNumericChainWithMultipleBases,
    attemptCondenseScalarProduct,
    attemptCollectDistributedScalars
];

function applySimplifiers(node: any, context: any, simplifiers: Array<(node: any, context: any) => boolean>): boolean {
    let changed = false;
    for (const simplifier of simplifiers) {
        if (simplifier(node, context)) {
            changed = true;
        }
    }
    return changed;
}

// ---------------------------------------------------------------------------
// Parent-entry and parenthesis-unwrapping helpers (consolidated from duplication)
// ---------------------------------------------------------------------------

/**
 * Locate the parent node and property key that lead to `target` within `root`.
 *
 * This is used by `unwrapEnclosingParentheses` to iteratively climb the AST
 * without relying on temporary `parent` properties that may be stale after
 * mutations.
 */
export function findParentEntry(
    root: unknown,
    target: unknown
): { parent: unknown; key: string | number | null } | null {
    if (!isObjectLike(root) || !target) {
        return null;
    }

    const stack = [{ parent: null, key: null as string | number | null, node: root }];
    const visited = new Set<object>();

    while (stack.length > 0) {
        const entry = stack.pop();
        if (!entry) {
            continue;
        }

        const { parent, key, node } = entry;
        if (node === target) {
            return { parent, key };
        }

        if (!isObjectLike(node) || visited.has(node as object)) {
            continue;
        }

        visited.add(node as object);

        if (Array.isArray(node)) {
            for (let index = node.length - 1; index >= 0; index -= 1) {
                stack.push({ parent: node, key: index, node: node[index] });
            }
            continue;
        }

        for (const [childKey, childValue] of Object.entries(node)) {
            if (childKey === "parent") {
                continue;
            }

            if (!isObjectLike(childValue)) {
                continue;
            }

            stack.push({ parent: node, key: childKey, node: childValue });
        }
    }

    return null;
}

/**
 * Strip enclosing parenthesized-expression wrappers from `node` when all guards pass.
 *
 * Iteratively walks up the AST using `findParentEntry` and replaces each
 * parenthesized-expression with its inner expression, stopping when:
 * - The parent is not a parenthesized expression
 * - Either the wrapper or its inner expression carries a comment
 * - The inner expression is not a safe operand (and not a call expression)
 *
 * This consolidates the identical logic that previously existed in both
 * `math-traversal-normalization.ts` and `math-lengthdir-transforms.ts`.
 */
export function unwrapEnclosingParentheses(node: unknown, context: ConvertManualMathTransformOptions | null): void {
    if (!isObjectLike(node)) {
        return;
    }

    const root = context?.astRoot;
    if (!isObjectLike(root)) {
        return;
    }

    let current: unknown = node;
    while (true) {
        const parentInfo = findParentEntry(root, current);
        if (!parentInfo) {
            break;
        }

        const { parent } = parentInfo;
        if (!isObjectLike(parent)) {
            break;
        }

        if ((parent as { type?: string }).type !== PARENTHESIZED_EXPRESSION) {
            break;
        }

        const expression = (parent as { expression?: unknown }).expression;
        if (!expression) {
            break;
        }

        if (Core.hasComment(parent) || Core.hasComment(expression)) {
            break;
        }

        if (!isSafeOperand(parent) && (expression as { type?: string }).type !== CALL_EXPRESSION) {
            break;
        }

        replaceNodeWith(parent, current);
        current = parent;
    }
}
