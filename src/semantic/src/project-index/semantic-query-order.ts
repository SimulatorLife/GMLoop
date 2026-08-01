/** Compare persisted semantic text using SQLite's UTF-8 binary ordering. */
export function compareSemanticQueryText(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** Normalize case-insensitive semantic search input before indexing or querying. */
export function normalizeSemanticSearchText(value: string): string {
    return value.normalize("NFC").toLowerCase();
}

/** Create the unique one-, two-, and three-code-point tokens used by substring search. */
export function createSemanticSearchNgrams(value: string): ReadonlyArray<string> {
    const codePoints = [...normalizeSemanticSearchText(value)];
    const ngrams = new Set<string>();
    for (let index = 0; index < codePoints.length; index += 1) {
        for (let length = 1; length <= 3 && index + length <= codePoints.length; length += 1) {
            ngrams.add(codePoints.slice(index, index + length).join(""));
        }
    }
    return Object.freeze([...ngrams].toSorted(compareSemanticQueryText));
}

/** Select the indexed token that produces candidates for a normalized substring query. */
export function readSemanticSearchNgram(normalizedQuery: string): string {
    return [...normalizedQuery].slice(0, 3).join("");
}
