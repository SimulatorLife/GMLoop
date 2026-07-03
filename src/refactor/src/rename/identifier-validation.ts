/**
 * Validation utilities for refactoring operations.
 * This module provides identifier validation and reserved keyword checking.
 */

import { Core } from "@gmloop/core";

/**
 * Validate and normalize an identifier name.
 * Throws TypeError or Error if the name is invalid.
 *
 * @param name - The identifier name to validate
 * @returns The validated name
 * @throws {TypeError} If name is not a string
 * @throws {Error} If name is empty, has whitespace, or contains invalid characters
 */
export function assertValidIdentifierName(name: unknown): string {
    const validated = Core.assertNonEmptyString(name, {
        name: "Identifier names",
        trim: false,
        errorMessage: "Identifier names must be strings and must not be empty or whitespace-only"
    });

    Core.assertNoLeadingOrTrailingWhitespace(validated, {
        name: "Identifier names",
        errorMessage: "Identifier names must not include leading or trailing whitespace"
    });

    if (!Core.GML_IDENTIFIER_NAME_PATTERN.test(validated)) {
        throw new Error(`Identifier '${validated}' is not a valid GML identifier (expected [A-Za-z_][A-Za-z0-9_]*)`);
    }

    return validated;
}

/**
 * Attempt to normalize and validate an identifier name.
 * Returns the validated name on success, or `null` if the name is syntactically
 * invalid. This is a safe, non-throwing counterpart to `assertValidIdentifierName`
 * for contexts where an invalid name should be silently skipped rather than
 * propagated as an exception.
 *
 * @param name - The identifier name to validate
 * @returns The validated name, or `null` if the name is invalid
 */
export function tryNormalizeIdentifierName(name: unknown): string | null {
    try {
        return assertValidIdentifierName(name);
    } catch {
        return null;
    }
}

/**
 * Assert that a rename request object has symbolId and newName properties.
 * Validates presence and that symbolId is a string.
 * Note: newName type validation is left to assertValidIdentifierName.
 *
 * @param request - The request object to validate
 * @param functionName - The function name for error messages
 * @throws {TypeError} If symbolId or newName are missing, or symbolId is not a string
 */
export function assertRenameRequest(
    request: unknown,
    functionName: string
): asserts request is { symbolId: string; newName: unknown } {
    if (!request || typeof request !== "object") {
        throw new TypeError(`${functionName} requires a request object`);
    }

    const req = request as Record<string, unknown>;

    if (!req.symbolId || !req.newName) {
        throw new TypeError(`${functionName} requires symbolId and newName`);
    }

    if (typeof req.symbolId !== "string") {
        throw new TypeError(`symbolId must be a string, got ${typeof req.symbolId}`);
    }
}

/**
 * Extract the symbol name from a fully-qualified symbol ID.
 * Symbol IDs follow the pattern `gml/{kind}/{name}`, e.g., "gml/script/scr_player".
 * This helper extracts the final segment (the symbol name) without requiring
 * repeated split/pop calls throughout the refactor codebase.
 *
 * @param symbolId - The fully-qualified symbol ID (e.g., "gml/script/scr_player")
 * @returns The symbol name (last path segment), or the original ID if splitting fails
 *
 * @example
 * extractSymbolName("gml/script/scr_player")  // "scr_player"
 * extractSymbolName("gml/var/hp")             // "hp"
 * extractSymbolName("invalid")                // "invalid"
 */
export function extractSymbolName(symbolId: string): string {
    const parsed = parseSymbolIdParts(symbolId);
    if (parsed) {
        return parsed.symbolName;
    }

    return symbolId.split("/").pop() ?? symbolId;
}

/**
 * Parse a symbol ID into its component parts.
 * Symbol IDs are expected to follow the pattern `gml/{kind}/{name}`.
 *
 * @param symbolId - The fully-qualified symbol ID (e.g., "gml/script/scr_player").
 * @returns Parsed symbol ID parts, or null if the ID is malformed.
 */
export function parseSymbolIdParts(
    symbolId: string
): { segments: Array<string>; symbolKind: string; symbolName: string } | null {
    const segments = symbolId.split("/");
    if (segments.length < 3) {
        return null;
    }

    const symbolKind = segments[1];
    const symbolName = segments.at(-1);

    if (!symbolKind || symbolName === undefined) {
        return null;
    }

    return { segments, symbolKind, symbolName };
}
