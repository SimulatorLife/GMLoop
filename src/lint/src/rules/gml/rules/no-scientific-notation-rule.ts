import type { Rule } from "eslint";

import { forEachScientificNotationToken, toPlainDecimalFromScientificLiteral } from "../../../malformed/index.js";
import { createMeta } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

type ScientificNotationFix = Readonly<{
    start: number;
    end: number;
    replacement: string;
}>;

function collectScientificNotationFixes(sourceText: string): ReadonlyArray<ScientificNotationFix> {
    const fixes: ScientificNotationFix[] = [];

    forEachScientificNotationToken(sourceText, (start, end, scientificText) => {
        const replacement = toPlainDecimalFromScientificLiteral(scientificText);
        if (replacement && replacement !== scientificText) {
            fixes.push(Object.freeze({ start, end, replacement }));
        }
    });

    return fixes;
}

/**
 * Creates the `gml/no-scientific-notation` rule.
 *
 * Replaces unsupported scientific-notation numeric literals (for example,
 * `1e-11`) with equivalent plain decimal literals accepted by GML.
 */
export function createNoScientificNotationRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const fixes = collectScientificNotationFixes(sourceText);
                    for (const fix of fixes) {
                        context.report({
                            loc: context.sourceCode.getLocFromIndex(fix.start),
                            messageId: definition.messageId,
                            fix(fixer) {
                                return fixer.replaceTextRange([fix.start, fix.end], fix.replacement);
                            }
                        });
                    }
                }
            });
        }
    });
}
