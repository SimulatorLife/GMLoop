import { Core } from "@gmloop/core";

import { forEachScientificNotationToken } from "../malformed/scientific-notation-scan.js";
import { recoverParseSourceFromMissingBrace } from "../malformed/source-preprocessing.js";
import { findNextNonWhitespaceIndex, findPreviousNonWhitespaceIndex } from "../rules/gml/rule-base-helpers.js";

export type RecoveryMode = "none" | "limited";

export const INSERTED_ARGUMENT_SEPARATOR_KIND = "inserted-argument-separator" as const;

export type RecoveryTextInsertion = {
    recoveredOffset: number;
    originalOffset: number;
    insertedText: string;
};

export type InsertedArgumentSeparatorRecovery = {
    kind: typeof INSERTED_ARGUMENT_SEPARATOR_KIND;
    recoveredOffset: number;
    originalOffset: number;
    insertedText: ",";
};

export type RecoveryProjection = {
    parseSource: string;
    insertions: ReadonlyArray<InsertedArgumentSeparatorRecovery>;
    textInsertions: ReadonlyArray<RecoveryTextInsertion>;
};

const UPPERCASE_LOGICAL_ALIAS_PATTERN = /\b(?:AND|OR|XOR|NOT)\b/gy;
const STRING_LENGTH_PROPERTY = ".length";
const ORPHAN_ASSIGNMENT_STATEMENT_PATTERN = /^\s*=\s*(?:\S.*)?;\s*$/u;
const NUMERIC_ASSIGNMENT_STATEMENT_PATTERN = /^\s*\d+(?:\.\d+)?\s*=\s*/u;
const THIS_MULTIPLICATION_STATEMENT_PATTERN = /^\s*_this\s*\*\s*[A-Za-z_][A-Za-z0-9_]*\s*;\s*$/u;
const CONTROL_CONDITION_PATTERN = /(if|while|do\s+until)\s*\(([^)]*)\)/giu;
// GML supports the bit-shift operators `<<` and `>>`, but it does NOT support
// the compound forms `<<=` or `>>=`. Keep them out of recovery heuristics so
// lint/fix paths never normalize valid shift expressions toward invalid tokens.
const COMPOUND_ASSIGNMENT_PATTERN = /\?\?=|\+=|-=|\*=|\/=|%=|&=|\^=|\|=/gu;
const MALFORMED_DOC_TAG_LINE_PATTERN = /^(\s*)\/(\s+)(@.+)$/gmu;

function isIdentifierCharacter(character: string): boolean {
    return /[A-Za-z0-9_]/u.test(character);
}

function canTerminateArgumentExpression(character: string): boolean {
    return (
        isIdentifierCharacter(character) ||
        character === '"' ||
        character === "'" ||
        character === ")" ||
        character === "]" ||
        character === "}"
    );
}

function canStartArgumentExpression(character: string): boolean {
    return (
        isIdentifierCharacter(character) ||
        character === '"' ||
        character === "'" ||
        character === "(" ||
        character === "[" ||
        character === "{"
    );
}

function isArgumentBoundaryCharacter(character: string): boolean {
    return character === ")" || character === "]" || character === "}" || character === ",";
}

function maskCommentsAndStringsForRecovery(sourceText: string): string {
    const chars = sourceText.split("");
    let index = 0;

    while (index < sourceText.length) {
        const character = sourceText[index] ?? "";
        const nextCharacter = sourceText[index + 1] ?? "";

        if (character === "/" && nextCharacter === "/") {
            chars[index] = " ";
            chars[index + 1] = " ";
            index += 2;
            while (index < sourceText.length) {
                const lineCharacter = sourceText[index] ?? "";
                if (lineCharacter === "\n" || lineCharacter === "\r") {
                    break;
                }
                chars[index] = " ";
                index += 1;
            }
            continue;
        }

        if (character === "/" && nextCharacter === "*") {
            chars[index] = " ";
            chars[index + 1] = " ";
            index += 2;
            while (index < sourceText.length) {
                const blockCharacter = sourceText[index] ?? "";
                const blockNext = sourceText[index + 1] ?? "";
                if (blockCharacter === "*" && blockNext === "/") {
                    chars[index] = " ";
                    chars[index + 1] = " ";
                    index += 2;
                    break;
                }

                if (blockCharacter !== "\n" && blockCharacter !== "\r") {
                    chars[index] = " ";
                }
                index += 1;
            }
            continue;
        }

        if (character === '"' || character === "'") {
            const quoteCharacter = character;
            chars[index] = quoteCharacter;
            index += 1;
            while (index < sourceText.length) {
                const stringCharacter = sourceText[index] ?? "";
                if (stringCharacter === "\\") {
                    chars[index] = "_";
                    if (index + 1 < sourceText.length) {
                        chars[index + 1] = "_";
                    }
                    index += 2;
                    continue;
                }

                if (stringCharacter === quoteCharacter) {
                    chars[index] = quoteCharacter;
                    index += 1;
                    break;
                }

                if (stringCharacter !== "\n" && stringCharacter !== "\r") {
                    chars[index] = "_";
                }
                index += 1;
            }
            continue;
        }

        index += 1;
    }

    return chars.join("");
}

