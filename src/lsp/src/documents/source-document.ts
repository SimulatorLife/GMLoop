import { fileURLToPath, pathToFileURL } from "node:url";

import type { Position, Range, TextDocumentContentChangeEvent } from "vscode-languageserver/node.js";

/**
 * Open GML text document tracked by the LSP session.
 */
export type GmlTextDocument = Readonly<{
    filePath: string;
    languageId: string;
    lineStarts: ReadonlyArray<number>;
    sourceText: string;
    uri: string;
    version: number;
}>;

/**
 * Store for open GML documents keyed by document URI.
 */
export type GmlDocumentStore = Readonly<{
    close(uri: string): void;
    get(uri: string): GmlTextDocument | null;
    list(): ReadonlyArray<GmlTextDocument>;
    open(document: { uri: string; languageId: string; version: number; text: string }): GmlTextDocument;
    update(
        uri: string,
        version: number,
        changes: ReadonlyArray<TextDocumentContentChangeEvent>
    ): GmlTextDocument | null;
}>;

/**
 * Convert an LSP document URI to a local filesystem path.
 */
export function uriToFilePath(uri: string): string {
    return fileURLToPath(uri);
}

/**
 * Convert a local filesystem path to an LSP document URI.
 */
export function filePathToUri(filePath: string): string {
    return pathToFileURL(filePath).href;
}

/**
 * Return true when a path or URI targets a GameMaker Language source file.
 */
export function isGmlDocumentPath(pathOrUri: string): boolean {
    return pathOrUri.toLowerCase().endsWith(".gml");
}

/**
 * Create a line-start offset table for UTF-16 source text.
 */
export function createLineStarts(sourceText: string): ReadonlyArray<number> {
    const lineStarts = [0];

    for (let index = 0; index < sourceText.length; index += 1) {
        const code = sourceText.charCodeAt(index);

        if (code === 0x0d) {
            if (index + 1 < sourceText.length && sourceText.charCodeAt(index + 1) === 0x0a) {
                index += 1;
            }
            lineStarts.push(index + 1);
            continue;
        }

        if (code === 0x0a || code === 0x20_28 || code === 0x20_29 || code === 0x00_85) {
            lineStarts.push(index + 1);
        }
    }

    return Object.freeze(lineStarts);
}

function clampLine(lineStarts: ReadonlyArray<number>, line: number): number {
    if (lineStarts.length === 0 || !Number.isFinite(line)) {
        return 0;
    }

    return Math.max(0, Math.min(Math.trunc(line), lineStarts.length - 1));
}

/**
 * Convert an LSP position to a UTF-16 source offset.
 */
export function positionToOffset(
    document: Pick<GmlTextDocument, "lineStarts" | "sourceText">,
    position: Position
): number {
    const line = clampLine(document.lineStarts, position.line);
    const lineStart = document.lineStarts[line] ?? 0;
    const nextLineStart = document.lineStarts[line + 1] ?? document.sourceText.length;
    const lineEnd = Math.max(lineStart, nextLineStart);
    return Math.max(lineStart, Math.min(lineStart + Math.max(0, position.character), lineEnd));
}

/**
 * Convert a UTF-16 source offset to an LSP position.
 */
export function offsetToPosition(
    document: Pick<GmlTextDocument, "lineStarts" | "sourceText">,
    offset: number
): Position {
    const normalizedOffset = Math.max(0, Math.min(Math.trunc(offset), document.sourceText.length));
    let low = 0;
    let high = document.lineStarts.length - 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const lineStart = document.lineStarts[middle] ?? 0;
        const nextLineStart = document.lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;

        if (normalizedOffset < lineStart) {
            high = middle - 1;
            continue;
        }

        if (normalizedOffset >= nextLineStart) {
            low = middle + 1;
            continue;
        }

        return { line: middle, character: normalizedOffset - lineStart };
    }

    const fallbackLine = clampLine(document.lineStarts, high);
    return {
        line: fallbackLine,
        character: normalizedOffset - (document.lineStarts[fallbackLine] ?? 0)
    };
}

/**
 * Convert an LSP range to UTF-16 source offsets.
 */
export function rangeToOffsets(document: GmlTextDocument, range: Range): { end: number; start: number } {
    return {
        start: positionToOffset(document, range.start),
        end: positionToOffset(document, range.end)
    };
}

/**
 * Convert UTF-16 source offsets to an LSP range.
 */
export function offsetsToRange(document: GmlTextDocument, start: number, end: number): Range {
    return {
        start: offsetToPosition(document, start),
        end: offsetToPosition(document, end)
    };
}

/**
 * Create a tracked GML text document from raw text.
 */
export function createGmlTextDocument(
    uri: string,
    languageId: string,
    version: number,
    sourceText: string
): GmlTextDocument {
    return Object.freeze({
        uri,
        filePath: uriToFilePath(uri),
        languageId,
        version,
        sourceText,
        lineStarts: createLineStarts(sourceText)
    });
}

function applyDocumentChange(
    document: GmlTextDocument,
    version: number,
    change: TextDocumentContentChangeEvent
): string {
    if (!("range" in change) || change.range === undefined) {
        return change.text;
    }

    const { start, end } = rangeToOffsets(document, change.range);
    return `${document.sourceText.slice(0, start)}${change.text}${document.sourceText.slice(end)}`;
}

/**
 * Create an in-memory document store for LSP text synchronization.
 */
export function createGmlDocumentStore(): GmlDocumentStore {
    const documents = new Map<string, GmlTextDocument>();

    return {
        open(document) {
            const tracked = createGmlTextDocument(document.uri, document.languageId, document.version, document.text);
            documents.set(document.uri, tracked);
            return tracked;
        },
        update(uri, version, changes) {
            const current = documents.get(uri);
            if (!current) {
                return null;
            }

            const updatedText = changes.reduce((sourceText, change) => {
                const transientDocument = createGmlTextDocument(uri, current.languageId, version, sourceText);
                return applyDocumentChange(transientDocument, version, change);
            }, current.sourceText);
            const updated = createGmlTextDocument(uri, current.languageId, version, updatedText);
            documents.set(uri, updated);
            return updated;
        },
        close(uri) {
            documents.delete(uri);
        },
        get(uri) {
            return documents.get(uri) ?? null;
        },
        list() {
            return [...documents.values()];
        }
    };
}
