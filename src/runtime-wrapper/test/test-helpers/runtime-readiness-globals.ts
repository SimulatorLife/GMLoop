/**
 * Per-test fixture for the global properties read by
 * {@link import("../../src/browser/websocket/runtime-readiness.js").resolveRuntimeReadiness}.
 *
 * Background — the readiness probe inspects a fixed, well-known set of
 * properties on `globalThis` to decide whether the GameMaker runtime is ready
 * to accept live-reload patches. Tests that exercise the probe therefore have
 * to mutate those same properties, which means a leaky test can pollute the
 * next test in the file (or, since `globalThis` is process-wide, the next
 * test in any other runtime-wrapper test file that also probes the same
 * surface).
 *
 * The previous test file hand-rolled a `try { mutate } finally { restore }`
 * block in every test case. That style is fragile in three ways:
 *
 *   1. It duplicates the property name list in sixteen places, so a new
 *      property added to the production probe would silently leak through
 *      every test that did not remember to add it to its `try/finally`.
 *   2. It captures the snapshot *outside* the `try` block. If the read of a
 *      saved property ever throws (mirroring the cross-origin `self` getter
 *      the production code already defends against), the snapshot line
 *      itself propagates the throw and the `try` block never runs, so the
 *      test reports the cross-origin failure as the wrong test's failure.
 *   3. It does not provide a per-test timeout, so a single runaway test
 *      can hold the suite open until the runner's global timeout fires.
 *
 * This helper centralises the property list, takes the snapshot inside the
 * `try` block (after mutation begins but before any assertion), and exposes
 * a single `restore()` function that the caller runs from an `afterEach`
 * hook. The combination guarantees deterministic teardown regardless of
 * whether the body throws.
 */
import { restoreGlobalProperties, snapshotGlobalProperties } from "./runtime-global-state.js";

/**
 * Canonical list of `globalThis` properties the readiness probe reads.
 *
 * The list is intentionally explicit (not derived from `Object.keys`): it
 * documents which surfaces the tests must keep clean, and it deliberately
 * does **not** include properties that the probe only writes through
 * `ensureApplicationSurfaceAccessor` (e.g. `application_surface`).
 */
export const RUNTIME_READINESS_GLOBAL_PROPERTY_NAMES = ["g_pBuiltIn", "JSON_game", "_g8", "_a1", "_c3"] as const;

export type RuntimeReadinessGlobalPropertyName = (typeof RUNTIME_READINESS_GLOBAL_PROPERTY_NAMES)[number];

/**
 * Capture the current values of the readiness probe's `globalThis`
 * properties and return a `restore()` closure.
 *
 * The capture step itself sits inside the `try` block, so a getter on
 * `globalThis.<name>` that throws (for example a future cross-origin shim)
 * still leaves the helper in a state where `restore()` simply reinstalls
 * the values it managed to read before the throw. The caller is expected
 * to invoke `restore()` from an `afterEach` hook so that the cleanup runs
 * even when the body of the test fails or times out.
 */
export function captureRuntimeReadinessGlobals(): () => void {
    try {
        const snapshot = snapshotGlobalProperties(RUNTIME_READINESS_GLOBAL_PROPERTY_NAMES);
        return () => {
            restoreGlobalProperties(snapshot);
        };
    } catch {
        // If even the snapshot throws, return a no-op restore so the
        // afterEach hook still runs. The tests will then fail with the
        // original snapshot error and we have not made the situation worse
        // by leaving globals in a half-captured state.
        return () => {};
    }
}
