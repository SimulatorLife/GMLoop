import type { Rule } from "eslint";

import { gmlRuleBaseHelpersServices } from "../../gml/gml-rule-services.js";
import {
    createFeatherRuleMeta,
    createFullTextRewriteRule,
    findEnumBlocks,
    findEnumDeclarations,
    normalizeRedundantSemicolonRuns,
    removeTrailingMacroSemicolonIfSafe,
    splitMacroLineSegments
} from "../feather-rule-helpers.js";
import {
    DIVISION_BY_ZERO_ASSIGNMENT_PATTERN,
    ENUM_MEMBER_DECLARATION_PATTERN,
    LEADING_EQUALS_ARTIFACT_PATTERN
} from "../feather-rule-patterns.js";
import type { EnumDeclarationMatch } from "../feather-rule-types.js";
import type { FeatherManifestEntry } from "../manifest.js";

// Consume the base-helper service contract so this feather rule does not
// reach two directory levels into the gml/ rules folder for
// `resolveLocFromIndex`. The facade keeps the gml/ layout encapsulated.
const { resolveLocFromIndex } = gmlRuleBaseHelpersServices;

export function createGm1003Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1000Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => sourceText.replaceAll(/^\s*break;\s*/gm, ""));
}

export function createGm1002Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /^([ \t]*)globalvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\r\n]+);/gmu,
            (_fullMatch, indentation: string, identifier: string, initializer: string) =>
                `${indentation}globalvar ${identifier};\n${indentation}${identifier} = ${initializer};`
        )
    );
}

export function createGm1004Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1005Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1007Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1008Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1009Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1010Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1012Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/return\s+([^;\n]+)\.length\s*;/g, "return string_length($1);")
    );
}

export function createGm1014Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1016Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => sourceText.replaceAll(/^\s*(?:true|false)\s*;\s*/gm, ""));
}

export function createGm1015Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(DIVISION_BY_ZERO_ASSIGNMENT_PATTERN, "$1");
        rewritten = rewritten.replaceAll(/^\s*\w+\s*\/=\s*0\s*;\s*/gm, "");
        rewritten = rewritten.replaceAll(/%=\s*\(\s*-?0\s*\)/g, "%= -1");
        return rewritten;
    });
}

export function createGm1021Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const callMatch = /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/u.exec(sourceText);
                    if (!callMatch) {
                        return;
                    }
                    context.report({
                        loc: resolveLocFromIndex(context, sourceText, callMatch.index),
                        messageId: "missingProjectContext"
                    });
                }
            });
        }
    });
}

export function createGm1026Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1029Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/"(-?\d+(?:\.\d+)?)"/g, (_fullMatch, numeric: string) => numeric)
    );
}

export function createGm1030Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const declarationPattern = /\bvar\s+sprite_index\b/;
        if (!declarationPattern.test(sourceText)) {
            return sourceText;
        }

        return sourceText.replaceAll(/\bsprite_index\b/g, "__featherFix_sprite_index");
    });
}

export function createGm1033Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, normalizeRedundantSemicolonRuns);
}

export function createGm1038Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1041Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /\b(instance_create_(?:depth|layer)\([^,]+,[^,]+,[^,]+,\s*)"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g,
            (_fullMatch, prefix: string, objectName: string) => `${prefix}${objectName})`
        )
    );
}

export function createGm1051Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let isInsideContinuedMacro = false;

        return sourceText.replaceAll(/^[^\r\n]*$/gmu, (line) => {
            const startsMacroDefinition = /^\s*#macro\b/u.test(line);
            const shouldFixMacroLine = startsMacroDefinition || isInsideContinuedMacro;
            if (!shouldFixMacroLine) {
                return line;
            }

            const fixedLine = removeTrailingMacroSemicolonIfSafe(line);

            // GameMaker multiline macros continue across physical lines via a trailing
            // backslash. GM1051 must inspect those continuation lines too, because GML
            // does not treat a standalone `;\` as meaningful macro content.
            isInsideContinuedMacro = splitMacroLineSegments(fixedLine).hasContinuation;

            return fixedLine;
        });
    });
}

export function createGm1052Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1054Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const declaredFunctions = new Set(
                        [...sourceText.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)].map((match) => match[1])
                    );
                    for (const match of sourceText.matchAll(
                        /\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
                    )) {
                        const parentFunctionName = match[1];
                        if (declaredFunctions.has(parentFunctionName)) {
                            continue;
                        }

                        const start = (match.index ?? 0) + match[0].lastIndexOf(parentFunctionName);
                        context.report({
                            loc: resolveLocFromIndex(context, sourceText, start),
                            messageId: "diagnostic"
                        });
                    }
                }
            });
        }
    });
}

export function createGm1055Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*\{([\s\S]*?)\n\}/g,
            (_fullMatch, functionName: string, parameterName: string, body: string) => {
                const rewrittenBody = body.replaceAll(/\bargument(?:0|\[\s*0\s*\])/gu, parameterName);
                return `function ${functionName}(${parameterName}) {${rewrittenBody}\n}`;
            }
        )
    );
}

export function createGm1058Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1063Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\(\s*texture_defined\s*\)\s*\?\s*([^:;]+):\s*-1\s*;/g,
            (_fullMatch, identifier: string, truthyExpr: string) =>
                `${identifier} = texture_defined ? ${truthyExpr.trim()} : pointer_null;`
        )
    );
}

export function createGm1064Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return Object.freeze({
        meta: createFeatherRuleMeta(entry),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const functionMatch = /\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/u.exec(sourceText);
                    if (!functionMatch) {
                        return;
                    }
                    context.report({
                        loc: resolveLocFromIndex(context, sourceText, functionMatch.index),
                        messageId: "missingProjectContext"
                    });
                }
            });
        }
    });
}

export function createGm1100Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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