type IdentifierToken = Readonly<{
    value: string;
    start: number;
}>;

function readIdentifierTokenEndingAt(sourceText: string, endIndex: number): IdentifierToken | null {
    const character = sourceText[endIndex] ?? "";
    if (!isIdentifierCharacter(character)) {
        return null;
    }

    let startIndex = endIndex;
    while (startIndex > 0 && isIdentifierCharacter(sourceText[startIndex - 1] ?? "")) {
        startIndex -= 1;
    }

    return Object.freeze({
        value: sourceText.slice(startIndex, endIndex + 1),
        start: startIndex
    });
}

const NON_CALL_PREFIX_KEYWORDS = new Set([
    "if",
    "for",
    "while",
    "switch",
    "repeat",
    "with",
    "function",
    "constructor",
    "catch"
]);

function isLikelyCallArgumentGap(sourceText: string, leftIndex: number): boolean {
    let cursor = leftIndex;
    while (cursor >= 0) {
        const character = sourceText[cursor] ?? "";
        if (character === "(") {
            const calleeEndIndex = findPreviousNonWhitespaceIndex(sourceText, cursor - 1, false);
            if (calleeEndIndex === null) {
                return false;
            }

            const calleeToken = readIdentifierTokenEndingAt(sourceText, calleeEndIndex);
            if (calleeToken) {
                if (NON_CALL_PREFIX_KEYWORDS.has(calleeToken.value.toLowerCase())) {
                    return false;
                }

                const beforeCalleeIndex = findPreviousNonWhitespaceIndex(sourceText, calleeToken.start - 1, false);
                if (beforeCalleeIndex === null) {
                    return true;
                }

                const prefixToken = readIdentifierTokenEndingAt(sourceText, beforeCalleeIndex);
                return prefixToken?.value.toLowerCase() !== "function";
            }

            const calleeCharacter = sourceText[calleeEndIndex] ?? "";
            return calleeCharacter === ")" || calleeCharacter === "]";
        }

        if (isArgumentBoundaryCharacter(character) || character === "\n" || character === "\r" || character === ";") {
            return false;
        }

        cursor -= 1;
    }

    return false;
}

function projectScientificNotationForRecovery(sourceText: string): string {
    const chunks: Array<string> = [];
    let copiedThrough = 0;

    forEachScientificNotationToken(sourceText, (start, end, scientificText) => {
        chunks.push(sourceText.slice(copiedThrough, start), "0".repeat(scientificText.length));
        copiedThrough = end;
    });

    if (copiedThrough === 0) {
        return sourceText;
    }

    chunks.push(sourceText.slice(copiedThrough));
    return chunks.join("");
}

function projectUppercaseLogicalAliasesForRecovery(sourceText: string): string {
    const chunks: Array<string> = [];
    const scanState = Core.createStringCommentScanState();
    const sourceLength = sourceText.length;

    let copiedThrough = 0;
    let index = 0;
    while (index < sourceLength) {
        const scannedIndex = Core.advanceStringCommentScan(sourceText, sourceLength, index, scanState, true);
        if (scannedIndex !== index) {
            index = scannedIndex;
            continue;
        }

        UPPERCASE_LOGICAL_ALIAS_PATTERN.lastIndex = index;
        const match = UPPERCASE_LOGICAL_ALIAS_PATTERN.exec(sourceText);
        if (!match) {
            index += 1;
            continue;
        }

        const alias = match[0] ?? "";
        const start = match.index;
        const end = start + alias.length;
        if (
            !Core.isIdentifierBoundaryCharacter(sourceText[start - 1]) ||
            !Core.isIdentifierBoundaryCharacter(sourceText[end])
        ) {
            index += 1;
            continue;
        }

        chunks.push(sourceText.slice(copiedThrough, start), alias.toLowerCase());
        copiedThrough = end;
        index = end;
    }

    if (copiedThrough === 0) {
        return sourceText;
    }

    chunks.push(sourceText.slice(copiedThrough));
    return chunks.join("");
}

