import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleBaseHelpersServices, gmlRuleDeprecatedIdentifierServices } from "../gml/gml-rule-services.js";
import type { EnumBlockMatch, EnumDeclarationMatch, MacroLineSegments } from "./feather-rule-types.js";
import type { FeatherManifestEntry } from "./manifest.js";

// Consume rule-services contracts so this file does not reach across the
// `feather/` ↔ `gml/` domain boundary for shared parsing helpers. The facade
// in `gml-rule-services.js` is the only surface that rule implementations
// outside the `gml/` domain are allowed to depend on, so internal layout
// changes under `rules/gml/rule-base-helpers.js` stay isolated to that file.
const { getDeprecatedIdentifierCatalogEntry } = gmlRuleDeprecatedIdentifierServices;
const { findMatchingBraceEndIndex, resolveLocFromIndex } = gmlRuleBaseHelpersServices;

export function createFeatherRuleMeta(entry: FeatherManifestEntry): Rule.RuleMetaData {
    const meta: Rule.RuleMetaData = {
        type: "suggestion",
        docs: Object.freeze({
            get description(): string {
                const diagnostic = Core.getFeatherDiagnosticById(entry.id);
                return diagnostic &&
                    typeof diagnostic.description === "string" &&
                    diagnostic.description.trim().length > 0
                    ? diagnostic.description
                    : `Rule for ${entry.ruleId}.`;
            },
            recommended: false,
            requiresProjectContext: entry.requiresProjectContext
        }),
        schema: Object.freeze([]),
        messages: Object.freeze({
            diagnostic: `${entry.ruleId} diagnostic.`,
            unsafeFix: "[unsafe-fix:SEMANTIC_AMBIGUITY] Unsafe fix omitted.",
            missingProjectContext: `${entry.ruleId} requires project context for a definitive diagnostic.`
        })
    };
    if (entry.fixability !== "none") {
        meta.fixable = "code";
    }
    return Object.freeze(meta);
}

export function appendLineIfMissing(sourceText: string, lineToAppend: string): string {
    if (sourceText.includes(lineToAppend)) {
        return sourceText;
    }

    const hasTerminalNewline = sourceText.endsWith("\n");
    return `${sourceText}${hasTerminalNewline ? "" : "\n"}${lineToAppend}\n`;
}

/**
 * Builds a feather rule that appends a deterministic reset line to the end of
 * a program when a detection pattern is matched anywhere in the source.
 *
 * This consolidates the "if pattern → append reset" body that used to be
 * copy-pasted across Feather reset-state rules that own a local reset
 * diagnostic (`gm2000`, `gm2003`, `gm2026`, `gm2035`, `gm2048`, `gm2050`,
 * `gm2051`, `gm2052`, and `gm2056`). Feather diagnostics that need project
 * context, or reset behavior now owned by focused `gml/*` rules, deliberately
 * do not use this helper.
 *
 * The helper refuses an empty `resetLine` because `appendLineIfMissing`
 * would treat an empty string as already-present and silently produce a
 * no-op rule, masking the authoring mistake.
 *
 * @param entry The manifest entry describing the rule.
 * @param detectionPattern Regex used to detect the call site the rule cares
 *   about. When the pattern does not match, the source is returned unchanged.
 * @param resetLine The statement appended to the end of the file when the
 *   pattern matches and the line is not already present.
 * @returns A `Rule.RuleModule` that emits a single full-text fix when the
 *   pattern matches and the reset line is not yet present.
 */
export function createMissingResetRule(
    entry: FeatherManifestEntry,
    detectionPattern: RegExp,
    resetLine: string
): Rule.RuleModule {
    if (resetLine.length === 0) {
        throw new Error("createMissingResetRule requires a non-empty reset line.");
    }

    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!detectionPattern.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, resetLine);
    });
}

export function extractFunctionParameterNames(parameterListText: string): Array<string> {
    return parameterListText
        .split(",")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .map((segment) => {
            const equalsIndex = segment.indexOf("=");
            const withoutDefault = equalsIndex === -1 ? segment : segment.slice(0, equalsIndex);
            return withoutDefault.replace(/^\.\.\./u, "").trim();
        })
        .filter((parameterName) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(parameterName));
}

