import assert from "node:assert/strict";
import { test } from "node:test";

import { __ciBuildEvidenceTest__ } from "../src/commands/ci-build-evidence.js";

const { isNormalTypescriptStatus, parseEvidence, validateEvidence } = __ciBuildEvidenceTest__;

void test("completed compiler failure is valid comparable recovery evidence", () => {
    const evidence = parseEvidence({
        schemaVersion: 1,
        targetSha: "base-sha",
        completed: true,
        succeeded: false,
        status: 2,
        signal: null,
        testsSkippedReason: "build-failed"
    });

    assert.deepEqual(validateEvidence(evidence, "base-sha", true), []);
});

void test("successful builds are rejected when failed-build evidence is required", () => {
    const evidence = parseEvidence({
        schemaVersion: 1,
        targetSha: "merge-sha",
        completed: true,
        succeeded: true,
        status: 0,
        signal: null,
        testsSkippedReason: null
    });

    assert.ok(validateEvidence(evidence, "merge-sha", true).some((error) => error.includes("expected a deterministic build failure")));
});

void test("signalled or incomplete build execution is not comparable evidence", () => {
    const evidence = parseEvidence({
        schemaVersion: 1,
        targetSha: "base-sha",
        completed: false,
        succeeded: false,
        status: null,
        signal: "SIGKILL",
        testsSkippedReason: null
    });

    const errors = validateEvidence(evidence, "base-sha", true);
    assert.ok(errors.some((error) => error.includes("normal TypeScript compiler status")));
});

void test("abnormal process exit codes cannot masquerade as deterministic compiler failures", () => {
    assert.equal(isNormalTypescriptStatus(0), true);
    assert.equal(isNormalTypescriptStatus(4), true);
    assert.equal(isNormalTypescriptStatus(127), false);

    const evidence = parseEvidence({
        schemaVersion: 1,
        targetSha: "base-sha",
        completed: true,
        succeeded: false,
        status: 127,
        signal: null,
        testsSkippedReason: "build-failed"
    });
    assert.ok(validateEvidence(evidence, "base-sha", true).some((error) => error.includes("normal TypeScript compiler status")));
});
