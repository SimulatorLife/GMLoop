/**
 * Unit coverage for the {@link resolveBaselineAndCandidateTargets} helper in
 * `src/cli/src/modules/runtime/compare-targets.ts`.
 *
 * The helper was extracted from the `replay compare` and `profile compare`
 * action orchestrators, which previously inlined the same three-step
 * ceremony (list available ids, default to penultimate/ultimate, load and
 * classify each side). The tests below pin the contract the orchestrators
 * rely on so the helper can be evolved safely:
 *
 * 1. The default-pair resolution falls back to the penultimate id for the
 *    baseline and the ultimate id for the candidate when no explicit
 *    overrides are supplied.
 * 2. Explicit overrides win over the default resolution, including when the
 *    override points at an id that is not in the available list.
 * 3. When an id is empty, the loader is not invoked and the corresponding
 *    reason is left as `null` (no spurious "missing" signal).
 * 4. The classifier is only invoked for sides that resolved to a non-empty
 *    id AND whose record failed to load, and the resulting reason surfaces
 *    on the correct baseline/candidate field.
 * 5. When no classifier is supplied, both reason fields are `null` even if
 *    the loader returns `null`.
 *
 * The tests use synthetic ids and record shapes so they exercise the
 * dependency-injected contract without depending on any specific artifact
 * store implementation; integration coverage for the actual `replay compare`
 * and `profile compare` orchestrators is provided by
 * `replay-artifact-validation.test.ts` and `profile-test-replay-command.test.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBaselineAndCandidateTargets } from "../src/modules/runtime/compare-targets.js";

/**
 * Synthetic record type used by the tests below. The helper is generic over
 * the record shape; tests use a tagged record so `null` returns from the
 * loader are easy to distinguish from a real payload.
 */
type SyntheticRecord = Readonly<{ id: string; kind: "baseline" | "candidate" | "other" }>;

function buildRecord(id: string, kind: SyntheticRecord["kind"]): SyntheticRecord {
    return Object.freeze({ id, kind });
}

void test("resolveBaselineAndCandidateTargets defaults baseline to penultimate and candidate to latest", async () => {
    const availableIds = ["a", "b", "c", "d"];
    const loadRecordCalls: Array<string> = [];

    const result = await resolveBaselineAndCandidateTargets<SyntheticRecord>({
        listAvailableIds: async () => availableIds,
        loadRecord: async (_projectRoot, id) => {
            loadRecordCalls.push(id);
            return buildRecord(id, id === "c" ? "baseline" : "candidate");
        },
        projectRoot: "/project"
    });

    assert.deepEqual([...result.availableIds], availableIds, "Helper should expose the available id list verbatim");
    assert.equal(result.baselineId, "c", "Penultimate id should be the default baseline");
    assert.equal(result.candidateId, "d", "Ultimate id should be the default candidate");
    assert.equal(result.baseline?.id, "c", "Baseline record should be loaded from the penultimate id");
    assert.equal(result.candidate?.id, "d", "Candidate record should be loaded from the ultimate id");
    assert.equal(result.baselineReason, null, "Successful baseline load should yield a null reason");
    assert.equal(result.candidateReason, null, "Successful candidate load should yield a null reason");
    assert.deepEqual(loadRecordCalls.sort(), ["c", "d"], "Loader should be invoked once per side for the resolved ids");
});

void test("resolveBaselineAndCandidateTargets honours explicit id overrides even when missing from the list", async () => {
    const availableIds = ["a", "b"];
    const loadRecordCalls: Array<string> = [];

    const result = await resolveBaselineAndCandidateTargets<SyntheticRecord>({
        explicitBaselineId: "explicit-baseline",
        explicitCandidateId: "explicit-candidate",
        listAvailableIds: async () => availableIds,
        loadRecord: async (_projectRoot, id) => {
            loadRecordCalls.push(id);
            return buildRecord(id, "other");
        },
        projectRoot: "/project"
    });

    assert.equal(result.baselineId, "explicit-baseline", "Explicit baseline should override the penultimate default");
    assert.equal(result.candidateId, "explicit-candidate", "Explicit candidate should override the latest default");
    assert.deepEqual(
        loadRecordCalls.sort(),
        ["explicit-baseline", "explicit-candidate"],
        "Loader should be invoked with the explicit overrides"
    );
});