export function normalizeFeatherDocTypeText(rawTypeText: string): string {
    let normalizedType = rawTypeText.replaceAll(/[{}]/g, "");
    normalizedType = normalizedType.replaceAll(/\bString\b/gi, "string");
    normalizedType = normalizedType.replaceAll(/\bArray\s*\[\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\]/gi, "array<$1>");
    normalizedType = normalizedType.replaceAll(/\bArray\s*\[\s*([A-Za-z_][A-Za-z0-9_.]*)/gi, "array<$1>");
    normalizedType = normalizedType.replaceAll(/\bId\s+Instance\b/gi, "Id.Instance");
    normalizedType = normalizedType.replaceAll("|", ",");
    normalizedType = normalizedType.replaceAll(/\s+/g, "");
    normalizedType = normalizedType.replaceAll(/(string)(array<)/g, "$1,$2");
    if (normalizedType.includes("array<") && !normalizedType.endsWith(">")) {
        normalizedType = `${normalizedType}>`;
    }

    return normalizedType;
}

export function hasParamDocImmediatelyAbove(sourceText: string, functionStartIndex: number): boolean {
    const priorLines = sourceText.slice(0, functionStartIndex).split(/\r?\n/u);
    for (let index = priorLines.length - 1; index >= 0; index -= 1) {
        const trimmed = priorLines[index].trim();
        if (trimmed.length === 0) {
            break;
        }

        if (!trimmed.startsWith("///")) {
            break;
        }

        if (/^\/\/\/\s*@param\b/u.test(trimmed)) {
            return true;
        }
    }

    return false;
}

export function collectContiguousLeadingDocLinesAboveIndex(sourceText: string, offset: number): ReadonlyArray<string> {
    const priorLines = sourceText.slice(0, offset).split(/\r?\n/u);
    while (priorLines.length > 0 && priorLines.at(-1)?.trim().length === 0) {
        priorLines.pop();
    }

    const contiguousDocLines: Array<string> = [];
    for (let index = priorLines.length - 1; index >= 0; index -= 1) {
        const trimmed = priorLines[index].trim();
        if (trimmed.length === 0) {
            break;
        }

        if (!trimmed.startsWith("///")) {
            break;
        }

        contiguousDocLines.unshift(priorLines[index]);
    }

    return contiguousDocLines;
}

export function collapseAdjacentDuplicateParamDocs(sourceText: string): string {
    const lines = sourceText.split("\n");
    const dedupedLines: Array<string> = [];

    for (const line of lines) {
        const previousLine = dedupedLines.at(-1);
        if (/^\s*\/\/\/\s*@param\b/u.test(line) && previousLine === line) {
            continue;
        }

        dedupedLines.push(line);
    }

    return dedupedLines.join("\n");
}

export function getDirectDeprecatedReplacement(identifierName: string): string | null {
    const entry = getDeprecatedIdentifierCatalogEntry(identifierName);
    if (!entry || entry.replacementKind !== "direct-rename" || entry.replacement === null) {
        return null;
    }

    return entry.replacement;
}

export function createFullTextRewriteRule(
    entry: FeatherManifestEntry,
    rewriteSourceText: (sourceText: string) => string
): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const rewritten = rewriteSourceText(sourceText);
                    if (rewritten === sourceText) {
                        return;
                    }

                    context.report({
                        loc: resolveLocFromIndex(context, context.sourceCode.text, 0),
                        messageId: "diagnostic",
                        fix: (fixer) => fixer.replaceTextRange([0, sourceText.length], rewritten)
                    });
                }
            });
        }
    });
}

export function findEnumBlocks(text: string): Array<EnumBlockMatch> {
    const blocks: Array<EnumBlockMatch> = [];
    const enumPattern = /enum\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/g;
    let match = enumPattern.exec(text);
    while (match) {
        const blockStart = match.index;
        const openBraceIndex = text.indexOf("{", blockStart);
        if (openBraceIndex === -1) {
            match = enumPattern.exec(text);
            continue;
        }

        const blockEnd = findMatchingBraceEndIndex(text, openBraceIndex);

        if (blockEnd > blockStart) {
            blocks.push({
                start: blockStart,
                end: blockEnd,
                text: text.slice(blockStart, blockEnd)
            });
        }

        match = enumPattern.exec(text);
    }

    return blocks;
}

export function findEnumDeclarations(text: string): Array<EnumDeclarationMatch> {
    const declarations: Array<EnumDeclarationMatch> = [];
    const enumPattern = /enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
    let match = enumPattern.exec(text);
    while (match) {
        const declarationStart = match.index ?? 0;
        const enumName = match[1];
        const openBraceIndex = text.indexOf("{", declarationStart);
        if (openBraceIndex === -1) {
            match = enumPattern.exec(text);
            continue;
        }

        const declarationEnd = findMatchingBraceEndIndex(text, openBraceIndex);

        if (declarationEnd > declarationStart) {
            declarations.push({
                name: enumName,
                start: declarationStart,
                end: declarationEnd,
                text: text.slice(declarationStart, declarationEnd)
            });
        }

        match = enumPattern.exec(text);
    }

    return declarations;
}

