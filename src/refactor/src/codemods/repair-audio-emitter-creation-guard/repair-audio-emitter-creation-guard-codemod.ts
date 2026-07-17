import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type { RepairAudioEmitterCreationGuardResult } from "../../types.js";
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

function hasNoArguments(node: AstRecord): boolean {
    return Array.isArray(node.arguments) && node.arguments.length === 0;
}

function hasAudioBuiltinMacro(sourceText: string): boolean {
    return [...sourceText.matchAll(/^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)\b/gmu)].some((match) => {
        const macroName = match[1]?.toLowerCase();
        return macroName === "audio_emitter_create" || macroName === "audio_system_is_initialised";
    });
}

function containsAudioBuiltinDeclaration(node: unknown): boolean {
    if (Array.isArray(node)) {
        return node.some((entry) => containsAudioBuiltinDeclaration(entry));
    }
    if (!isAstRecord(node)) {
        return false;
    }

    if (node.type === "FunctionDeclaration" || node.type === "ConstructorDeclaration") {
        const id = typeof node.id === "string" ? node.id.toLowerCase() : null;
        if (id === "audio_emitter_create" || id === "audio_system_is_initialised") {
            return true;
        }
    }

    if (node.type === "VariableDeclarator") {
        const id = Core.getIdentifierName(node.id)?.toLowerCase();
        if (id === "audio_emitter_create" || id === "audio_system_is_initialised") {
            return true;
        }
    }

    return Object.entries(node).some(([key, child]) => key !== "parent" && containsAudioBuiltinDeclaration(child));
}

function getCallEdit(node: AstRecord): Readonly<{ start: number; end: number; text: string }> | null {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    if (typeof start !== "number" || typeof end !== "number") {
        return null;
    }

    return Object.freeze({
        start,
        end,
        text: "audio_system_is_initialised() ? audio_emitter_create() : -1"
    });
}

function collectAudioEmitterGuardEdits(
    programNode: unknown
): ReadonlyArray<Readonly<{ start: number; end: number; text: string }>> {
    const edits: Array<Readonly<{ start: number; end: number; text: string }>> = [];

    const visit = (node: unknown, insideAudioGuard: boolean): void => {
        if (Array.isArray(node)) {
            for (const child of node) {
                visit(child, insideAudioGuard);
            }
            return;
        }
        if (!isAstRecord(node)) {
            return;
        }

        const isAudioReadyGuard =
            node.type === "TernaryExpression" &&
            isNamedCall(node.test, "audio_system_is_initialised") &&
            hasNoArguments(node.test);
        if (isNamedCall(node, "audio_emitter_create") && hasNoArguments(node) && !insideAudioGuard) {
            const edit = getCallEdit(node);
            if (edit !== null) {
                edits.push(edit);
            }
        }

        for (const [key, child] of Object.entries(node)) {
            if (key !== "parent") {
                visit(child, insideAudioGuard || isAudioReadyGuard);
            }
        }
    };

    visit(programNode, false);
    return edits;
}

/**
 * Guard zero-argument audio-emitter creation until the HTML5 audio engine is ready.
 *
 * The native HTML5 runtime can retain a partially initialized emitter when
 * `audio_emitter_create()` runs before Web Audio initialization. Returning the
 * conventional invalid emitter index avoids that object entering the native
 * update loop. Existing guards and user-defined declarations/macros are left
 * unchanged.
 *
 * @param sourceText - GML source text to transform.
 * @returns The transformed source and applied source edits.
 */
export function applyRepairAudioEmitterCreationGuardCodemod(sourceText: string): RepairAudioEmitterCreationGuardResult {
    if (!sourceText.includes("audio_emitter_create")) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    let programNode: unknown;
    try {
        programNode = Parser.GMLParser.parse(sourceText);
    } catch {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    if (hasAudioBuiltinMacro(sourceText) || containsAudioBuiltinDeclaration(programNode)) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    const appliedEdits = collectAudioEmitterGuardEdits(programNode);
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
