import path from "node:path";

import { Semantic } from "@gmloop/semantic";

type WorkerOverlayDocument = Readonly<{
    filePath: string;
    sourceText: string;
    version: number;
}>;

type WorkerOverlayBoundaryEntry = Readonly<{
    contentHash: string;
    version: number;
}>;

/**
 * Captures every open-buffer version and content hash used as worker input.
 *
 * Keys are `path.resolve`'d absolute file paths so the map is robust to
 * callers passing relative paths. The stored `version` is the LSP document
 * version at snapshot time; the `contentHash` mirrors the semantic content
 * hash the worker compares against, so any source-text drift is detected
 * even when a client forgets to bump the version number.
 *
 * @param documents Open buffers to snapshot. Order is irrelevant; the
 *   resulting map is keyed by absolute path.
 * @returns Read-only map from absolute path to `{ version, contentHash }`.
 */
export function createWorkerOverlayBoundary(
    documents: ReadonlyArray<WorkerOverlayDocument>
): ReadonlyMap<string, WorkerOverlayBoundaryEntry> {
    return new Map(
        documents.map((document) => [
            path.resolve(document.filePath),
            {
                contentHash: Semantic.createSemanticContentHash(document.sourceText),
                version: document.version
            }
        ])
    );
}

/**
 * Returns whether the complete open-buffer set still matches a worker boundary.
 *
 * The check is strict: both the document count AND every path's version and
 * content hash must agree with `boundary`. Adding, removing, editing, or
 * even merely renaming a buffer invalidates the snapshot, so callers should
 * treat a `false` result as "rebuild the worker overlay from scratch".
 *
 * @param boundary Snapshot previously produced by `createWorkerOverlayBoundary`.
 * @param documents Current open buffers to compare against the snapshot.
 * @returns `true` only when every entry matches by path, version, and content hash.
 */
export function isWorkerOverlayBoundaryCurrent(
    boundary: ReadonlyMap<string, WorkerOverlayBoundaryEntry>,
    documents: ReadonlyArray<WorkerOverlayDocument>
): boolean {
    if (documents.length !== boundary.size) {
        return false;
    }
    return documents.every((document) => {
        const entry = boundary.get(path.resolve(document.filePath));
        // Guard explicitly instead of relying on `&&` short-circuiting through
        // `entry?.version === document.version`. That comparison is only a
        // safe stand-in for "entry exists" when `document.version` can never
        // itself be `undefined`, but this module runs with `strict: false`
        // (see tsconfig.base.json), so nothing at compile time guarantees a
        // caller-supplied document actually carries a numeric version. If a
        // document with an `undefined` version has no matching boundary
        // entry, `entry?.version === document.version` evaluates to
        // `undefined === undefined` → `true`, and the unguarded
        // `entry.contentHash` read below would throw
        // `TypeError: Cannot read properties of undefined (reading 'contentHash')`.
        if (entry === undefined) {
            return false;
        }
        return (
            entry.version === document.version &&
            entry.contentHash === Semantic.createSemanticContentHash(document.sourceText)
        );
    });
}
