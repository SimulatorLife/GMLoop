/**
 * Unit tests for the `replay-helpers` facade.
 *
 * These tests pin the Law-of-Demeter seams that the `replay` command relies
 * on: each helper must collapse the four-segment `artifact.trace.events.<...>`
 * chain into a single neighbour call so the command file does not reach
 * through the events array to read accessors, indexes, or arithmetic. The
 * tests also lock the constants (`MINIMUM_REPLAY_EVENT_COUNT`,
 * `REPLAY_EVENT_TYPES`) so the `replay assert` payload stays stable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    computeReplayEventCountDelta,
    countReplayTraceEvents,
    getFirstReplayTraceEvent,
    getLastReplayTraceEvent,
    getReplayTraceEvents,
    hasMinimumReplayTraceEvents,
    hasReplayStartEvent,
    MINIMUM_REPLAY_EVENT_COUNT,
    REPLAY_EVENT_TYPES,
    type ReplayArtifact,
    type ReplayEvent
} from "../src/commands/replay-helpers.js";

function createReplayEvent(overrides: Partial<ReplayEvent> = {}): ReplayEvent {
    return Object.freeze({
        payload: "demo",
        step: 1,
        type: REPLAY_EVENT_TYPES.start,
        ...overrides
    });
}

function createReplayArtifact(events: ReadonlyArray<ReplayEvent>): ReplayArtifact {
    return Object.freeze({
        artifactId: "artifact-id",
        checksum: "checksum",
        createdAt: "2026-07-24T00:00:00.000Z",
        input: "input",
        name: "name",
        projectRoot: "/project",
        trace: Object.freeze({ events: Object.freeze([...events]) })
    });
}

void describe("replay-helpers", () => {
    void describe("REPLAY_EVENT_TYPES", () => {
        void it("exposes the well-known start, input, and complete discriminators", () => {
            assert.equal(REPLAY_EVENT_TYPES.start, "start");
            assert.equal(REPLAY_EVENT_TYPES.input, "input");
            assert.equal(REPLAY_EVENT_TYPES.complete, "complete");
        });
    });

    void describe("MINIMUM_REPLAY_EVENT_COUNT", () => {
        void it("matches the seed-event count emitted by buildReplayArtifactSeed", () => {
            // The replay seed always produces start/input/complete (3 events).
            // The minimum-event-count predicate must mirror that floor so the
            // freshly recorded happy path resolves to a passing assertion.
            assert.equal(MINIMUM_REPLAY_EVENT_COUNT, 3);
        });
    });

    void describe("getReplayTraceEvents", () => {
        void it("returns the events array from the artifact trace", () => {
            const events = Object.freeze([
                createReplayEvent({ type: REPLAY_EVENT_TYPES.start, step: 1 }),
                createReplayEvent({ type: REPLAY_EVENT_TYPES.input, step: 2 }),
                createReplayEvent({ type: REPLAY_EVENT_TYPES.complete, step: 3 })
            ]);
            const artifact = createReplayArtifact(events);

            assert.deepEqual([...getReplayTraceEvents(artifact)], [...events]);
        });

        void it("returns the same reference that the artifact stores under `trace.events`", () => {
            const events = Object.freeze([
                createReplayEvent({ type: REPLAY_EVENT_TYPES.start, step: 1 }),
                createReplayEvent({ type: REPLAY_EVENT_TYPES.input, step: 2 })
            ]);
            const artifact = createReplayArtifact(events);

            assert.strictEqual(getReplayTraceEvents(artifact), artifact.trace.events);
        });

        void it("returns an empty array for an artifact with no events", () => {
            const artifact = createReplayArtifact(Object.freeze([]));

            assert.deepEqual([...getReplayTraceEvents(artifact)], []);
        });
    });

    void describe("countReplayTraceEvents", () => {
        void it("returns the number of recorded events", () => {
            const artifact = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ step: 1 }),
                    createReplayEvent({ step: 2 }),
                    createReplayEvent({ step: 3 })
                ])
            );

            assert.equal(countReplayTraceEvents(artifact), 3);
        });

        void it("returns 0 for an empty artifact", () => {
            assert.equal(countReplayTraceEvents(createReplayArtifact(Object.freeze([]))), 0);
        });
    });

    void describe("getFirstReplayTraceEvent", () => {
        void it("returns the first event from the trace", () => {
            const first = createReplayEvent({ type: REPLAY_EVENT_TYPES.start, step: 1 });
            const second = createReplayEvent({ type: REPLAY_EVENT_TYPES.input, step: 2 });
            const artifact = createReplayArtifact(Object.freeze([first, second]));

            assert.strictEqual(getFirstReplayTraceEvent(artifact), first);
        });

        void it("returns undefined when the trace is empty", () => {
            assert.equal(getFirstReplayTraceEvent(createReplayArtifact(Object.freeze([]))), undefined);
        });
    });

    void describe("getLastReplayTraceEvent", () => {
        void it("returns the final event from the trace", () => {
            const first = createReplayEvent({ type: REPLAY_EVENT_TYPES.start, step: 1 });
            const last = createReplayEvent({ type: REPLAY_EVENT_TYPES.complete, step: 3 });
            const artifact = createReplayArtifact(Object.freeze([first, last]));

            assert.strictEqual(getLastReplayTraceEvent(artifact), last);
        });

        void it("returns undefined when the trace is empty", () => {
            assert.equal(getLastReplayTraceEvent(createReplayArtifact(Object.freeze([]))), undefined);
        });

        void it("returns the only event when the trace has exactly one entry", () => {
            const only = createReplayEvent({ type: REPLAY_EVENT_TYPES.start, step: 1 });
            const artifact = createReplayArtifact(Object.freeze([only]));

            assert.strictEqual(getLastReplayTraceEvent(artifact), only);
        });
    });

    void describe("hasMinimumReplayTraceEvents", () => {
        void it("returns true when the artifact has at least the minimum event count", () => {
            const artifact = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ step: 1 }),
                    createReplayEvent({ step: 2 }),
                    createReplayEvent({ step: 3 })
                ])
            );

            assert.equal(hasMinimumReplayTraceEvents(artifact), true);
        });

        void it("returns true when the artifact has more than the minimum event count", () => {
            const artifact = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ step: 1 }),
                    createReplayEvent({ step: 2 }),
                    createReplayEvent({ step: 3 }),
                    createReplayEvent({ step: 4 })
                ])
            );

            assert.equal(hasMinimumReplayTraceEvents(artifact), true);
        });

        void it("returns false when the artifact has fewer events than the minimum", () => {
            const artifact = createReplayArtifact(
                Object.freeze([createReplayEvent({ step: 1 }), createReplayEvent({ step: 2 })])
            );

            assert.equal(hasMinimumReplayTraceEvents(artifact), false);
        });

        void it("returns false when the artifact has no events", () => {
            assert.equal(hasMinimumReplayTraceEvents(createReplayArtifact(Object.freeze([]))), false);
        });
    });

    void describe("hasReplayStartEvent", () => {
        void it("returns true when the first event is a start event", () => {
            const artifact = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ type: REPLAY_EVENT_TYPES.start, step: 1 }),
                    createReplayEvent({ type: REPLAY_EVENT_TYPES.input, step: 2 })
                ])
            );

            assert.equal(hasReplayStartEvent(artifact), true);
        });

        void it("returns false when the first event is not a start event", () => {
            const artifact = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ type: REPLAY_EVENT_TYPES.input, step: 1 }),
                    createReplayEvent({ type: REPLAY_EVENT_TYPES.complete, step: 2 })
                ])
            );

            assert.equal(hasReplayStartEvent(artifact), false);
        });

        void it("returns false when the artifact has no events", () => {
            assert.equal(hasReplayStartEvent(createReplayArtifact(Object.freeze([]))), false);
        });
    });

    void describe("computeReplayEventCountDelta", () => {
        void it("returns the candidate event count minus the baseline event count", () => {
            const baseline = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ step: 1 }),
                    createReplayEvent({ step: 2 }),
                    createReplayEvent({ step: 3 })
                ])
            );
            const candidate = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ step: 1 }),
                    createReplayEvent({ step: 2 }),
                    createReplayEvent({ step: 3 }),
                    createReplayEvent({ step: 4 }),
                    createReplayEvent({ step: 5 })
                ])
            );

            assert.equal(computeReplayEventCountDelta(baseline, candidate), 2);
        });

        void it("returns a negative delta when the candidate has fewer events than the baseline", () => {
            const baseline = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ step: 1 }),
                    createReplayEvent({ step: 2 }),
                    createReplayEvent({ step: 3 }),
                    createReplayEvent({ step: 4 })
                ])
            );
            const candidate = createReplayArtifact(
                Object.freeze([
                    createReplayEvent({ step: 1 }),
                    createReplayEvent({ step: 2 }),
                    createReplayEvent({ step: 3 })
                ])
            );

            assert.equal(computeReplayEventCountDelta(baseline, candidate), -1);
        });

        void it("returns 0 when the candidate and baseline have the same event count", () => {
            const baseline = createReplayArtifact(
                Object.freeze([createReplayEvent({ step: 1 }), createReplayEvent({ step: 2 })])
            );
            const candidate = createReplayArtifact(
                Object.freeze([createReplayEvent({ step: 1 }), createReplayEvent({ step: 2 })])
            );

            assert.equal(computeReplayEventCountDelta(baseline, candidate), 0);
        });
    });
});
