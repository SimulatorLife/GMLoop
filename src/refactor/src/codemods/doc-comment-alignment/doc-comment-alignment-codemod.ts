import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type { DocCommentAlignmentEdit, DocCommentAlignmentResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

type FunctionLikeNode = Readonly<{
    type: "FunctionDeclaration" | "ConstructorDeclaration";
    params: ReadonlyArray<unknown>;
    start: number;
}>;

type FunctionParameter = Readonly<{
    name: string;
    optional: boolean;
}>;

type ExistingParamDocLine = Readonly<{
    index: number;
    name: string;
    typeText: string;
    suffix: string;
}>;

const PARAM_PARSE_PATTERN =
    /^(\s*\/\/\/\s*@param)(\s+\{[^}]+\})?(\s+)(\[[A-Za-z_][A-Za-z0-9_]*(?:=[^\]]*)?\]|[A-Za-z_][A-Za-z0-9_]*)(.*)$/u;
const PARAM_NAME_TOKEN_PATTERN = /^\[?([A-Za-z_][A-Za-z0-9_]*)/u;

function computeLineStarts(sourceText: string): Array<number> {
    const lineStarts = [0];
    let index = 0;
    while (index < sourceText.length) {
        if (sourceText[index] === "\n") {
            lineStarts.push(index + 1);
        }
        index += 1;
    }
    return lineStarts;
}

function findLineIndex(lineStarts: ReadonlyArray<number>, offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const value = lineStarts[mid] ?? 0;
        const next = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
        if (offset < value) {
            high = mid - 1;
            continue;
        }
        if (offset >= next) {
            low = mid + 1;
            continue;
        }
        return mid;
    }
    return 0;
}

function collectFunctionLikeNodes(programNode: unknown): ReadonlyArray<FunctionLikeNode> {
    const functions: Array<FunctionLikeNode> = [];
    const visit = (node: unknown): void => {
        if (!node || typeof node !== "object") {
            return;
        }
        if (Array.isArray(node)) {
            for (const entry of node) {
                visit(entry);
            }
            return;
        }

        const record = node as Record<string, unknown>;
        if (
            (record.type === "FunctionDeclaration" || record.type === "ConstructorDeclaration") &&
            typeof record.start === "number" &&
            Array.isArray(record.params)
        ) {
            functions.push(
                Object.freeze({
                    type: record.type,
                    start: record.start,
                    params: record.params
                })
            );
        }

        for (const value of Object.values(record)) {
            if (value && typeof value === "object") {
                visit(value);
            }
        }
    };

    visit(programNode);
    return functions;
}

function readFunctionParameters(parameters: ReadonlyArray<unknown>): ReadonlyArray<FunctionParameter> {
    const result: Array<FunctionParameter> = [];

    for (const parameter of parameters) {
        if (!parameter || typeof parameter !== "object") {
            continue;
        }
        const parameterRecord = parameter as Record<string, unknown>;
        if (parameterRecord.type !== "DefaultParameter") {
            continue;
        }

        const left = parameterRecord.left;
        if (!left || typeof left !== "object") {
            continue;
        }
        const leftRecord = left as Record<string, unknown>;
        if (leftRecord.type !== "Identifier" || typeof leftRecord.name !== "string") {
            continue;
        }

        result.push(
            Object.freeze({
                name: leftRecord.name,
                optional: parameterRecord.right !== null
            })
        );
    }

    return result;
}

function extractExistingParamDocLine(line: string, index: number): ExistingParamDocLine | null {
    const match = PARAM_PARSE_PATTERN.exec(line);
    if (!match) {
        return null;
    }

    const rawParamToken = match[4] ?? "";
    const parsedName = PARAM_NAME_TOKEN_PATTERN.exec(rawParamToken);
    const name = parsedName?.[1] ?? null;
    if (!name) {
        return null;
    }

    return Object.freeze({
        index,
        name,
        typeText: (match[2] ?? "").trim(),
        suffix: match[5] ?? ""
    });
}

function buildParamDocLine(
    indentation: string,
    parameter: FunctionParameter,
    existingParamDocLine: ExistingParamDocLine | null
): string {
    const typeSegment = Core.isNonEmptyString(existingParamDocLine?.typeText ?? "")
        ? ` ${existingParamDocLine?.typeText ?? ""}`
        : "";
    const paramNameToken = parameter.optional ? `[${parameter.name}]` : parameter.name;
    const suffix = existingParamDocLine?.suffix ?? "";
    const suffixSegment = suffix.length === 0 ? "" : /^\s/u.test(suffix) ? suffix : ` ${suffix}`;
    return `${indentation}/// @param${typeSegment} ${paramNameToken}${suffixSegment}`;
}

function chooseExistingParamDocLine(
    parameter: FunctionParameter,
    parameterIndex: number,
    existingParamDocLines: ReadonlyArray<ExistingParamDocLine>,
    usedIndexes: Set<number>
): ExistingParamDocLine | null {
    for (const existingParamDocLine of existingParamDocLines) {
        if (existingParamDocLine.name === parameter.name && !usedIndexes.has(existingParamDocLine.index)) {
            usedIndexes.add(existingParamDocLine.index);
            return existingParamDocLine;
        }
    }

    const positional = existingParamDocLines[parameterIndex] ?? null;
    if (positional && !usedIndexes.has(positional.index)) {
        usedIndexes.add(positional.index);
        return positional;
    }

    return null;
}