function buildCommentedLineOfSameLength(lineContent: string): string {
    if (lineContent.length === 0) {
        return lineContent;
    }

    const firstNonWhitespaceIndex = lineContent.search(/\S/u);
    const commentStartIndex = firstNonWhitespaceIndex === -1 ? 0 : firstNonWhitespaceIndex;
    const suffixLength = Math.max(0, lineContent.length - commentStartIndex - 2);
    return `${lineContent.slice(0, commentStartIndex)}//${" ".repeat(suffixLength)}`;
}

function buildNoOpStatementLineOfSameLength(lineContent: string): string {
    if (lineContent.length <= 2) {
        return "0;".slice(0, lineContent.length);
    }

    const firstNonWhitespaceIndex = lineContent.search(/\S/u);
    const statementStartIndex = firstNonWhitespaceIndex === -1 ? 0 : firstNonWhitespaceIndex;
    const availableLength = lineContent.length - statementStartIndex;
    if (availableLength <= 2) {
        return `${lineContent.slice(0, statementStartIndex)}0;`;
    }

    return `${lineContent.slice(0, statementStartIndex)}0;${" ".repeat(availableLength - 2)}`;
}

function classifyInvalidStandaloneLineForRecovery(
    lineContent: string
): "none" | "replace-with-no-op-statement" | "replace-with-comment" {
    if (
        ORPHAN_ASSIGNMENT_STATEMENT_PATTERN.test(lineContent) ||
        NUMERIC_ASSIGNMENT_STATEMENT_PATTERN.test(lineContent)
    ) {
        return "replace-with-no-op-statement";
    }

    if (THIS_MULTIPLICATION_STATEMENT_PATTERN.test(lineContent)) {
        return "replace-with-comment";
    }

    return "none";
}

function projectInvalidStandaloneLinesForRecovery(sourceText: string): string {
    const segments = sourceText.match(/[^\r\n]*(?:\r\n|\r|\n|$)/gu) ?? [];
    let changed = false;

    const projectedSegments = segments.map((segment) => {
        const lineEndingMatch = /(?:\r\n|\r|\n)$/u.exec(segment);
        const lineEnding = lineEndingMatch?.[0] ?? "";
        const lineContent = lineEnding.length === 0 ? segment : segment.slice(0, -lineEnding.length);
        const lineProjection = classifyInvalidStandaloneLineForRecovery(lineContent);

        if (lineProjection === "none") {
            return segment;
        }

        changed = true;
        if (lineProjection === "replace-with-no-op-statement") {
            return `${buildNoOpStatementLineOfSameLength(lineContent)}${lineEnding}`;
        }

        return `${buildCommentedLineOfSameLength(lineContent)}${lineEnding}`;
    });

    return changed ? projectedSegments.join("") : sourceText;
}

function createParseSafeCompoundAssignment(operatorText: string): string {
    return operatorText.length === 3 ? "== " : "==";
}

function projectCompoundAssignmentsInControlConditionsForRecovery(sourceText: string): string {
    return sourceText.replaceAll(
        CONTROL_CONDITION_PATTERN,
        (fullMatch: string, keyword: string, conditionText: string): string => {
            const rewrittenConditionText = conditionText.replaceAll(COMPOUND_ASSIGNMENT_PATTERN, (operatorText) =>
                createParseSafeCompoundAssignment(operatorText)
            );
            if (rewrittenConditionText === conditionText) {
                return fullMatch;
            }

            return `${keyword} (${rewrittenConditionText})`;
        }
    );
}

function projectMalformedDocTagLinesForRecovery(sourceText: string): string {
    if (sourceText.length === 0) {
        return sourceText;
    }

    return sourceText.replaceAll(
        MALFORMED_DOC_TAG_LINE_PATTERN,
        (_match: string, indentation: string, spacing: string, docTagPayload: string) =>
            `${indentation}//${spacing}${docTagPayload}`
    );
}

type PendingRecoveryInsertion = Readonly<{
    offset: number;
    text: string;
}>;

