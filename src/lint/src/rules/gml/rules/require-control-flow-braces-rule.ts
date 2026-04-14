import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, findPreviousNonWhitespaceIndex } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

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
        node: branchNode as never,
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
            return Object.freeze({
                IfStatement(node: unknown) {
                    if (!isControlFlowStatementNode(node)) {
                        return;
                    }

                    const isElseIfBranch = isElseIfBranchBySourceContext(context.sourceCode.text, node);
                    const consequentNode = node.consequent;
                    if (!isControlFlowStatementNode(consequentNode)) {
                        return;
                    }

                    if (!isBlockStatementNode(consequentNode)) {
                        const consequentFix = isElseIfBranch
                            ? undefined
                            : (fixer: Rule.RuleFixer) => {
                                  const bodyReplacement = computeWrappedControlFlowBodyReplacement(
                                      context.sourceCode.text,
                                      consequentNode
                                  );
                                  if (bodyReplacement === null) {
                                      return null;
                                  }

                                  const headerReplacement = computeCanonicalIfHeaderReplacement(
                                      context.sourceCode.text,
                                      node
                                  );
                                  if (headerReplacement === null) {
                                      return fixer.replaceTextRange(
                                          [bodyReplacement.rangeStart, bodyReplacement.rangeEnd],
                                          bodyReplacement.replacementText
                                      );
                                  }

                                  return [
                                      fixer.replaceTextRange(
                                          [headerReplacement.rangeStart, headerReplacement.rangeEnd],
                                          headerReplacement.replacementText
                                      ),
                                      fixer.replaceTextRange(
                                          [bodyReplacement.rangeStart, bodyReplacement.rangeEnd],
                                          bodyReplacement.replacementText
                                      )
                                  ];
                              };
                        context.report({
                            node: consequentNode as never,
                            messageId: definition.messageId,
                            fix: consequentFix
                        });
                    }

                    if (node.alternate === null || node.alternate === undefined || isIfStatementNode(node.alternate)) {
                        return;
                    }

                    reportMissingBlockBody(context, definition.messageId, node.alternate, true);
                },
                WhileStatement(node: unknown) {
                    if (!isControlFlowStatementNode(node)) {
                        return;
                    }

                    reportMissingBlockBody(context, definition.messageId, node.body, true);
                },
                ForStatement(node: unknown) {
                    if (!isControlFlowStatementNode(node)) {
                        return;
                    }

                    reportMissingBlockBody(context, definition.messageId, node.body, true);
                },
                RepeatStatement(node: unknown) {
                    if (!isControlFlowStatementNode(node)) {
                        return;
                    }

                    reportMissingBlockBody(context, definition.messageId, node.body, true);
                },
                DoUntilStatement(node: unknown) {
                    if (!isControlFlowStatementNode(node)) {
                        return;
                    }

                    reportMissingBlockBody(context, definition.messageId, node.body, true);
                },
                WithStatement(node: unknown) {
                    if (!isControlFlowStatementNode(node)) {
                        return;
                    }

                    reportMissingBlockBody(context, definition.messageId, node.body, true);
                }
            });
        }
    });
}
