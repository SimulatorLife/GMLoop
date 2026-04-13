/**
 * Deep structural equivalence comparison for GameMaker AST nodes.
 *
 * Compares two AST subtrees for structural identity while ignoring
 * position/metadata keys (start, end, range, loc, parent, comments, tokens)
 * that differ between two otherwise identical subtrees at different source
 * positions. Optionally unwraps `ParenthesizedExpression` wrappers before
 * comparison so parenthesised and non-parenthesised forms are treated as
 * equivalent.
 *
 * **Prior location**: `src/lint/src/rules/gml/ast-node-equivalence.ts`.
 * Moved here because Core owns "Clone / equality helpers" (target-state.md
 * §2.1) and this module has zero lint-specific dependencies—it only relies
 * on `unwrapParenthesizedExpression` from Core's own node helpers.
 */

import { unwrapParenthesizedExpression } from "./node-helpers/index.js";
import type { GameMakerAstNode } from "./types.js";

/**
 * AST metadata keys that carry position/token data and should be excluded
 * when comparing two expression nodes for structural equivalence. Keys such
 * as `"start"`, `"end"`, and `"loc"` differ between two otherwise identical
 * subtrees that appear at different source positions.
 */
export const IGNORED_AST_METADATA_KEYS = new Set(["start", "end", "range", "loc", "parent", "comments", "tokens"]);

/**
 * Deep-compares two raw AST values for structural equivalence, recursively
 * descending into objects and arrays while skipping metadata keys listed in
 * {@link IGNORED_AST_METADATA_KEYS}.
 *
 * Callers that want `ParenthesizedExpression` wrappers to be treated as
 * transparent should call {@link areExpressionNodesEquivalentIgnoringParentheses}
 * instead, which strips those wrappers before delegating here.
 */
export function areAstValuesEquivalentIgnoringParentheses(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }

    if (left === null || right === null) {
        return false;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }

        for (const [index, element] of left.entries()) {
            if (!areExpressionNodesEquivalentIgnoringParentheses(element, right[index])) {
                return false;
            }
        }

        return true;
    }

    if (typeof left !== typeof right) {
        return false;
    }

    if (typeof left !== "object" || typeof right !== "object") {
        return false;
    }

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;

    for (const [leftKey, leftValue] of Object.entries(leftRecord)) {
        if (IGNORED_AST_METADATA_KEYS.has(leftKey)) {
            continue;
        }

        if (!(leftKey in rightRecord)) {
            return false;
        }

        if (!areExpressionNodesEquivalentIgnoringParentheses(leftValue, rightRecord[leftKey])) {
            return false;
        }
    }

    for (const rightKey of Object.keys(rightRecord)) {
        if (IGNORED_AST_METADATA_KEYS.has(rightKey)) {
            continue;
        }

        if (!(rightKey in leftRecord)) {
            return false;
        }
    }

    return true;
}

/**
 * Compares two expression nodes for structural equivalence after stripping
 * any surrounding `ParenthesizedExpression` wrappers from both sides.
 *
 * This is the preferred entry point for rules that need to determine whether
 * two expressions are semantically identical regardless of redundant parens.
 */
export function areExpressionNodesEquivalentIgnoringParentheses(left: unknown, right: unknown): boolean {
    return areAstValuesEquivalentIgnoringParentheses(
        unwrapParenthesizedExpression(left as GameMakerAstNode | null | undefined),
        unwrapParenthesizedExpression(right as GameMakerAstNode | null | undefined)
    );
}
