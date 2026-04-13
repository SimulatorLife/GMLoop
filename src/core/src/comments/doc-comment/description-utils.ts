import type { MutableDocCommentLines } from "../comment-utils.js";

const STRING_TYPE = "string";

/**
 * Outcome of evaluating a potential `@description` continuation line.
 */
export type DescriptionContinuationLineClassification =
    | {
          kind: "stop";
      }
    | {
          kind: "empty";
          trimmedLine: string;
      }
    | {
          kind: "text";
          originalLine: string;
          trimmedLine: string;
          suffix: string;
      };

/**
 * Classify a doc-comment line following `@description` to determine whether it
 * continues the description text, should be skipped, or signals a stop.
 */
export function classifyDescriptionContinuationLine(line: unknown): DescriptionContinuationLineClassification {
    if (typeof line !== "string") {
        return { kind: "stop" };
    }

    const trimmedLine = line.trim();
    const match = trimmedLine.match(/^(\/+(?:\/|(?=\s*@)))(.*)$/);
    if (!match || match[1].length < 3) {
        return { kind: "stop" };
    }

    const _prefix = match[1];
    const rest = match[2];

    if (rest.trim().startsWith("@")) {
        return { kind: "stop" };
    }

    const suffix = rest.trim();

    if (suffix.length === 0) {
        return { kind: "empty", trimmedLine };
    }

    return {
        kind: "text",
        originalLine: line,
        trimmedLine,
        suffix
    };
}
export const DESCRIPTION_TAG_PATTERN = /^\/\/\/\s*@description\b/i;

export function resolveDescriptionIndentation(line: string) {
    const trimmedStart = line.trimStart();
    const indent = line.slice(0, line.length - trimmedStart.length);
    const prefixMatch = trimmedStart.match(/^(\/\/\/\s*@description\s+)/i);
    const prefix = prefixMatch ? prefixMatch[1] : "/// @description ";
    return { indent, prefix };
}

function getDocCommentIndentSpaces(line: string): number {
    const match = line.match(/^\s*\/\/\/([ \t]*)/);
    if (!match) {
        return 0;
    }

    return match[1].replaceAll("\t", "    ").length;
}

function formatDescriptionContinuationLine(line: string, continuationPrefix: string): string | null {
    if (typeof line !== STRING_TYPE) {
        return null;
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith("///")) {
        return null;
    }

    if (/^\/\/\/\s*@/.test(trimmed)) {
        return null;
    }

    const docLikeMatch = trimmed.match(/^\/\/\/\s*\/\s*(.*)$/);
    const suffix = docLikeMatch ? (docLikeMatch[1] ?? "").trim() : trimmed.slice(3).replace(/^\s+/, "");
    if (suffix.length === 0) {
        return null;
    }

    const normalizedPrefix = continuationPrefix.trimStart();
    if (trimmed.startsWith(normalizedPrefix)) {
        return line;
    }

    return `${continuationPrefix}${suffix}`;
}

function findDescriptionLineIndex(docCommentDocs: MutableDocCommentLines | readonly unknown[]): number {
    if (!Array.isArray(docCommentDocs)) {
        return -1;
    }

    return docCommentDocs.findIndex((line) => typeof line === STRING_TYPE && DESCRIPTION_TAG_PATTERN.test(line.trim()));
}

export function collectDescriptionContinuations(docCommentDocs: MutableDocCommentLines | readonly unknown[]): string[] {
    const descriptionIndex = findDescriptionLineIndex(docCommentDocs);
    if (descriptionIndex === -1) {
        return [];
    }

    const continuations: string[] = [];

    for (let index = descriptionIndex + 1; index < docCommentDocs.length; index += 1) {
        const line = docCommentDocs[index];
        const classification = classifyDescriptionContinuationLine(line);

        if (classification.kind === "stop") {
            break;
        }

        if (classification.kind === "empty") {
            continue;
        }

        continuations.push(classification.originalLine);
    }

    return continuations;
}

/**
 * Collect normalized continuation payloads that immediately follow a specific
 * `@description` line, while preserving indentation contributed by deeper
 * comment-prefix indentation on subsequent lines.
 */
