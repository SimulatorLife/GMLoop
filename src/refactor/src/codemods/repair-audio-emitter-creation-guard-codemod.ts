import { Core } from "@gmloop/core";

import { defaultGmlProgramParser } from "../parser-adapter.js";
import type { RepairAudioEmitterCreationGuardResult } from "../types.js";
import {
    type CodemodAstRecord,
    containsBuiltinNameDeclaration,
    createCodemodResultFromEdits,
    hasBuiltinNameMacro,
    isAstRecord,
    isNamedCall
} from "./codemod-helpers.js";

const AUDIO_BUILTIN_NAMES: ReadonlySet<string> = new Set(["audio_emitter_create", "audio_system_is_initialised"]);

function hasNoArguments(node: CodemodAstRecord): boolean {
    return Array.isArray(node.arguments) && node.arguments.length === 0;
}

function getCallEdit(node: CodemodAstRecord): Readonly<{ start: number; end: number; text: string }> | null {
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
        programNode = defaultGmlProgramParser(sourceText);
    } catch {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    if (
        hasBuiltinNameMacro(sourceText, AUDIO_BUILTIN_NAMES) ||
        containsBuiltinNameDeclaration(programNode, AUDIO_BUILTIN_NAMES)
    ) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    const appliedEdits = collectAudioEmitterGuardEdits(programNode);
    return createCodemodResultFromEdits(sourceText, appliedEdits);
}
