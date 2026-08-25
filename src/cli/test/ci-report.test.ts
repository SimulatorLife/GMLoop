import assert from "node:assert/strict";
import { test } from "node:test";

import { __ciReportTest__ } from "../src/commands/ci-report.js";

const { calculateManifestDigest, calculatePlanDigest, createBalancedShardPlan, findCoverageErrors, isCanonicalTestPath } =
    __ciReportTest__;

void test("CI test discovery matches the canonical non-performance corpus rules", () => {
    assert.equal(isCanonicalTestPath("src/core/dist/test/example.test.js"), true);
    assert.equal(isCanonicalTestPath("src/lint/dist/test/rules/example.test.js"), true);
    assert.equal(isCanonicalTestPath("test/dist/integration/example.test.js"), true);
    assert.equal(isCanonicalTestPath("src/core/dist/test/performance/example.test.js"), false);
    assert.equal(isCanonicalTestPath("test/dist/fixture-perf.test.js"), false);
    assert.equal(isCanonicalTestPath("src/core/dist/example.test.js"), false);
});

void test("balanced CI shards use longest-processing-time placement deterministically", () => {
    const shards = createBalancedShardPlan(
        [
            { file: "a.test.js", weightMs: 9_000 },
            { file: "b.test.js", weightMs: 8_000 },
            { file: "c.test.js", weightMs: 7_000 },
            { file: "d.test.js", weightMs: 6_000 },
            { file: "e.test.js", weightMs: 5_000 },
            { file: "f.test.js", weightMs: 4_000 }
        ],
        3
    );

    assert.deepEqual(
        shards.map((shard) => ({ name: shard.name, files: shard.files, estimatedDurationMs: shard.estimatedDurationMs })),
        [
            { name: "shard-1", files: ["a.test.js", "f.test.js"], estimatedDurationMs: 13_000 },
            { name: "shard-2", files: ["b.test.js", "e.test.js"], estimatedDurationMs: 13_000 },
            { name: "shard-3", files: ["c.test.js", "d.test.js"], estimatedDurationMs: 13_000 }
        ]
    );
});

void test("CI manifest digests are stable and sensitive to assignments", () => {
    const tests = ["a.test.js", "b.test.js", "c.test.js"];
    const firstPlan = [
        { name: "shard-1", files: ["a.test.js", "c.test.js"], estimatedDurationMs: 10 },
        { name: "shard-2", files: ["b.test.js"], estimatedDurationMs: 10 }
    ];
    const secondPlan = [
        { name: "shard-1", files: ["a.test.js"], estimatedDurationMs: 10 },
        { name: "shard-2", files: ["b.test.js", "c.test.js"], estimatedDurationMs: 10 }
    ];

    assert.equal(calculateManifestDigest(tests), calculateManifestDigest([...tests].reverse()));
    assert.notEqual(calculatePlanDigest(firstPlan), calculatePlanDigest(secondPlan));
});

void test("CI report coverage rejects duplicate or missing test files", () => {
    const shards = [
        { name: "shard-1", files: ["a.test.js"], estimatedDurationMs: 10 },
        { name: "shard-2", files: ["b.test.js"], estimatedDurationMs: 10 }
    ];
    const manifestDigest = calculateManifestDigest(["a.test.js", "b.test.js"]);
    const planDigest = calculatePlanDigest(shards);
    const manifest = {
        schemaVersion: 1,
        shardCount: 2,
        tests: ["a.test.js", "b.test.js"],
        manifestDigest,
        planDigest,
        shards
    };

    const validMetadata = shards.map((shard) => ({
        schemaVersion: 1,
        shard: shard.name,
        completed: true,
        status: 0,
        signal: null,
        durationMs: 10,
        testFiles: shard.files,
        manifestDigest,
        planDigest,
        reportFile: `tests-${shard.name}.xml`
    }));
    assert.deepEqual(findCoverageErrors(manifest, validMetadata), []);

    const duplicateMetadata = [
        validMetadata[0],
        { ...validMetadata[1], testFiles: ["a.test.js"] }
    ];
    const errors = findCoverageErrors(manifest, duplicateMetadata);
    assert.ok(errors.some((error) => error.includes("appears in more than one shard")));
    assert.ok(errors.some((error) => error.includes("missing test files")));
});
