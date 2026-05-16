/**
 * @gmloop/semantic — Project Index Cache Validation Policy
 *
 * ## Separation of concerns
 *
 * The `loadProjectIndexCache` mechanism (file I/O, JSON parsing, writing
 * results) lives in `cache.ts`. It owns all side effects.
 *
 * This module holds only the **policy** — pure functions that decide whether
 * a parsed cache payload is a valid hit given the caller's expectations.
 * It has no file I/O or other side effects whatsoever.
 *
 * Responsibilities kept here:
 *   - `ProjectIndexCacheMissReason` constants: the vocabulary of why a cache
 *     is rejected. Centralising these here keeps miss-reason strings
 *     co-located with the logic that produces them.
 *   - Structural validation: does the parsed JSON have all required fields?
 *   - Hit/miss evaluation: given a validated payload and caller expectations,
 *     which condition (if any) causes a cache miss?
 *
 * This separation lets callers test every validation decision in isolation
 * (no file I/O required) and keeps `cache.ts` focused on I/O concerns.
 *
 * @example
 * ```ts
 * const result = evaluateCacheHitDecision(parsedPayload, {
 *     resolvedRoot: path.resolve(projectRoot),
 *     schemaVersion: PROJECT_INDEX_CACHE_SCHEMA_VERSION,
 *     formatterVersion: "1.0.0",
 *     pluginVersion: "0.1.0",
 *     manifestMtimes: { "project.yyp": 100 },
 *     sourceMtimes: { "scripts/main.gml": 200 }
 * });
 * if (!result.valid) {
 *     return cacheMiss(result.missReason);
 * }
 * ```
 */

import nodePath from "node:path";

import { Core } from "@gmloop/core";

// ---------------------------------------------------------------------------
// Miss reason constants
// ---------------------------------------------------------------------------

/**
 * Reasons why a project index cache lookup is classified as a miss.
 *
 * "NOT_FOUND" and "INVALID_JSON" originate in the mechanism layer (file I/O
 * or JSON parse failure) and are included here for completeness. All other
 * values represent policy decisions: the file was read and parsed
 * successfully, but the payload failed a validation rule.
 */
export const ProjectIndexCacheMissReason = Object.freeze({
    NOT_FOUND: "not-found",
    INVALID_JSON: "invalid-json",
    INVALID_SCHEMA: "invalid-schema",
    PROJECT_ROOT_MISMATCH: "project-root-mismatch",
    FORMATTER_VERSION_MISMATCH: "formatter-version-mismatch",
    PLUGIN_VERSION_MISMATCH: "plugin-version-mismatch",
    MANIFEST_MTIME_MISMATCH: "manifest-mtime-mismatch",
    SOURCE_MTIME_MISMATCH: "source-mtime-mismatch"
});

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/**
 * The caller's expectations used to evaluate whether a cache payload is
 * fresh and valid for the current project configuration.
 */
export type CacheValidationExpectations = Readonly<{
    /** Resolved absolute path of the project root. */
    resolvedRoot: string;
    /** Expected schema version (e.g. `PROJECT_INDEX_CACHE_SCHEMA_VERSION`). */
    schemaVersion: number;
    /** Expected formatter version string, or `undefined`/empty to skip check. */
    formatterVersion?: string;
    /** Expected plugin version string, or `undefined`/empty to skip check. */
    pluginVersion?: string;
    /**
     * Expected manifest file mtimes. When provided and non-empty, the cached
     * manifest mtimes must match these values.
     */
    manifestMtimes?: Record<string, unknown>;
    /**
     * Expected source file mtimes. When provided and non-empty, the cached
     * source mtimes must match these values.
     */
    sourceMtimes?: Record<string, unknown>;
}>;

/**
 * Result returned by {@link evaluateCacheHitDecision}.
 *
 * - `valid: true` — the payload passes all validation rules (cache hit).
 * - `valid: false` — at least one rule failed; `missReason` is one of the
 *   values from {@link ProjectIndexCacheMissReason}.
 */
export type CacheHitEvaluationResult =
    | { readonly valid: true }
    | { readonly valid: false; readonly missReason: string };

// ---------------------------------------------------------------------------
// Internal helpers (pure, no side effects)
// ---------------------------------------------------------------------------

/**
 * Returns `true` when `record` is a non-null object with at least one own
 * enumerable property.
 */
function hasEntries(record: unknown): boolean {
    return typeof record === "object" && record !== null && Object.keys(record as object).length > 0;
}

/**
 * Compares two mtime maps for equality.
 *
 * Numeric values are compared with `Core.areNumbersApproximatelyEqual` to
 * tolerate floating-point rounding on platforms where `stat.mtimeMs` is not
 * an integer. All other value types are compared with strict equality.
 *
 * Returns `true` when both maps have the same keys with matching values.
 */
