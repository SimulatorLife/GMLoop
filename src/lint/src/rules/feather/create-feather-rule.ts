import type { Rule } from "eslint";

import { getDeprecatedIdentifierCatalogEntry } from "../../services/deprecated-identifiers/index.js";
import { resolveLocFromIndex } from "../gml/rule-base-helpers.js";
import type { FeatherManifestEntry } from "./manifest.js";

type EnumBlockMatch = {
    start: number;
    end: number;
    text: string;
};

type EnumDeclarationMatch = {
    name: string;
    start: number;
    end: number;
    text: string;
};

type FeatherRuleFactory = (entry: FeatherManifestEntry) => Rule.RuleModule;

const NON_NEWLINE_WHITESPACE_CHARACTER_CLASS = String.raw`[\t\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]`;

const ENUM_MEMBER_DECLARATION_PATTERN = new RegExp(
    String.raw`^(?<name>[A-Za-z_][A-Za-z0-9_]*)(?<initializer>\s*=\s*(?:[^\s,][^,\n]*|${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}))?(?<suffix>\s*(?:,\s*)?(?:\/\/.*)?)$`,
    "u"
);

const DIVISION_BY_ZERO_ASSIGNMENT_PATTERN = new RegExp(
    String.raw`(\b[A-Za-z_]\w*\s*=\s*(?:[^\s/;][^;\n/]*|${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}))\s*\/\s*0\b`,
    "g"
);

const LEADING_EQUALS_ARTIFACT_PATTERN = new RegExp(
    String.raw`^=\s*(?:\S.*|${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS});\s*$`,
    "u"
);

const GPU_ALPHA_TEST_TRUE_SPACING_PATTERN = new RegExp(
    String.raw`(\bgpu_set_alphatestenable\s*\(\s*true\s*\)\s*;)${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}*\n\s*\n(\s*[^\s])`,
    "g"
);

const BRACKETED_INDEX_LIST_PATTERN = new RegExp(
    String.raw`\[(?!\s*#)([^,\]\n]+(?:\s*,\s*(?:[^\s,\]][^,\]\n]*|${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}))+)]`,
    "g"
);

const VERTEX_BEGIN_WITHOUT_END_PATTERN = new RegExp(
    String.raw`(vertex_begin\(vb,\s*format\);${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}*\n\s*vertex_position_3d\([^\n]+\);\s*)`,
    "m"
);

const DUPLICATE_GPU_PUSH_STATE_PATTERN = new RegExp(
    String.raw`gpu_push_state\(\);${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}*\n\s*gpu_push_state\(\);`,
    "g"
);

const DUPLICATE_GPU_POP_STATE_PATTERN = new RegExp(
    String.raw`gpu_pop_state\(\);${NON_NEWLINE_WHITESPACE_CHARACTER_CLASS}*\n\s*gpu_pop_state\(\);`,
    "g"
);

function createFeatherRuleMeta(entry: FeatherManifestEntry, fixable: "code" | null = "code"): Rule.RuleMetaData {
    const baseMeta: Rule.RuleMetaData = {
        type: "suggestion",
        docs: Object.freeze({
            description: `Rule for ${entry.ruleId}.`,
            recommended: false,
            requiresProjectContext: entry.requiresProjectContext
        }),
        schema: Object.freeze([]),
        messages: Object.freeze({
            diagnostic: `${entry.ruleId} diagnostic.`
        })
    };

    if (fixable === "code") {
        return Object.freeze({
            ...baseMeta,
            fixable: "code"
        });
    }

    return Object.freeze(baseMeta);
}

function appendLineIfMissing(sourceText: string, lineToAppend: string): string {
    if (sourceText.includes(lineToAppend)) {
        return sourceText;
    }

    const hasTerminalNewline = sourceText.endsWith("\n");
    return `${sourceText}${hasTerminalNewline ? "" : "\n"}${lineToAppend}\n`;
}

function toDocParameterName(parameterName: string): string {
    return parameterName.replace(/^_+/u, "");
}

function extractFunctionParameterNames(parameterListText: string): Array<string> {
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

function normalizeFeatherDocTypeText(rawTypeText: string): string {
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

function hasParamDocImmediatelyAbove(sourceText: string, functionStartIndex: number): boolean {
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

function collectContiguousLeadingDocLinesAboveIndex(sourceText: string, offset: number): ReadonlyArray<string> {
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

function collapseAdjacentDuplicateParamDocs(sourceText: string): string {
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

function findMatchingBraceEndIndex(sourceText: string, openBraceIndex: number): number {
    let depth = 0;
    for (let index = openBraceIndex; index < sourceText.length; index += 1) {
        const character = sourceText[index];
        if (character === "{") {
            depth += 1;
            continue;
        }

        if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return index + 1;
            }
        }
    }

    return -1;
}

function getDirectDeprecatedReplacement(identifierName: string): string | null {
    const entry = getDeprecatedIdentifierCatalogEntry(identifierName);
    if (!entry || entry.replacementKind !== "direct-rename" || entry.replacement === null) {
        return null;
    }

    return entry.replacement;
}

function createFullTextRewriteRule(
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

function findEnumBlocks(text: string): Array<EnumBlockMatch> {
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

function findEnumDeclarations(text: string): Array<EnumDeclarationMatch> {
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

function createGm1003Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const enumBlocks = findEnumBlocks(sourceText);
                    for (const block of enumBlocks) {
                        const rewrittenWithoutNumericStrings = block.text.replaceAll(
                            /=\s*"(?<integer>-?\d+)"(?<suffix>\s*(?:,|\/\/|$))/gm,
                            (_full, integer, suffix) => `= ${integer}${suffix as string}`
                        );
                        const rewritten = rewrittenWithoutNumericStrings.replaceAll(
                            /,(?=\s*(?:\/\/[^\n\r]*)?\r?\n\s*\})/gu,
                            ""
                        );
                        if (rewritten === block.text) {
                            continue;
                        }

                        context.report({
                            loc: resolveLocFromIndex(context, context.sourceCode.text, block.start),
                            messageId: "diagnostic",
                            fix: (fixer) => fixer.replaceTextRange([block.start, block.end], rewritten)
                        });
                    }
                }
            });
        }
    });
}

function createGm1000Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => sourceText.replaceAll(/^\s*break;\s*/gm, ""));
}

function createGm1002Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/global\.(\w+)\s*=/g, (_fullMatch, identifier: string) => `${identifier} =`)
    );
}