function rewriteDocCommentBlock(
    blockLines: ReadonlyArray<string>,
    functionParameters: ReadonlyArray<FunctionParameter>,
    indentation: string
): ReadonlyArray<string> {
    const existingParamDocLines = blockLines
        .map((line, index) => extractExistingParamDocLine(line, index))
        .filter((entry): entry is ExistingParamDocLine => entry !== null);

    const usedParamDocLineIndexes = new Set<number>();
    const rewrittenParamLines = functionParameters.map((parameter, parameterIndex) => {
        const existingParamDocLine = chooseExistingParamDocLine(
            parameter,
            parameterIndex,
            existingParamDocLines,
            usedParamDocLineIndexes
        );
        return buildParamDocLine(indentation, parameter, existingParamDocLine);
    });

    const firstParamLineIndex = existingParamDocLines[0]?.index ?? -1;
    if (firstParamLineIndex >= 0) {
        const existingParamLineIndexSet = new Set(existingParamDocLines.map((line) => line.index));
        const rewrittenLines: Array<string> = [];
        for (const [index, line] of blockLines.entries()) {
            if (index === firstParamLineIndex) {
                rewrittenLines.push(...rewrittenParamLines);
            }
            if (!existingParamLineIndexSet.has(index)) {
                rewrittenLines.push(line);
            }
        }
        return rewrittenLines;
    }

    if (rewrittenParamLines.length === 0) {
        return [...blockLines];
    }

    return [...blockLines, ...rewrittenParamLines];
}

function collectDocCommentAlignmentEdits(
    sourceText: string,
    functionNodes: ReadonlyArray<FunctionLikeNode>,
    lineStarts: ReadonlyArray<number>
): ReadonlyArray<DocCommentAlignmentEdit> {
    const edits: Array<DocCommentAlignmentEdit> = [];

    for (const functionNode of functionNodes) {
        const functionLineIndex = findLineIndex(lineStarts, functionNode.start);
        let candidateLineIndex = functionLineIndex - 1;
        const docLineIndexes: Array<number> = [];

        while (candidateLineIndex >= 0) {
            const lineStart = lineStarts[candidateLineIndex] ?? 0;
            const lineEnd = lineStarts[candidateLineIndex + 1] ?? sourceText.length;
            const lineText = sourceText.slice(lineStart, lineEnd).replace(/\r?\n$/u, "");
            if (!lineText.trimStart().startsWith("///")) {
                break;
            }
            docLineIndexes.push(candidateLineIndex);
            candidateLineIndex -= 1;
        }

        if (docLineIndexes.length === 0) {
            continue;
        }

        docLineIndexes.reverse();
        const docStartLineIndex = docLineIndexes[0] ?? 0;
        const docEndLineIndex = docLineIndexes.at(-1) ?? 0;
        const docStart = lineStarts[docStartLineIndex] ?? 0;
        const docEnd = lineStarts[docEndLineIndex + 1] ?? sourceText.length;
        const docBlockText = sourceText.slice(docStart, docEnd);
        const hadTrailingNewline = docBlockText.endsWith("\n");
        const linesWithoutTrailingNewline = hadTrailingNewline ? docBlockText.slice(0, -1) : docBlockText;
        const blockLines = linesWithoutTrailingNewline.length === 0 ? [] : linesWithoutTrailingNewline.split("\n");
        const functionLineStart = lineStarts[functionLineIndex] ?? 0;
        const functionLineEnd = lineStarts[functionLineIndex + 1] ?? sourceText.length;
        const functionLineText = sourceText.slice(functionLineStart, functionLineEnd);
        const indentationMatch = /^(\s*)/u.exec(functionLineText);
        const indentation = indentationMatch?.[1] ?? "";
        const functionParameters = readFunctionParameters(functionNode.params);

        const rewrittenBlockLines = rewriteDocCommentBlock(blockLines, functionParameters, indentation);
        const rewrittenText =
            rewrittenBlockLines.length === 0
                ? ""
                : `${rewrittenBlockLines.join("\n")}${hadTrailingNewline ? "\n" : ""}`;

        if (rewrittenText !== docBlockText) {
            edits.push(
                Object.freeze({
                    start: docStart,
                    end: docEnd,
                    text: rewrittenText
                })
            );
        }
    }

    return edits;
}

/**
 * Align function doc-comment `@param` tags to the function signature by
 * reordering/renaming tags and marking defaulted parameters as optional.
 */
export function applyDocCommentAlignmentCodemod(sourceText: string): DocCommentAlignmentResult {
    if (!Core.isNonEmptyString(sourceText)) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    let programNode: unknown;
    try {
        programNode = Parser.GMLParser.parse(sourceText);
    } catch {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const functionNodes = collectFunctionLikeNodes(programNode);
    if (functionNodes.length === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const lineStarts = computeLineStarts(sourceText);
    const edits = collectDocCommentAlignmentEdits(sourceText, functionNodes, lineStarts);
    if (edits.length === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const outputText = applySourceTextEdits(sourceText, edits);
    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(edits)
    });
}

export const docCommentAlignmentInternal = Object.freeze({
    readFunctionParameters
});
