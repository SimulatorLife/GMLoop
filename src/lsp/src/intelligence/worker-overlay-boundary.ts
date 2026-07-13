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

/** Captures every open-buffer version and hash used as worker input. */
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

/** Returns whether the complete open-buffer set still matches a worker boundary. */
export function isWorkerOverlayBoundaryCurrent(
    boundary: ReadonlyMap<string, WorkerOverlayBoundaryEntry>,
    documents: ReadonlyArray<WorkerOverlayDocument>
): boolean {
    if (documents.length !== boundary.size) {
        return false;
    }
    return documents.every((document) => {
        const entry = boundary.get(path.resolve(document.filePath));
        return (
            entry?.version === document.version &&
            entry.contentHash === Semantic.createSemanticContentHash(document.sourceText)
        );
    });
}