function createGm1004Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const enumBlocks = findEnumBlocks(sourceText);
                    for (const block of enumBlocks) {
                        const lines = block.text.split(/\r?\n/u);
                        const memberEntries: Array<{ lineIndex: number; name: string; hasInitializer: boolean }> = [];
                        for (const [index, line] of lines.entries()) {
                            const trimmed = line.trim();
                            if (
                                trimmed.length === 0 ||
                                trimmed.startsWith("//") ||
                                trimmed === "{" ||
                                trimmed === "}"
                            ) {
                                continue;
                            }

                            const memberMatch = ENUM_MEMBER_DECLARATION_PATTERN.exec(trimmed);
                            if (!memberMatch?.groups?.name) {
                                continue;
                            }

                            memberEntries.push({
                                lineIndex: index,
                                name: memberMatch.groups.name,
                                hasInitializer: typeof memberMatch.groups.initializer === "string"
                            });
                        }

                        const entriesByName = new Map<string, Array<{ lineIndex: number; hasInitializer: boolean }>>();
                        for (const entryLine of memberEntries) {
                            const bucket = entriesByName.get(entryLine.name) ?? [];
                            bucket.push({
                                lineIndex: entryLine.lineIndex,
                                hasInitializer: entryLine.hasInitializer
                            });
                            entriesByName.set(entryLine.name, bucket);
                        }

                        const removeLineIndexes = new Set<number>();
                        for (const duplicateEntries of entriesByName.values()) {
                            if (duplicateEntries.length < 2) {
                                continue;
                            }

                            const initializerEntries = duplicateEntries.filter((entryLine) => entryLine.hasInitializer);
                            const keeper =
                                initializerEntries.length > 0
                                    ? (initializerEntries.at(-1) ?? duplicateEntries[0])
                                    : duplicateEntries[0];

                            for (const candidate of duplicateEntries) {
                                if (candidate.lineIndex !== keeper.lineIndex) {
                                    removeLineIndexes.add(candidate.lineIndex);
                                }
                            }
                        }

                        if (removeLineIndexes.size === 0) {
                            continue;
                        }

                        const rewrittenLines = lines.filter((_, index) => !removeLineIndexes.has(index));
                        const rewritten = rewrittenLines.join("\n");
                        context.report({
                            loc: resolveLocFromIndex(context, context.sourceCode.text, block.start),
                            messageId: "diagnostic",
                            fix: (fixer) => fixer.replaceTextRange([block.start, block.end], rewritten)
                        });
                    }
                }
            });
        }
    });
}

function createGm1005Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const pattern = /\bdraw_set_color\(\s*\)/g;
                    for (const match of sourceText.matchAll(pattern)) {
                        const start = match.index ?? 0;
                        const end = start + match[0].length;
                        context.report({
                            loc: resolveLocFromIndex(context, context.sourceCode.text, start),
                            messageId: "diagnostic",
                            fix: (fixer) => fixer.replaceTextRange([start, end], "draw_set_color(c_black)")
                        });
                    }
                }
            });
        }
    });
}

function createGm1007Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        return sourceText
            .split(/\r?\n/u)
            .filter((line) => {
                const trimmed = line.trim();
                if (trimmed.length === 0) {
                    return true;
                }

                if (/^new\s+\w+\([^)]*\)\s*=/.test(trimmed)) {
                    return false;
                }
                if (/^\d+\s*=/.test(trimmed)) {
                    return false;
                }
                if (/^=\s*/.test(trimmed)) {
                    return false;
                }
                return true;
            })
            .join("\n");
    });
}

function createGm1008Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const workingDirectoryAssignmentPattern = /(^|\n)([ \t]*)(?:var\s+)?working_directory(\s*=\s*)/;
        const declaredWorkingDirectory = workingDirectoryAssignmentPattern.test(sourceText);
        if (!declaredWorkingDirectory) {
            return sourceText;
        }

        const rewrittenWithLocalDeclaration = sourceText.replace(
            workingDirectoryAssignmentPattern,
            (_fullMatch, linePrefix: string, indentation: string, assignmentOperator: string) =>
                `${linePrefix}${indentation}var __feather_working_directory${assignmentOperator}`
        );

        return rewrittenWithLocalDeclaration.replaceAll(/\bworking_directory\b/g, "__feather_working_directory");
    });
}

function createGm1009Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/\bfa_readonly\s*\+\s*fa_archive\b/g, "fa_readonly | fa_archive");
        rewritten = rewritten.replaceAll(/\broom\s*\+\s*1\b/g, "room_next(room)");
        rewritten = rewritten.replaceAll(/\broom\s*-\s*1\b/g, "room_previous(room)");
        rewritten = rewritten.replaceAll(/\broom_goto\(\s*room_next\(room\)\s*\)/g, "room_goto_next()");
        rewritten = rewritten.replaceAll(/\broom_goto\(\s*room\s*\+\s*1\s*\)/g, "room_goto_next()");
        return rewritten;
    });
}

function createGm1010Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/(?<=\b\d+\s*\+\s*)"(-?\d+(?:\.\d+)?)"/g, "$1");
        rewritten = rewritten.replaceAll(/(?<==\s*)"(-?\d+(?:\.\d+)?)"\s*(?=\+\s*[A-Za-z_]\w*)/g, "$1");
        rewritten = rewritten.replaceAll(
            /(\b-?\d+(?:\.\d+)?\s*\+\s*)([A-Za-z_]\w*)\b/g,
            (fullMatch, numericPrefix: string, identifier: string) => {
                if (!/num/i.test(identifier)) {
                    return fullMatch;
                }

                return `${numericPrefix}real(${identifier})`;
            }
        );
        return rewritten;
    });
}

function createGm1012Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/return\s+([^;\n]+)\.length\s*;/g, "return string_length($1);");
        rewritten = rewritten.replaceAll(
            /^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/gm,
            (
                fullMatch: string,
                indentation: string,
                _functionName: string,
                parameterList: string,
                offset: number,
                fullText: string
            ) => {
                const parameterNames = extractFunctionParameterNames(parameterList);
                if (parameterNames.length === 0 || hasParamDocImmediatelyAbove(fullText, offset)) {
                    return fullMatch;
                }

                const docs = parameterNames
                    .map((parameterName) => `${indentation}/// @param ${toDocParameterName(parameterName)}`)
                    .join("\n");
                return `${docs}\n${fullMatch}`;
            }
        );
        return collapseAdjacentDuplicateParamDocs(rewritten);
    });
}

function createGm1014Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const enumDeclarations = findEnumDeclarations(sourceText);
                    const enumByName = new Map<string, EnumDeclarationMatch>();
                    for (const declaration of enumDeclarations) {
                        enumByName.set(declaration.name, declaration);
                    }

                    const enumMemberReferencePattern = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
                    for (const match of sourceText.matchAll(enumMemberReferencePattern)) {
                        const enumName = match[1];
                        const memberName = match[2];
                        const declaration = enumByName.get(enumName);
                        if (!declaration) {
                            continue;
                        }

                        const memberPattern = new RegExp(String.raw`\b${memberName}\b`, "u");
                        if (memberPattern.test(declaration.text)) {
                            continue;
                        }

                        const sizeofPattern = /^(\s*)(SIZEOF\b[^\n]*)/m;
                        const sizeofMatch = sizeofPattern.exec(declaration.text);
                        if (!sizeofMatch) {
                            continue;
                        }

                        const indentation = sizeofMatch[1];
                        const insertion = `${indentation}${memberName},\n`;
                        const blockRelativeInsertIndex = sizeofMatch.index ?? 0;
                        const absoluteInsertIndex = declaration.start + blockRelativeInsertIndex;

                        context.report({
                            loc: resolveLocFromIndex(context, context.sourceCode.text, absoluteInsertIndex),
                            messageId: "diagnostic",
                            fix: (fixer) =>
                                fixer.replaceTextRange(
                                    [declaration.start, declaration.end],
                                    `${declaration.text.slice(0, blockRelativeInsertIndex)}${insertion}${declaration.text.slice(blockRelativeInsertIndex)}`
                                )
                        });
                        return;
                    }
                }
            });
        }
    });
}

function createGm1016Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const rewritten = sourceText.replaceAll(/^\s*(?:true|false)\s*;\s*/gm, "");
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

