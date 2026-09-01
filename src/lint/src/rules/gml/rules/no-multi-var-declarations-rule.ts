import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, getNodeRange, isAstNodeRecord } from "../rule-base-helpers.js";

function getDeclarationKeyword(
    sourceText: string,
    declaration: Record<string, unknown>,
    firstDeclaratorStart: number
): string | null {
    const declarationStart = Core.getNodeStartIndex(declaration);
    if (typeof declarationStart !== "number") {
        return null;
    }

    const declarationPrefix = sourceText.slice(declarationStart, firstDeclaratorStart);
    const keyword = /\b(?:var|static|let|const)\b/iu.exec(declarationPrefix)?.[0];
    return keyword ?? (typeof declaration.kind === "string" ? declaration.kind : null);
}

function buildSplitDeclarationText(sourceText: string, declaration: Record<string, unknown>): string | null {
    if (!Array.isArray(declaration.declarations) || declaration.declarations.length < 2) {
        return null;
    }

    const declarationRange = getNodeRange(declaration);
    const firstDeclarator = isAstNodeRecord(declaration.declarations[0]) ? declaration.declarations[0] : null;
    const firstRange = getNodeRange(firstDeclarator);
    if (declarationRange === null || firstRange === null) {
        return null;
    }

    const keyword = getDeclarationKeyword(sourceText, declaration, firstRange.start);
    if (keyword === null) {
        return null;
    }

    let output = sourceText.slice(declarationRange.start, firstRange.end);
    let previousEnd = firstRange.end;

    for (const rawDeclarator of declaration.declarations.slice(1)) {
        if (!isAstNodeRecord(rawDeclarator)) {
            return null;
        }

        const currentRange = getNodeRange(rawDeclarator);
        if (currentRange === null) {
            return null;
        }

        const separator = sourceText.slice(previousEnd, currentRange.start);
        const maskedSeparator = Core.maskCommentsAndStringsForRecovery(separator, { maskDirectiveLines: true });
        const commaIndex = maskedSeparator.indexOf(",");
        if (commaIndex === -1) {
            return null;
        }

        output += `${separator.slice(0, commaIndex)};${separator.slice(commaIndex + 1)}${keyword} `;
        output += sourceText.slice(currentRange.start, currentRange.end);
        previousEnd = currentRange.end;
    }

    return output;
}

export function createNoMultiVarDeclarationsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Declare each variable in its own statement instead of using a multi-declarator declaration."
        }),
        create(context: Rule.RuleContext) {
            return Object.freeze({
                Program(programNode: unknown) {
                    const sourceText = context.sourceCode.text;

                    Core.traverseAst(programNode, {
                        enter(node, traversalContext) {
                            if (!isAstNodeRecord(node) || node.type !== "VariableDeclaration") {
                                return;
                            }

                            if (!Array.isArray(node.declarations) || node.declarations.length < 2) {
                                return;
                            }

                            const declarationRange = getNodeRange(node);
                            if (declarationRange === null) {
                                return;
                            }

                            const replacement =
                                traversalContext.parent?.type === "ForStatement" && traversalContext.key === "init"
                                    ? null
                                    : buildSplitDeclarationText(sourceText, node);

                            context.report({
                                loc: context.sourceCode.getLocFromIndex(declarationRange.start),
                                messageId: definition.messageId,
                                ...(replacement === null
                                    ? {}
                                    : {
                                          fix: (fixer) =>
                                              fixer.replaceTextRange(
                                                  [declarationRange.start, declarationRange.end],
                                                  replacement
                                              )
                                      })
                            });
                        }
                    });
                }
            });
        }
    });
}
