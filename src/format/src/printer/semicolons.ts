import { Core } from "@gmloop/core";
import type { AstPath } from "prettier";

const { isObjectLike } = Core;

// Helpers focused solely on semicolon emission rules within the printer.

const STRING_TYPE = "string" as const;

// Regex fallback for Unicode whitespace characters outside the ASCII range.
// Only reached when charCode >= 128, which is uncommon in GML source text.
const UNICODE_WHITESPACE_REGEX = /\s/;

/**
 * Identify whitespace that the semicolon scanner can skip.
 *
 * Most GML source is ASCII, so the fast path uses direct character-code checks
 * and only falls back to `/\s/` for non-ASCII whitespace.
 */
function isWhitespaceCharacterCode(charCode: number): boolean {
    if (charCode < 0x80) {
        return charCode === 0x20 || (charCode >= 0x09 && charCode <= 0x0d);
    }

    return UNICODE_WHITESPACE_REGEX.test(String.fromCharCode(charCode));
}

/**
 * Centralize the node types that require semicolon output.
 */
function nodeTypeNeedsSemicolon(type?: string): boolean {
    if (!type) {
        return false;
    }

    switch (type) {
        case "CallExpression":
        case "AssignmentExpression":
        case "ExpressionStatement":
        case "GlobalVarStatement":
        case "ReturnStatement":
        case "BreakStatement":
        case "ContinueStatement":
        case "ExitStatement":
        case "ThrowStatement":
        case "IncDecStatement":
        case "VariableDeclaration":
        case "DeleteStatement": {
            return true;
        }
        default: {
            return false;
        }
    }
}

/**
 * Return a semicolon literal when the node type requires statement termination.
 */
export function optionalSemicolon(nodeType?: string): "" | ";" {
    return nodeTypeNeedsSemicolon(nodeType) ? ";" : "";
}

/**
 * Return the next non-whitespace character after the provided index.
 */
export function getNextNonWhitespaceCharacter(text: string | null | undefined, startIndex: number): string | null {
    if (typeof text !== STRING_TYPE) {
        return null;
    }

    const { length } = text;
    let index = startIndex;

    while (index < length) {
        if (!isWhitespaceCharacterCode(text.charCodeAt(index))) {
            return text[index] ?? null;
        }

        index += 1;
    }

    return null;
}

/**
 * Count blank lines after the provided index, ignoring semicolons and
 * whitespace between line breaks.
 */
export function countTrailingBlankLines(text: string | null | undefined, startIndex: number): number {
    if (typeof text !== STRING_TYPE) {
        return 0;
    }

    const { length } = text;
    let index = startIndex;
    let newlineCount = 0;

    while (index < length) {
        const characterCode = text.charCodeAt(index);

        if (characterCode === 59) {
            index += 1;
            continue;
        }

        if (characterCode === 10) {
            newlineCount += 1;
            index += 1;
            continue;
        }

        if (characterCode === 13) {
            newlineCount += 1;
            index += index + 1 < length && text.charCodeAt(index + 1) === 10 ? 2 : 1;
            continue;
        }

        if (isWhitespaceCharacterCode(characterCode)) {
            index += 1;
            continue;
        }

        break;
    }

    if (newlineCount === 0) {
        return 0;
    }

    return Math.max(0, newlineCount - 1);
}

/**
 * Determine whether the semicolon cleanup logic should skip the character.
 */
export function isSkippableSemicolonWhitespace(charCode: number): boolean {
    return isWhitespaceCharacterCode(charCode);
}

/**
 * Determine whether the current path points at the last statement in a body.
 */
export function isLastStatement(path: AstPath<unknown>): boolean {
    const body = getParentNodeListProperty(path);
    if (!body) {
        return true;
    }
    const node = path.getValue();

    const lastIndex = body.length - 1;
    return lastIndex >= 0 && body[lastIndex] === node;
}

function getParentNodeListProperty(path: AstPath<unknown>): unknown[] | null {
    const parent = path.getParentNode();
    if (!parent) {
        return null;
    }
    return getNodeListProperty(parent);
}

function getNodeListProperty(node: unknown): unknown[] | null {
    if (!isObjectLike(node)) {
        return null;
    }

    const maybeBody = (node as { body?: unknown }).body;
    return Array.isArray(maybeBody) ? maybeBody : null;
}