function createGm1017Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const deprecatedFunctionMatch =
            /\/\/\/\s*@deprecated\s+Use\s+([A-Za-z_][A-Za-z0-9_]*)\s+instead\.[^\n]*\n\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(
                sourceText
            );
        if (!deprecatedFunctionMatch) {
            return sourceText;
        }

        const replacementName = deprecatedFunctionMatch[1];
        const deprecatedName = deprecatedFunctionMatch[2];
        const callPattern = new RegExp(String.raw`\b${deprecatedName}\s*\(`, "g");
        return sourceText.replaceAll(callPattern, (match, offset: number, fullText: string) => {
            const prefix = fullText.slice(0, offset);
            const functionDeclarationPrefix = /function\s+$/u;
            if (functionDeclarationPrefix.test(prefix)) {
                return match;
            }

            return `${replacementName}(`;
        });
    });
}

function createGm1015Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(DIVISION_BY_ZERO_ASSIGNMENT_PATTERN, "$1");
        rewritten = rewritten.replaceAll(/^\s*\w+\s*\/=\s*0\s*;\s*/gm, "");
        rewritten = rewritten.replaceAll(/%=\s*\(\s*-?0\s*\)/g, "%= -1");
        return rewritten;
    });
}

function createGm1023Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const replacement = getDirectDeprecatedReplacement("os_win32");
                    if (!replacement) {
                        return;
                    }

                    const legacyOsSymbolPattern = /\bos_win32\b/g;
                    for (const match of sourceText.matchAll(legacyOsSymbolPattern)) {
                        const start = match.index ?? 0;
                        const end = start + match[0].length;
                        context.report({
                            loc: resolveLocFromIndex(context, context.sourceCode.text, start),
                            messageId: "diagnostic",
                            fix: (fixer) => fixer.replaceTextRange([start, end], replacement)
                        });
                    }
                }
            });
        }
    });
}

function createGm1021Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /function\s+([A-Za-z_][A-Za-z0-9_]*)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*\{([\s\S]*?)\n\}/g,
            (_fullMatch, functionName: string, parameterName: string, body: string) => {
                const rewrittenBody = body.replaceAll(/\bargument\s*\[\s*0\s*\]/g, parameterName);
                return `function ${functionName}(${parameterName}) {${rewrittenBody}\n}`;
            }
        )
    );
}

function createGm1024Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const declarationMatch = /(^|\n)(\s*)score\s*=/.exec(sourceText);
        if (!declarationMatch) {
            return sourceText;
        }

        return sourceText.replaceAll(/\bscore\b/g, "__featherFix_score");
    });
}

function createGm1026Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const linePattern = /^(\s*)pi\+\+;\s*$/m;
        const match = linePattern.exec(sourceText);
        if (!match) {
            return sourceText;
        }

        const indentation = match[1];
        return sourceText.replace(
            linePattern,
            `${indentation}var __featherFix_pi = pi;\n${indentation}__featherFix_pi++;`
        );
    });
}

function createGm1028Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/\blst_\w*\[\?\s*/g, (prefix) => prefix.replace("[?", "[|"))
    );
}

function createGm1029Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/"(-?\d+(?:\.\d+)?)"/g, (_fullMatch, numeric: string) => numeric)
    );
}

function createGm1030Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const declarationPattern = /\bvar\s+sprite_index\b/;
        if (!declarationPattern.test(sourceText)) {
            return sourceText;
        }

        return sourceText.replaceAll(/\bsprite_index\b/g, "__featherFix_sprite_index");
    });
}

function splitCodeAndTrailingLineComment(line: string): { codeSegment: string; trailingComment: string } {
    let inSingleQuotedString = false;
    let inDoubleQuotedString = false;
    let escaped = false;
    for (let index = 0; index < line.length - 1; index += 1) {
        const character = line[index];
        const nextCharacter = line[index + 1];

        if (escaped) {
            escaped = false;
            continue;
        }

        if ((inSingleQuotedString || inDoubleQuotedString) && character === "\\") {
            escaped = true;
            continue;
        }

        if (!inDoubleQuotedString && character === "'") {
            inSingleQuotedString = !inSingleQuotedString;
            continue;
        }

        if (!inSingleQuotedString && character === '"') {
            inDoubleQuotedString = !inDoubleQuotedString;
            continue;
        }

        if (!inSingleQuotedString && !inDoubleQuotedString && character === "/" && nextCharacter === "/") {
            return {
                codeSegment: line.slice(0, index),
                trailingComment: line.slice(index)
            };
        }
    }

    return { codeSegment: line, trailingComment: "" };
}

function collapseRedundantStatementSemicolons(codeSegment: string): string {
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

function normalizeRedundantSemicolonRuns(sourceText: string): string {
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

function createGm1033Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, normalizeRedundantSemicolonRuns);
}

function createGm1038Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const lines = sourceText.split(/\r?\n/u);
        const seenMacros = new Set<string>();
        const rewritten: Array<string> = [];
        for (const line of lines) {
            const macroMatch = /^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
            if (!macroMatch) {
                rewritten.push(line);
                continue;
            }

            const macroName = macroMatch[1];
            if (seenMacros.has(macroName)) {
                continue;
            }

            seenMacros.add(macroName);
            rewritten.push(line);
        }

        return rewritten.join("\n");
    });
}

function createGm1041Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /\b(instance_create_(?:depth|layer)\([^,]+,[^,]+,[^,]+,\s*)"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g,
            (_fullMatch, prefix: string, objectName: string) => `${prefix}${objectName})`
        )
    );
}

function createGm1051Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/^[^\r\n]*$/gmu, (line) => {
            if (!/^\s*#macro\b/u.test(line)) {
                return line;
            }

            const inlineCommentStart = line.search(/\/\/|\/\*/u);
            const body = inlineCommentStart === -1 ? line : line.slice(0, inlineCommentStart);
            const trailingSemicolon = /;\s*$/u.exec(body);
            if (!trailingSemicolon) {
                return line;
            }

            const semicolonIndex = trailingSemicolon.index;
            const bodyWithoutTrailingSemicolon = `${body.slice(0, semicolonIndex)}${body.slice(semicolonIndex + 1)}`;
            if (/\w;\w/u.test(bodyWithoutTrailingSemicolon)) {
                return line;
            }

            const commentSuffix = inlineCommentStart === -1 ? "" : line.slice(inlineCommentStart);
            return `${bodyWithoutTrailingSemicolon}${commentSuffix}`;
        })
    );
}

function createGm1052Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const arrayVariableNames = new Set<string>();
        for (const match of sourceText.matchAll(/\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\[/g)) {
            arrayVariableNames.add(match[1]);
        }

        return sourceText.replaceAll(/\bdelete\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g, (fullMatch, identifier: string) => {
            if (!arrayVariableNames.has(identifier)) {
                return fullMatch;
            }

            return `${identifier} = undefined;`;
        });
    });
}

function createGm1054Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const arrayLengthReplacement = getDirectDeprecatedReplacement("array_length_1d");
        const arrayHeightReplacement = getDirectDeprecatedReplacement("array_height_2d");
        let rewritten = sourceText;
        if (arrayLengthReplacement) {
            rewritten = rewritten.replaceAll(/\barray_length_1d\s*\(/g, `${arrayLengthReplacement}(`);
        }
        if (arrayHeightReplacement) {
            rewritten = rewritten.replaceAll(/\barray_height_2d\s*\(/g, `${arrayHeightReplacement}(`);
        }
        return rewritten;
    });
}

