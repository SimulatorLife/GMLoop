import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type {
    RepairDependentVariableDeclarationsEdit,
    RepairDependentVariableDeclarationsResult
} from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

type AstRecord = Record<string, unknown>;

function isAstRecord(value: unknown): value is AstRecord {
    return Core.isObjectLike(value);
}

function getIdentifierName(node: unknown): string | null {
    const name = Core.getIdentifierName(node);
    return name === null ? null : name.toLowerCase();
}

function collectInitializerReferences(initializer: unknown): ReadonlySet<string> {
    const references = new Set<string>();
    Core.traverseAst(initializer, {
        enter(node) {
            if (node.type !== "Identifier") {
                return;
            }
            const name = getIdentifierName(node);
            if (name !== null) {
                references.add(name);
            }
        }
    });
    return references;
}

function hasEarlierDeclaratorDependency(declaration: AstRecord): boolean {
    if (!Array.isArray(declaration.declarations) || declaration.declarations.length < 2) {
        return false;
    }

    const earlierNames = new Set<string>();
    for (const declarator of declaration.declarations) {
        if (!isAstRecord(declarator)) {
            continue;
        }

        if (declarator.init !== null && declarator.init !== undefined) {
            for (const reference of collectInitializerReferences(declarator.init)) {
                if (earlierNames.has(reference)) {
                    return true;
                }
            }
        }

        const name = getIdentifierName(declarator.id);
        if (name !== null) {
            earlierNames.add(name);
        }
    }

    return false;
}

function getSourceRange(node: unknown): Readonly<{ start: number; end: number }> | null {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    return typeof start === "number" && typeof end === "number" ? { start, end } : null;
}

function getDeclarationKeyword(
    sourceText: string,
    declaration: AstRecord,
    firstDeclaratorStart: number
): string | null {
    const declarationPrefix = sourceText.slice(Core.getNodeStartIndex(declaration) ?? 0, firstDeclaratorStart);
    const keyword = /\b(var|static|let|const)\b/iu.exec(declarationPrefix)?.[0];
    return keyword ?? (typeof declaration.kind === "string" ? declaration.kind : null);
}

function buildSplitDeclarationText(sourceText: string, declaration: AstRecord): string | null {
    if (!Array.isArray(declaration.declarations) || declaration.declarations.length < 2) {
        return null;
    }

    const declarationRange = getSourceRange(declaration);
    const firstDeclarator = isAstRecord(declaration.declarations[0]) ? declaration.declarations[0] : null;
    const firstRange = getSourceRange(firstDeclarator);
    if (declarationRange === null || firstRange === null) {
        return null;
    }

    const keyword = getDeclarationKeyword(sourceText, declaration, firstRange.start);
    if (keyword === null) {
        return null;
    }

    let output = sourceText.slice(declarationRange.start, firstRange.end);
    let previousEnd = firstRange.end;

    for (const rawDeclarator of declaration.declarations.slice(1)) {
        if (!isAstRecord(rawDeclarator)) {
            return null;
        }

        const currentRange = getSourceRange(rawDeclarator);
        if (currentRange === null) {
            return null;
        }

        const separator = sourceText.slice(previousEnd, currentRange.start);
        const maskedSeparator = Core.maskCommentsAndStringsForRecovery(separator, { maskDirectiveLines: true });
        const commaIndex = maskedSeparator.indexOf(",");
        if (commaIndex === -1) {
            return null;
        }

        output += `${separator.slice(0, commaIndex)};${separator.slice(commaIndex + 1)}${keyword} `;
        output += sourceText.slice(currentRange.start, currentRange.end);
        previousEnd = currentRange.end;
    }

    return output;
}

function collectDependentDeclarationEdits(
    sourceText: string,
    programNode: unknown
): ReadonlyArray<RepairDependentVariableDeclarationsEdit> {
    const edits: Array<RepairDependentVariableDeclarationsEdit> = [];

    Core.traverseAst(programNode, {
        enter(node, context) {
            const declaration = isAstRecord(node) ? node : null;
            if (declaration === null || declaration.type !== "VariableDeclaration") {
                return;
            }
            if (!hasEarlierDeclaratorDependency(declaration)) {
                return;
            }

            // A declaration in a `for` initializer cannot be replaced with multiple
            // statements without changing the loop syntax. Leave that form for a
            // future control-flow-aware transform instead of producing invalid GML.
            if (context.parent?.type === "ForStatement" && context.key === "init") {
                return;
            }

            const range = getSourceRange(declaration);
            const replacement = buildSplitDeclarationText(sourceText, declaration);
            if (range === null || replacement === null || replacement === sourceText.slice(range.start, range.end)) {
                return;
            }

            edits.push(
                Object.freeze({
                    start: range.start,
                    end: range.end,
                    text: replacement
                })
            );
        }
    });

    return edits;
}

/**
 * Split comma-separated variable declarations whose initializers reference an
 * earlier declarator in the same statement.
 *
 * GameMaker's HTML5 compiler can reorder those initializers while lowering a
 * multi-declarator statement. Splitting only the dependent statements keeps
 * the source evaluation order explicit and avoids changing independent
 * declarations or `for`-initializer syntax.
 *
 * @param sourceText - GML source text to transform.
 * @returns The transformed source and applied source edits.
 */
export function applyRepairDependentVariableDeclarationsCodemod(
    sourceText: string
): RepairDependentVariableDeclarationsResult {
    if (!sourceText.includes(",")) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    let programNode: unknown;
    try {
        programNode = Parser.GMLParser.parse(sourceText);
    } catch {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    const appliedEdits = collectDependentDeclarationEdits(sourceText, programNode);
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
