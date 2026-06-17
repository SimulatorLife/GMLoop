import * as fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import { pathExistsSync } from "../../shared/path-exists.js";

type SemanticFileRecord = {
    declarations?: Array<Record<string, unknown>>;
    references?: Array<Record<string, unknown>>;
};

type ConstructorRuntimeTypeReferenceContext = {
    files: Record<string, SemanticFileRecord>;
    projectRoot: string;
};

/**
 * Exact source span for a constructor runtime-type reference.
 */
export interface ConstructorRuntimeTypeReferenceOccurrence {
    end: number;
    name: string;
    start: number;
}

/**
 * Constructor runtime-type references discovered within a single GML file.
 */
export interface ConstructorRuntimeTypeReferenceRecord {
    path: string;
    references: Array<ConstructorRuntimeTypeReferenceOccurrence>;
}

const CONSTRUCTOR_TYPE_COMPARISON_OPERATORS = new Set(["!=", "<>", "=", "=="]);

function readIdentifierOccurrence(node: unknown): ConstructorRuntimeTypeReferenceOccurrence | null {
    if (!Core.isIdentifierNode(node) || !Core.isNonEmptyString(node.name)) {
        return null;
    }

    const start = typeof node.start === "number" ? node.start : null;
    const end = typeof node.end === "number" ? node.end + 1 : null;
    if (start === null || end === null || end <= start) {
        return null;
    }

    return {
        name: node.name,
        start,
        end
    };
}

function readQuotedLiteralOccurrence(node: unknown): ConstructorRuntimeTypeReferenceOccurrence | null {
    if (!Core.isLiteralNode(node) || typeof node.value !== "string" || node.value.length < 2) {
        return null;
    }

    const openingQuote = node.value[0];
    const closingQuote = node.value.at(-1);
    const isQuotedLiteral = (openingQuote === '"' || openingQuote === "'") && openingQuote === closingQuote;
    if (!isQuotedLiteral) {
        return null;
    }

    const start = typeof node.start === "number" ? node.start + 1 : null;
    const end = typeof node.end === "number" ? node.end : null;
    if (start === null || end === null || end <= start) {
        return null;
    }

    return {
        name: node.value.slice(1, -1),
        start,
        end
    };
}

function isCallExpressionIdentifierMatch(node: unknown, name: string): boolean {
    return Core.isCallExpressionNode(node) && Core.getCallExpressionIdentifierName(node) === name;
}

function pushUniqueOccurrence(
    occurrences: Array<ConstructorRuntimeTypeReferenceOccurrence>,
    seenKeys: Set<string>,
    occurrence: ConstructorRuntimeTypeReferenceOccurrence | null
): void {
    if (occurrence === null) {
        return;
    }

    const key = `${occurrence.name}:${occurrence.start}:${occurrence.end}`;
    if (seenKeys.has(key)) {
        return;
    }

    seenKeys.add(key);
    occurrences.push(occurrence);
}

function collectConstructorRuntimeTypeReferencesFromAst(
    sourceText: string
): Array<ConstructorRuntimeTypeReferenceOccurrence> {
    const ast = Parser.GMLParser.parse(sourceText, { getComments: false });
    const occurrences: Array<ConstructorRuntimeTypeReferenceOccurrence> = [];
    const seenKeys = new Set<string>();

    Core.walkAst(ast, (node) => {
        if (isCallExpressionIdentifierMatch(node, "is_instanceof")) {
            const constructorArg = Core.getCallExpressionArguments(node)[1];
            pushUniqueOccurrence(occurrences, seenKeys, readIdentifierOccurrence(constructorArg));
            return;
        }

        if (!Core.isBinaryExpressionNode(node)) {
            return;
        }

        const operator = typeof node.operator === "string" ? node.operator : null;
        if (operator === null || !CONSTRUCTOR_TYPE_COMPARISON_OPERATORS.has(operator)) {
            return;
        }

        const leftLiteral = readQuotedLiteralOccurrence(node.left);
        const rightLiteral = readQuotedLiteralOccurrence(node.right);

        if (leftLiteral !== null && isCallExpressionIdentifierMatch(node.right, "instanceof")) {
            pushUniqueOccurrence(occurrences, seenKeys, leftLiteral);
        }

        if (rightLiteral !== null && isCallExpressionIdentifierMatch(node.left, "instanceof")) {
            pushUniqueOccurrence(occurrences, seenKeys, rightLiteral);
        }
    });

    return occurrences.toSorted((left, right) => left.start - right.start);
}