function createGm1058Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const constructorCalls = new Set<string>();
        for (const match of sourceText.matchAll(/\bnew\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
            constructorCalls.add(match[1]);
        }

        if (constructorCalls.size === 0) {
            return sourceText;
        }

        let rewritten = sourceText;
        for (const functionName of constructorCalls) {
            const declarationPattern = new RegExp(
                String.raw`(\bfunction\s+${functionName}\s*\([^)]*\))(\s*constructor\b)?(\s*\{)`,
                "g"
            );
            rewritten = rewritten.replaceAll(
                declarationPattern,
                (
                    _match,
                    functionHeader: string,
                    existingConstructorKeyword: string | undefined,
                    bracePrefix: string
                ) =>
                    existingConstructorKeyword
                        ? `${functionHeader}${existingConstructorKeyword}${bracePrefix}`
                        : `${functionHeader} constructor${bracePrefix}`
            );
        }

        return rewritten;
    });
}

function createGm1063Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\(\s*texture_defined\s*\)\s*\?\s*([^:;]+):\s*-1\s*;/g,
            (_fullMatch, identifier: string, truthyExpr: string) =>
                `${identifier} = texture_defined ? ${truthyExpr.trim()} : pointer_null;`
        )
    );
}

function createGm1064Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const seenFunctionNames = new Set<string>();
        const functionPattern = /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g;
        const removals: Array<[number, number]> = [];

        for (const match of sourceText.matchAll(functionPattern)) {
            const functionName = match[1];
            const start = match.index ?? 0;
            const openBraceIndex = sourceText.indexOf("{", start);
            if (openBraceIndex === -1) {
                continue;
            }

            let depth = 1;
            let end = openBraceIndex + 1;
            while (end < sourceText.length && depth > 0) {
                const character = sourceText[end];
                if (character === "{") {
                    depth += 1;
                } else if (character === "}") {
                    depth -= 1;
                }
                end += 1;
            }

            if (!seenFunctionNames.has(functionName)) {
                seenFunctionNames.add(functionName);
                continue;
            }

            let removalEnd = end;
            while (removalEnd < sourceText.length && /\s/.test(sourceText[removalEnd])) {
                removalEnd += 1;
            }
            removals.push([start, removalEnd]);
        }

        if (removals.length === 0) {
            return sourceText;
        }

        let rewritten = "";
        let cursor = 0;
        for (const [start, end] of removals) {
            rewritten += sourceText.slice(cursor, start);
            cursor = end;
        }
        rewritten += sourceText.slice(cursor);
        return rewritten;
    });
}

function createGm1100Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const rewrittenLines = sourceText.split(/\r?\n/u).filter((line) => {
            const trimmed = line.trim();
            if (LEADING_EQUALS_ARTIFACT_PATTERN.test(trimmed)) {
                return false;
            }

            if (/^_this\s*\*\s*\w+\s*;\s*$/u.test(trimmed)) {
                return false;
            }

            return true;
        });
        return rewrittenLines
            .join("\n")
            .replaceAll(/\n{2,}/g, "\n")
            .replace(/\n?$/u, "\n");
    });
}

function createGm2000Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_blendmode\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_set_blendmode(bm_normal);");
    });
}

function createGm2003Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bshader_set\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "shader_reset();");
    });
}

function createGm2009Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/^\s*vertex_end\s*\([^)]*\)\s*;\s*/gm, "")
    );
}

function createGm2020Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /^(\s*)all\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+);\s*$/gm,
            (_fullMatch, indentation: string, identifier: string, valueExpression: string) =>
                `${indentation}with (all) {\n${indentation}    ${identifier} = ${valueExpression};\n${indentation}}`
        )
    );
}

function createGm2023Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bdraw_set_alpha\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "draw_set_alpha(1);");
    });
}

function createGm2025Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bdraw_set_color\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "draw_set_color(c_white);");
    });
}

function createGm2026Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bdraw_set_halign\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "draw_set_halign(fa_left);");
    });
}

function createGm2028Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/^\s*draw_primitive_end\s*\(\s*\)\s*;\s*/gm, "")
    );
}

function createGm2032Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/^\s*file_find_close\s*\(\s*\)\s*;\s*/gm, "")
    );
}

function createGm2035Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_push_state\s*\(\s*\)\s*;/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_pop_state();");
    });
}

function createGm2040Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_zwriteenable\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_set_zwriteenable(true);");
    });
}

function createGm2048Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_blendenable\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_set_blendenable(true);");
    });
}

function createGm2050Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_fog\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_set_fog(false, c_black, 0, 1);");
    });
}

function createGm2051Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_cullmode\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_set_cullmode(cull_noculling);");
    });
}

function createGm2052Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_colourwriteenable\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_set_colourwriteenable(true, true, true, true);");
    });
}

function createGm2053Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_alphatestenable\s*\(/.test(sourceText)) {
            return sourceText;
        }

        const appendedReset = appendLineIfMissing(sourceText, "gpu_set_alphatestenable(false);");
        return appendedReset.replaceAll(GPU_ALPHA_TEST_TRUE_SPACING_PATTERN, "$1\n$2");
    });
}

function createGm2054Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_alphatestref\s*\(/.test(sourceText)) {
            return sourceText;
        }

        const lineEnding = sourceText.includes("\r\n") ? "\r\n" : "\n";
        let insertedResetBeforeDisable = false;
        const rewritten = sourceText.replaceAll(
            /^([ \t]*)gpu_set_alphatestenable\s*\(\s*false\s*\)\s*;/gm,
            (fullMatch: string, indentation: string, offset: number, fullText: string) => {
                const precedingLines = fullText.slice(0, offset).split(/\r?\n/u);
                for (let index = precedingLines.length - 1; index >= 0; index -= 1) {
                    const trimmed = precedingLines[index]?.trim() ?? "";
                    if (trimmed.length === 0) {
                        continue;
                    }

                    if (/^gpu_set_alphatestref\s*\(\s*0\s*\)\s*;$/u.test(trimmed)) {
                        return fullMatch;
                    }

                    break;
                }

                insertedResetBeforeDisable = true;
                return `${indentation}gpu_set_alphatestref(0);${lineEnding}${fullMatch}`;
            }
        );

        if (insertedResetBeforeDisable) {
            return rewritten;
        }

        if (!/\bgpu_set_alphatestref\s*\(\s*0\s*\)\s*;/.test(rewritten)) {
            return appendLineIfMissing(rewritten, "gpu_set_alphatestref(0);");
        }

        return rewritten;
    });
}

function createGm2056Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_texrepeat\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_set_texrepeat(false);");
    });
}

function createGm2061Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll(
            /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;\s*\n\1if\s*\(\s*\2\s*==\s*undefined\s*\)\s*\2\s*=\s*(.+?)\s*;\s*$/gm,
            (_fullMatch, indentation: string, target: string, expression: string, fallback: string) =>
                `${indentation}${target} = ${expression} ?? ${fallback};`
        );

        rewritten = rewritten.replaceAll(
            /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;\s*\n\1if\s*\(\s*(?:\2\s*==\s*undefined|is_undefined\s*\(\s*\2\s*\))\s*\)\s*\{\s*\n\1[ \t]+\2\s*=\s*(.+?)\s*;\s*\n\1\}\s*$/gm,
            (_fullMatch, indentation: string, target: string, expression: string, fallback: string) =>
                `${indentation}${target} = ${expression} ?? ${fallback};`
        );

        return rewritten;
    });
}

