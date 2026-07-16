import assert from "node:assert/strict";

import { Core } from "@gmloop/core";

import type { SemanticFileManifest } from "../src/project-index/semantic-manifest.js";
import { createSemanticSnapshotFromProjectIndex } from "../src/project-index/semantic-snapshot-codec.js";
import type { openSemanticIndexStore } from "../src/project-index/semantic-store.js";

export function publishSnapshot(
    store: ReturnType<typeof openSemanticIndexStore>,
    index: Record<string, unknown>,
    tier: "definitions" | "full",
    sourceRevision: string,
    affectedFiles: ReadonlyArray<string> | null = null
) {
    const files = Core.isObjectLike(index.files) ? index.files : {};
    const entries = new Map(
        Object.entries(files)
            .filter((entry): entry is [string, Record<string, unknown>] => Core.isObjectLike(entry[1]))
            .map(([relativePath, file]) => [
                relativePath,
                Object.freeze({
                    contentHash: typeof file.contentHash === "string" ? file.contentHash : `hash:${relativePath}`,
                    fileKind: "gml" as const,
                    mtimeMs: null,
                    relativePath,
                    sizeBytes: 0,
                    sourceOrigin: "disk" as const,
                    sourceVersion: null
                })
            ])
    );
    const manifest: SemanticFileManifest = Object.freeze({
        entries,
        sourceRevision: sourceRevision as SemanticFileManifest["sourceRevision"]
    });
    const publicationRequest = {
        authoritative: tier === "full" && store.readActiveSemanticSlots().definitions === null,
        baseGeneration: store.readActiveSemanticSlots()[tier]?.generation ?? null,
        expectedHeadGeneration: store.readSemanticProjectHead().generation,
        manifest,
        navigationProjection: index,
        snapshot: createSemanticSnapshotFromProjectIndex(index, tier, manifest.sourceRevision),
        sourceRevision,
        tier
    } as const;
    const publication =
        affectedFiles === null
            ? store.publishSemanticSnapshot(publicationRequest)
            : store.applySemanticIncrement({ ...publicationRequest, affectedFiles });
    assert.equal(publication.status, "published");
    assert.ok(publication.state);
    return publication.state;
}
