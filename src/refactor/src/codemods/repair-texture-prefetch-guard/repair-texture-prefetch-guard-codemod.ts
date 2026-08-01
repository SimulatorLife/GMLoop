import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type { RepairTexturePrefetchGuardResult } from "../../types.js";
import {
    type CodemodAstRecord,
    containsBuiltinNameDeclaration,
    createCodemodResultFromEdits,
    createUnchangedCodemodResult,
    getNodeSource,
    hasBuiltinNameMacro,
    isAstRecord,
    isNamedCall,
    unwrapParenthesizedExpression
} from "../codemod-helpers.js";

const TEXTURE_BUILTIN_NAMES: ReadonlySet<string> = new Set(["texture_is_ready", "texture_prefetch"]);

function getSingleCallArgument(node: CodemodAstRecord): CodemodAstRecord | null {
    return Array.isArray(node.arguments) && node.arguments.length === 1 && isAstRecord(node.arguments[0])
        ? node.arguments[0]
        : null;
}

function hasSameArgument(sourceText: string, firstCall: CodemodAstRecord, secondCall: CodemodAstRecord): boolean {
    const firstArgument = getSingleCallArgument(firstCall);
    const secondArgument = getSingleCallArgument(secondCall);
    if (firstArgument === null || secondArgument === null) {
        return false;
    }

    const firstSource = getNodeSource(sourceText, firstArgument);
    const secondSource = getNodeSource(sourceText, secondArgument);
    return firstSource !== null && firstSource === secondSource;
}

function getPrefetchCallFromConsequent(node: CodemodAstRecord): CodemodAstRecord | null {
    if (node.type === "BlockStatement") {
        const body = node.body;
        return Array.isArray(body) && isNamedCall(body[0], "texture_prefetch") ? body[0] : null;
    }

    return isNamedCall(node, "texture_prefetch") ? node : null;
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
        return createUnchangedCodemodResult(sourceText);
    }

    let programNode: unknown;
    try {
        programNode = Parser.GMLParser.parse(sourceText);
    } catch {
        return createUnchangedCodemodResult(sourceText);
    }

    if (
        hasBuiltinNameMacro(sourceText, TEXTURE_BUILTIN_NAMES) ||
        containsBuiltinNameDeclaration(programNode, TEXTURE_BUILTIN_NAMES)
    ) {
        return createUnchangedCodemodResult(sourceText);
    }

    const appliedEdits = collectGuardRepairEdits(sourceText, programNode);
    return createCodemodResultFromEdits(sourceText, appliedEdits);
}
