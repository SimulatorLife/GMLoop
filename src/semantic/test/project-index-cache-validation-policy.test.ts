/**
 * Unit tests for the project index cache validation policy.
 *
 * All tests are pure and exercise policy decisions in isolation — no file I/O
 * is required because the evaluator functions have no side effects.
 */

import assert from "node:assert/strict";
import nodePath from "node:path";
import test from "node:test";

import {
    evaluateCacheHitDecision,
    ProjectIndexCacheMissReason,
    validateCachePayloadStructure
} from "../src/project-index/cache-validation-policy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 2;

function makeValidPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: SCHEMA_VERSION,
        projectRoot: "/projects/my-game",
        formatterVersion: "1.0.0",
        pluginVersion: "0.1.0",
        manifestMtimes: { "project.yyp": 100 },
        sourceMtimes: { "scripts/main.gml": 200 },
        metricsSummary: null,
        projectIndex: { resources: {}, scopes: {} },
        ...overrides
    };
}

function makeValidExpectations(
    overrides: Partial<{
        resolvedRoot: string;
        schemaVersion: number;
        formatterVersion: string;
        pluginVersion: string;
        manifestMtimes: Record<string, unknown>;
        sourceMtimes: Record<string, unknown>;
    }> = {}
) {
    return {
        resolvedRoot: nodePath.resolve("/projects/my-game"),
        schemaVersion: SCHEMA_VERSION,
        formatterVersion: "1.0.0",
        pluginVersion: "0.1.0",
        manifestMtimes: { "project.yyp": 100 },
        sourceMtimes: { "scripts/main.gml": 200 },
        ...overrides
    };
}

// ---------------------------------------------------------------------------
// validateCachePayloadStructure
// ---------------------------------------------------------------------------

void test("validateCachePayloadStructure accepts a fully valid payload", () => {
    assert.equal(validateCachePayloadStructure(makeValidPayload(), SCHEMA_VERSION), true);
});

void test("validateCachePayloadStructure rejects null and non-objects", () => {
    assert.equal(validateCachePayloadStructure(null, SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(undefined, SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure("string", SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(42, SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure([], SCHEMA_VERSION), false);
});

void test("validateCachePayloadStructure rejects wrong schema version", () => {
    assert.equal(validateCachePayloadStructure(makeValidPayload({ schemaVersion: 1 }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ schemaVersion: "2" }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ schemaVersion: null }), SCHEMA_VERSION), false);
});

void test("validateCachePayloadStructure rejects missing or invalid projectRoot", () => {
    assert.equal(validateCachePayloadStructure(makeValidPayload({ projectRoot: "" }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ projectRoot: 42 }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ projectRoot: null }), SCHEMA_VERSION), false);
});

void test("validateCachePayloadStructure rejects non-string formatterVersion or pluginVersion", () => {
    assert.equal(validateCachePayloadStructure(makeValidPayload({ formatterVersion: null }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ pluginVersion: 0 }), SCHEMA_VERSION), false);
});

void test("validateCachePayloadStructure rejects non-object mtime maps", () => {
    assert.equal(validateCachePayloadStructure(makeValidPayload({ manifestMtimes: null }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ sourceMtimes: "bad" }), SCHEMA_VERSION), false);
});

void test("validateCachePayloadStructure allows null metricsSummary", () => {
    assert.equal(validateCachePayloadStructure(makeValidPayload({ metricsSummary: null }), SCHEMA_VERSION), true);
});

void test("validateCachePayloadStructure allows absent metricsSummary", () => {
    const payload = makeValidPayload();
    delete payload.metricsSummary;
    assert.equal(validateCachePayloadStructure(payload, SCHEMA_VERSION), true);
});

void test("validateCachePayloadStructure allows object metricsSummary", () => {
    assert.equal(
        validateCachePayloadStructure(makeValidPayload({ metricsSummary: { total: 3 } }), SCHEMA_VERSION),
        true
    );
});