function createGm2064Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_ztestenable\s*\(/.test(sourceText)) {
            return sourceText;
        }

        return appendLineIfMissing(sourceText, "gpu_set_ztestenable(true);");
    });
}

function createGm1013Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s+\(/gm, "$1function $2(");
        rewritten = rewritten.replaceAll(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s+:\s*/g, "$1$2: ");
        rewritten = rewritten.replaceAll(
            /(^([ \t]*)(?:static\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*function\s*\([^)]*\)\s*(?:constructor\s*)?\{[\s\S]*?^\2\})([ \t]*(?:;[ \t]*)?(?:\r?\n|$))/gm,
            (_fullMatch, blockText: string, _indentation: string, suffix: string) =>
                suffix.includes(";") ? `${blockText}${suffix}` : `${blockText};${suffix}`
        );
        rewritten = rewritten.replaceAll(
            /with\s*\(\s*other\s*\)\s*\{([\s\S]*?)\n([ \t]*)\}/gm,
            (fullMatch, body: string, indentation: string) => {
                const rewrittenBody = body.replaceAll(
                    /(\bvar\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*;/g,
                    (_match, declarationPrefix: string, leftOperand: string, rightOperand: string) => {
                        if (/^(?:other|self|global)$/u.test(rightOperand)) {
                            return `${declarationPrefix}${leftOperand} + ${rightOperand};`;
                        }

                        return `${declarationPrefix}${leftOperand} + other.${rightOperand};`;
                    }
                );

                return fullMatch.replace(body, rewrittenBody).replace(/\n[ \t]*\}$/u, `\n${indentation}}`);
            }
        );
        return rewritten;
    });
}

function createGm1032Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/^\s*\/\/\/\s*@function\b[^\n]*\n?/gm, "");
        rewritten = rewritten.replaceAll(/\bargument\[\s*(\d+)\s*\]/g, "argument$1");
        rewritten = rewritten.replaceAll(
            /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{([\s\S]*?)\n\}/g,
            (_fullMatch, functionName: string, body: string) => {
                const aliasMatches = [
                    ...body.matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*argument(\d+)\s*;\s*$/gm)
                ];
                const aliasEntries = aliasMatches.map((match) => ({
                    name: match[1],
                    index: Number.parseInt(match[2])
                }));
                const argumentIndexes = [...body.matchAll(/\bargument(\d+)\b/g)].map((match) =>
                    Number.parseInt(match[1])
                );
                const maxArgumentIndex = argumentIndexes.length === 0 ? -1 : Math.max(...argumentIndexes);

                let rewrittenBody = body;
                if (aliasEntries.length > 0) {
                    const aliasesByIndex = new Map<number, string>();
                    for (const aliasEntry of aliasEntries) {
                        aliasesByIndex.set(aliasEntry.index, aliasEntry.name);
                    }

                    const sortedAliasIndexes = [...aliasesByIndex.keys()].toSorted((left, right) => left - right);
                    const contiguousAliases = sortedAliasIndexes.every((index, sortedIndex) => index === sortedIndex);
                    if (contiguousAliases && maxArgumentIndex <= sortedAliasIndexes.at(-1)) {
                        rewrittenBody = rewrittenBody.replaceAll(
                            /^[ \t]*var\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*argument\d+\s*;[ \t]*(?:\r?\n)?/gm,
                            ""
                        );
                        for (const [index, aliasName] of aliasesByIndex) {
                            const aliasPattern = new RegExp(String.raw`\bargument${index}\b`, "g");
                            rewrittenBody = rewrittenBody.replaceAll(aliasPattern, aliasName);
                        }
                        const parameterList = sortedAliasIndexes.map((index) => aliasesByIndex.get(index)).join(", ");
                        return `function ${functionName}(${parameterList}) {${rewrittenBody}\n}`;
                    }
                }

                const uniqueSortedIndexes = [...new Set(argumentIndexes)].toSorted((left, right) => left - right);
                const startsAtZero = uniqueSortedIndexes.length > 0 && uniqueSortedIndexes[0] === 0;
                if (startsAtZero) {
                    for (const [position, originalIndex] of uniqueSortedIndexes.entries()) {
                        if (position === originalIndex) {
                            continue;
                        }

                        const argumentPattern = new RegExp(String.raw`\bargument${originalIndex}\b`, "g");
                        rewrittenBody = rewrittenBody.replaceAll(argumentPattern, `argument${position}`);
                    }
                }

                return `function ${functionName}() {${rewrittenBody}\n}`;
            }
        );
        rewritten = rewritten.replaceAll(
            /((?:^[ \t]*\/\/\/[^\n]*\n)*)(^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{)/gm,
            (
                fullMatch: string,
                docBlock: string,
                functionDeclaration: string,
                indentation: string,
                _functionName: string,
                parameterList: string,
                offset: number,
                fullText: string
            ) => {
                const parameterNames = extractFunctionParameterNames(parameterList);
                const functionDeclarationStart = offset + docBlock.length;
                const openBraceIndex = fullText.indexOf("{", functionDeclarationStart);
                if (openBraceIndex === -1) {
                    return fullMatch;
                }

                const closeBraceEndIndex = findMatchingBraceEndIndex(fullText, openBraceIndex);
                if (closeBraceEndIndex < 0) {
                    return fullMatch;
                }

                const functionBody = fullText.slice(openBraceIndex + 1, closeBraceEndIndex - 1);
                const argumentIndexes = [...functionBody.matchAll(/\bargument(\d+)\b/g)].map((match) =>
                    Number.parseInt(match[1])
                );
                const maxArgumentIndex = argumentIndexes.length === 0 ? -1 : Math.max(...argumentIndexes);

                const aliasNamesByIndex = new Map<number, string>();
                for (const match of functionBody.matchAll(
                    /^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*argument(\d+)\s*;\s*$/gm
                )) {
                    const aliasName = match[1];
                    const aliasIndex = Number.parseInt(match[2]);
                    aliasNamesByIndex.set(aliasIndex, aliasName);
                }

                const docLines =
                    docBlock.length === 0
                        ? []
                        : docBlock
                              .trimEnd()
                              .split(/\r?\n/u)
                              .filter((line) => line.length > 0);
                const descriptionLines = docLines
                    .filter((line) => /^\s*\/\/\/\s*@description\b/u.test(line))
                    .map((line) => {
                        const descriptionText = line.replace(/^\s*\/\/\/\s*@description\b\s*/u, "").trim();
                        return `${indentation}/// @description${descriptionText.length > 0 ? ` ${descriptionText}` : ""}`;
                    });
                const returnsLines = docLines
                    .filter((line) => /^\s*\/\/\/\s*@returns\b/u.test(line))
                    .map((line) => `${indentation}/// @returns${line.replace(/^\s*\/\/\/\s*@returns\b/u, "")}`);

                const parameterDocNames: Array<string> = [];
                if (parameterNames.length > 0) {
                    parameterDocNames.push(...parameterNames);
                } else if (maxArgumentIndex >= 0) {
                    for (let index = 0; index <= maxArgumentIndex; index += 1) {
                        parameterDocNames.push(aliasNamesByIndex.get(index) ?? `argument${index}`);
                    }
                }

                const parameterDocLines = parameterDocNames.map(
                    (parameterName) => `${indentation}/// @param ${toDocParameterName(parameterName)}`
                );
                const canonicalDocLines = [...descriptionLines, ...parameterDocLines, ...returnsLines];
                if (canonicalDocLines.length === 0) {
                    return functionDeclaration;
                }

                return `${canonicalDocLines.join("\n")}\n${functionDeclaration}`;
            }
        );
        rewritten = rewritten.replaceAll(/\}\n(?=\/\/\/\s*@description\b)/g, "}\n\n");
        if (!rewritten.endsWith("\n")) {
            rewritten = `${rewritten}\n`;
        }
        return rewritten;
    });
}