function collectConstructorRuntimeTypeReferencesFromText(
    sourceText: string
): Array<ConstructorRuntimeTypeReferenceOccurrence> {
    const occurrences: Array<ConstructorRuntimeTypeReferenceOccurrence> = [];
    const seenKeys = new Set<string>();
    const isInstanceofPattern = /\bis_instanceof\s*\([^,()]+(?:\([^)]*\)[^,()]*)?,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
    const instanceofLiteralPattern = /\binstanceof\s*\([^)]*\)\s*(?:==|!=|=|<>)\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g;
    const reversedInstanceofLiteralPattern =
        /(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*(?:==|!=|=|<>)\s*\binstanceof\s*\([^)]*\)/g;

    for (const match of sourceText.matchAll(isInstanceofPattern)) {
        const name = match[1];
        const matchedText = match[0];
        const matchIndex = match.index;
        if (!Core.isNonEmptyString(name) || typeof matchIndex !== "number") {
            continue;
        }

        const startOffset = matchedText.lastIndexOf(name);
        if (startOffset === -1) {
            continue;
        }

        pushUniqueOccurrence(occurrences, seenKeys, {
            name,
            start: matchIndex + startOffset,
            end: matchIndex + startOffset + name.length
        });
    }

    for (const pattern of [instanceofLiteralPattern, reversedInstanceofLiteralPattern]) {
        for (const match of sourceText.matchAll(pattern)) {
            const name = match[2];
            const matchedText = match[0];
            const matchIndex = match.index;
            if (!Core.isNonEmptyString(name) || typeof matchIndex !== "number") {
                continue;
            }

            const startOffset = matchedText.indexOf(name);
            if (startOffset === -1) {
                continue;
            }

            pushUniqueOccurrence(occurrences, seenKeys, {
                name,
                start: matchIndex + startOffset,
                end: matchIndex + startOffset + name.length
            });
        }
    }

    return occurrences.toSorted((left, right) => left.start - right.start);
}

function collectConstructorRuntimeTypeReferences(sourceText: string): Array<ConstructorRuntimeTypeReferenceOccurrence> {
    try {
        return collectConstructorRuntimeTypeReferencesFromAst(sourceText);
    } catch {
        return collectConstructorRuntimeTypeReferencesFromText(sourceText);
    }
}

/**
 * Enumerate runtime constructor type checks across project GML files.
 *
 * These occurrences cover the GameMaker patterns that encode constructor names
 * outside the semantic index today:
 * - `is_instanceof(value, ConstructorName)`
 * - `instanceof(value) == "ConstructorName"`
 *
 * @param context Files and project root to inspect.
 * @returns Reference records keyed by file path.
 */
export function listConstructorRuntimeTypeReferenceRecords(
    context: ConstructorRuntimeTypeReferenceContext
): Array<ConstructorRuntimeTypeReferenceRecord> {
    const records: Array<ConstructorRuntimeTypeReferenceRecord> = [];

    for (const filePath of Object.keys(context.files)) {
        if (!filePath.endsWith(".gml")) {
            continue;
        }

        const absolutePath = path.resolve(context.projectRoot, filePath);
        if (!pathExistsSync(absolutePath)) {
            continue;
        }

        const sourceText = (() => {
            try {
                return fs.readFileSync(absolutePath, "utf8");
            } catch {
                return null;
            }
        })();

        if (sourceText === null) {
            continue;
        }

        const references = collectConstructorRuntimeTypeReferences(sourceText);
        if (references.length === 0) {
            continue;
        }

        records.push({
            path: filePath,
            references
        });
    }

    return records;
}
