import assert from "node:assert/strict";
import { test } from "node:test";

import { __ciBuildEvidenceTest__ } from "../src/commands/ci-build-evidence.js";

const { parseEvidence, validateEvidence } = __ciBuildEvidenceTest__;

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
    assert.ok(errors.some((error) => error.includes("did not complete normally")));
    assert.ok(errors.some((error) => error.includes("tests skipped")));
});