function applyRecoveryTextInsertions(
    sourceText: string,
    pendingInsertions: ReadonlyArray<PendingRecoveryInsertion>,
    priorInsertions: ReadonlyArray<RecoveryTextInsertion>
): Readonly<{
    parseSource: string;
    textInsertions: ReadonlyArray<RecoveryTextInsertion>;
}> {
    if (pendingInsertions.length === 0) {
        return Object.freeze({
            parseSource: sourceText,
            textInsertions: Object.freeze([])
        });
    }

    const orderedInsertions = [...pendingInsertions].toSorted((left, right) => {
        if (left.offset !== right.offset) {
            return left.offset - right.offset;
        }

        return left.text.localeCompare(right.text);
    });

    const chunks: Array<string> = [];
    const textInsertions: Array<RecoveryTextInsertion> = [];
    let copiedThrough = 0;
    let accumulatedShift = 0;

    for (const insertion of orderedInsertions) {
        if (insertion.offset < copiedThrough || insertion.offset > sourceText.length) {
            continue;
        }

        chunks.push(sourceText.slice(copiedThrough, insertion.offset), insertion.text);
        copiedThrough = insertion.offset;

        textInsertions.push({
            originalOffset: mapRecoveredIndexToOriginal(insertion.offset, priorInsertions),
            recoveredOffset: insertion.offset + accumulatedShift,
            insertedText: insertion.text
        });
        accumulatedShift += insertion.text.length;
    }

    if (textInsertions.length === 0) {
        return Object.freeze({
            parseSource: sourceText,
            textInsertions: Object.freeze([])
        });
    }

    chunks.push(sourceText.slice(copiedThrough));

    // cloneObjectEntries shallow-clones each entry before deep-freezing so
    // mutations in the returned arrays cannot corrupt the accumulated state.
    return Object.freeze({
        parseSource: chunks.join(""),
        textInsertions: Object.freeze(Core.cloneObjectEntries(textInsertions))
    });
}

function collectStringLiteralLengthWrapInsertions(sourceText: string): ReadonlyArray<PendingRecoveryInsertion> {
    const pendingInsertions: Array<PendingRecoveryInsertion> = [];
    let index = 0;

    while (index < sourceText.length) {
        const character = sourceText[index] ?? "";
        const nextCharacter = sourceText[index + 1] ?? "";

        if (character === "/" && nextCharacter === "/") {
            index += 2;
            while (index < sourceText.length) {
                const lineCharacter = sourceText[index] ?? "";
                if (lineCharacter === "\n" || lineCharacter === "\r") {
                    break;
                }
                index += 1;
            }
            continue;
        }

        if (character === "/" && nextCharacter === "*") {
            index += 2;
            while (index < sourceText.length) {
                const blockCharacter = sourceText[index] ?? "";
                const blockNext = sourceText[index + 1] ?? "";
                if (blockCharacter === "*" && blockNext === "/") {
                    index += 2;
                    break;
                }
                index += 1;
            }
            continue;
        }

        if (character !== '"' && character !== "'") {
            index += 1;
            continue;
        }

        const literalStartIndex = index;
        const quoteCharacter = character;
        index += 1;

        while (index < sourceText.length) {
            const stringCharacter = sourceText[index] ?? "";
            if (stringCharacter === "\\") {
                index += 2;
                continue;
            }

            if (stringCharacter === quoteCharacter) {
                break;
            }

            index += 1;
        }

        if (index >= sourceText.length) {
            break;
        }

        const literalEndIndex = index;
        let memberAccessIndex = literalEndIndex + 1;
        while (memberAccessIndex < sourceText.length && /\s/u.test(sourceText[memberAccessIndex] ?? "")) {
            memberAccessIndex += 1;
        }

        if (!sourceText.startsWith(STRING_LENGTH_PROPERTY, memberAccessIndex)) {
            index = literalEndIndex + 1;
            continue;
        }

        pendingInsertions.push(
            Object.freeze({ offset: literalStartIndex, text: "(" }),
            Object.freeze({ offset: literalEndIndex + 1, text: ")" })
        );

        index = literalEndIndex + 1;
    }

    return Object.freeze(pendingInsertions);
}

