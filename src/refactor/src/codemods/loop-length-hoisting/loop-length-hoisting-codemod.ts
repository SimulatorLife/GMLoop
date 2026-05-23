import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import { applySourceTextEdits } from "../codemod-helpers.js";
import type { LoopLengthHoistingEdit, LoopLengthHoistingResult } from "./types.js";

const ARRAY_LENGTH_CALL_TEXT = "array_length(";
const DEFAULT_HOIST_IDENTIFIER = "len";
const ARRAY_LENGTH_FUNCTION_NAMES = new Set(["array_length"]);
const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/gu;

type AstRecord = Record<string, unknown>;

type ForStatementContext = Readonly<{
    forNode: AstRecord;
    canInsertHoistBeforeLoop: boolean;
}>;

function createUnchangedResult(sourceText: string): LoopLengthHoistingResult {
    return Object.freeze({
        changed: false,
        outputText: sourceText,
        appliedEdits: Object.freeze([])
    });
}

function isAstRecord(value: unknown): value is AstRecord {
    return Core.isObjectLike(value);
}

function collectForStatementContexts(programNode: unknown): ReadonlyArray<ForStatementContext> {
    const contexts: Array<ForStatementContext> = [];

    const visit = (node: unknown, parent: AstRecord | null, parentKey: string | null): void => {
        if (Array.isArray(node)) {
            for (const element of node) {
                visit(element, parent, parentKey);
            }
            return;
        }

        if (!isAstRecord(node)) {
            return;
        }

        if (node.type === "ForStatement") {
            contexts.push(
                Object.freeze({
                    forNode: node,
                    canInsertHoistBeforeLoop:
                        parent !== null &&
                        parentKey === "body" &&
                        (parent.type === "Program" || parent.type === "BlockStatement")
                })
            );
            return;
        }

        for (const [key, child] of Object.entries(node)) {
            if (child && typeof child === "object") {
                visit(child, node, key);
            }
        }
    };

    visit(programNode, null, null);
    return contexts;
}

function resolveLineIndent(sourceText: string, offset: number): string {
    const lineStart = sourceText.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    let cursor = lineStart;
    while (cursor < sourceText.length) {
        const character = sourceText[cursor];
        if (character !== " " && character !== "\t") {
            break;
        }
        cursor += 1;
    }

    return sourceText.slice(lineStart, cursor);
}

function collectSourceIdentifierNames(sourceText: string): Set<string> {
    const names = new Set<string>();
    for (const match of sourceText.matchAll(IDENTIFIER_PATTERN)) {
        names.add(match[0]);
    }
    return names;
}

function resolveAvailableHoistIdentifier(usedIdentifierNames: Set<string>): string {
    if (!usedIdentifierNames.has(DEFAULT_HOIST_IDENTIFIER)) {
        usedIdentifierNames.add(DEFAULT_HOIST_IDENTIFIER);
        return DEFAULT_HOIST_IDENTIFIER;
    }

    let suffix = 1;
    while (usedIdentifierNames.has(`${DEFAULT_HOIST_IDENTIFIER}_${suffix}`)) {
        suffix += 1;
    }

    const identifierName = `${DEFAULT_HOIST_IDENTIFIER}_${suffix}`;
    usedIdentifierNames.add(identifierName);
    return identifierName;
}

function buildLoopLengthHoistEdits(sourceText: string, ast: unknown): ReadonlyArray<LoopLengthHoistingEdit> {
    const edits: Array<LoopLengthHoistingEdit> = [];
    const usedIdentifierNames = collectSourceIdentifierNames(sourceText);

    for (const context of collectForStatementContexts(ast)) {
        if (!context.canInsertHoistBeforeLoop) {
            continue;
        }

        const forStart = Core.getNodeStartIndex(context.forNode);
        if (typeof forStart !== "number") {
            continue;
        }

        const testExpression = context.forNode.test;
        const calls = Core.collectLoopLengthAccessorCallsFromAstNode({
            sourceText,
            rootNode: testExpression,
            enabledFunctionNames: ARRAY_LENGTH_FUNCTION_NAMES
        });
        const firstCall = calls[0];
        if (!firstCall) {
            continue;
        }

        const indent = resolveLineIndent(sourceText, forStart);
        const hoistIdentifier = resolveAvailableHoistIdentifier(usedIdentifierNames);
        edits.push(
            Object.freeze({
                start: forStart,
                end: forStart,
                text: `${indent}var ${hoistIdentifier} = ${firstCall.callText};\n`
            })
        );

        for (const call of calls) {
            edits.push(
                Object.freeze({
                    start: call.callStart,
                    end: call.callEnd,
                    text: hoistIdentifier
                })
            );
        }
    }

    return edits;
}

/**
 * Hoist `array_length(...)` calls from safe `for` loop conditions into a local
 * `var len = ...` declaration immediately before the loop.
 *
 * The implementation intentionally uses a substring gate before parsing so
 * realistic projects with many files and few array-length loops skip the AST
 * path entirely.
 *
 * @param sourceText - GML source text to transform.
 * @returns The transformed source and edit list.
 */
export function applyLoopLengthHoistingCodemod(sourceText: string): LoopLengthHoistingResult {
    if (!Core.isNonEmptyString(sourceText) || !sourceText.includes(ARRAY_LENGTH_CALL_TEXT)) {
        return createUnchangedResult(sourceText);
    }

    let ast: unknown;
    try {
        ast = Parser.GMLParser.parse(sourceText);
    } catch {
        return createUnchangedResult(sourceText);
    }

    const edits = buildLoopLengthHoistEdits(sourceText, ast);
    if (edits.length === 0) {
        return createUnchangedResult(sourceText);
    }

    const outputText = applySourceTextEdits(sourceText, edits);
    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(edits)
    });
}
