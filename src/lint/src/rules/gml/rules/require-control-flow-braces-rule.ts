import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, findPreviousNonWhitespaceIndex } from "../rule-base-helpers.js";

type ControlFlowStatementNode = Readonly<Record<string, unknown> & { type: string }>;

function isControlFlowStatementNode(node: unknown): node is ControlFlowStatementNode {
    return typeof node === "object" && node !== null && typeof Reflect.get(node, "type") === "string";
}

function isBlockStatementNode(node: unknown): boolean {
    return isControlFlowStatementNode(node) && node.type === "BlockStatement";
}

function isIfStatementNode(node: unknown): boolean {
    return isControlFlowStatementNode(node) && node.type === "IfStatement";
}

function isElseIfBranchBySourceContext(sourceText: string, node: ControlFlowStatementNode): boolean {
    const nodeStartIndex = Core.getNodeStartIndex(node);
    if (nodeStartIndex === null || nodeStartIndex === 0) {
        return false;
    }

    const cursor = findPreviousNonWhitespaceIndex(sourceText, nodeStartIndex, true);
    if (cursor === null) {
        return false;
    }

    const elseText = "else";
    const elseStartIndex = cursor - elseText.length + 1;
    if (elseStartIndex < 0) {
        return false;
    }

    return sourceText.slice(elseStartIndex, cursor + 1) === elseText;
}

function bodyNodeNeedsStatementSemicolon(bodyNode: ControlFlowStatementNode): boolean {
    switch (bodyNode.type) {
        case "CallExpression":
        case "AssignmentExpression":
        case "ExpressionStatement":
        case "IdentifierStatement":
        case "IncDecStatement":
        case "ReturnStatement":
        case "BreakStatement":
        case "ContinueStatement":
        case "ExitStatement":
        case "ThrowStatement":
        case "VariableDeclaration": {
            return true;
        }
        default: {
            return false;
        }
    }
}

