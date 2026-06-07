/**
 * Semicolon emission rules for the printer layer.
 *
 * Printer-internal helpers stay defined directly in this file. The shared
 * layout helpers (`countTrailingBlankLines`, `getNextNonWhitespaceCharacter`)
 * live in `../shared/layout-helpers.js` and are imported directly by callers.
 */

import { Core } from "@gmloop/core";
import type { AstPath } from "prettier";

const { isObjectLike } = Core;

// ---------------------------------------------------------------------------
// Semicolon emission rules
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const UNICODE_WHITESPACE_REGEX = /\s/;

function isWhitespaceCharacterCode(charCode: number): boolean {
    if (charCode < 0x80) {
        return charCode === 0x20 || (charCode >= 0x09 && charCode <= 0x0d);
    }

    return UNICODE_WHITESPACE_REGEX.test(String.fromCharCode(charCode));
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
