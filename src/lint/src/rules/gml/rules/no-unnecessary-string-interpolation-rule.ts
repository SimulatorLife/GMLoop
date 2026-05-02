import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, isAstNodeRecord, walkAstNodes, type GmlRuleDefinition } from "../rule-base-helpers.js";

function hasInterpolationAtoms(atoms: ReadonlyArray<unknown>): boolean {
    return atoms.some((atom) => !isAstNodeRecord(atom) || atom.type !== "TemplateStringText");
}

function isUnnecessaryTemplateStringExpression(node: unknown): node is Rule.Node {
    if (!isAstNodeRecord(node) || node.type !== "TemplateStringExpression") {
        return false;
    }

    if (!Array.isArray(node.atoms)) {
        return false;
    }

    return !hasInterpolationAtoms(node.atoms);
}

/**
 * Creates the `gml/no-unnecessary-string-interpolation` rule.
 *
 * This rule reports template strings that contain no interpolation atoms,
 * and auto-fixes them by removing the `$` prefix.
 */
export function createNoUnnecessaryStringInterpolationRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const sourceText = context.sourceCode.text;

                    walkAstNodes(programNode, (candidateNode) => {
                        if (!isUnnecessaryTemplateStringExpression(candidateNode)) {
                            return;
                        }

                        const start = Core.getNodeStartIndex(candidateNode);
                        const end = Core.getNodeEndIndex(candidateNode);
                        if (typeof start !== "number" || typeof end !== "number") {
                            return;
                        }

                        const originalText = sourceText.slice(start, end);
                        if (!originalText.startsWith("$")) {
                            return;
                        }

                        context.report({
                            node: candidateNode,
                            messageId: definition.messageId,
                            fix(fixer) {
                                return fixer.replaceTextRange([start, end], originalText.slice(1));
                            }
                        });
                    });
                }
            });
        }
    });
}
