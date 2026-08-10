import assert from "node:assert/strict";
import test from "node:test";

import {
    createWorkerOverlayBoundary,
    isWorkerOverlayBoundaryCurrent
} from "../src/intelligence/worker-overlay-boundary.js";

const initialDocuments = [
    { filePath: "/project/a.gml", sourceText: "function a() {}", version: 1 },
    { filePath: "/project/b.gml", sourceText: "function b() {}", version: 3 }
] as const;

void test("worker overlay boundary accepts an unchanged complete buffer set", () => {
    const boundary = createWorkerOverlayBoundary(initialDocuments);
    assert.equal(
        isWorkerOverlayBoundaryCurrent(
            boundary,
            initialDocuments.map((document) => ({ ...document }))
        ),
        true
    );
});

void test("worker overlay boundary rejects edits in any non-anchor buffer", () => {
    const boundary = createWorkerOverlayBoundary(initialDocuments);
    assert.equal(
        isWorkerOverlayBoundaryCurrent(boundary, [
            initialDocuments[0],
            { ...initialDocuments[1], sourceText: "function changed() {}", version: 4 }
        ]),
        false
    );
    assert.equal(
        isWorkerOverlayBoundaryCurrent(boundary, [
            initialDocuments[0],
            { ...initialDocuments[1], sourceText: "function changed_without_version() {}" }
        ]),
        false,
        "the content hash must reject protocol clients that reuse a document version"
    );
});

void test("worker overlay boundary rejects opened or closed buffers", () => {
    const boundary = createWorkerOverlayBoundary(initialDocuments);
    assert.equal(isWorkerOverlayBoundaryCurrent(boundary, [initialDocuments[0]]), false);
    assert.equal(
        isWorkerOverlayBoundaryCurrent(boundary, [
            ...initialDocuments,
            { filePath: "/project/c.gml", sourceText: "function c() {}", version: 1 }
        ]),
        false
    );
});

void test("worker overlay boundary rejects an unmatched document with an undefined version instead of throwing", () => {
    // Regression test for a TypeError guarded against in isWorkerOverlayBoundaryCurrent.
    //
    // The module builds with "strict": false (tsconfig.base.json), so nothing at
    // compile time stops a caller from handing in a document whose `version` is
    // `undefined` despite the `number` type annotation -- for example a document
    // reconstructed from partially-malformed JSON-RPC data. Before the fix, an
    // unmatched path (no boundary entry) combined with such a document produced
    // `entry?.version === document.version` => `undefined === undefined` => `true`,
    // which then fell through to an unguarded `entry.contentHash` read and threw
    // `TypeError: Cannot read properties of undefined (reading 'contentHash')`.
    // The guarded implementation must instead report the boundary as stale.
    //
    // The document set below keeps the same length as `boundary` so the leading
    // `documents.length !== boundary.size` check does not short-circuit before
    // reaching the per-document comparison that this test targets.
    const boundary = createWorkerOverlayBoundary(initialDocuments);
    const documentWithUndefinedVersion = {
        filePath: "/project/never-snapshotted.gml",
        sourceText: "function neverSnapshotted() {}",
        version: undefined as unknown as number
    };
    const documentsWithOneUnmatchedPath = [initialDocuments[0], documentWithUndefinedVersion];

    assert.doesNotThrow(() => {
        isWorkerOverlayBoundaryCurrent(boundary, documentsWithOneUnmatchedPath);
    });
    assert.equal(isWorkerOverlayBoundaryCurrent(boundary, documentsWithOneUnmatchedPath), false);
});