export function splitCodeAndTrailingLineComment(line: string): { codeSegment: string; trailingComment: string } {
    // Track position within the line and current parsing mode using a discriminated
    // union instead of three separate boolean flags. This makes the state transitions
    // explicit and eliminates the verbose compound boolean checks (e.g. "!inSingleQuotedString
    // && !inDoubleQuotedString").
    let state: "outside" | "'" | '"' | "escaped" = "outside";

    for (let index = 0; index < line.length - 1; index += 1) {
        const character = line[index];
        const nextCharacter = line[index + 1];

        if (state === "escaped") {
            state = "outside";
        } else if (state === "'" || state === '"') {
            if (character === "\\") {
                state = "escaped";
            } else if (character === state) {
                state = "outside";
            }
        } else {
            // "outside"
            switch (character) {
                case "\\": {
                    state = "escaped";

                    break;
                }
                case "'": {
                    state = "'";

                    break;
                }
                case '"': {
                    state = '"';

                    break;
                }
                default: {
                    if (character === "/" && nextCharacter === "//") {
                        return {
                            codeSegment: line.slice(0, index),
                            trailingComment: line.slice(index)
                        };
                    }
                }
            }
        }
    }

    return { codeSegment: line, trailingComment: "" };
}

export function collapseRedundantStatementSemicolons(codeSegment: string): string {
    const caseLabelSemicolonRun = /^(\s*(?:case\b.+|default)\s*:\s*);+\s*$/u.exec(codeSegment);
    if (caseLabelSemicolonRun) {
        return caseLabelSemicolonRun[1].trimEnd();
    }

    if (/^\s*;+\s*$/u.test(codeSegment)) {
        return "";
    }

    const trailingSemicolonRun = /^(.*?);{2,}(\s*)$/u.exec(codeSegment);
    if (!trailingSemicolonRun) {
        return codeSegment;
    }

    return `${trailingSemicolonRun[1]};${trailingSemicolonRun[2]}`;
}

export function normalizeRedundantSemicolonRuns(sourceText: string): string {
    const lineEndingMatch = /\r\n|\n/u.exec(sourceText);
    const lineEnding = lineEndingMatch ? lineEndingMatch[0] : "\n";
    const lines = sourceText.split(/\r?\n/u);
    const rewrittenLines: Array<string> = [];
    for (const line of lines) {
        const { codeSegment, trailingComment } = splitCodeAndTrailingLineComment(line);
        const semicolonOnlyLine = /^\s*;+\s*$/u.test(codeSegment);
        const rewrittenCodeSegment = collapseRedundantStatementSemicolons(codeSegment);
        if (rewrittenCodeSegment.length > 0) {
            rewrittenLines.push(`${rewrittenCodeSegment}${trailingComment}`);
            continue;
        }

        if (trailingComment.length === 0) {
            if (!semicolonOnlyLine) {
                rewrittenLines.push("");
            }
            continue;
        }

        const indentationMatch = /^(\s*)/u.exec(codeSegment);
        const indentation = indentationMatch ? indentationMatch[1] : "";
        rewrittenLines.push(`${indentation}${trailingComment.trimStart()}`);
    }

    return rewrittenLines.join(lineEnding);
}

export function splitMacroLineSegments(line: string): MacroLineSegments {
    const inlineCommentStart = line.search(/\/\/|\/\*/u);
    const body = inlineCommentStart === -1 ? line : line.slice(0, inlineCommentStart);
    const continuationMatch = /\\\s*$/u.exec(body);

    return Object.freeze({
        bodyWithoutContinuation:
            continuationMatch === null ? body : body.slice(0, continuationMatch.index ?? body.length),
        continuationSuffix: continuationMatch?.[0] ?? "",
        commentSuffix: inlineCommentStart === -1 ? "" : line.slice(inlineCommentStart),
        hasContinuation: continuationMatch !== null
    });
}

export function removeTrailingMacroSemicolonIfSafe(line: string): string {
    const macroLineSegments = splitMacroLineSegments(line);
    if (macroLineSegments.hasContinuation) {
        return line;
    }

    const trailingSemicolon = /;\s*$/u.exec(macroLineSegments.bodyWithoutContinuation);
    if (!trailingSemicolon) {
        return line;
    }

    const semicolonIndex = trailingSemicolon.index;
    const bodyWithoutTrailingSemicolon = `${macroLineSegments.bodyWithoutContinuation.slice(0, semicolonIndex)}${macroLineSegments.bodyWithoutContinuation.slice(semicolonIndex + 1)}`;
    if (/\w;\w/u.test(bodyWithoutTrailingSemicolon)) {
        return line;
    }

    return `${bodyWithoutTrailingSemicolon}${macroLineSegments.continuationSuffix}${macroLineSegments.commentSuffix}`;
}
