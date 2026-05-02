import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import {
    computeLineStartOffsets,
    createMeta,
    findFirstChangedCharacterOffset,
    isCommentOnlyLine,
    shouldReportUnsafe,
    type GmlRuleDefinition
} from "../rule-base-helpers.js";

type StructAssignmentRecord = Readonly<{
    indentation: string;
    objectName: string;
    propertyName: string;
    valueText: string;
    trailingComment: string | null;
}>;

function containsInlineCommentTokens(valueText: string): boolean {
    return valueText.includes("//") || valueText.includes("/*") || valueText.includes("*/");
}

function parseStructAssignmentLine(line: string): StructAssignmentRecord | null {
    const dotAssignmentPattern =
        /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);\s*(?:\/\/\s*(.*))?$/u;
    const staticIndexAssignmentPattern =
        /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\[\$\s*(?:"([A-Za-z_][A-Za-z0-9_]*)"|'([A-Za-z_][A-Za-z0-9_]*)')\s*\]\s*=\s*(.+?);\s*(?:\/\/\s*(.*))?$/u;

    const dotAssignmentMatch = dotAssignmentPattern.exec(line);
    if (dotAssignmentMatch) {
        return Object.freeze({
            indentation: dotAssignmentMatch[1],
            objectName: dotAssignmentMatch[2],
            propertyName: dotAssignmentMatch[3],
            valueText: dotAssignmentMatch[4].trim(),
            trailingComment:
                typeof dotAssignmentMatch[5] === "string" && dotAssignmentMatch[5].trim().length > 0
                    ? dotAssignmentMatch[5].trim()
                    : null
        });
    }

    const staticIndexAssignmentMatch = staticIndexAssignmentPattern.exec(line);
    if (!staticIndexAssignmentMatch) {
        return null;
    }

    const propertyName = staticIndexAssignmentMatch[3] ?? staticIndexAssignmentMatch[4] ?? "";
    if (!Core.isGmlIdentifierName(propertyName)) {
        return null;
    }

    return Object.freeze({
        indentation: staticIndexAssignmentMatch[1],
        objectName: staticIndexAssignmentMatch[2],
        propertyName,
        valueText: staticIndexAssignmentMatch[5].trim(),
        trailingComment:
            typeof staticIndexAssignmentMatch[6] === "string" && staticIndexAssignmentMatch[6].trim().length > 0
                ? staticIndexAssignmentMatch[6].trim()
                : null
    });
}

