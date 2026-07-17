import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type { RepairTexturePrefetchGuardResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

type AstRecord = Record<string, unknown>;

function isAstRecord(value: unknown): value is AstRecord {
    return Core.isObjectLike(value);
}

function isNamedCall(node: unknown, functionName: string): node is AstRecord {
    if (!isAstRecord(node) || node.type !== "CallExpression") {
        return false;
    }

    const object = node.object;
    return (
        isAstRecord(object) &&
        object.type === "Identifier" &&
        typeof object.name === "string" &&
        object.name.toLowerCase() === functionName
    );
}

function unwrapParenthesizedExpression(node: unknown): AstRecord | null {
    let current = isAstRecord(node) ? node : null;
    while (current?.type === "ParenthesizedExpression") {
        current = isAstRecord(current.expression) ? current.expression : null;
    }
    return current;
}

function getSingleCallArgument(node: AstRecord): AstRecord | null {
    return Array.isArray(node.arguments) && node.arguments.length === 1 && isAstRecord(node.arguments[0])
        ? node.arguments[0]
        : null;
}

function getNodeSource(sourceText: string, node: AstRecord): string | null {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    return typeof start === "number" && typeof end === "number" ? sourceText.slice(start, end).trim() : null;
}

function hasSameArgument(sourceText: string, firstCall: AstRecord, secondCall: AstRecord): boolean {
    const firstArgument = getSingleCallArgument(firstCall);
    const secondArgument = getSingleCallArgument(secondCall);
    if (firstArgument === null || secondArgument === null) {
        return false;
    }

    const firstSource = getNodeSource(sourceText, firstArgument);
    const secondSource = getNodeSource(sourceText, secondArgument);
    return firstSource !== null && firstSource === secondSource;
}

function getPrefetchCallFromConsequent(node: AstRecord): AstRecord | null {
    if (node.type === "BlockStatement") {
        const body = node.body;
        return Array.isArray(body) && isNamedCall(body[0], "texture_prefetch") ? body[0] : null;
    }

    return isNamedCall(node, "texture_prefetch") ? node : null;
}

function isBuiltInNameDeclaration(node: AstRecord): boolean {
    const names = new Set(["texture_is_ready", "texture_prefetch"]);
    if (node.type === "FunctionDeclaration" || node.type === "ConstructorDeclaration") {
        if (typeof node.id === "string" && names.has(node.id.toLowerCase())) {
            return true;
        }

        if (
            Array.isArray(node.params) &&
            node.params.some((parameter) => {
                const identifierName = Core.getIdentifierName(parameter);
                return identifierName !== null && names.has(identifierName.toLowerCase());
            })
        ) {
            return true;
        }
    }

    if (node.type === "VariableDeclarator") {
        const identifierName = Core.getIdentifierName(node.id);
        return identifierName !== null && names.has(identifierName.toLowerCase());
    }

    return false;
}

function containsBuiltInNameDeclaration(node: unknown): boolean {
    if (Array.isArray(node)) {
        return node.some((entry) => containsBuiltInNameDeclaration(entry));
    }
    if (!isAstRecord(node)) {
        return false;
    }
    if (isBuiltInNameDeclaration(node)) {
        return true;
    }

    return Object.values(node).some((child) => containsBuiltInNameDeclaration(child));
}

function hasBuiltInNameMacro(sourceText: string): boolean {
    return [...sourceText.matchAll(/^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)\b/gmu)].some((match) => {
        const macroName = match[1]?.toLowerCase();
        return macroName === "texture_is_ready" || macroName === "texture_prefetch";
    });
}

function collectGuardRepairEdits(
    sourceText: string,
    programNode: unknown
): ReadonlyArray<Readonly<{ start: number; end: number; text: string }>> {
    const edits: Array<Readonly<{ start: number; end: number; text: string }>> = [];

    const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const child of node) {
                visit(child);
            }
            return;
        }
        if (!isAstRecord(node)) {
            return;
        }

        if (node.type === "IfStatement") {
            const condition = unwrapParenthesizedExpression(node.test);
            const prefetchCall = getPrefetchCallFromConsequent(isAstRecord(node.consequent) ? node.consequent : {});
            if (condition !== null && isNamedCall(condition, "texture_is_ready") && prefetchCall !== null) {
                const conditionStart = Core.getNodeStartIndex(condition);
                if (typeof conditionStart === "number" && hasSameArgument(sourceText, condition, prefetchCall)) {
                    edits.push(Object.freeze({ start: conditionStart, end: conditionStart, text: "!" }));
                }
            }
        }

        for (const child of Object.values(node)) {
            visit(child);
        }
    };

    visit(programNode);
    return edits;
}

/**
 * Repair inverted `texture_is_ready` guards that prefetch only ready textures.
 *
 * The codemod recognizes a single-file, structurally safe pattern and changes
 * `if (texture_is_ready(texture)) texture_prefetch(texture)` to use the
 * not-ready branch. It leaves files with built-in-name declarations untouched
 * because those calls may refer to user-defined symbols instead of GameMaker's
 * texture APIs.
 *
 * @param sourceText - GML source text to transform.
 * @returns The transformed source and applied source edits.
 */
export function applyRepairTexturePrefetchGuardCodemod(sourceText: string): RepairTexturePrefetchGuardResult {
    if (!sourceText.includes("texture_is_ready") || !sourceText.includes("texture_prefetch")) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    let programNode: unknown;
    try {
        programNode = Parser.GMLParser.parse(sourceText);
    } catch {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    if (hasBuiltInNameMacro(sourceText) || containsBuiltInNameDeclaration(programNode)) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    const appliedEdits = collectGuardRepairEdits(sourceText, programNode);
    if (appliedEdits.length === 0) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    const outputText = applySourceTextEdits(sourceText, appliedEdits);
    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(appliedEdits)
    });
}
