import { Core } from "@gmloop/core";

import { resolveProjectDisplayPath } from "./path-normalization.js";

/**
 * Normalize thrown values into an error-like object the formatter can mutate
 * safely. Preserves existing properties for structured error objects while
 * coercing primitive messages into the `{ message }` shape consumed by the
 * rest of the helpers.
 *
 * @param {unknown} error Thrown value originating from the parser.
 * @returns {Record<string, unknown> & { message?: string }} Error-like record
 *          that can be enriched with formatted context.
 */
function normalizeSyntaxErrorLike(error) {
    if (error !== null && (typeof error === "object" || typeof error === "function")) {
        return error;
    }

    const normalizedMessage = Core.getNonEmptyString(error);
    return { message: normalizedMessage ?? "" };
}

/**
 * Format a parser-originated syntax error into the structured message emitted
 * by the project-index reporting helpers. Enriches the original error with
 * location metadata, formatted excerpts, and a canonical `message` while
 * preserving the original text for downstream consumers.
 *
 * @param {unknown} error Value thrown by the parser.
 * @param {string | null | undefined} sourceText Source code that triggered the
 *        syntax error.
 * @param {{ filePath?: string | null, projectRoot?: string | null }} [context]
 *        Optional metadata describing where the source originated.
 * @returns {Record<string, unknown>} Normalized error decorated with display
 *          metadata and canonical messaging.
 */
export function formatProjectIndexSyntaxError(
    error,
    sourceText,
    context?: { filePath?: string | null; projectRoot?: string | null }
) {
    const normalizedError = normalizeSyntaxErrorLike(error);

    const { filePath, projectRoot } = context ?? {};
    const lineNumber = Core.toFiniteNumber(normalizedError.line);
    const columnNumber = Core.toFiniteNumber(normalizedError.column);
    const displayPath = resolveProjectDisplayPath(filePath, projectRoot);

    const baseDescription = extractBaseDescription(normalizedError.message);
    const locationSuffix = buildLocationSuffix(displayPath, lineNumber, columnNumber);
    const excerpt = formatSourceExcerpt(sourceText, lineNumber, columnNumber);

    const originalMessage = Core.getNonEmptyString(normalizedError.message) ?? "";
    const formattedMessage = `Syntax Error${locationSuffix}: ${baseDescription}${excerpt ? `\n\n${excerpt}` : ""}`;

    normalizedError.message = formattedMessage;
    normalizedError.originalMessage = originalMessage;

    if (displayPath) {
        normalizedError.filePath = displayPath;
    }

    if (excerpt) {
        normalizedError.sourceExcerpt = excerpt;
    }

    return normalizedError;
}

function extractBaseDescription(message) {
    const normalizedMessage = Core.getNonEmptyString(message);
    if (!normalizedMessage) {
        return "";
    }

    const match = normalizedMessage.match(/^Syntax Error[^:]*:(?<description>.*)$/s);
    if (match?.groups?.description) {
        return match.groups.description.trim();
    }

    return normalizedMessage.trim();
}

function buildLocationSuffix(displayPath, lineNumber, columnNumber) {
    const parts = [];

    if (displayPath) {
        parts.push(displayPath);
    }

    if (lineNumber !== undefined && lineNumber !== null) {
        const location =
            columnNumber === undefined ? `line ${lineNumber}` : `line ${lineNumber}, column ${columnNumber}`;

        parts.push(location);
    }

    if (parts.length === 0) {
        return "";
    }

    return ` (${parts.join(": ")})`;
}

function formatSourceExcerpt(sourceText, lineNumber, columnNumber) {
    if (lineNumber === undefined || lineNumber < 1 || typeof sourceText !== "string") {
        return "";
    }

    const lines = Core.splitLines(sourceText);
    const lineIndex = Math.min(lineNumber - 1, lines.length - 1);

    if (lineIndex < 0 || lineIndex >= lines.length) {
        return "";
    }

    const rawLineText = lines[lineIndex];
    const lineNumberWidth = String(lineNumber).length;
    const gutter = `${String(lineNumber).padStart(lineNumberWidth)} | `;
    const { lineText, pointerOffset } = expandTabsForDisplay(rawLineText, columnNumber);
    const contentLine = `${gutter}${lineText}`;

    if (columnNumber == null || columnNumber < 0) {
        return contentLine;
    }

    const indicatorSpacing = `${" ".repeat(lineNumberWidth)} | `;
    const pointerLine = `${indicatorSpacing}${" ".repeat(pointerOffset)}^`;

    return `${contentLine}\n${pointerLine}`;
}

function expandTabsForDisplay(lineText, columnNumber, tabSize = 4) {
    if (typeof lineText !== "string" || lineText.length === 0) {
        return { lineText: "", pointerOffset: 0 };
    }

    const clampedIndex = clampColumnIndex(lineText.length, columnNumber);

    if (!lineText.includes("\t")) {
        return { lineText, pointerOffset: clampedIndex };
    }

    let expanded = "";
    let pointerOffset = 0;

    for (const [index, char] of Array.from(lineText).entries()) {
        if (index === clampedIndex) {
            pointerOffset = expanded.length;
        }

        if (char === "\t") {
            const spacesToAdd = tabSize - (expanded.length % tabSize) || tabSize;
            expanded += " ".repeat(spacesToAdd);
        } else {
            expanded += char;
        }
    }

    if (clampedIndex >= lineText.length) {
        pointerOffset = expanded.length;
    }

    return { lineText: expanded, pointerOffset };
}

function clampColumnIndex(length, columnNumber) {
    const normalizedColumn = Core.toNormalizedInteger(columnNumber);
    if (normalizedColumn === null || normalizedColumn < 0) {
        return 0;
    }

    const normalizedLength = Core.toNormalizedInteger(length);
    if (normalizedLength === null || normalizedLength <= 0) {
        return 0;
    }

    return Core.clamp(normalizedColumn, 0, normalizedLength);
}