void test("validateCachePayloadStructure rejects non-object metricsSummary", () => {
    assert.equal(validateCachePayloadStructure(makeValidPayload({ metricsSummary: "bad" }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ metricsSummary: 42 }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ metricsSummary: true }), SCHEMA_VERSION), false);
});

void test("validateCachePayloadStructure rejects non-object projectIndex", () => {
    assert.equal(validateCachePayloadStructure(makeValidPayload({ projectIndex: null }), SCHEMA_VERSION), false);
    assert.equal(validateCachePayloadStructure(makeValidPayload({ projectIndex: "bad" }), SCHEMA_VERSION), false);
});

// ---------------------------------------------------------------------------
// evaluateCacheHitDecision — structural failures
// ---------------------------------------------------------------------------

void test("evaluateCacheHitDecision returns INVALID_SCHEMA for malformed payloads", () => {
    const expectations = makeValidExpectations();
    const result = evaluateCacheHitDecision(null, expectations);
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.INVALID_SCHEMA);
    }
});

void test("evaluateCacheHitDecision returns INVALID_SCHEMA when schema version mismatches", () => {
    const result = evaluateCacheHitDecision(makeValidPayload({ schemaVersion: 99 }), makeValidExpectations());
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.INVALID_SCHEMA);
    }
});

// ---------------------------------------------------------------------------
// evaluateCacheHitDecision — project root
// ---------------------------------------------------------------------------

void test("evaluateCacheHitDecision returns PROJECT_ROOT_MISMATCH when project root differs", () => {
    const payload = makeValidPayload({ projectRoot: "/other/project" });
    const result = evaluateCacheHitDecision(payload, makeValidExpectations());
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.PROJECT_ROOT_MISMATCH);
    }
});

void test("evaluateCacheHitDecision resolves relative project roots before comparing", () => {
    // The payload root is relative; nodePath.resolve should produce the same
    // absolute path as the resolved root in the expectations.
    const relRoot = "my-game"; // Will resolve to something like <cwd>/my-game
    const absRoot = nodePath.resolve(relRoot);
    const payload = makeValidPayload({ projectRoot: relRoot });
    const expectations = makeValidExpectations({ resolvedRoot: absRoot });
    // No version or mtime expectations to keep the test focused on path resolution.
    const result = evaluateCacheHitDecision(payload, {
        ...expectations,
        formatterVersion: undefined,
        pluginVersion: undefined,
        manifestMtimes: {},
        sourceMtimes: {}
    });
    assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------------
// evaluateCacheHitDecision — version pins
// ---------------------------------------------------------------------------

void test("evaluateCacheHitDecision returns FORMATTER_VERSION_MISMATCH on version change", () => {
    const result = evaluateCacheHitDecision(
        makeValidPayload(),
        makeValidExpectations({ formatterVersion: "2.0.0" })
    );
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.FORMATTER_VERSION_MISMATCH);
    }
});

void test("evaluateCacheHitDecision skips formatter version check when expectation is absent", () => {
    const result = evaluateCacheHitDecision(
        makeValidPayload(),
        makeValidExpectations({ formatterVersion: undefined, pluginVersion: undefined, sourceMtimes: {} })
    );
    assert.equal(result.valid, true);
});

void test("evaluateCacheHitDecision returns PLUGIN_VERSION_MISMATCH on version change", () => {
    const result = evaluateCacheHitDecision(makeValidPayload(), makeValidExpectations({ pluginVersion: "9.9.9" }));
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.PLUGIN_VERSION_MISMATCH);
    }
});

void test("evaluateCacheHitDecision skips plugin version check when expectation is absent", () => {
    const result = evaluateCacheHitDecision(
        makeValidPayload(),
        makeValidExpectations({ pluginVersion: undefined, sourceMtimes: {} })
    );
    assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------------
// evaluateCacheHitDecision — mtime freshness
// ---------------------------------------------------------------------------

void test("evaluateCacheHitDecision returns MANIFEST_MTIME_MISMATCH when manifest mtime differs", () => {
    const result = evaluateCacheHitDecision(
        makeValidPayload(),
        makeValidExpectations({ manifestMtimes: { "project.yyp": 999 } })
    );
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.MANIFEST_MTIME_MISMATCH);
    }
});