function areMtimeMapsEqual(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
    if (expected === actual) {
        return true;
    }

    if (!Core.isObjectLike(expected) || !Core.isObjectLike(actual)) {
        return false;
    }

    const expectedEntries = Object.entries(expected);
    const actualKeys = Object.keys(actual);

    if (expectedEntries.length !== actualKeys.length) {
        return false;
    }

    return expectedEntries.every(([key, value]) => {
        const actualValue = (actual as Record<string, unknown>)[key];

        if (typeof value === "number" && typeof actualValue === "number") {
            return Core.areNumbersApproximatelyEqual(value, actualValue);
        }

        return actualValue === value;
    });
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

/**
 * Validates that a parsed JSON value has the expected shape for a project
 * index cache entry.
 *
 * This is a **structural** check only — it verifies field presence and
 * types but does not evaluate freshness or match the payload against caller
 * expectations. A payload that passes this check is ready for
 * {@link evaluateCacheHitDecision}.
 *
 * @param payload - The parsed JSON value to validate (may be any type).
 * @param expectedSchemaVersion - The schema version this code expects.
 * @returns `true` when the payload has all required fields with valid types.
 */
export function validateCachePayloadStructure(payload: unknown, expectedSchemaVersion: number): boolean {
    if (!Core.isObjectLike(payload)) {
        return false;
    }

    const record = payload as Record<string, unknown>;

    if (record.schemaVersion !== expectedSchemaVersion) {
        return false;
    }

    if (typeof record.projectRoot !== "string" || record.projectRoot.length === 0) {
        return false;
    }

    if (typeof record.formatterVersion !== "string") {
        return false;
    }

    if (typeof record.pluginVersion !== "string") {
        return false;
    }

    if (!Core.isObjectLike(record.manifestMtimes)) {
        return false;
    }

    if (!Core.isObjectLike(record.sourceMtimes)) {
        return false;
    }

    // Allow `metricsSummary` to be omitted, to be an object, or explicitly
    // `null` (null indicates no metrics were collected). Any other
    // non-object value is invalid.
    if (record.metricsSummary != null && !Core.isObjectLike(record.metricsSummary)) {
        return false;
    }

    if (!Core.isObjectLike(record.projectIndex)) {
        return false;
    }

    return true;
}

// ---------------------------------------------------------------------------
// Hit / miss policy evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a parsed cache payload is a hit or a miss for the given
 * caller expectations.
 *
 * The function applies validation rules in order of increasing cost:
 * 1. Structural validity (schema version, required fields)
 * 2. Project root identity
 * 3. Formatter / plugin version pins
 * 4. Manifest mtime freshness
 * 5. Source mtime freshness
 *
 * The first failing rule short-circuits the evaluation and sets `missReason`
 * to the corresponding {@link ProjectIndexCacheMissReason} value.
 *
 * This function is **pure** — it performs no file I/O, no mutations, and no
 * side effects. The "NOT_FOUND" and "INVALID_JSON" misses are handled by the
 * mechanism layer before this evaluator is called.
 *
 * @param payload - The parsed JSON value (after a successful `JSON.parse`).
 * @param expectations - The caller's expectations for the current project.
 * @returns A {@link CacheHitEvaluationResult} indicating hit or miss.
 */
export function evaluateCacheHitDecision(
    payload: unknown,
    expectations: CacheValidationExpectations
): CacheHitEvaluationResult {
    const { resolvedRoot, schemaVersion, formatterVersion, pluginVersion, manifestMtimes, sourceMtimes } = expectations;

    // 1. Structural validation: does the payload have the expected shape?
    if (!validateCachePayloadStructure(payload, schemaVersion)) {
        return { valid: false, missReason: ProjectIndexCacheMissReason.INVALID_SCHEMA };
    }

    const record = payload as Record<string, unknown>;

    // 2. Project root: the cache must belong to the same project.
    if (nodePath.resolve(record.projectRoot as string) !== resolvedRoot) {
        return { valid: false, missReason: ProjectIndexCacheMissReason.PROJECT_ROOT_MISMATCH };
    }

    // 3a. Formatter version: only enforced when the caller provides a version.
    if (formatterVersion && record.formatterVersion !== String(formatterVersion)) {
        return { valid: false, missReason: ProjectIndexCacheMissReason.FORMATTER_VERSION_MISMATCH };
    }

    // 3b. Plugin version: only enforced when the caller provides a version.
    if (pluginVersion && record.pluginVersion !== String(pluginVersion)) {
        return { valid: false, missReason: ProjectIndexCacheMissReason.PLUGIN_VERSION_MISMATCH };
    }

    // 4. Manifest mtimes: only checked when the caller provides expectations.
    const expectedManifestMtimes = manifestMtimes ?? {};
    if (
        hasEntries(expectedManifestMtimes) &&
        !areMtimeMapsEqual(expectedManifestMtimes as Record<string, unknown>, record.manifestMtimes as Record<string, unknown>)
    ) {
        return { valid: false, missReason: ProjectIndexCacheMissReason.MANIFEST_MTIME_MISMATCH };
    }

    // 5. Source mtimes: only checked when the caller provides expectations.
    const expectedSourceMtimes = sourceMtimes ?? {};
    if (
        hasEntries(expectedSourceMtimes) &&
        !areMtimeMapsEqual(expectedSourceMtimes as Record<string, unknown>, record.sourceMtimes as Record<string, unknown>)
    ) {
        return { valid: false, missReason: ProjectIndexCacheMissReason.SOURCE_MTIME_MISMATCH };
    }

    return { valid: true };
}
