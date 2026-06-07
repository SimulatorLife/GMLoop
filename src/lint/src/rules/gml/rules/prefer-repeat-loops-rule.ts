import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, findMatchingBraceEndIndex } from "../rule-base-helpers.js";

type RepeatLoopCandidate = Readonly<{
    limitExpression: string;
    loopStartIndex: number;
    loopHeaderEndIndex: number;
}>;

function usesUnitIncrement(iteratorName: string, updateExpression: string): boolean {
    const compactExpression = updateExpression.replaceAll(/\s+/g, "");
    return (
        compactExpression === `${iteratorName}++` ||
        compactExpression === `++${iteratorName}` ||
        compactExpression === `${iteratorName}+=1` ||
        compactExpression === `${iteratorName}=${iteratorName}+1`
    );
}

function collectRepeatLoopCandidates(sourceText: string): Array<RepeatLoopCandidate> {
    const candidates: Array<RepeatLoopCandidate> = [];
    const forLoopPattern =
        /for\s*\(\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*0\s*;\s*([A-Za-z_][A-Za-z0-9_]*)\s*<\s*([^;]+?)\s*;\s*([^)]+?)\s*\)\s*\{/g;

    for (const match of sourceText.matchAll(forLoopPattern)) {
        const matchStartIndex = match.index ?? 0;
        const iteratorName = match[1];
        const conditionLeftIdentifier = match[2];
        const limitExpression = match[3].trim();
        const updateExpression = match[4];

        if (conditionLeftIdentifier !== iteratorName || limitExpression.length === 0) {
            continue;
        }

        if (!usesUnitIncrement(iteratorName, updateExpression)) {
            continue;
        }

        const iteratorPattern = new RegExp(String.raw`\b${Core.escapeRegExp(iteratorName)}\b`, "u");
        if (iteratorPattern.test(limitExpression)) {
            continue;
        }

        const loopOpenBraceIndex = matchStartIndex + match[0].length - 1;
        const loopEndIndex = findMatchingBraceEndIndex(sourceText, loopOpenBraceIndex);
        if (loopEndIndex === -1) {
            continue;
        }

        const loopBodyText = sourceText.slice(loopOpenBraceIndex + 1, loopEndIndex - 1);
        if (iteratorPattern.test(loopBodyText)) {
            continue;
        }

        candidates.push({
            limitExpression,
            loopStartIndex: matchStartIndex,
            loopHeaderEndIndex: loopOpenBraceIndex + 1
        });
    }

    return candidates;
}

export function createPreferRepeatLoopsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const loopCandidates = collectRepeatLoopCandidates(sourceText);
                    for (const loopCandidate of loopCandidates) {
                        context.report({
                            loc: context.sourceCode.getLocFromIndex(loopCandidate.loopStartIndex),
                            messageId: definition.messageId,
                            fix: (fixer) =>
                                fixer.replaceTextRange(
                                    [loopCandidate.loopStartIndex, loopCandidate.loopHeaderEndIndex],
                                    `repeat (${loopCandidate.limitExpression}) {`
                                )
                        });
                    }
                }
            });
        }
    });
}
