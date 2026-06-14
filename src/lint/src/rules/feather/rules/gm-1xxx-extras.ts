import type { Rule } from "eslint";

import { gmlRuleBaseHelpersServices, gmlRuleDocCommentServices } from "../../gml/gml-rule-services.js";
import {
    createFullTextRewriteRule,
    extractFunctionParameterNames,
    normalizeFeatherDocTypeText
} from "../feather-rule-helpers.js";
import { BRACKETED_INDEX_LIST_PATTERN } from "../feather-rule-patterns.js";
import type { FeatherManifestEntry } from "../manifest.js";

// Consume the doc-comment service contract so this file does not reach into
// the doc-comment layer directly; the abstraction is the only surface that
// rule implementations are allowed to depend on.
const { normalizeDocParamName } = gmlRuleDocCommentServices;

// Consume the base-helper service contract so this feather rule does not
// reach two directory levels into the gml/ rules folder for
// `findMatchingBraceEndIndex`. The facade keeps the gml/ layout encapsulated.
const { findMatchingBraceEndIndex } = gmlRuleBaseHelpersServices;

/**
 * Houses the GM1xxx rule factories that were added in a later pass on top of
 * the original `create-feather-rule.ts` catalogue. They are larger and more
 * multi-step than the 1xxx rules in {@link gm-1xxx-rules}, so they live in
 * their own file to keep both files under the readability budget.
 */
export function createGm1013Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1032Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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
                    index: Number.parseInt(match[2], 10)
                }));
                const argumentIndexes = [...body.matchAll(/\bargument(\d+)\b/g)].map((match) =>
                    Number.parseInt(match[1], 10)
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
                    Number.parseInt(match[1], 10)
                );
                const maxArgumentIndex = argumentIndexes.length === 0 ? -1 : Math.max(...argumentIndexes);

                const aliasNamesByIndex = new Map<number, string>();
                for (const match of functionBody.matchAll(
                    /^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*argument(\d+)\s*;\s*$/gm
                )) {
                    const aliasName = match[1];
                    const aliasIndex = Number.parseInt(match[2], 10);
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
                    (parameterName) => `${indentation}/// @param ${normalizeDocParamName(parameterName)}`
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

export function createGm1034Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1036Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1056Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1059Rule(entry: FeatherManifestEntry): Rule.RuleModule {
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

export function createGm1062Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/^\s*\/\/\/\s*@function\b[^\n]*\n?/gm, "");
        rewritten = rewritten.replaceAll(/^([ \t]*\/\/\/\s*)@desc\b/gm, "$1@description");
        rewritten = rewritten.replaceAll(
            /^([ \t]*\/\/\/\s*@param\s*)\{([^}]*)\}(\s+)([A-Za-z_][A-Za-z0-9_]*)(.*)$/gm,
            (_fullMatch, prefix: string, typeText: string, spacing: string, parameterName: string, suffix: string) => {
                const normalizedType = normalizeFeatherDocTypeText(typeText);
                const normalizedParameterName = normalizeDocParamName(parameterName);
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