void test("resolveBaselineAndCandidateTargets skips the loader when the resolved id is empty", async () => {
    let loadCallCount = 0;

    const result = await resolveBaselineAndCandidateTargets<SyntheticRecord>({
        explicitBaselineId: "",
        explicitCandidateId: "",
        listAvailableIds: async () => [],
        loadRecord: async () => {
            loadCallCount += 1;
            return buildRecord("never", "other");
        },
        projectRoot: "/project"
    });

    assert.equal(loadCallCount, 0, "Loader must not be invoked when both ids are empty");
    assert.equal(result.baselineId, "", "Empty explicit id should be surfaced verbatim");
    assert.equal(result.candidateId, "", "Empty explicit id should be surfaced verbatim");
    assert.equal(result.baseline, null, "Empty baseline id should resolve to a null record");
    assert.equal(result.candidate, null, "Empty candidate id should resolve to a null record");
    assert.equal(result.baselineReason, null, "Empty baseline id should never produce a reason");
    assert.equal(result.candidateReason, null, "Empty candidate id should never produce a reason");
});

void test("resolveBaselineAndCandidateTargets classifies missing sides through the caller-supplied hook", async () => {
    const classificationCalls: Array<string> = [];
    const result = await resolveBaselineAndCandidateTargets<SyntheticRecord>({
        classifyMissing: async (_projectRoot, id) => {
            classificationCalls.push(id);
            return id === "missing-baseline" ? "baseline_not_found" : "candidate_invalid";
        },
        explicitBaselineId: "missing-baseline",
        explicitCandidateId: "missing-candidate",
        listAvailableIds: async () => ["a", "b"],
        loadRecord: async () => null,
        projectRoot: "/project"
    });

    assert.equal(result.baseline, null, "Helper should surface a null baseline when the loader returns null");
    assert.equal(result.candidate, null, "Helper should surface a null candidate when the loader returns null");
    assert.equal(result.baselineReason, "baseline_not_found", "Classifier output should populate baselineReason");
    assert.equal(result.candidateReason, "candidate_invalid", "Classifier output should populate candidateReason");
    assert.deepEqual(
        classificationCalls.sort(),
        ["missing-baseline", "missing-candidate"],
        "Classifier should be invoked once per missing side"
    );
});

void test("resolveBaselineAndCandidateTargets leaves both reason fields null when no classifier is supplied", async () => {
    const result = await resolveBaselineAndCandidateTargets<SyntheticRecord>({
        explicitBaselineId: "missing-baseline",
        explicitCandidateId: "missing-candidate",
        listAvailableIds: async () => ["a"],
        loadRecord: async () => null,
        projectRoot: "/project"
    });

    assert.equal(result.baselineReason, null, "Without a classifier, the baseline reason should remain null");
    assert.equal(result.candidateReason, null, "Without a classifier, the candidate reason should remain null");
    assert.equal(result.baseline, null, "Baseline should still be null when the loader returns null");
    assert.equal(result.candidate, null, "Candidate should still be null when the loader returns null");
});

void test("resolveBaselineAndCandidateTargets only invokes the classifier for sides that actually failed to load", async () => {
    const classificationCalls: Array<string> = [];
    const result = await resolveBaselineAndCandidateTargets<SyntheticRecord>({
        classifyMissing: async (_projectRoot, id) => {
            classificationCalls.push(id);
            return `${id}_reason`;
        },
        explicitBaselineId: "ok-baseline",
        explicitCandidateId: "missing-candidate",
        listAvailableIds: async () => ["a"],
        loadRecord: async (_projectRoot, id) => (id === "ok-baseline" ? buildRecord(id, "baseline") : null),
        projectRoot: "/project"
    });

    assert.equal(result.baseline?.id, "ok-baseline", "Baseline should be loaded from the override");
    assert.equal(result.candidate, null, "Candidate should remain null when the loader returns null");
    assert.equal(result.baselineReason, null, "Classifier should not be invoked for the successful side");
    assert.equal(result.candidateReason, "missing-candidate_reason", "Classifier should run for the failing side only");
    assert.deepEqual(
        classificationCalls,
        ["missing-candidate"],
        "Classifier should be invoked exactly once for the failing side"
    );
});
