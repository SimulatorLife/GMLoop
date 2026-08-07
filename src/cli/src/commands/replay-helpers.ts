/**
 * Structural shape and accessor helpers for replay artifacts.
 *
 * `replay run`, `replay compare`, and `replay assert` all need to read small
 * slices of an artifact's `trace.events` array (count, first event, last
 * event, minimum-count predicate). Without this module, every call site
 * reached four segments deep (`artifact.trace.events.length`,
 * `artifact.trace.events.at(-1)`, etc.) and re-implemented the same
 * structural observations.
 *
 * The helpers in this file collapse those chains into a single immediate
 * neighbour call so collaborators in {@link ./replay.ts} only talk to the
 * artifact seam, not to the nested `trace.events` array. Keeping the
 * `MINIMUM_REPLAY_EVENT_COUNT` constant next to the predicate that uses it
 * also stops the literal `3` from drifting across the command file.
 */

/**
 * Discriminator for the well-known replay event types emitted by
 * {@link buildReplayArtifactSeed}. Enum-like union so callers can compare
 * `event.type` against a named constant without leaking string literals into
 * the `assert` payload.
 */
export const REPLAY_EVENT_TYPES = Object.freeze({
    complete: "complete",
    input: "input",
    start: "start"
} as const);

export type ReplayEventType = (typeof REPLAY_EVENT_TYPES)[keyof typeof REPLAY_EVENT_TYPES];

/**
 * A single step recorded inside an artifact's `trace.events` array.
 *
 * The shape mirrors the seed produced by `buildReplayArtifactSeed`; the
 * runtime validator in {@link ./replay.ts} enforces it on every disk read.
 */
export type ReplayEvent = Readonly<{
    payload: string;
    step: number;
    type: string;
}>;

/**
 * Stable, on-disk shape of a replay artifact produced by the `replay record`
 * action and consumed by `replay run`, `replay compare`, and `replay assert`.
 */
export type ReplayArtifact = Readonly<{
    artifactId: string;
    checksum: string;
    createdAt: string;
    input: string;
    name: string;
    projectRoot: string;
    trace: {
        events: ReadonlyArray<ReplayEvent>;
    };
}>;

/**
 * Minimum number of events an artifact must carry to be considered a valid
 * deterministic trace. The seed emitted by `buildReplayArtifactSeed` always
 * produces exactly this many events (`start`, `input`, `complete`) so the
 * `replay assert` action can treat this constant as the structural floor.
 */
export const MINIMUM_REPLAY_EVENT_COUNT = 3;

/**
 * Read the raw replay event array from an artifact.
 *
 * Collapses the `artifact.trace.events` three-segment walk so collaborators
 * that only need to iterate, count, or index into the events list address a
 * single immediate neighbour. The returned reference is the same array the
 * artifact stores, so callers must not mutate it.
 */
export function getReplayTraceEvents(artifact: ReplayArtifact): ReadonlyArray<ReplayEvent> {
    return artifact.trace.events;
}

/**
 * Count the replay events recorded in an artifact.
 *
 * Collapses `artifact.trace.events.length` into a single call so the `run`,
 * `compare`, and `assert` action handlers stop repeating the four-segment
 * chain at every call site.
 */
export function countReplayTraceEvents(artifact: ReplayArtifact): number {
    return getReplayTraceEvents(artifact).length;
}

/**
 * Read the first replay event recorded in an artifact.
 *
 * Collapses `artifact.trace.events[0]` so that the `replay assert` payload
 * (which checks the leading event type) talks to one neighbour instead of
 * reaching into the nested `trace.events` array. Returns `undefined` when the
 * artifact is empty so callers can guard without a separate length check.
 */
export function getFirstReplayTraceEvent(artifact: ReplayArtifact): ReplayEvent | undefined {
    return getReplayTraceEvents(artifact)[0];
}

/**
 * Read the final replay event recorded in an artifact.
 *
 * Collapses `artifact.trace.events.at(-1)` so the `replay run` payload can
 * surface the trailing event's payload without reaching through three
 * nested members. Returns `undefined` when the artifact is empty so callers
 * can fall back to a default value without a separate length check.
 */
export function getLastReplayTraceEvent(artifact: ReplayArtifact): ReplayEvent | undefined {
    return getReplayTraceEvents(artifact).at(-1);
}

/**
 * Return `true` when an artifact records at least
 * {@link MINIMUM_REPLAY_EVENT_COUNT} replay events.
 *
 * Collapses the `artifact.trace.events.length >= MINIMUM_REPLAY_EVENT_COUNT`
 * four-segment predicate so the `replay assert` action gates its
 * `minimumEventCount` payload and `hasDeterministicEventFlow` flag through
 * one call. Keeping the threshold next to the predicate stops the literal
 * `3` from being duplicated across the command file.
 */
export function hasMinimumReplayTraceEvents(artifact: ReplayArtifact): boolean {
    return countReplayTraceEvents(artifact) >= MINIMUM_REPLAY_EVENT_COUNT;
}

/**
 * Return `true` when an artifact's first recorded event is the well-known
 * `start` event.
 *
 * Collapses `artifact.trace.events[0]?.type === "start"` so the
 * `hasDeterministicEventFlow` assertion in `replay assert` only has to ask
 * one neighbour. The leading `?.` chain is preserved by the helper so empty
 * artifacts still resolve to `false` rather than throwing.
 */
export function hasReplayStartEvent(artifact: ReplayArtifact): boolean {
    return getFirstReplayTraceEvent(artifact)?.type === REPLAY_EVENT_TYPES.start;
}

/**
 * Compute the difference in event counts between two replay artifacts.
 *
 * Collapses `candidate.trace.events.length - baseline.trace.events.length`
 * so the `replay compare` action can derive `eventCountDelta` from a single
 * helper call. The sign convention (`candidate - baseline`) matches the
 * existing payload so callers do not have to invert the result.
 */
export function computeReplayEventCountDelta(baseline: ReplayArtifact, candidate: ReplayArtifact): number {
    return countReplayTraceEvents(candidate) - countReplayTraceEvents(baseline);
}
