/**
 * Repair code that captures `other.<name>` references inside event callbacks.
 *
 * Background
 * ----------
 * GML object events run in a context where `other` is the calling instance.
 * Developers occasionally write `other.<name>` inside a function expression
 * passed to a constructor (e.g. `ZModelOverrideCustom`), where the resulting
 * closure does not execute inside the original event scope and the
 * "other" reference resolves to `undefined` at runtime. The pattern
 * surfaces as silent `self.other.*` accesses (the runtime proxy exposes
 * `other` as `self`) or as a hard `unable to convert undefined` exception
 * when the value is numeric.
 *
 * The codemod detects inline callbacks inside event bodies that dereference
 * `other.<name>` and rewrites each reference to `self.<name>`. Top-level
 * `other.<name>` references (where the event context resolves them to the
 * calling instance) are left untouched.
 *
 * This codemod is intentionally textual; it does not use the semantic
 * analyzer or attempt to differentiate between user-defined shadows of
 * `other` because the runtime/HTML5 semantics of those usages are not
 * expressible in GML source.
 */
import { Core } from "@gmloop/core";

import type { CodemodEdit, CodemodResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

/**
 * Stable identifier used in the codemod registry. The same string must be
 * used wherever the codemod is referenced (registry, CLI config, project
 * config schema) so lookups stay decoupled from file paths.
 */
export const REPAIR_EVENT_CALLBACK_OTHER_CODEMOD_ID = "repairEventCallbackOther";

/**
 * Configuration options for the codemod. The codemod accepts an optional
 * `sourcePath` so the registry can pass the file context without forcing
 * the codemod to recompute it from the AST. When `sourcePath` is provided
 * the codemod is a no-op unless the path is inside an event file
 * (`objects/<objectName>/<eventName>.gml`).
 */
export type RepairEventCallbackOtherCodemodOptions = Readonly<{
    readonly sourcePath?: string;
}>;

/**
 * A single text edit produced by the codemod.
 */
export type RepairEventCallbackOtherEdit = CodemodEdit;

/**
 * Per-file result returned by {@link applyRepairEventCallbackOtherCodemod}.
 */
export type RepairEventCallbackOtherResult = CodemodResult;

const EVENT_FILE_PATTERN = /(^|[\\/])objects[\\/][^\\/]+[\\/][^\\/]+$/u;
const OTHER_MEMBER_PATTERN = /\bother\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/gu;

function isEventFilePath(sourcePath: string | undefined): boolean {
    if (typeof sourcePath !== "string" || sourcePath.length === 0) {
        return false;
    }
    return EVENT_FILE_PATTERN.test(sourcePath);
}

interface AstShape {
    readonly type: string;
    readonly start?: number | null;
    readonly end?: number | null;
    readonly sourcePath?: string | null;
}

function isFunctionLikeNode(value: unknown): value is AstShape {
    if (!Core.isObjectLike(value)) {
        return false;
    }
    const type = (value as { type?: unknown }).type;
    return type === "FunctionExpression" || type === "ArrowFunctionExpression" || type === "FunctionDeclaration";
}

function collectInlineFunctionRanges(program: AstShape): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    walk(program, (node) => {
        if (!isFunctionLikeNode(node)) {
            return;
        }
        if (typeof node.start === "number" && typeof node.end === "number" && node.end > node.start) {
            ranges.push({ start: node.start, end: node.end });
        }
    });
    return ranges;
}

function walk(node: unknown, visit: (node: unknown) => void): void {
    if (!Core.isObjectLike(node)) {
        return;
    }
    visit(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                walk(item, visit);
            }
        } else if (Core.isObjectLike(value)) {
            walk(value, visit);
        }
    }
}

interface OffsetEdit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

function collectReplacements(
    sourceText: string,
    inlineRanges: ReadonlyArray<{ start: number; end: number }>
): Array<OffsetEdit> {
    const edits: Array<OffsetEdit> = [];
    for (const range of inlineRanges) {
        const inlineSource = sourceText.slice(range.start, range.end);
        OTHER_MEMBER_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null = OTHER_MEMBER_PATTERN.exec(inlineSource);
        while (match !== null) {
            const memberStart = range.start + match.index;
            const memberEnd = memberStart + match[0].length;
            const name = match[1];
            edits.push({ start: memberStart, end: memberEnd, text: `self.${name}` });
            match = OTHER_MEMBER_PATTERN.exec(inlineSource);
        }
    }
    return edits;
}

interface ProgramNode {
    readonly type: string;
    readonly body?: ReadonlyArray<unknown>;
    readonly start?: number | null;
    readonly end?: number | null;
}

/**
 * Apply the codemod to a single GML event body.
 *
 * The function only mutates `other.<name>` references that appear inside
 * function expressions nested in the event body. Top-level `other.<name>`
 * references (where the event context resolves them to the calling
 * instance) are left untouched.
 */
export function applyRepairEventCallbackOtherCodemod(
    sourceText: string,
    ast: ProgramNode,
    options: RepairEventCallbackOtherCodemodOptions = {}
): RepairEventCallbackOtherResult {
    if (!isEventFilePath(options.sourcePath)) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }
    const ranges = collectInlineFunctionRanges(ast);
    if (ranges.length === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }
    const edits = collectReplacements(sourceText, ranges);
    if (edits.length === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }
    const outputText = applySourceTextEdits(sourceText, edits);
    if (outputText === sourceText) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }
    return Object.freeze({
        changed: true,
        outputText,
        appliedEdits: Object.freeze(edits)
    });
}
