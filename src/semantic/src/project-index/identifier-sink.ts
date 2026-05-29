/**
 * @gmloop/semantic
 *
 * Identifier sink backed by temporary JSONL spill files.
 *
 * ## Policy vs. mechanism
 *
 * This module implements the **mechanism** — file I/O, in-memory maps, and
 * cache promotion.  Policy decisions (threshold defaults, normalization,
 * and read-cache LRU eviction) are delegated to `identifier-sink-policy.ts`.
 * Keeping the two layers separate allows callers to test policy logic in
 * isolation without any I/O.
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    evaluateReadCacheEvictionPolicy,
    type NormalizedSinkThresholds,
    normalizeSinkThresholds
} from "./identifier-sink-policy.js";

export type IdentifierSinkRole = "declarations" | "references";

export type IdentifierSinkRecord = {
    collection: string;
    key: string;
    role: IdentifierSinkRole;
    payload: unknown;
};

export interface IdentifierSink {
    append(record: IdentifierSinkRecord): void;
    readAll(collection: string, key: string, role: IdentifierSinkRole): Array<unknown>;
    getRetainedEntriesPerKey(): number;
    getStats(): {
        recordsAppended: number;
        recordsSpilled: number;
        spillFiles: number;
        cacheHits: number;
        cacheMisses: number;
    };
    dispose(): void;
}

export type LruCacheEntry = {
    records: Array<unknown>;
};

type TempFileIdentifierSinkOptions = Readonly<{
    enabled?: boolean;
    flushThreshold?: unknown;
    retainedEntriesPerKey?: unknown;
    readCacheMaxEntries?: unknown;
    tempDirectoryPrefix?: string;
}>;

function createRecordKey(collection: string, key: string, role: IdentifierSinkRole): string {
    return `${collection}\u0000${key}\u0000${role}`;
}

function escapeKeySegment(value: string): string {
    return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

function createStableKeyDigest(value: string): string {
    return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function createSpillFileName(recordKey: string): string {
    const sanitizedPrefix = escapeKeySegment(recordKey).slice(0, 48);
    const digest = createStableKeyDigest(recordKey);
    return `${sanitizedPrefix}-${digest}.jsonl`;
}

function parseJsonLines(rawContents: string): Array<unknown> {
    if (rawContents.length === 0) {
        return [];
    }

    const lines = rawContents.split("\n");
    const records: Array<unknown> = [];
    for (const line of lines) {
        if (line.length === 0) {
            continue;
        }

        try {
            records.push(JSON.parse(line));
        } catch {
            // Skip lines that are not valid JSON — a corrupt spill file should
            // not propagate an exception through the read path.  The mechanism
            // will clear the spill-file-to-record-key mapping on I/O errors,
            // so any remaining good lines will be preserved in the in-memory tail.
        }
    }

    return records;
}

/**
 * Temporary-file-backed identifier sink that keeps a bounded in-memory tail for
 * duplicate checks and spills historical records to JSONL files.
 */
export class TempFileIdentifierSink implements IdentifierSink {
    private readonly enabled: boolean;
    private readonly thresholds: NormalizedSinkThresholds;
    private readonly tempRootPath: string | null;
    private readonly inMemoryTailByKey = new Map<string, Array<unknown>>();
    private readonly filePathByKey = new Map<string, string>();
    private readonly recordKeyByFilePath = new Map<string, string>();
    private readonly parsedReadCacheByPath = new Map<string, LruCacheEntry>();
    private recordsAppended = 0;
    private recordsSpilled = 0;
    private spillFiles = 0;
    private cacheHits = 0;
    private cacheMisses = 0;
    private disposed = false;

    constructor(options: TempFileIdentifierSinkOptions = {}) {
        this.enabled = options.enabled ?? false;
        this.thresholds = normalizeSinkThresholds(options);

        if (this.enabled) {
            const prefix = options.tempDirectoryPrefix ?? "gmloop-identifier-sink-";
            this.tempRootPath = mkdtempSync(path.join(os.tmpdir(), prefix));
            return;
        }

        this.tempRootPath = null;
    }

    append(record: IdentifierSinkRecord): void {
        if (!this.enabled || this.disposed) {
            return;
        }

        const recordKey = createRecordKey(record.collection, record.key, record.role);
        const tail = Core.getOrCreateMapEntry(this.inMemoryTailByKey, recordKey, () => []);
        tail.push(record.payload);
        this.recordsAppended += 1;

        if (tail.length < this.thresholds.flushThreshold) {
            return;
        }

        const spillCount = Math.max(0, tail.length - this.thresholds.retainedEntriesPerKey);
        if (spillCount === 0) {
            return;
        }

        const spillRecords = tail.splice(0, spillCount);
        this.appendRecordsToFile(recordKey, spillRecords);
    }