function parseEmptyStructDeclarationLine(line: string): Readonly<{
    indentation: string;
    declarationPrefix: string;
    objectName: string;
}> | null {
    const emptyStructDeclarationPattern = /^(\s*)((?:var\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*\}\s*;\s*$/u;
    const declarationMatch = emptyStructDeclarationPattern.exec(line);
    if (!declarationMatch) {
        return null;
    }

    return Object.freeze({
        indentation: declarationMatch[1],
        declarationPrefix: declarationMatch[2],
        objectName: declarationMatch[3]
    });
}

function createStructLiteralBlock(
    indentation: string,
    declarationPrefix: string,
    objectName: string,
    assignments: ReadonlyArray<StructAssignmentRecord>,
    compactLiteralSpacing: boolean
): ReadonlyArray<string> {
    const hasTrailingComments = assignments.some((assignment) => typeof assignment.trailingComment === "string");

    if (!hasTrailingComments) {
        const propertyInitializers = assignments.map(
            (assignment) => `${assignment.propertyName}: ${assignment.valueText}`
        );
        const openingBrace = compactLiteralSpacing ? "{" : "{ ";
        const closingBrace = compactLiteralSpacing ? "}" : " }";
        return Object.freeze([
            `${indentation}${declarationPrefix}${objectName} = ${openingBrace}${propertyInitializers.join(", ")}${closingBrace};`
        ]);
    }

    const entryIndentation = `${indentation}    `;
    const blockLines: Array<string> = [`${indentation}${declarationPrefix}${objectName} = {`];
    for (const [assignmentIndex, assignment] of assignments.entries()) {
        const isLastAssignment = assignmentIndex === assignments.length - 1;
        const separator = isLastAssignment ? "" : ",";
        const trailingCommentSuffix = assignment.trailingComment === null ? "" : ` // ${assignment.trailingComment}`;
        blockLines.push(
            `${entryIndentation}${assignment.propertyName}: ${assignment.valueText}${separator}${trailingCommentSuffix}`
        );
    }
    blockLines.push(`${indentation}};`);
    return Object.freeze(blockLines);
}

export function createPreferStructLiteralAssignmentsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const shouldReportUnsafeFixes = shouldReportUnsafe(context);
            const listener: Rule.RuleListener = {
                Program() {
                    const text = context.sourceCode.text;
                    const lines = text.split(/\r?\n/);
                    const lineStartOffsets = computeLineStartOffsets(text);

                    const rewrittenLines: Array<string> = [];
                    let firstUnsafeOffset: number | null = null;
                    let firstRewriteOffset: number | null = null;
                    let lineIndex = 0;
                    while (lineIndex < lines.length) {
                        const firstAssignment = parseStructAssignmentLine(lines[lineIndex]);
                        const nestedSelfAssignmentCluster =
                            firstAssignment !== null &&
                            firstAssignment.objectName === "self" &&
                            firstAssignment.indentation.length > 4;
                        if (
                            !firstAssignment ||
                            nestedSelfAssignmentCluster ||
                            !Core.isGmlIdentifierName(firstAssignment.objectName) ||
                            firstAssignment.objectName.toLowerCase() === "global"
                        ) {
                            rewrittenLines.push(lines[lineIndex]);
                            lineIndex += 1;
                            continue;
                        }

                        const cluster: Array<StructAssignmentRecord> = [firstAssignment];
                        let clusterEndIndex = lineIndex;
                        while (clusterEndIndex + 1 < lines.length) {
                            const nextAssignment = parseStructAssignmentLine(lines[clusterEndIndex + 1]);
                            if (!nextAssignment) {
                                break;
                            }

                            if (
                                nextAssignment.objectName !== firstAssignment.objectName ||
                                nextAssignment.indentation !== firstAssignment.indentation
                            ) {
                                break;
                            }

                            cluster.push(nextAssignment);
                            clusterEndIndex += 1;
                        }

                        const previousLine = lineIndex > 0 ? lines[lineIndex - 1] : "";
                        const hasLeadingCommentBarrier = isCommentOnlyLine(previousLine);
                        const declarationRecord =
                            lineIndex === 0 ? null : parseEmptyStructDeclarationLine(previousLine);
                        const hasImmediateStructCreation =
                            declarationRecord !== null &&
                            declarationRecord.objectName === firstAssignment.objectName &&
                            declarationRecord.indentation === firstAssignment.indentation &&
                            !hasLeadingCommentBarrier;

                        if (!hasImmediateStructCreation) {
                            rewrittenLines.push(lines[lineIndex]);
                            lineIndex += 1;
                            continue;
                        }

                        const assignmentColumnOffset = lines[lineIndex].search(/[A-Za-z_]/u);
                        const reportOffset = (lineStartOffsets[lineIndex] ?? 0) + Math.max(assignmentColumnOffset, 0);
                        const seenProperties = new Set<string>();
                        let hasInlineCommentInValue = false;
                        let hasDuplicatePropertyAssignment = false;
                        for (const assignment of cluster) {
                            if (containsInlineCommentTokens(assignment.valueText)) {
                                hasInlineCommentInValue = true;
                                break;
                            }

                            if (seenProperties.has(assignment.propertyName)) {
                                hasDuplicatePropertyAssignment = true;
                                break;
                            }

                            seenProperties.add(assignment.propertyName);
                        }

                        if (hasDuplicatePropertyAssignment) {
                            for (let currentIndex = lineIndex; currentIndex <= clusterEndIndex; currentIndex += 1) {
                                rewrittenLines.push(lines[currentIndex]);
                            }
                            lineIndex = clusterEndIndex + 1;
                            continue;
                        }

                        if (hasInlineCommentInValue) {
                            if (firstUnsafeOffset === null) {
                                firstUnsafeOffset = reportOffset;
                            }

                            for (let currentIndex = lineIndex; currentIndex <= clusterEndIndex; currentIndex += 1) {
                                rewrittenLines.push(lines[currentIndex]);
                            }
                            lineIndex = clusterEndIndex + 1;
                            continue;
                        }

                        if (firstRewriteOffset === null) {
                            firstRewriteOffset = reportOffset;
                        }

                        const rewrittenLiteralBlock = createStructLiteralBlock(
                            firstAssignment.indentation,
                            declarationRecord.declarationPrefix,
                            firstAssignment.objectName,
                            cluster,
                            true
                        );

                        if (rewrittenLines.length > 0) {
                            rewrittenLines.pop();
                        }
                        rewrittenLines.push(...rewrittenLiteralBlock);

                        lineIndex = clusterEndIndex + 1;
                    }

                    const rewrittenText = rewrittenLines.join(Core.dominantLineEnding(text));
                    if (rewrittenText !== text) {
                        context.report({
                            loc: context.sourceCode.getLocFromIndex(
                                firstRewriteOffset ?? findFirstChangedCharacterOffset(text, rewrittenText)
                            ),
                            messageId: definition.messageId,
                            fix: (fixer) => fixer.replaceTextRange([0, text.length], rewrittenText)
                        });
                    }

                    if (firstUnsafeOffset !== null && shouldReportUnsafeFixes) {
                        context.report({
                            loc: context.sourceCode.getLocFromIndex(firstUnsafeOffset),
                            messageId: "unsafeFix"
                        });
                    }
                }
            };

            return Object.freeze(listener);
        }
    });
}