function createArgumentSeparatorProjection(sourceText: string): Readonly<{
    parseSource: string;
    insertions: ReadonlyArray<InsertedArgumentSeparatorRecovery>;
    textInsertions: ReadonlyArray<RecoveryTextInsertion>;
}> {
    const chunks: Array<string> = [];
    const insertions: Array<InsertedArgumentSeparatorRecovery> = [];
    let copiedThrough = 0;

    const recoveryScanSource = maskCommentsAndStringsForRecovery(sourceText);
    let index = 0;
    while (index < sourceText.length) {
        const character = recoveryScanSource[index] ?? "";
        if (!/\s/u.test(character)) {
            index += 1;
            continue;
        }

        const whitespaceRunStart = index;
        while (index < sourceText.length && /\s/u.test(recoveryScanSource[index] ?? "")) {
            index += 1;
        }
        const whitespaceRunEnd = index - 1;

        const previousIndex = findPreviousNonWhitespaceIndex(recoveryScanSource, whitespaceRunStart - 1, false);
        const nextIndex = findNextNonWhitespaceIndex(recoveryScanSource, whitespaceRunEnd + 1);
        if (previousIndex === null || nextIndex === null) {
            continue;
        }

        if (
            !canTerminateArgumentExpression(recoveryScanSource[previousIndex] ?? "") ||
            !canStartArgumentExpression(recoveryScanSource[nextIndex] ?? "") ||
            !isLikelyCallArgumentGap(recoveryScanSource, previousIndex)
        ) {
            continue;
        }

        chunks.push(sourceText.slice(copiedThrough, whitespaceRunStart), ",");
        copiedThrough = whitespaceRunStart;

        const recoveredOffset = whitespaceRunStart + insertions.length;
        insertions.push({
            kind: INSERTED_ARGUMENT_SEPARATOR_KIND,
            recoveredOffset,
            originalOffset: whitespaceRunStart,
            insertedText: ","
        });
    }

    if (insertions.length === 0) {
        return Object.freeze({
            parseSource: sourceText,
            insertions: Object.freeze([]),
            textInsertions: Object.freeze([])
        });
    }

    chunks.push(sourceText.slice(copiedThrough));

    // cloneObjectEntries shallow-clones each entry before deep-freezing so
    // mutations in the returned arrays cannot corrupt the accumulated state.
    const frozenInsertions = Object.freeze(Core.cloneObjectEntries(insertions));
    return Object.freeze({
        parseSource: chunks.join(""),
        insertions: frozenInsertions,
        textInsertions: frozenInsertions
    });
}

/**
 * Produces a parser-recovery source variant by:
 * 1) neutralizing unsupported scientific notation literals into parse-safe tokens, and
 * 2) normalizing a narrow set of malformed tokens into parse-safe equivalents, and
 * 3) inserting commas in clearly ambiguous call argument positions where users omitted separators.
 */
export function createLimitedRecoveryProjection(sourceText: string, parseError?: unknown): RecoveryProjection {
    if (sourceText.length === 0) {
        return Object.freeze({
            parseSource: sourceText,
            insertions: Object.freeze([]),
            textInsertions: Object.freeze([])
        });
    }

    let projectedSourceText = projectScientificNotationForRecovery(sourceText);
    projectedSourceText = projectMalformedDocTagLinesForRecovery(projectedSourceText);
    projectedSourceText = projectUppercaseLogicalAliasesForRecovery(projectedSourceText);
    projectedSourceText = projectInvalidStandaloneLinesForRecovery(projectedSourceText);
    projectedSourceText = projectCompoundAssignmentsInControlConditionsForRecovery(projectedSourceText);

    const argumentSeparatorProjection = createArgumentSeparatorProjection(projectedSourceText);
    projectedSourceText = argumentSeparatorProjection.parseSource;

    const stringLengthProjection = applyRecoveryTextInsertions(
        projectedSourceText,
        collectStringLiteralLengthWrapInsertions(projectedSourceText),
        argumentSeparatorProjection.textInsertions
    );
    projectedSourceText = stringLengthProjection.parseSource;

    const allTextInsertions = [...argumentSeparatorProjection.textInsertions, ...stringLengthProjection.textInsertions];
    const appendedClosingBraceText = recoverParseSourceFromMissingBrace(projectedSourceText, parseError);
    if (appendedClosingBraceText === null) {
        return Object.freeze({
            parseSource: projectedSourceText,
            insertions: argumentSeparatorProjection.insertions,
            textInsertions: Object.freeze(allTextInsertions)
        });
    }

    const appendedText = appendedClosingBraceText.slice(projectedSourceText.length);
    const missingBraceProjection = applyRecoveryTextInsertions(
        projectedSourceText,
        appendedText.length === 0
            ? Object.freeze([])
            : Object.freeze([{ offset: projectedSourceText.length, text: appendedText }]),
        allTextInsertions
    );

    return Object.freeze({
        parseSource: missingBraceProjection.parseSource,
        insertions: argumentSeparatorProjection.insertions,
        textInsertions: Object.freeze([...allTextInsertions, ...missingBraceProjection.textInsertions])
    });
}

export function mapRecoveredIndexToOriginal(
    recoveredIndex: number,
    insertions: ReadonlyArray<RecoveryTextInsertion>
): number {
    if (!Number.isFinite(recoveredIndex) || insertions.length === 0) {
        return recoveredIndex;
    }

    let shift = 0;
    for (const insertion of insertions) {
        if (insertion.recoveredOffset >= recoveredIndex) {
            break;
        }

        shift += insertion.insertedText.length;
    }

    return Math.max(0, recoveredIndex - shift);
}
