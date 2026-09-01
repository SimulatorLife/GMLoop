import { Core } from "@gmloop/core";

import type { SemanticSnapshotAcquireResult, SemanticSnapshotLease } from "../semantic-snapshot.js";

/** Sentinel returned when one request stops waiting for shared project work. */
export const SEMANTIC_PROJECT_WAIT_CANCELLED = Symbol("semantic-project-session-cancelled-wait");

/** Race a request signal against shared work without propagating cancellation into that work. */
export function waitForSemanticProjectWork<T>(
    promise: Promise<T>,
    signal: AbortSignal
): Promise<T | typeof SEMANTIC_PROJECT_WAIT_CANCELLED> {
    if (signal.aborted) {
        return Promise.resolve(SEMANTIC_PROJECT_WAIT_CANCELLED);
    }
    return new Promise<T | typeof SEMANTIC_PROJECT_WAIT_CANCELLED>((resolve, reject) => {
        const onAbort = (): void => {
            signal.removeEventListener("abort", onAbort);
            resolve(SEMANTIC_PROJECT_WAIT_CANCELLED);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        void promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                return resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", onAbort);
                return reject(Core.isErrorLike(error) ? error : new Error("Shared semantic project work failed."));
            }
        );
    });
}

/** Track explicit consumer release while preserving the store-owned lease unchanged. */
export function wrapSemanticProjectLease(
    lease: SemanticSnapshotLease,
    activeLeaseReleases: Set<() => void>,
    notifyLeaseReleased: () => void
): SemanticSnapshotAcquireResult {
    let released = false;
    const release = (): void => {
        if (released) {
            return;
        }
        released = true;
        activeLeaseReleases.delete(release);
        lease.release();
        notifyLeaseReleased();
    };
    activeLeaseReleases.add(release);
    return Object.freeze({
        kind: "lease",
        lease: Object.freeze({ identity: lease.identity, queries: lease.queries, release })
    });
}