    readAll(collection: string, key: string, role: IdentifierSinkRole): Array<unknown> {
        if (this.disposed) {
            return [];
        }

        const recordKey = createRecordKey(collection, key, role);
        const tailRecords = this.inMemoryTailByKey.get(recordKey) ?? [];

        if (!this.enabled) {
            return [...tailRecords];
        }

        const filePath = this.filePathByKey.get(recordKey);
        if (!filePath) {
            return [...tailRecords];
        }

        const spilledRecords = this.readSpilledRecords(filePath);
        return [...spilledRecords, ...tailRecords];
    }

    getRetainedEntriesPerKey(): number {
        return this.thresholds.retainedEntriesPerKey;
    }

    getStats() {
        return {
            recordsAppended: this.recordsAppended,
            recordsSpilled: this.recordsSpilled,
            spillFiles: this.spillFiles,
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses
        };
    }

    dispose(): void {
        this.disposed = true;
        this.inMemoryTailByKey.clear();
        this.filePathByKey.clear();
        this.recordKeyByFilePath.clear();
        this.parsedReadCacheByPath.clear();

        if (!this.enabled || !this.tempRootPath) {
            return;
        }

        rmSync(this.tempRootPath, { recursive: true, force: true });
    }

    private appendRecordsToFile(recordKey: string, records: Array<unknown>): void {
        if (!this.enabled || this.disposed || records.length === 0 || !this.tempRootPath) {
            return;
        }

        let filePath = this.filePathByKey.get(recordKey);
        if (!filePath) {
            filePath = path.join(this.tempRootPath, createSpillFileName(recordKey));
            this.filePathByKey.set(recordKey, filePath);
            this.recordKeyByFilePath.set(filePath, recordKey);
            this.spillFiles += 1;
        }

        const payload = `${records.map((value) => JSON.stringify(value)).join("\n")}\n`;
        appendFileSync(filePath, payload, "utf8");
        this.recordsSpilled += records.length;

        // Invalidate read cache because the file grew.
        this.parsedReadCacheByPath.delete(filePath);
    }

    private readSpilledRecords(filePath: string): Array<unknown> {
        const cached = this.parsedReadCacheByPath.get(filePath);
        if (cached) {
            this.cacheHits += 1;
            this.promoteReadCacheEntry(filePath, cached);
            return cached.records;
        }

        this.cacheMisses += 1;
        try {
            const rawContents = readFileSync(filePath, "utf8");
            const records = parseJsonLines(rawContents);
            this.promoteReadCacheEntry(filePath, { records });
            return records;
        } catch {
            this.clearSpillPathMappings(filePath);
            return [];
        }
    }

    private clearSpillPathMappings(filePath: string): void {
        this.parsedReadCacheByPath.delete(filePath);
        const recordKey = this.recordKeyByFilePath.get(filePath);
        if (!recordKey) {
            return;
        }

        this.recordKeyByFilePath.delete(filePath);
        this.filePathByKey.delete(recordKey);
    }

    private promoteReadCacheEntry(cacheKey: string, entry: LruCacheEntry): void {
        const keyWasPresent = this.parsedReadCacheByPath.has(cacheKey);

        // Step 1 — remove the entry (if it was present) to place the cache in its
        // pre-insertion state.  For an already-present key this also moves the
        // entry from its old position to MRU (via the re-insert in step 4).
        this.parsedReadCacheByPath.delete(cacheKey);

        // Step 2 — delegate the eviction decision to the pure policy evaluator.
        // The evaluator receives the cache in its post-deletion state and uses
        // `keyWasPresent` to predict whether the subsequent re-insertion will
        // overflow maxEntries, computing exactly how many oldest entries to
        // evict so the promoted entry is never itself removed.
        const decision = evaluateReadCacheEvictionPolicy({
            currentCache: this.parsedReadCacheByPath,
            promotedKey: cacheKey,
            promotedKeyWasAlreadyPresent: keyWasPresent,
            maxEntries: this.thresholds.readCacheMaxEntries
        });

        // Step 3 — apply the policy decision before re-insertion so the promoted
        // entry lands in the cache at MRU position after the eviction pass.
        for (const key of decision.evictKeys) {
            this.parsedReadCacheByPath.delete(key);
        }

        // Step 4 — re-insert the promoted entry as the most-recently-used entry.
        this.parsedReadCacheByPath.set(cacheKey, entry);
    }
}

export function createIdentifierSink(options: TempFileIdentifierSinkOptions = {}): IdentifierSink {
    return new TempFileIdentifierSink({
        ...options,
        enabled: options.enabled ?? true
    });
}
