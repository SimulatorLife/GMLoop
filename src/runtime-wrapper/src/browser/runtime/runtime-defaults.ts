/**
 * Centralized default values for the runtime wrapper module.
 *
 * This module is the single source of truth for tuning constants consumed by
 * {@link createRuntimeWrapper} and the surrounding runtime helpers. Keeping
 * the defaults in their own module (mirroring the inline-defaults pattern
 * used at the top of `browser/websocket/client.ts`) gives us:
 *
 * - One place to review the runtime's tunable surface area
 * - Stable, importable references for tests and downstream tooling
 * - No need to read the implementation file to learn what the defaults are
 * - Cleaner separation between policy (defaults) and mechanism (the
 *   implementation that consumes the defaults)
 *
 * Each constant is intentionally small, frozen (where applicable), and
 * documented with the rationale for its chosen value so the next maintainer
 * can judge whether the value still fits the runtime's needs.
 */

/**
 * Default maximum number of undo snapshots retained by
 * {@link createRuntimeWrapper}.
 *
 * The undo stack is bounded to prevent unbounded memory growth during
 * long-running development sessions. When the limit is reached, the oldest
 * snapshot is discarded to make room for the newest one.
 *
 * 50 snapshots is chosen as a reasonable balance for hot-reload workflows:
 * - It comfortably covers a typical sequence of source-file saves during a
 *   single feature change.
 * - It keeps the per-snapshot state (the previous function for a patch id)
 *   small enough that the stack's memory footprint is negligible compared
 *   to the registry it backs.
 * - A user can override it via {@link RuntimeWrapperOptions.maxUndoStackSize}
 *   (set to `0` for unbounded, which is not recommended for long sessions).
 */
export const DEFAULT_MAX_UNDO_STACK_SIZE = 50;

/**
 * Default maximum number of error records retained by the runtime wrapper's
 * error history.
 *
 * The error history is bounded to prevent unbounded memory growth when patch
 * validation or application fails repeatedly during a development session.
 * Older error records are dropped first once the limit is reached, keeping
 * the most recent diagnostics available for the error analytics API.
 *
 * 100 entries is chosen as a reasonable default because:
 * - It is large enough to surface patterns across a typical debugging
 *   session of flaky patches.
 * - It is small enough that iterating the history in the diagnostics API
 *   stays cheap even on lower-powered developer machines.
 * - A user can override it via {@link RuntimeWrapperOptions.maxErrorHistorySize}
 *   (set to `0` for unbounded, which is not recommended for long sessions).
 */
export const DEFAULT_MAX_ERROR_HISTORY_SIZE = 100;

/**
 * Default maximum number of patch history records retained by the runtime
 * wrapper.
 *
 * Patch history powers diagnostics and aggregate stats, but live-reload
 * sessions can apply thousands of patches while a developer repeatedly saves
 * files. Retaining every historical entry keeps obsolete metadata objects and
 * per-entry strings alive even though diagnostics only need recent activity.
 *
 * 500 entries preserves a generous recent timeline while bounding steady-state
 * memory. A value of `0` remains available via
 * {@link RuntimeWrapperOptions.maxPatchHistorySize} for explicitly unbounded
 * diagnostic sessions.
 */
export const DEFAULT_MAX_PATCH_HISTORY_SIZE = 500;