function createGm1034Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/\bargument\[\s*(\d+)\s*\]/g, "argument$1");
        rewritten = rewritten.replaceAll(
            /^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\n\{/gm,
            "$1function $2() {"
        );

        const functionDeclarationMatch = /^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{/m.exec(rewritten);
        const aliasMatch = /^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*argument0\s*;\s*$/m.exec(rewritten);
        if (functionDeclarationMatch && aliasMatch) {
            const functionDeclaration = functionDeclarationMatch[0];
            const functionIndentation = functionDeclarationMatch[1] ?? "";
            const functionName = functionDeclarationMatch[2];
            const parameterName = aliasMatch[1];

            rewritten = rewritten.replace(
                functionDeclaration,
                `${functionIndentation}function ${functionName}(${parameterName}) {`
            );
            rewritten = rewritten.replace(aliasMatch[0], "");
        }

        rewritten = rewritten.replaceAll(/^\s*show_debug_message\(/gm, "    show_debug_message(");
        rewritten = rewritten.replaceAll(/^\s*return\s+/gm, "    return ");
        rewritten = rewritten.replaceAll(/\n{3,}/g, "\n\n");
        if (!rewritten.trimEnd().endsWith("}")) {
            rewritten = `${rewritten.trimEnd()}\n}`;
        }
        return rewritten;
    });
}

function createGm1036Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(BRACKETED_INDEX_LIST_PATTERN, (_fullMatch, indexList: string) => {
            return indexList
                .split(",")
                .map((indexPart) => `[${indexPart.trim()}]`)
                .join("");
        });
        rewritten = rewritten.replaceAll(
            /^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\n\{/gm,
            "$1function $2($3) {"
        );
        return rewritten;
    });
}

function createGm1056Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        return sourceText.replaceAll(
            /^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/gm,
            (fullMatch: string, indentation: string, functionName: string, parameterList: string) => {
                const parameterSegments = parameterList
                    .split(",")
                    .map((segment) => segment.trim())
                    .filter((segment) => segment.length > 0);
                if (parameterSegments.length === 0) {
                    return fullMatch;
                }

                const firstOptionalIndex = parameterSegments.findIndex((segment) => segment.includes("="));
                if (firstOptionalIndex === -1) {
                    return fullMatch;
                }

                const normalizedParameters: Array<string> = [];
                for (const [index, segment] of parameterSegments.entries()) {
                    if (index >= firstOptionalIndex && !segment.includes("=")) {
                        normalizedParameters.push(`${segment} = undefined`);
                        continue;
                    }

                    normalizedParameters.push(segment);
                }
                return `${indentation}function ${functionName}(${normalizedParameters.join(", ")}) {`;
            }
        );
    });
}

function createGm1059Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/gm,
            (fullMatch: string, indentation: string, functionName: string, parameterList: string) => {
                const parameterNames = extractFunctionParameterNames(parameterList);
                if (parameterNames.length === 0) {
                    return fullMatch;
                }

                const uniqueParameterNames: Array<string> = [];
                for (const parameterName of parameterNames) {
                    if (!uniqueParameterNames.includes(parameterName)) {
                        uniqueParameterNames.push(parameterName);
                    }
                }

                return `${indentation}function ${functionName}(${uniqueParameterNames.join(", ")}) {`;
            }
        )
    );
}

function createGm1062Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/^\s*\/\/\/\s*@function\b[^\n]*\n?/gm, "");
        rewritten = rewritten.replaceAll(/^([ \t]*\/\/\/\s*)@desc\b/gm, "$1@description");
        rewritten = rewritten.replaceAll(
            /^([ \t]*\/\/\/\s*@param\s*)\{([^}]*)\}(\s+)([A-Za-z_][A-Za-z0-9_]*)(.*)$/gm,
            (_fullMatch, prefix: string, typeText: string, spacing: string, parameterName: string, suffix: string) => {
                const normalizedType = normalizeFeatherDocTypeText(typeText);
                const normalizedParameterName = toDocParameterName(parameterName);
                const normalizedSuffix = suffix.replace(/^\s*-\s*/u, " ");
                return `${prefix}{${normalizedType}}${spacing}${normalizedParameterName}${normalizedSuffix}`;
            }
        );
        rewritten = rewritten.replaceAll(
            /^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\n\{/gm,
            "$1function $2($3) {"
        );
        rewritten = rewritten.replaceAll(/,\s+\n/g, ",\n");
        rewritten = rewritten.replaceAll(
            /((?:^[ \t]*\/\/\/[^\n]*\n)+)(^([ \t]*)function\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*\{)/gm,
            (_fullMatch: string, docBlock: string, functionDeclaration: string, indentation: string) => {
                const docLines = docBlock
                    .trimEnd()
                    .split(/\r\n|\n/u)
                    .filter((line) => line.length > 0);
                const descriptionLines = docLines
                    .filter((line) => /^\s*\/\/\/\s*@description\b/u.test(line))
                    .map((line) => {
                        const descriptionText = line.replace(/^\s*\/\/\/\s*@description\b\s*/u, "").trim();
                        return `${indentation}/// @description${descriptionText.length > 0 ? ` ${descriptionText}` : ""}`;
                    });
                const parameterLines = docLines
                    .filter((line) => /^\s*\/\/\/\s*@param\b/u.test(line))
                    .map((line) => `${indentation}${line.trimStart()}`);
                const returnLines = docLines
                    .filter((line) => /^\s*\/\/\/\s*@returns\b/u.test(line))
                    .map((line) => `${indentation}${line.trimStart()}`);
                if (returnLines.length === 0) {
                    returnLines.push(`${indentation}/// @returns {undefined}`);
                }

                const orderedDocLines = [...descriptionLines, ...parameterLines, ...returnLines];
                return `${orderedDocLines.join("\n")}\n${functionDeclaration}`;
            }
        );
        return rewritten;
    });
}

function createGm2004Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/for\s*\(\s*var i = 0;\s*i < ([^;]+);\s*i \+= 1\s*\)\s*\{/g, "repeat ($1) {");
        rewritten = rewritten.replaceAll(
            /for\s*\(\s*count = 0;\s*count < ([^;]+);\s*\+\+count\s*\)\s*\{/g,
            "repeat ($1) {"
        );
        rewritten = rewritten.replaceAll(
            /for\s*\(\s*var step = 0;\s*step < ([^;]+);\s*step = step \+ 1\s*\)\s*\{/g,
            "repeat ($1) {"
        );
        return rewritten;
    });
}

function createGm2005Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll(
            /if \(!surface_exists\(sf_canvas\)\)\s*\n\{/g,
            "if (!surface_exists(sf_canvas)) {"
        );
        rewritten = appendLineIfMissing(rewritten, "surface_reset_target();");
        return rewritten;
    });
}

