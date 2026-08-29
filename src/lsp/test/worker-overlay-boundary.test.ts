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
    const boundary = createWorkerOverlayBoundary(initialDocuments);
    const documents = [
        initialDocuments[0],
        {
            filePath: "/project/never-snapshotted.gml",
            sourceText: "function neverSnapshotted() {}",
            version: undefined as unknown as number
        }
    ];
    assert.equal(isWorkerOverlayBoundaryCurrent(boundary, documents), false);
});
