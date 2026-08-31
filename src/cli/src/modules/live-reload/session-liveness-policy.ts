import { Core } from "@gmloop/core";

import type { LiveReloadRegisteredSession } from "./session-registry.js";

/**
 * ## Policy and Mechanism Separation
 *
 * This module owns the *decision* of whether a registered live-reload
 * session is still live, given a status payload fetched from its `/status`
 * endpoint. It performs no I/O and mutates nothing.
 *
 * Callers in `session-registry.ts` own the *mechanism*: fetching the status
 * endpoint and, on a negative verdict, evicting the stale registry file. Before
 * this module existed, that identity-matching heuristic was duplicated between
 * `isLiveReloadRegisteredSessionAlive` and the eviction path in
 * `discoverLiveReloadSessionByPath`, so the two copies could silently drift
 * apart if only one was updated. Routing both call sites through a single
 * pure evaluator keeps the heuristic testable in isolation and guarantees
 * both sites agree on what "alive" means.
 */

/**
 * Decide whether a registered live-reload session is still the one answering
 * at its status endpoint.
 *
 * Sessions registered before identity fields (`sessionId`/`processId`)
 * existed, or that never recorded a worker process, are considered alive as
 * long as the status endpoint responded with a well-formed payload — there is
 * no stronger identity to check. Otherwise the session is only alive when the
 * status payload's `liveReloadSession` identity matches the registered
 * session's `sessionId`, `processId`, and `projectRoot` exactly, which rules
 * out a stale registry pointing at a status server now serving a different
 * (or restarted) session.
 *
 * @param session - The registry entry being validated.
 * @param statusPayload - The raw JSON payload returned by the session's
 *   `/status` endpoint, or `null`/non-object when the fetch failed.
 * @returns `true` when the session should be treated as alive.
 */
export function evaluateLiveReloadSessionLiveness(
    session: LiveReloadRegisteredSession,
    statusPayload: unknown
): boolean {
    if (!Core.isObjectLike(statusPayload)) {
        return false;
    }

    if (session.sessionId === undefined || session.processId === null) {
        return true;
    }

    const identity = (statusPayload as Record<string, unknown>).liveReloadSession;
    if (!Core.isObjectLike(identity)) {
        return false;
    }

    const identityRecord = identity as Record<string, unknown>;
    return (
        identityRecord.sessionId === session.sessionId &&
        identityRecord.processId === session.processId &&
        identityRecord.projectRoot === session.projectRoot
    );
}