function createGm2007Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(
            /^([ \t]*var\s+[A-Za-z_][A-Za-z0-9_]*)(\s*\/\/[^\n]*)?$/gm,
            (_fullMatch, declaration: string, trailingComment?: string) => `${declaration};${trailingComment ?? ""}`
        );
        rewritten = rewritten.replaceAll(/(if\s*\([^\n]+\))\s*\n\{/g, "$1 {");
        return rewritten;
    });
}

function createGm2008Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const beginCount = [...sourceText.matchAll(/\bvertex_begin\s*\(/g)].length;
        const endCount = [...sourceText.matchAll(/\bvertex_end\s*\(/g)].length;
        if (!/\bvertex_begin\s*\(/.test(sourceText) || beginCount <= endCount) {
            return sourceText;
        }

        return sourceText.replace(VERTEX_BEGIN_WITHOUT_END_PATTERN, "$1\nvertex_end(vb);\n");
    });
}

function createGm2011Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (sourceText.includes("vertex_end(vb);")) {
            return sourceText;
        }
        return appendLineIfMissing(sourceText, "vertex_end(vb);");
    });
}

function createGm2012Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const lineEnding = sourceText.includes("\r\n") ? "\r\n" : "\n";
        const hasTerminalNewline = sourceText.endsWith("\n");
        const lines = sourceText.split(/\r?\n/u);
        const rewrittenLines: Array<string> = [];
        let activeBeginLineIndex: number | null = null;
        let activeBeginHasContent = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "vertex_format_add_position_3d();") {
                continue;
            }

            if (trimmed === "vertex_format_begin();") {
                if (activeBeginLineIndex !== null && !activeBeginHasContent) {
                    rewrittenLines.splice(activeBeginLineIndex, 1);
                }

                rewrittenLines.push(line);
                activeBeginLineIndex = rewrittenLines.length - 1;
                activeBeginHasContent = false;
                continue;
            }

            if (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*vertex_format_end\(\);\s*$/u.test(trimmed)) {
                rewrittenLines.push(line);
                activeBeginLineIndex = null;
                activeBeginHasContent = false;
                continue;
            }

            if (trimmed === "vertex_format_end();") {
                if (activeBeginLineIndex !== null && !activeBeginHasContent) {
                    rewrittenLines.splice(activeBeginLineIndex, 1);
                }

                activeBeginLineIndex = null;
                activeBeginHasContent = false;
                continue;
            }

            if (activeBeginLineIndex !== null && trimmed.length === 0) {
                continue;
            }

            if (activeBeginLineIndex !== null && trimmed.length > 0 && !trimmed.startsWith("//")) {
                activeBeginHasContent = true;
            }

            rewrittenLines.push(line);
        }

        let rewritten = rewrittenLines.join(lineEnding);
        rewritten = rewritten.replaceAll(new RegExp(`${lineEnding}{3,}`, "g"), `${lineEnding}${lineEnding}`);
        if (hasTerminalNewline && !rewritten.endsWith(lineEnding)) {
            rewritten = `${rewritten}${lineEnding}`;
        }

        return rewritten;
    });
}

function createGm2015Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const lines = sourceText.split(/\r?\n/u);
        const rewritten: Array<string> = [];
        let insertedTodo = false;
        for (const line of lines) {
            if (/^\s*vertex_format_/.test(line)) {
                if (!insertedTodo) {
                    rewritten.push("// TODO: Incomplete vertex format definition automatically commented out (GM2015)");
                    insertedTodo = true;
                }
                rewritten.push(`//${line}`);
                continue;
            }
            rewritten.push(line);
        }
        return rewritten.join("\n");
    });
}

function createGm2029Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll("draw_primitive_begin();", "draw_primitive_begin(pr_trianglelist);");
        rewritten = rewritten.replaceAll(
            /draw_vertex\(([^)]+)\);\s*draw_vertex\(([^)]+)\);/g,
            "draw_vertex($1);\ndraw_vertex($2);"
        );

        const lines = rewritten.split(/\r?\n/u);
        const beginPattern = /^\s*draw_primitive_begin\s*\([^)]*\)\s*;\s*$/u;
        const endPattern = /^\s*draw_primitive_end\s*\(\s*\)\s*;\s*$/u;
        const vertexPattern = /^\s*draw_vertex\s*\(/u;
        const firstVertexIndex = lines.findIndex((line) => vertexPattern.test(line));
        if (firstVertexIndex === -1) {
            return rewritten;
        }

        const vertexIndent = /^(\s*)/u.exec(lines[firstVertexIndex])?.[1] ?? "";
        const beginLine = `${vertexIndent}draw_primitive_begin(pr_trianglelist);`;
        const endLine = `${vertexIndent}draw_primitive_end();`;
        const keptLines = lines.filter((line) => !beginPattern.test(line) && !endPattern.test(line));

        const insertBeginAt = keptLines.findIndex((line) => vertexPattern.test(line));
        if (insertBeginAt === -1) {
            return rewritten;
        }

        keptLines.splice(insertBeginAt, 0, beginLine);
        let lastVertexIndex = -1;
        for (let index = keptLines.length - 1; index >= 0; index -= 1) {
            if (vertexPattern.test(keptLines[index])) {
                lastVertexIndex = index;
                break;
            }
        }

        if (lastVertexIndex === -1) {
            return rewritten;
        }

        keptLines.splice(lastVertexIndex + 1, 0, endLine);
        return keptLines.join("\n");
    });
}

function createGm2030Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/if \(([^)]+)\)\s*\n\{/g, "if ($1) {");
        rewritten = rewritten.replace(/\n\}\nelse\s*\n\{/, "\n} else {");
        rewritten = rewritten.replaceAll(/^\s*draw_primitive_end\(\);\s*$/gm, "");
        rewritten = rewritten.replace(
            /(\}\s*)\n\ninstance_destroy\(\);/m,
            "$1\ndraw_primitive_end();\n\ninstance_destroy();"
        );
        return rewritten;
    });
}

function createGm2031Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll(/if \(([^)]+)\)\s*\n\{/g, "if ($1) {");
        const lines = rewritten.split(/\r?\n/u);
        for (const [index, line] of lines.entries()) {
            if (!/^\s*_file2\s*=\s*file_find_first\(/u.test(line)) {
                continue;
            }

            let previousNonEmptyLineIndex = index - 1;
            while (previousNonEmptyLineIndex >= 0 && lines[previousNonEmptyLineIndex].trim().length === 0) {
                previousNonEmptyLineIndex -= 1;
            }

            if (previousNonEmptyLineIndex >= 0 && lines[previousNonEmptyLineIndex].trim() === "file_find_close();") {
                break;
            }

            const indentation = /^(\s*)/u.exec(line)?.[1] ?? "";
            lines.splice(index, 0, `${indentation}file_find_close();`);
            break;
        }

        rewritten = lines.join("\n");
        return rewritten;
    });
}

function createGm2033Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll(/while \(([^)]+)\)\s*\n\{/g, "while ($1) {");
        rewritten = rewritten.replace(/\n\s*file_find_next\(\);\s*$/m, "");
        return rewritten;
    });
}

