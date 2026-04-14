import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    cosineSimilarity,
    createGraphEmbeddingProvider,
    deserializeEmbeddingVector,
    serializeEmbeddingVector
} from "../src/graph-index/embeddings.js";

void describe("deserializeEmbeddingVector", () => {
    void it("round-trips a Float32Array through serialize/deserialize with Buffer", () => {
        const original = new Float32Array([1, 2, 3, 4]);
        const serialized = serializeEmbeddingVector(original);
        const deserialized = deserializeEmbeddingVector(serialized);

        assert.deepEqual(deserialized, original);
    });

    void it("deserializes from a plain Uint8Array (cross-realm ArrayBufferView)", () => {
        const original = new Float32Array([0.5, 1.5, -2.5]);
        const serialized = serializeEmbeddingVector(original);
        const uint8View = new Uint8Array(serialized.buffer, serialized.byteOffset, serialized.byteLength);
        const deserialized = deserializeEmbeddingVector(uint8View);

        assert.deepEqual(deserialized, original);
    });

    void it("deserializes from a raw ArrayBuffer", () => {
        const original = new Float32Array([10, 20]);
        const rawBuffer = original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength);
        const deserialized = deserializeEmbeddingVector(rawBuffer);

        assert.deepEqual(deserialized, original);
    });
});

void describe("cosineSimilarity", () => {
    void it("returns 1 for identical unit vectors", () => {
        const vector = new Float32Array([1, 0, 0]);
        assert.ok(Math.abs(cosineSimilarity(vector, vector) - 1) < 1e-6);
    });

    void it("returns 0 for orthogonal vectors", () => {
        const a = new Float32Array([1, 0]);
        const b = new Float32Array([0, 1]);
        assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-6);
    });
});

void describe("createGraphEmbeddingProvider", () => {
    void it("produces consistent embeddings for the same input", () => {
        const provider = createGraphEmbeddingProvider({
            provider: "local-token-hash",
            dimensions: 64,
            modelCacheDir: "/tmp/gml-test-embeddings",
            enabled: true
        });

        const vectorA = provider.embedText("scr_player_move");
        const vectorB = provider.embedText("scr_player_move");

        assert.deepEqual(vectorA, vectorB);
        assert.equal(vectorA.length, 64);
    });
});
