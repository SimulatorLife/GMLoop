/**
 * Minimal codec interface for reading and writing GameMaker project metadata
 * documents (.yy/.yyp). The refactor workspace defines this interface rather
 * than importing @gmloop/semantic directly, enabling callers to inject a
 * production implementation while tests can rely on a lightweight JSON fallback
 * (target-state.md: refactor defines its own abstraction interfaces and accepts
 * implementations via dependency injection).
 */
export interface ProjectMetadataAdapter {
    /**
     * Parse a raw .yy/.yyp document string into a mutable plain object.
     * @param rawContent - Raw file content.
     * @param sourcePath - Absolute path, used for schema resolution.
     */
    parseDocument(rawContent: string, sourcePath: string): Record<string, unknown>;

    /**
     * Serialize a document object back to the canonical .yy/.yyp string format.
     * @param document - The document object to serialize.
     * @param sourcePath - Absolute path, used for schema-aware serialization.
     */
    stringifyDocument(document: Record<string, unknown>, sourcePath: string): string;
}

/**
 * Lightweight JSON fallback used when no production adapter is injected.
 * Suitable for tests that operate on simple JSON fixtures; production callers
 * (e.g. the CLI) should supply a Semantic-backed adapter via the request's
 * `metadataAdapter` field so that schema validation and Yy serialization are
 * applied correctly.
 */
export const defaultProjectMetadataAdapter: ProjectMetadataAdapter = Object.freeze({
    parseDocument(rawContent: string): Record<string, unknown> {
        return JSON.parse(rawContent) as Record<string, unknown>;
    },
    stringifyDocument(document: Record<string, unknown>): string {
        return `${JSON.stringify(document, null, 4)}\n`;
    }
});