function createGm2042Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/if \(([^)]+)\)\s*\n\{/g, "if ($1) {");
        rewritten = rewritten.replaceAll(/\n\}\nelse\s*\n\{/g, "\n} else {");
        rewritten = rewritten.replaceAll(DUPLICATE_GPU_PUSH_STATE_PATTERN, "gpu_push_state();");
        rewritten = rewritten.replaceAll(DUPLICATE_GPU_POP_STATE_PATTERN, "gpu_pop_state();");
        rewritten = rewritten.replace(
            "gpu_push_state();draw_circle(x + 1, y + 1, 2, true);scr_another_custom_function_which_might_reset_things();",
            "gpu_push_state();\ndraw_circle(x + 1, y + 1, 2, true);\nscr_another_custom_function_which_might_reset_things();"
        );
        return rewritten;
    });
}

function createGm2043Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replace(/(^|\n)([ \t]*)i\s*=\s*0\s*;/u, "$1$2var i = 0;");
        rewritten = rewritten.replace(/(^|\n)([ \t]*)var\s+i\s*=\s*34\s*;/u, "$1$2i = 34;");
        rewritten = rewritten.replaceAll(/if \(([^)]+)\)\s*\n\{/g, "if ($1) {");
        rewritten = rewritten.replaceAll(
            /(^[ \t]*)if\s*\(([^)]+)\)\s*\{\r?\n([ \t]*)var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\r\n]+);\r?\n\1\}\r?\n/gm,
            (
                fullMatch: string,
                indentation: string,
                condition: string,
                bodyIndentation: string,
                identifier: string,
                initializer: string,
                offset: number,
                fullText: string
            ) => {
                const before = fullText.slice(0, offset);
                const after = fullText.slice(offset + fullMatch.length);
                const declarationPattern = new RegExp(String.raw`\bvar\s+${identifier}\b`);
                const subsequentUsePattern = new RegExp(String.raw`\b${identifier}\s*=`);
                if (!subsequentUsePattern.test(after)) {
                    return fullMatch;
                }

                if (declarationPattern.test(before)) {
                    return `${indentation}if (${condition}) {\n${bodyIndentation}${identifier} = ${initializer};\n${indentation}}\n`;
                }

                return `${indentation}var ${identifier};\n\n${indentation}if (${condition}) {\n${bodyIndentation}${identifier} = ${initializer};\n${indentation}}\n`;
            }
        );
        return rewritten;
    });
}

function createGm2044Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(
            /^([ \t]*)function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/gm,
            (
                fullMatch: string,
                indentation: string,
                _functionName: string,
                _parameterList: string,
                offset: number,
                fullText: string
            ) => {
                const leadingDocLines = collectContiguousLeadingDocLinesAboveIndex(fullText, offset);
                if (leadingDocLines.some((line) => /^\/\/\/\s*@returns\b/u.test(line.trim()))) {
                    return fullMatch;
                }

                return `${indentation}/// @returns {undefined}\n${fullMatch}`;
            }
        );
        rewritten = rewritten.replaceAll(
            /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\1\s*\+\s*1\s*;/g,
            (_fullMatch, identifier: string) => `${identifier} = ${identifier} + 1;`
        );
        rewritten = rewritten.replaceAll(
            /\n([ \t]*)var\s+([A-Za-z_][A-Za-z0-9_]*)\s*;\s*\n\1var\s+\2\s*;/g,
            "\n$1var $2;"
        );
        return rewritten;
    });
}

function createGm2046Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replace(
            "vertex_submit(vb, pr_trianglelist, surface_get_texture(sf));\nsurface_reset_target();",
            "surface_reset_target();\nvertex_submit(vb, pr_trianglelist, surface_get_texture(sf));"
        );
        if (!/surface_set_target\(sf2\)[\s\S]*surface_reset_target\(\);/.test(rewritten)) {
            rewritten = `${rewritten}${rewritten.endsWith("\n") ? "" : "\n"}surface_reset_target();\n`;
        }
        return rewritten;
    });
}

const featherRuleFactoriesById: ReadonlyMap<string, FeatherRuleFactory> = new Map([
    ["GM1000", createGm1000Rule],
    ["GM1002", createGm1002Rule],
    ["GM1003", createGm1003Rule],
    ["GM1004", createGm1004Rule],
    ["GM1005", createGm1005Rule],
    ["GM1007", createGm1007Rule],
    ["GM1008", createGm1008Rule],
    ["GM1009", createGm1009Rule],
    ["GM1010", createGm1010Rule],
    ["GM1012", createGm1012Rule],
    ["GM1014", createGm1014Rule],
    ["GM1015", createGm1015Rule],
    ["GM1016", createGm1016Rule],
    ["GM1017", createGm1017Rule],
    ["GM1021", createGm1021Rule],
    ["GM1023", createGm1023Rule],
    ["GM1024", createGm1024Rule],
    ["GM1026", createGm1026Rule],
    ["GM1028", createGm1028Rule],
    ["GM1029", createGm1029Rule],
    ["GM1030", createGm1030Rule],
    ["GM1033", createGm1033Rule],
    ["GM1038", createGm1038Rule],
    ["GM1041", createGm1041Rule],
    ["GM1051", createGm1051Rule],
    ["GM1052", createGm1052Rule],
    ["GM1054", createGm1054Rule],
    ["GM1058", createGm1058Rule],
    ["GM1063", createGm1063Rule],
    ["GM1064", createGm1064Rule],
    ["GM1100", createGm1100Rule],
    ["GM1013", createGm1013Rule],
    ["GM1032", createGm1032Rule],
    ["GM1034", createGm1034Rule],
    ["GM1036", createGm1036Rule],
    ["GM1056", createGm1056Rule],
    ["GM1059", createGm1059Rule],
    ["GM1062", createGm1062Rule],
    ["GM2000", createGm2000Rule],
    ["GM2003", createGm2003Rule],
    ["GM2009", createGm2009Rule],
    ["GM2004", createGm2004Rule],
    ["GM2005", createGm2005Rule],
    ["GM2007", createGm2007Rule],
    ["GM2008", createGm2008Rule],
    ["GM2011", createGm2011Rule],
    ["GM2012", createGm2012Rule],
    ["GM2015", createGm2015Rule],
    ["GM2020", createGm2020Rule],
    ["GM2023", createGm2023Rule],
    ["GM2025", createGm2025Rule],
    ["GM2026", createGm2026Rule],
    ["GM2028", createGm2028Rule],
    ["GM2029", createGm2029Rule],
    ["GM2032", createGm2032Rule],
    ["GM2030", createGm2030Rule],
    ["GM2031", createGm2031Rule],
    ["GM2033", createGm2033Rule],
    ["GM2035", createGm2035Rule],
    ["GM2040", createGm2040Rule],
    ["GM2042", createGm2042Rule],
    ["GM2043", createGm2043Rule],
    ["GM2044", createGm2044Rule],
    ["GM2046", createGm2046Rule],
    ["GM2048", createGm2048Rule],
    ["GM2050", createGm2050Rule],
    ["GM2051", createGm2051Rule],
    ["GM2052", createGm2052Rule],
    ["GM2053", createGm2053Rule],
    ["GM2054", createGm2054Rule],
    ["GM2056", createGm2056Rule],
    ["GM2061", createGm2061Rule],
    ["GM2064", createGm2064Rule]
]);

export function createFeatherRule(entry: FeatherManifestEntry): Rule.RuleModule {
    const createRule = featherRuleFactoriesById.get(entry.id);
    if (createRule) {
        return createRule(entry);
    }

    throw new Error(`Missing feather rule implementation for id '${entry.id}'.`);
}