void test("evaluateCacheHitDecision skips manifest mtime check when expectation is empty", () => {
    const result = evaluateCacheHitDecision(
        makeValidPayload(),
        makeValidExpectations({ manifestMtimes: {}, sourceMtimes: {} })
    );
    assert.equal(result.valid, true);
});

void test("evaluateCacheHitDecision skips manifest mtime check when expectation is absent", () => {
    const result = evaluateCacheHitDecision(makeValidPayload(), makeValidExpectations({ manifestMtimes: undefined }));
    assert.equal(result.valid, true);
});

void test("evaluateCacheHitDecision returns SOURCE_MTIME_MISMATCH when source mtime differs", () => {
    const result = evaluateCacheHitDecision(
        makeValidPayload(),
        makeValidExpectations({ sourceMtimes: { "scripts/main.gml": 999 } })
    );
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.SOURCE_MTIME_MISMATCH);
    }
});

void test("evaluateCacheHitDecision skips source mtime check when expectation is empty", () => {
    const result = evaluateCacheHitDecision(
        makeValidPayload(),
        makeValidExpectations({ manifestMtimes: {}, sourceMtimes: {} })
    );
    assert.equal(result.valid, true);
});

void test("evaluateCacheHitDecision tolerates floating-point mtime noise", () => {
    // Timestamps from stat() can have sub-millisecond variance between reads.
    // The policy uses approximate equality to avoid spurious misses.
    const payloadMtime = 1_234_567.89012;
    const expectationMtime = 1_234_567.89014; // within 1e-9 relative tolerance

    const result = evaluateCacheHitDecision(
        makeValidPayload({ sourceMtimes: { "scripts/main.gml": payloadMtime } }),
        makeValidExpectations({ sourceMtimes: { "scripts/main.gml": expectationMtime } })
    );
    assert.equal(result.valid, true);
});

void test("evaluateCacheHitDecision returns SOURCE_MTIME_MISMATCH for genuinely different mtimes", () => {
    const result = evaluateCacheHitDecision(
        makeValidPayload({ sourceMtimes: { "scripts/main.gml": 100 } }),
        makeValidExpectations({ sourceMtimes: { "scripts/main.gml": 200 } })
    );
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.SOURCE_MTIME_MISMATCH);
    }
});

// ---------------------------------------------------------------------------
// evaluateCacheHitDecision — happy path
// ---------------------------------------------------------------------------

void test("evaluateCacheHitDecision returns valid for a matching payload and expectations", () => {
    const result = evaluateCacheHitDecision(makeValidPayload(), makeValidExpectations());
    assert.equal(result.valid, true);
});

void test("evaluateCacheHitDecision evaluates rules in order: INVALID_SCHEMA before PROJECT_ROOT_MISMATCH", () => {
    // A structurally invalid payload is rejected as INVALID_SCHEMA,
    // not PROJECT_ROOT_MISMATCH, regardless of the resolvedRoot.
    const result = evaluateCacheHitDecision(
        makeValidPayload({ schemaVersion: 0, projectRoot: "/other" }),
        makeValidExpectations()
    );
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.INVALID_SCHEMA);
    }
});

void test("evaluateCacheHitDecision evaluates FORMATTER_VERSION_MISMATCH before MANIFEST_MTIME_MISMATCH", () => {
    // When both formatter version and manifest mtimes differ, formatter version
    // is checked first (it comes earlier in the evaluation order).
    const result = evaluateCacheHitDecision(
        makeValidPayload(),
        makeValidExpectations({
            formatterVersion: "9.9.9",
            manifestMtimes: { "project.yyp": 999 }
        })
    );
    assert.equal(result.valid, false);
    if (result.valid === false) {
        assert.equal(result.missReason, ProjectIndexCacheMissReason.FORMATTER_VERSION_MISMATCH);
    }
});
