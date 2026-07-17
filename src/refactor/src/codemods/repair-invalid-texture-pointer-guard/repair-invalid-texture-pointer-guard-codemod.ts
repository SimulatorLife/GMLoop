import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type { RepairInvalidTexturePointerGuardResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

type AstRecord = Record<string, unknown>;

function isAstRecord(value: unknown): value is AstRecord {
    return Core.isObjectLike(value);
}

function isFunctionNode(node: AstRecord): boolean {
    return (
        node.type === "FunctionDeclaration" ||
        node.type === "ConstructorDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
    );
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
        object.name.toLowerCase() === functionName.toLowerCase()
    );
}

function unwrapParenthesizedExpression(node: unknown): AstRecord | null {
    let current = isAstRecord(node) ? node : null;
    while (current?.type === "ParenthesizedExpression") {
        current = isAstRecord(current.expression) ? current.expression : null;
    }
    return current;
}

function getNodeSource(sourceText: string, node: AstRecord): string | null {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    return typeof start === "number" && typeof end === "number" ? sourceText.slice(start, end).trim() : null;
}

function getSingleInvalidTextureThrow(node: unknown, sourceText: string): AstRecord | null {
    const consequent = isAstRecord(node) ? node : null;
    if (consequent === null) {
        return null;
    }

    let candidate: AstRecord | null = null;
    if (consequent.type === "BlockStatement") {
        const body = consequent.body;
        if (Array.isArray(body) && body.length === 1 && isAstRecord(body[0])) {
            candidate = body[0];
        }
    } else {
        candidate = consequent;
    }

    if (candidate?.type !== "ThrowStatement") {
        return null;
    }

    const message = getNodeSource(sourceText, candidate.argument as AstRecord);
    return message !== null && /Invalid or null texture pointer found/u.test(message) ? candidate : null;
}

function getTextureGuardThrow(node: AstRecord, sourceText: string): AstRecord | null {
    if (node.type !== "IfStatement") {
        return null;
    }

    const condition = unwrapParenthesizedExpression(node.test);
    if (condition?.type !== "UnaryExpression" || condition.operator !== "!") {
        return null;
    }

    const textureValidityCall = unwrapParenthesizedExpression(condition.argument);
    if (!isNamedCall(textureValidityCall, "scr_texture_is_valid")) {
        return null;
    }

    return getSingleInvalidTextureThrow(node.consequent, sourceText);
}

function hasTextureProperty(structNode: AstRecord): boolean {
    const properties = structNode.properties;
    if (!Array.isArray(properties)) {
        return false;
    }

    return properties.some((property) => {
        if (!isAstRecord(property)) {
            return false;
        }
        if (typeof property.name === "string") {
            return property.name.toLowerCase() === "texture";
        }
        return Core.getIdentifierName(property.key)?.toLowerCase() === "texture";
    });
}

function getFallbackIdentifier(functionNode: AstRecord, guardStart: number): string | null {
    const candidates: Array<Readonly<{ name: string; start: number }>> = [];

    const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
            for (const child of node) {
                visit(child);
            }
            return;
        }
        if (!isAstRecord(node) || node === functionNode) {
            return;
        }
        if (isFunctionNode(node)) {
            return;
        }

        if (node.type === "VariableDeclarator") {
            const identifierName = Core.getIdentifierName(node.id);
            const initializer = isAstRecord(node.init) ? node.init : null;
            const declarationStart = Core.getNodeStartIndex(node);
            if (
                identifierName !== null &&
                initializer !== null &&
                (initializer.type === "StructExpression" || initializer.type === "ObjectExpression") &&
                hasTextureProperty(initializer) &&
                typeof declarationStart === "number" &&
                declarationStart < guardStart
            ) {
                candidates.push(Object.freeze({ name: identifierName, start: declarationStart }));
            }
        }

        for (const [key, child] of Object.entries(node)) {
            if (key !== "parent") {
                visit(child);
            }
        }
    };

    const functionBody = isAstRecord(functionNode.body) ? functionNode.body : null;
    visit(functionBody);

    candidates.sort((first, second) => first.start - second.start);
    return candidates.at(-1)?.name ?? null;
}

function collectGuardRepairEdits(
    sourceText: string,
    programNode: unknown
): ReadonlyArray<Readonly<{ start: number; end: number; text: string }>> {
    const edits: Array<Readonly<{ start: number; end: number; text: string }>> = [];

    const visit = (node: unknown, enclosingFunction: AstRecord | null): void => {
        if (Array.isArray(node)) {
            for (const child of node) {
                visit(child, enclosingFunction);
            }
            return;
        }
        if (!isAstRecord(node)) {
            return;
        }

        const currentFunction = isFunctionNode(node) ? node : enclosingFunction;
        const throwStatement = getTextureGuardThrow(node, sourceText);
        if (throwStatement !== null && currentFunction !== null) {
            const guardStart = Core.getNodeStartIndex(node);
            const throwStart = Core.getNodeStartIndex(throwStatement);
            const throwEnd = Core.getNodeEndIndex(throwStatement);
            const fallbackIdentifier =
                typeof guardStart === "number" ? getFallbackIdentifier(currentFunction, guardStart) : null;
            if (fallbackIdentifier !== null && typeof throwStart === "number" && typeof throwEnd === "number") {
                edits.push(Object.freeze({ start: throwStart, end: throwEnd, text: `return ${fallbackIdentifier}` }));
            }
        }

        for (const [key, child] of Object.entries(node)) {
            if (key !== "parent") {
                visit(child, currentFunction);
            }
        }
    };

    visit(programNode, null);
    return edits;
}

/**
 * Replace a startup-time invalid texture throw with the function's declared
 * texture-info fallback object.
 *
 * The codemod only changes a guard that checks `scr_texture_is_valid(...)`,
 * throws the project's explicit invalid-texture message, and is enclosed by a
 * function that declares a struct containing a `texture` property before the
 * guard. This keeps unrelated error handling and functions without a safe
 * fallback unchanged.
 *
 * @param sourceText - GML source text to transform.
 * @returns The transformed source and applied source edits.
 */
export function applyRepairInvalidTexturePointerGuardCodemod(
    sourceText: string
): RepairInvalidTexturePointerGuardResult {
    if (!sourceText.includes("scr_texture_is_valid") || !sourceText.includes("Invalid or null texture pointer found")) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    let programNode: unknown;
    try {
        programNode = Parser.GMLParser.parse(sourceText);
    } catch {
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
