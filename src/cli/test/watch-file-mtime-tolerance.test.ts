/**
 * Regression coverage for the mtime tolerance helper used by the watch
 * command's initial-scan cache.
 *
 * Filesystem modification times (`fs.Stats.mtimeMs`) are returned as JavaScript
 * numbers whose precision depends on the underlying filesystem and OS. The
 * same physical mtime can surface as two adjacent floats on consecutive
 * reads — for example when the second read crosses a process boundary
 * (e.g. an editor save via a different process, or a containerised build
 * re-statting a host mount) or when FAT-style 2-second coarsening rounds a
 * previously sub-second timestamp.
 *
 * Before this helper existed the watch command used strict equality
 * (`cached.mtimeMs === currentStats.mtimeMs`), which silently invalidated
 * the initial-scan cache for every file whose mtime differed by even one
 * ulp. That forced a re-read of every GML file during startup and made
 * startup timings on real projects visibly worse on platforms with
 * sub-millisecond mtime precision.
 *
 * These tests pin the contract of `areFileMtimesApproximatelyEqual` so the
 * helper cannot silently regress to strict equality (or otherwise widen its
 * tolerance past the point where genuinely newer mtimes would also be
 * accepted).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { areFileMtimesApproximatelyEqual } from "../src/commands/watch/source-analysis.js";

void describe("watch command mtime tolerance helper", () => {
    void it("treats identical mtimes as equivalent", () => {
        assert.equal(areFileMtimesApproximatelyEqual(1_700_000_000_000, 1_700_000_000_000), true);
        assert.equal(areFileMtimesApproximatelyEqual(0, 0), true);
    });

    void it("treats mtimes within a single ulp as equivalent", () => {
        // 4× Number.EPSILON is the same tolerance window used by
        // `Core.areNumbersApproximatelyEqual` for unit-magnitude operands,
        // which is the smallest scale the helper can resolve.
        const baseMtime = 1_700_000_000_000;
        const oneUlpDelta = Number.EPSILON * baseMtime;
        assert.equal(areFileMtimesApproximatelyEqual(baseMtime, baseMtime + oneUlpDelta), true);
        assert.equal(areFileMtimesApproximatelyEqual(baseMtime, baseMtime - oneUlpDelta), true);
    });

    void it("rejects mtimes that differ by more than the dynamic tolerance window", () => {
        // One millisecond is orders of magnitude beyond the EPSILON-scaled
        // tolerance window for any plausible mtime magnitude, so this should
        // never be accepted as a cache hit.
        const cached = 1_700_000_000_000;
        const fresh = cached + 1;
        assert.equal(areFileMtimesApproximatelyEqual(cached, fresh), false);
        assert.equal(areFileMtimesApproximatelyEqual(fresh, cached), false);
    });

    void it("rejects mixed finite / non-finite sentinels", () => {
        // NaN never satisfies `===`, so neither should the helper.
        assert.equal(areFileMtimesApproximatelyEqual(Number.NaN, 1_700_000_000_000), false);
        assert.equal(areFileMtimesApproximatelyEqual(1_700_000_000_000, Number.NaN), false);
        // A finite mtime should never be considered equivalent to an
        // infinite sentinel — fs.Stats always reports a finite mtimeMs in
        // practice, so an infinite value is a programming error rather than
        // a real "unchanged" signal.
        assert.equal(areFileMtimesApproximatelyEqual(Number.POSITIVE_INFINITY, 1_700_000_000_000), false);
        assert.equal(areFileMtimesApproximatelyEqual(1_700_000_000_000, Number.NEGATIVE_INFINITY), false);
    });

    void it("treats cached and current mtimes as equivalent across a single-ulp drift", () => {
        // Simulate the real-world flake: the same physical file is read twice
        // (e.g. by `collectScriptNames` during watch startup and then again
        // during `performInitialScan`). On any platform whose mtime precision
        // exceeds what the runtime is willing to round-trip, those two reads
        // can produce adjacent floats that differ by a single ulp. The helper
        // must treat them as equivalent so the initial-scan cache is hit
        // instead of forcing a re-read of every unchanged GML file.
        const cachedMtime = 1_700_000_000_000;
        const driftedMtime = cachedMtime + Number.EPSILON * cachedMtime;
        assert.equal(areFileMtimesApproximatelyEqual(cachedMtime, driftedMtime), true);
    });
});
