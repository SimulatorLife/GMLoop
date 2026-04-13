/**
 * Lint rule: gml/simplify-real-calls
 *
 * Detects calls to GML's built-in `real()` function that take a single string
 * literal argument whose content is a valid numeric literal, and replaces the
 * entire call expression with just the numeric literal.
 *
 * ### Architectural note
 *
 * This transform is **linter-owned** per target-state.md §2.1 and §3.2.
 * Substituting `real("0.5")` → `0.5` is a semantic/content rewrite (it
 * collapses a function call into a constant literal), which lies outside the
 * formatter's responsibility. The formatter may only perform layout and
 * canonical rendering transforms.
 *
 * ### Examples
 *
 * ```gml
 * // Before (lint warn + autofix)
 * var x = real("0.5");
 * var y = REAL("123");
 *
 * // After --write
 * var x = 0.5;
 * var y = 123;
 * ```
 */

import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, getNodeEndIndex, getNodeStartIndex, isAstNodeRecord, walkAstNodes } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

/**
 * Matches a valid GML numeric literal string: optional sign, integer part,
 * optional decimal, and optional exponent. Used to validate that the content
 * of the string argument to `real()` can be safely emitted as a bare literal.
 */
const NUMERIC_STRING_LITERAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Extracts the inner content of a GML string literal node value.
 *
 * The GML AST stores the raw source representation in `Literal.value`,
 * including surrounding quote characters. This function strips the quotes so
 * callers can inspect the plain string content.
 *
 * Handles both regular quoted strings (`"..."` / `'...'`) and GML verbatim
 * strings (`@"..."`).
 *
 * @param rawValue - The raw value from a `Literal` AST node.
 * @returns The inner string content, or `null` if the value is not a
 *   recognizable quoted string form.
 */
function extractStringLiteralContent(rawValue: string): string | null {
    if (rawValue.startsWith('@"') && rawValue.endsWith('"') && rawValue.length >= 3) {
        return rawValue.slice(2, -1) || null;
    }

    return Core.stripStringQuotes(rawValue);
}

/**
 * Returns the numeric string if the given node is a `real("...")` call
 * expression with a single string literal argument whose content is a valid
 * numeric literal. Returns `null` otherwise.
 *
 * The callee name check is case-insensitive because GML is case-insensitive for
 * built-in function names (e.g. `REAL("1")` is equivalent to `real("1")`).
 *
 * @param node - Candidate AST node.
 * @returns The numeric string content to substitute, or `null` when the node
 *   does not match the pattern.
 */
function resolveRealCallNumericValue(node: unknown): string | null {
    if (!isAstNodeRecord(node) || node.type !== "CallExpression") {
        return null;
    }

    if (!Core.isCallExpressionIdentifierMatch(node, "real", { caseInsensitive: true })) {
        return null;
    }

    const args = node.arguments;
    if (!Array.isArray(args) || args.length !== 1) {
        return null;
    }

    const argument = args[0];
    if (!isAstNodeRecord(argument) || argument.type !== "Literal") {
        return null;
    }

    const rawValue = typeof argument.value === "string" ? argument.value : null;
    if (!rawValue) {
        return null;
    }

    const innerContent = extractStringLiteralContent(rawValue);
    if (!innerContent) {
        return null;
    }

    const trimmed = innerContent.trim();
    return NUMERIC_STRING_LITERAL_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Creates the `gml/simplify-real-calls` rule.
 *
 * Replaces `real("<numeric>")` call expressions with the bare numeric literal.
 * This is a semantics-preserving transform because `real()` is a pure
 * string-to-number conversion that produces the same value as the literal.
 */
export function createSimplifyRealCallsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    walkAstNodes(programNode, (node) => {
                        const numericValue = resolveRealCallNumericValue(node);
                        if (!numericValue) {
                            return;
                        }

                        const start = getNodeStartIndex(node);
                        const end = getNodeEndIndex(node);
                        if (typeof start !== "number" || typeof end !== "number") {
                            return;
                        }

                        context.report({
                            node: node as Rule.Node,
                            messageId: definition.messageId,
                            fix(fixer) {
                                return fixer.replaceTextRange([start, end], numericValue);
                            }
                        });
                    });
                }
            });
        }
    });
}
