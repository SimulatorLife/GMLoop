import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

type IdentifierOccurrenceRange = {
    end: number;
    start: number;
};

const EMPTY_IDENTIFIER_OCCURRENCES: ReadonlyArray<IdentifierOccurrenceRange> = Object.freeze([]);
const STRING_LITERAL_PATTERN = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu;
const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/gu;

function appendIdentifierOccurrence(
    occurrencesByName: Map<string, Array<IdentifierOccurrenceRange>>,
    name: string,
    start: number,
    end: number
): void {
    if (!Core.isNonEmptyString(name) || end <= start) {
        return;
    }

    const existingOccurrences = occurrencesByName.get(name);
    if (existingOccurrences) {
        existingOccurrences.push({ start, end });
        return;
    }

    occurrencesByName.set(name, [{ start, end }]);
}

function collectIdentifierOccurrencesFromAst(sourceText: string): Map<string, Array<IdentifierOccurrenceRange>> | null {
    try {
        const program = Parser.GMLParser.parse(sourceText, { getComments: false });
        const occurrencesByName = new Map<string, Array<IdentifierOccurrenceRange>>();

        const traverse = (node: unknown): void => {
            if (!Core.isObjectLike(node)) {
                return;
            }

            const candidate = node as Record<string, unknown>;
            if (candidate.type === "Identifier" && typeof candidate.name === "string") {
                const start = typeof candidate.start === "number" ? candidate.start : null;
                const endInclusive = typeof candidate.end === "number" ? candidate.end : null;
                const end = endInclusive === null ? null : endInclusive + 1;

                if (start !== null && end !== null && end >= start) {
                    const before = start > 0 ? sourceText[start - 1] : "";
                    const after = end < sourceText.length ? sourceText[end] : "";
                    if ((before !== '"' || after !== '"') && (before !== "'" || after !== "'")) {
                        appendIdentifierOccurrence(occurrencesByName, candidate.name, start, end);
                    }
                }
            }

            for (const [key, value] of Object.entries(candidate)) {
                if (key === "start" || key === "end" || key === "type" || key === "name") {
                    continue;
                }

                if (Array.isArray(value)) {
                    for (const child of value) {
                        traverse(child);
                    }
                    continue;
                }

                if (Core.isObjectLike(value)) {
                    traverse(value);
                }
            }
        };

        traverse(program);
        return occurrencesByName;
    } catch {
        return null;
    }
}

function collectStringLiteralRanges(sourceText: string): Array<IdentifierOccurrenceRange> {
    const ranges: Array<IdentifierOccurrenceRange> = [];

    for (const match of sourceText.matchAll(STRING_LITERAL_PATTERN)) {
        if (typeof match.index !== "number") {
            continue;
        }

        ranges.push({
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return ranges;
}

function isWithinStringLiteral(
    start: number,
    end: number,
    stringLiteralRanges: ReadonlyArray<IdentifierOccurrenceRange>
): boolean {
    return stringLiteralRanges.some((range) => start >= range.start && end <= range.end);
}

function isIdentifierBoundaryCharacter(character: string | undefined): boolean {
    return character === undefined || !/[A-Za-z0-9_]/u.test(character);
}

function collectIdentifierOccurrencesFromText(sourceText: string): Map<string, Array<IdentifierOccurrenceRange>> {
    const occurrencesByName = new Map<string, Array<IdentifierOccurrenceRange>>();
    const stringLiteralRanges = collectStringLiteralRanges(sourceText);

    for (const match of sourceText.matchAll(IDENTIFIER_PATTERN)) {
        if (typeof match.index !== "number") {
            continue;
        }

        const identifierName = match[0];
        const start = match.index;
        const end = start + identifierName.length;
        const before = start > 0 ? sourceText[start - 1] : undefined;
        const after = end < sourceText.length ? sourceText[end] : undefined;

        if (!isIdentifierBoundaryCharacter(before) || !isIdentifierBoundaryCharacter(after)) {
            continue;
        }

        if (isWithinStringLiteral(start, end, stringLiteralRanges)) {
            continue;
        }

        appendIdentifierOccurrence(occurrencesByName, identifierName, start, end);
    }

    return occurrencesByName;
}

function buildIdentifierOccurrenceIndex(sourceText: string): Map<string, Array<IdentifierOccurrenceRange>> {
    return collectIdentifierOccurrencesFromAst(sourceText) ?? collectIdentifierOccurrencesFromText(sourceText);
}

/**
 * Caches per-file identifier occurrences so disk-backed fallback lookups can
 * reuse one parse or scan per source file instead of rescanning the file for
 * every renamed symbol.
 */
export class GmlIdentifierOccurrenceIndex {
    private readonly occurrencesByName: ReadonlyMap<string, ReadonlyArray<IdentifierOccurrenceRange>>;

    private constructor(occurrencesByName: ReadonlyMap<string, ReadonlyArray<IdentifierOccurrenceRange>>) {
        this.occurrencesByName = occurrencesByName;
    }

    /**
     * Build an identifier-occurrence index for a single GML source file.
     */
    static fromSourceText(sourceText: string): GmlIdentifierOccurrenceIndex {
        return new GmlIdentifierOccurrenceIndex(buildIdentifierOccurrenceIndex(sourceText));
    }

    /**
     * Look up all identifier occurrences for a single name.
     */
    getOccurrences(identifierName: string): ReadonlyArray<IdentifierOccurrenceRange> {
        return this.occurrencesByName.get(identifierName) ?? EMPTY_IDENTIFIER_OCCURRENCES;
    }

    /**
     * Iterate all identifier occurrence groups keyed by identifier name.
     *
     * This keeps callers on one pass over the prebuilt file index rather than
     * performing one `getOccurrences()` lookup per candidate symbol.
     */
    forEachOccurrencesByIdentifierName(
        visit: (identifierName: string, occurrences: ReadonlyArray<IdentifierOccurrenceRange>) => void
    ): void {
        for (const [identifierName, occurrences] of this.occurrencesByName.entries()) {
            visit(identifierName, occurrences);
        }
    }
}
