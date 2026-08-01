/**
 * Duplicate-scope and multi-declaration naming-convention codemod performance guard.
 *
 * Exercises the naming-convention planner at scale (220 files × 36 targets with
 * duplicate scoped declarations, and 220 files × 60 targets in a shared scope)
 * where the duplicate-scope and multi-declaration handling paths dominate.
 *
 * Each test is kept in its own file so that Node's test runner spawns it in a
 * dedicated worker process, preventing intra-file concurrency from inflating timings.
 *
 * These tests lock in the following optimisation passes:
 *
 * **Duplicate-declaration keying** (duplicate-scope test):
 *   Replaced the previous per-scope O(n²) duplicate keying with an O(n) Map
 *   keyed on the declaration's normalized path+start+end.  This eliminates
 *   the quadratic comparison overhead that grew with the number of declarations
 *   per scope.
 *
 * **Lazy scope-decision allocation** (multi-declaration test):
 *   Deferred the allocation of per-scope decision structures until they are
 *   first accessed, rather than constructing them eagerly for every scope
 *   encountered during target processing.  This avoids unnecessary Map/Set
 *   allocations in the common case where a scope has only a single declaration.
 */
import test from "node:test";

import { runNamingConventionStressTest } from "./test-helpers/naming-convention-test-runner.js";

const FILE_COUNT = 220;
const DUPLICATE_DECLARATIONS_PER_FILE = 36;
// Parallel-sample median baseline on commit 8326bc8d5955b0aa972069251b29f141dd6405b1: ~832ms.
// After duplicate-declaration keying optimization: ~682ms on the same workload.
// Threshold keeps CI headroom while guarding against regression toward baseline.
const PERFORMANCE_THRESHOLD_MS = 1400;
const MULTI_DECLARATION_SCOPE_PER_FILE = 60;
// Standalone benchmark (April 19, 2026):
//   before lazy scope-decision allocation: median ~72.98ms
//   after  lazy scope-decision allocation: median ~66.11ms
// Threshold allows CI worker contention while guarding against regressions
// that reintroduce per-target Map allocations in this hot path.
// Re-measured on April 26, 2026 under full validation-surface contention:
// median ~697ms (same synthetic workload). Keep headroom narrow while still
// preserving regression protection against >2x slowdowns.
const MULTI_DECLARATION_SCOPE_THRESHOLD_MS = 800;

void test("namingConvention duplicate-scope stress test stays within the planner threshold", async () => {
    await runNamingConventionStressTest({
        fileCount: FILE_COUNT,
        targetsPerFile: DUPLICATE_DECLARATIONS_PER_FILE,
        performanceThresholdMs: PERFORMANCE_THRESHOLD_MS,
        testDisplayName: "duplicate-scope (220 files × 36 targets)",
        sharedScopeId: "shared_scope",
        duplicateTargetsPerDeclaration: true
    });
});

void test("namingConvention multi-declaration scopes stay within allocation-regression threshold", async () => {
    await runNamingConventionStressTest({
        fileCount: FILE_COUNT,
        targetsPerFile: MULTI_DECLARATION_SCOPE_PER_FILE,
        performanceThresholdMs: MULTI_DECLARATION_SCOPE_THRESHOLD_MS,
        testDisplayName: "multi-declaration scope (220 files × 60 targets)",
        sharedScopeId: "shared_scope"
    });
});
