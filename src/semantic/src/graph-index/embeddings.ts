import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

import type { GraphEmbeddingsConfig } from "./types.js";

export interface GraphEmbeddingProvider {
    readonly dimensions: number;
    readonly providerId: string;
    embedText: (text: string) => Float32Array;
}

function normalizeEmbeddingText(text: string): Array<string> {
    return text
        .toLowerCase()
        .replaceAll(/[^a-z0-9_]+/g, " ")
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function hashTokenToIndex(token: string, dimensions: number): number {
    const digest = createHash("sha256").update(token).digest();
    return digest.readUInt32BE(0) % dimensions;
}

function normalizeVectorMagnitude(vector: Float32Array): Float32Array {
    let magnitudeSquared = 0;
    for (const value of vector) {
        magnitudeSquared += value * value;
    }

    if (magnitudeSquared === 0) {
        return vector;
    }

    const magnitude = Math.sqrt(magnitudeSquared);
    for (let index = 0; index < vector.length; index += 1) {
        vector[index] /= magnitude;
    }

    return vector;
}

class LocalTokenHashEmbeddingProvider implements GraphEmbeddingProvider {
    public readonly dimensions: number;
    public readonly providerId: string;

    constructor(config: GraphEmbeddingsConfig) {
        this.dimensions = Math.max(8, Math.trunc(config.dimensions));
        this.providerId = config.provider;
    }

    embedText(text: string): Float32Array {
        const tokens = normalizeEmbeddingText(text);
        const vector = new Float32Array(this.dimensions);

        for (const token of tokens) {
            const bucket = hashTokenToIndex(token, this.dimensions);
            vector[bucket] += 1;
        }

        return normalizeVectorMagnitude(vector);
    }
}

/**
 * Cache the deterministic local embedding model descriptor used by the graph index.
 */
export function ensureGraphEmbeddingModelAssets(config: GraphEmbeddingsConfig): void {
    mkdirSync(config.modelCacheDir, { recursive: true });
    writeFileSync(
        path.join(config.modelCacheDir, `${config.provider}.json`),
        `${JSON.stringify(
            {
                dimensions: Math.max(8, Math.trunc(config.dimensions)),
                provider: config.provider,
                type: "local-token-hash"
            },
            null,
            2
        )}\n`,
        "utf8"
    );
}

/**
 * Create the local embedding provider used by the graph index.
 */
export function createGraphEmbeddingProvider(config: GraphEmbeddingsConfig): GraphEmbeddingProvider {
    return new LocalTokenHashEmbeddingProvider(config);
}

/**
 * Serialize an embedding vector into a SQLite-friendly blob.
 */
export function serializeEmbeddingVector(vector: Float32Array): Buffer {
    return Buffer.from(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

/**
 * Deserialize a stored SQLite blob into an embedding vector.
 */
export function deserializeEmbeddingVector(blob: Buffer | Uint8Array | ArrayBuffer): Float32Array {
    if (Core.isArrayBufferLike(blob) && !Core.isArrayBufferViewLike(blob)) {
        return new Float32Array(blob.slice(0));
    }

    // At this point blob is Buffer or Uint8Array (both ArrayBufferView subtypes).
    const view = blob as Uint8Array;
    const bytes = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/**
 * Compute cosine similarity between two normalized vectors.
 */
export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
    const length = Math.min(left.length, right.length);
    let score = 0;

    for (let index = 0; index < length; index += 1) {
        score += left[index] * right[index];
    }

    return score;
}
