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

/**
 * Extract indentation metadata from a line that contains a `@description` tag.
 *
 * @param line - A source line that may contain a `/// @description` tag.
 * @returns An object containing the base indentation string and the prefix
 *          used before the description text.
 */
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

/**
 * Shared iteration engine for walking the lines that immediately follow a
 * `@description` tag, applying `classifyDescriptionContinuationLine` and
 * yielding structured payloads for each non-stop, non-empty line.
 *
 * @param docCommentDocs - The doc comment lines to iterate.
 * @param descriptionIndex - The 0-based index of the `@description` line.
 * @param yieldOriginal - When true, yields `originalLine` (raw source text);
 *                        when false, yields `suffix` (content without comment prefix).
 * @param baseIndentSpaces - Used only when `yieldOriginal` is false to compute
 *                           relative indentation; pass `0` when not needed.
 * @param onEmpty - Optional callback invoked for each "empty" continuation line.
 * @param onText - Callback invoked for each "text" continuation line, receiving
 *                either the raw line or a suffix+extra-indent payload depending on
 *                `yieldOriginal`, along with the line's 0-based index within the
 *                doc comment array.
 * @param onStop - Callback invoked when a "stop" classification is reached.
 */
function iterateDescriptionContinuations(
    docCommentDocs: MutableDocCommentLines | readonly unknown[],
    descriptionIndex: number,
    {
        yieldOriginal,
        baseIndentSpaces = 0,
        onEmpty,
        onText,
        onStop
    }: {
        yieldOriginal: boolean;
        baseIndentSpaces?: number;
        onEmpty?: () => void;
        onText: (payload: string, index: number) => void;
        onStop?: () => void;
    }
): void {
    for (let index = descriptionIndex + 1; index < docCommentDocs.length; index += 1) {
        const line = docCommentDocs[index];
        const classification = classifyDescriptionContinuationLine(line);

        if (classification.kind === "stop") {
            onStop?.();
            break;
        }

        if (classification.kind === "empty") {
            onEmpty?.();
            continue;
        }

        if (yieldOriginal) {
            onText(classification.originalLine, index);
        } else if (typeof line === "string") {
            const indentSpaces = getDocCommentIndentSpaces(line);
            const extraIndent = Math.max(0, indentSpaces - baseIndentSpaces);
            onText(`${" ".repeat(extraIndent)}${classification.suffix}`, index);
        } else {
            onText(classification.suffix, index);
        }
    }
}

/**
 * Extract all raw continuation lines that immediately follow a `@description` tag.
 *
 * @param docCommentDocs - The lines of a doc comment, including the `@description` line.
 * @returns An array of the raw continuation lines following `@description`.
 */
export function collectDescriptionContinuations(docCommentDocs: MutableDocCommentLines | readonly unknown[]): string[] {
    const descriptionIndex = findDescriptionLineIndex(docCommentDocs);
    if (descriptionIndex === -1) {
        return [];
    }

    const continuations: string[] = [];
    iterateDescriptionContinuations(docCommentDocs, descriptionIndex, {
        yieldOriginal: true,
        onText: (originalLine) => continuations.push(originalLine)
    });
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

    let linesConsumed = 0;
    const continuations: string[] = [];
    iterateDescriptionContinuations(docCommentDocs, startIndex, {
        yieldOriginal: false,
        baseIndentSpaces,
        onEmpty: () => {
            continuations.push("");
            linesConsumed += 1;
        },
        onText: (payload) => {
            continuations.push(payload);
            linesConsumed += 1;
        }
    });
    return { continuations, linesConsumed };
}

/**
 * Apply normalized continuation lines to an existing doc comment after its
 * `@description` tag, replacing any previously existing continuations.
 *
 * @param docCommentDocs - The mutable doc comment lines to modify.
 * @param continuations - The normalized continuation lines to insert.
 * @returns The modified doc comment lines.
 */
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

/**
 * Ensure a doc comment has at least one continuation line after `@description`.
 *
 * If no continuation line exists, a single blank continuation line is appended.
 *
 * @param docCommentDocs - The mutable doc comment lines to modify in place.
 */
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
    iterateDescriptionContinuations(docCommentDocs, descriptionIndex, {
        yieldOriginal: true,
        onText: (_originalLine, index) => {
            const line = docCommentDocs[index];
            const formatted = formatDescriptionContinuationLine(line, continuationPrefix);
            if (!formatted) {
                return;
            }
            docCommentDocs[index] = formatted;
            foundContinuation = true;
        }
    });

    if (foundContinuation) {
        docCommentDocs._preserveDescriptionBreaks = true;
    }
}
