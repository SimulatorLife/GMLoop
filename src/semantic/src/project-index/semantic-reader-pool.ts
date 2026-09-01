import { openGraphIndexSnapshotDatabase } from "../graph-index/database.js";
import type { GraphDatabase } from "../graph-index/sqlite-adapter.js";

const MAX_SEMANTIC_SNAPSHOT_READERS = 4;

type PendingSemanticReader = Readonly<{
    cancel: () => void;
    resolve: (database: GraphDatabase | null) => void;
    signal: AbortSignal;
}>;

/** A bounded pool of query-only SQLite connections used by snapshot leases. */
export type SemanticSnapshotReaderPool = Readonly<{
    acquire: (signal: AbortSignal) => Promise<GraphDatabase | null>;
    close: () => void;
    release: (database: GraphDatabase) => void;
}>;

/** Create the internal bounded reader pool for one semantic project store. */
export function createSemanticSnapshotReaderPool(databasePath: string): SemanticSnapshotReaderPool {
    const idleReaders: GraphDatabase[] = [];
    const pendingReaders: PendingSemanticReader[] = [];
    let connectionCount = 0;
    let closed = false;

    const removePendingReader = (pending: PendingSemanticReader): void => {
        const index = pendingReaders.indexOf(pending);
        if (index !== -1) {
            pendingReaders.splice(index, 1);
        }
    };

    const acquire = (signal: AbortSignal): Promise<GraphDatabase | null> => {
        if (closed || signal.aborted) {
            return Promise.resolve(null);
        }
        const idleReader = idleReaders.pop();
        if (idleReader !== undefined) {
            return Promise.resolve(idleReader);
        }
        if (connectionCount < MAX_SEMANTIC_SNAPSHOT_READERS) {
            const database = openGraphIndexSnapshotDatabase(databasePath);
            connectionCount += 1;
            return Promise.resolve(database);
        }
        return new Promise<GraphDatabase | null>((resolve) => {
            const cancel = (): void => {
                removePendingReader(pending);
                signal.removeEventListener("abort", cancel);
                resolve(null);
            };
            const pending: PendingSemanticReader = Object.freeze({ cancel, resolve, signal });
            pendingReaders.push(pending);
            signal.addEventListener("abort", cancel, { once: true });
        });
    };

    const release = (database: GraphDatabase): void => {
        if (closed) {
            database.close();
            connectionCount -= 1;
            return;
        }
        const pending = pendingReaders.shift();
        if (pending !== undefined) {
            pending.signal.removeEventListener("abort", pending.cancel);
            pending.resolve(database);
            return;
        }
        idleReaders.push(database);
    };

    const close = (): void => {
        if (closed) {
            return;
        }
        closed = true;
        for (const pending of pendingReaders.splice(0)) {
            pending.signal.removeEventListener("abort", pending.cancel);
            pending.resolve(null);
        }
        for (const database of idleReaders.splice(0)) {
            database.close();
            connectionCount -= 1;
        }
    };

    return Object.freeze({ acquire, close, release });
}