function computeCanonicalIfHeaderReplacement(
    sourceText: string,
    ifNode: ControlFlowStatementNode
): Readonly<{ rangeStart: number; rangeEnd: number; replacementText: string }> | null {
    const ifStartIndex = Core.getNodeStartIndex(ifNode);
    const bodyNode = ifNode.consequent;
    const bodyStartIndex = Core.getNodeStartIndex(bodyNode);
    const testNode = ifNode.test;
    const testStartIndex = Core.getNodeStartIndex(testNode);
    const testEndIndex = Core.getNodeEndIndex(testNode);
    if (
        ifStartIndex === null ||
        bodyStartIndex === null ||
        testStartIndex === null ||
        testEndIndex === null ||
        testEndIndex <= testStartIndex ||
        bodyStartIndex <= ifStartIndex
    ) {
        return null;
    }

    const headerText = sourceText.slice(ifStartIndex, bodyStartIndex);
    if (/^\s*if\s*\(/u.test(headerText) && !/\bthen\b/u.test(headerText)) {
        return null;
    }

    return {
        rangeStart: ifStartIndex,
        rangeEnd: bodyStartIndex,
        replacementText: `if (${sourceText.slice(testStartIndex, testEndIndex)}) `
    };
}

function computeWrappedControlFlowBodyReplacement(
    sourceText: string,
    bodyNode: ControlFlowStatementNode
): Readonly<{ rangeStart: number; rangeEnd: number; replacementText: string }> | null {
    const bodyStartIndex = Core.getNodeStartIndex(bodyNode);
    const bodyEndIndex = Core.getNodeEndIndex(bodyNode);
    if (bodyStartIndex === null || bodyEndIndex === null || bodyEndIndex <= bodyStartIndex) {
        return null;
    }

    let rangeEnd = bodyEndIndex;
    while (rangeEnd < sourceText.length && (sourceText[rangeEnd] === " " || sourceText[rangeEnd] === "\t")) {
        rangeEnd += 1;
    }

    const hasTrailingSemicolon = sourceText[rangeEnd] === ";";
    if (hasTrailingSemicolon) {
        rangeEnd += 1;
    }

    const bodyText = sourceText.slice(bodyStartIndex, bodyEndIndex);
    const statementText = hasTrailingSemicolon
        ? sourceText.slice(bodyStartIndex, rangeEnd)
        : `${bodyText}${bodyNodeNeedsStatementSemicolon(bodyNode) ? ";" : ""}`;
    return {
        rangeStart: bodyStartIndex,
        rangeEnd,
        replacementText: `{ ${statementText} }`
    };
}

/**
 * Builds the autofix callback for an `if` statement whose consequent is not
 * already wrapped in a block. The fix wraps the consequent body in braces and,
 * when the parent `if (...) then` header used the legacy `then` keyword,
 * also rewrites the header to the canonical `if (...)` form. The two fixes
 * share their `fixer` calls so the visitor does not need to know about the
 * individual `replaceTextRange` plumbing.
 *
 * @param sourceText - Full source text for the program being linted.
 * @param ifNode - The enclosing `IfStatement` node.
 * @param consequentNode - The `if` consequent body that needs wrapping.
 * @returns A fix callback suitable for `context.report({ fix })`.
 */
function buildIfConsequentFix(
    sourceText: string,
    ifNode: ControlFlowStatementNode,
    consequentNode: ControlFlowStatementNode
): (fixer: Rule.RuleFixer) => Rule.Fix | Rule.Fix[] | null {
    return (fixer) => {
        const bodyReplacement = computeWrappedControlFlowBodyReplacement(sourceText, consequentNode);
        if (bodyReplacement === null) {
            return null;
        }

        const bodyFix = fixer.replaceTextRange(
            [bodyReplacement.rangeStart, bodyReplacement.rangeEnd],
            bodyReplacement.replacementText
        );

        const headerReplacement = computeCanonicalIfHeaderReplacement(sourceText, ifNode);
        if (headerReplacement === null) {
            return bodyFix;
        }

        return [
            fixer.replaceTextRange(
                [headerReplacement.rangeStart, headerReplacement.rangeEnd],
                headerReplacement.replacementText
            ),
            bodyFix
        ];
    };
}

function reportMissingControlFlowBraces(
    context: Rule.RuleContext,
    messageId: string,
    branchNode: unknown,
    allowAutofix: boolean
): void {
    if (!isControlFlowStatementNode(branchNode)) {
        return;
    }

    context.report({
        node: branchNode,
        messageId,
        fix: allowAutofix
            ? (fixer) => {
                  const replacement = computeWrappedControlFlowBodyReplacement(context.sourceCode.text, branchNode);
                  if (replacement === null) {
                      return null;
                  }

                  return fixer.replaceTextRange(
                      [replacement.rangeStart, replacement.rangeEnd],
                      replacement.replacementText
                  );
              }
            : undefined
    });
}

function reportMissingBlockBody(
    context: Rule.RuleContext,
    messageId: string,
    bodyNode: unknown,
    allowAutofix: boolean
): void {
    if (isBlockStatementNode(bodyNode)) {
        return;
    }

    reportMissingControlFlowBraces(context, messageId, bodyNode, allowAutofix);
}

export function createRequireControlFlowBracesRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Control-flow statements must use braces."
        }),
        create(context) {
            // The `while` / `for` / `repeat` / `do-until` / `with` visitors share
            // an identical body: report a missing block body for `node.body`.
            // Sharing one handler keeps the visitor declaration concise and
            // prevents the cases from drifting apart when the rule evolves.
            const reportMissingBodyBraces = (node: unknown) => {
                if (!isControlFlowStatementNode(node)) {
                    return;
                }

                reportMissingBlockBody(context, definition.messageId, node.body, true);
            };

            const handleIfStatement = (node: unknown) => {
                if (!isControlFlowStatementNode(node)) {
                    return;
                }

                const isElseIfBranch = isElseIfBranchBySourceContext(context.sourceCode.text, node);
                const consequentNode = node.consequent;
                if (!isControlFlowStatementNode(consequentNode)) {
                    return;
                }

                if (!isBlockStatementNode(consequentNode)) {
                    context.report({
                        node: consequentNode as never,
                        messageId: definition.messageId,
                        fix: isElseIfBranch
                            ? undefined
                            : buildIfConsequentFix(context.sourceCode.text, node, consequentNode)
                    });
                }

                if (node.alternate === null || node.alternate === undefined || isIfStatementNode(node.alternate)) {
                    return;
                }

                reportMissingBlockBody(context, definition.messageId, node.alternate, true);
            };

            return Object.freeze({
                IfStatement: handleIfStatement,
                WhileStatement: reportMissingBodyBraces,
                ForStatement: reportMissingBodyBraces,
                RepeatStatement: reportMissingBodyBraces,
                DoUntilStatement: reportMissingBodyBraces,
                WithStatement: reportMissingBodyBraces
            });
        }
    });
}
