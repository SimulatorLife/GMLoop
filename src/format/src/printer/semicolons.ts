/**
 * Semicolon emission rules for the printer layer.
 *
 * The core whitespace/blank-line helpers (`countTrailingBlankLines`,
 * `getNextNonWhitespaceCharacter`) live in the shared layout layer so both
 * printer and comment subsystems can use them without introducing a cross-domain
 * import dependency. This module re-exports them so existing call sites inside
 * the printer package do not need to change.
 */

import { Core } from "@gmloop/core";
import type { AstPath } from "prettier";

// Re-export shared helpers so printer module call sites remain unchanged.
// Any printer-internal helper that is only used within the printer subsystem
// stays defined directly in this file.
export { countTrailingBlankLines, getNextNonWhitespaceCharacter } from "../shared/index.js";

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
