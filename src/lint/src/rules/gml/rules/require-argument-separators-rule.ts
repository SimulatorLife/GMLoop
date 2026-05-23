import type { Rule } from "eslint";

import { gmlRuleLanguageServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, readObjectOption } from "../rule-base-helpers.js";

const { createLimitedRecoveryProjection } = gmlRuleLanguageServices;

type ArgumentSeparatorInsertion = Readonly<{
    originalOffset: number;
    insertedText: ",";
}>;

function tryReadArgumentSeparatorRecoveryFromParserServices(
    context: Rule.RuleContext
): ReadonlyArray<ArgumentSeparatorInsertion> | null {
    const parserServices = context.sourceCode.parserServices;
    if (!parserServices || typeof parserServices !== "object") {
        return null;
    }

    const parserServicesWithGml = parserServices as { gml?: unknown };
    if (!parserServicesWithGml.gml || typeof parserServicesWithGml.gml !== "object") {
        return null;
    }

    const gmlWithRecovery = parserServicesWithGml.gml as { recovery?: unknown };
    if (!Array.isArray(gmlWithRecovery.recovery)) {
        return null;
    }

    const insertions: Array<ArgumentSeparatorInsertion> = [];
    for (const recoveryEntry of gmlWithRecovery.recovery) {
        if (!recoveryEntry || typeof recoveryEntry !== "object") {
            continue;
        }

        const originalOffset = Reflect.get(recoveryEntry, "originalOffset");
        const insertedText = Reflect.get(recoveryEntry, "insertedText");

        if (typeof originalOffset === "number" && Number.isInteger(originalOffset) && insertedText === ",") {
            insertions.push(
                Object.freeze({
                    originalOffset,
                    insertedText
                })
            );
        }
    }

    return Object.freeze(insertions);
}

function collectArgumentSeparatorInsertionOffsets(
    context: Rule.RuleContext,
    sourceText: string
): ReadonlyArray<number> {
    const parserRecoveryInsertions = tryReadArgumentSeparatorRecoveryFromParserServices(context);
    const recoveries = parserRecoveryInsertions ?? createLimitedRecoveryProjection(sourceText).insertions;
    const uniqueOffsets = new Set<number>();

    for (const recovery of recoveries) {
        if (recovery.originalOffset < 0 || recovery.originalOffset > sourceText.length) {
            continue;
        }

        uniqueOffsets.add(recovery.originalOffset);
    }

    return Object.freeze([...uniqueOffsets].sort((left, right) => left - right));
}

export function createRequireArgumentSeparatorsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const options = readObjectOption(context);
            const shouldRepair = options.repair === undefined ? true : options.repair === true;

            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const insertionOffsets = collectArgumentSeparatorInsertionOffsets(context, sourceText);

                    for (const insertionOffset of insertionOffsets) {
                        context.report({
                            loc: context.sourceCode.getLocFromIndex(insertionOffset),
                            messageId: definition.messageId,
                            fix: shouldRepair
                                ? (fixer) => fixer.insertTextAfterRange([insertionOffset, insertionOffset], ",")
                                : null
                        });
                    }
                }
            });
        }
    });
}