export function collectDescriptionContinuationText(
    docCommentDocs: MutableDocCommentLines | readonly unknown[],
    startIndex: number,
    baseIndentSpaces: number
): { continuations: string[]; linesConsumed: number } {
    if (!Array.isArray(docCommentDocs) || startIndex < 0 || startIndex >= docCommentDocs.length) {
        return { continuations: [], linesConsumed: 0 };
    }

    const continuations: string[] = [];
    let lookahead = startIndex + 1;

    while (lookahead < docCommentDocs.length) {
        const candidate = docCommentDocs[lookahead];
        const classification = classifyDescriptionContinuationLine(candidate);
        if (classification.kind === "stop") {
            break;
        }

        if (classification.kind === "empty") {
            continuations.push("");
            lookahead += 1;
            continue;
        }

        if (typeof candidate === "string") {
            const indentSpaces = getDocCommentIndentSpaces(candidate);
            const extraIndent = Math.max(0, indentSpaces - baseIndentSpaces);
            continuations.push(`${" ".repeat(extraIndent)}${classification.suffix}`);
        } else {
            continuations.push(classification.suffix);
        }
        lookahead += 1;
    }

    return { continuations, linesConsumed: lookahead - startIndex };
}

export function applyDescriptionContinuations(
    docCommentDocs: MutableDocCommentLines,
    continuations: string[]
): MutableDocCommentLines {
    if (!Array.isArray(docCommentDocs) || continuations.length === 0) {
        return docCommentDocs;
    }

    const descriptionIndex = findDescriptionLineIndex(docCommentDocs);
    if (descriptionIndex === -1) {
        return docCommentDocs;
    }

    const descriptionLine = docCommentDocs[descriptionIndex];
    if (typeof descriptionLine !== STRING_TYPE) {
        return docCommentDocs;
    }

    const continuationPrefix = "/// ";

    let insertIndex = descriptionIndex + 1;

    for (const original of continuations) {
        const formatted = formatDescriptionContinuationLine(original, continuationPrefix);

        if (!formatted) {
            continue;
        }

        const normalized = formatted.trim();
        const alreadyExists = docCommentDocs.some((line) => {
            if (typeof line !== STRING_TYPE) {
                return false;
            }

            const lineTrimmed = line.trim();
            const normalizedTrimmed = normalized.trim();

            if (lineTrimmed === normalizedTrimmed) {
                return true;
            }

            // Fallback for differing space counts after slashes
            const lineContent = lineTrimmed.replace(/^\/+\s*/, "");
            const normalizedContent = normalizedTrimmed.replace(/^\/+\s*/, "");

            return lineContent === normalizedContent;
        });

        if (alreadyExists) {
            continue;
        }

        docCommentDocs.splice(insertIndex, 0, formatted);
        insertIndex += 1;
    }

    if (continuations.length > 0) {
        docCommentDocs._preserveDescriptionBreaks = true;
    }

    return docCommentDocs;
}

export function ensureDescriptionContinuations(docCommentDocs: MutableDocCommentLines) {
    const descriptionIndex = findDescriptionLineIndex(docCommentDocs);
    if (descriptionIndex === -1) {
        return;
    }

    const descriptionLine = docCommentDocs[descriptionIndex];
    if (typeof descriptionLine !== STRING_TYPE) {
        return;
    }

    const continuationPrefix = "/// ";

    let foundContinuation = false;

    for (let index = descriptionIndex + 1; index < docCommentDocs.length; index += 1) {
        const line = docCommentDocs[index];

        const classification = classifyDescriptionContinuationLine(line);
        if (classification.kind === "stop") {
            break;
        }

        if (classification.kind === "empty") {
            continue;
        }

        const formatted = formatDescriptionContinuationLine(line, continuationPrefix);
        if (!formatted) {
            continue;
        }

        docCommentDocs[index] = formatted;
        foundContinuation = true;
    }

    if (foundContinuation) {
        docCommentDocs._preserveDescriptionBreaks = true;
    }
}
