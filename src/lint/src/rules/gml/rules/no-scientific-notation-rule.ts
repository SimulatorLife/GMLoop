import type { Rule } from "eslint";

import { gmlRuleMalformedServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta } from "../rule-base-helpers.js";

const { forEachScientificNotationToken, toPlainDecimalFromScientificLiteral } = gmlRuleMalformedServices;

/**
 * Creates the `gml/no-scientific-notation` rule.
 *
 * Reports scientific-notation numeric literals such as `1e-11` that GML
 * cannot parse natively. Each match is only flagged when the underlying
 * plain-decimal conversion succeeds, so cases that exceed the formatter's
 * fixed-literal length limit are left alone rather than producing a
 * "reported but unfixable" diagnostic.
 */
export function createNoScientificNotationRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    forEachScientificNotationToken(sourceText, (start, _end, scientificText) => {
                        const replacement = toPlainDecimalFromScientificLiteral(scientificText);
                        if (!replacement || replacement === scientificText) {
                            return;
                        }

                        context.report({
                            loc: context.sourceCode.getLocFromIndex(start),
                            messageId: definition.messageId
                        });
                    });
                }
            });
        }
    });
}
