import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, isAstNodeRecord, resolveLocFromIndex, type GmlRuleDefinition } from "../rule-base-helpers.js";

function collectGlobalVarStatementStartOffsets(programNode: unknown): ReadonlyArray<number> {
    const statementStartOffsets: Array<number> = [];

    const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const element of node) {
                visit(element);
            }
            return;
        }

        if (!isAstNodeRecord(node)) {
            return;
        }

        if (node.type === "GlobalVarStatement") {
            const start = Core.getNodeStartIndex(node);
            if (typeof start === "number") {
                statementStartOffsets.push(start);
            }
        }

        Core.forEachNodeChild(node, (childNode) => visit(childNode));
    };

    visit(programNode);
    return statementStartOffsets;
}

export function createNoGlobalvarRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, { includeFixableDefault: false }),
        create(context) {
            const listener: Rule.RuleListener = {
                Program(programNode) {
                    const globalVarStatementStartOffsets = collectGlobalVarStatementStartOffsets(programNode);
                    if (globalVarStatementStartOffsets.length === 0) {
                        return;
                    }

                    const sourceText = context.sourceCode.text;
                    const firstViolationLoc = resolveLocFromIndex(
                        context,
                        sourceText,
                        globalVarStatementStartOffsets[0] ?? 0
                    );

                    context.report({
                        loc: firstViolationLoc,
                        messageId: definition.messageId
                    });
                }
            };

            return Object.freeze(listener);
        }
    });
}
