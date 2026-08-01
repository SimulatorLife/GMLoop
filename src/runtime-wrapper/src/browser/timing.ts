/**
 * Shared timing utilities for the runtime-wrapper workspace.
 *
 * This module provides high-resolution timing for duration measurements using performance.now().
 * The performance API provides sub-millisecond precision and monotonic timestamps that are
 * immune to system clock adjustments, making it ideal for measuring patch application
 * durations in hot-reload scenarios.
 *
 * For wall-clock timestamps (absolute time recorded in metrics), call `Date.now()` directly.
 *
 * These helpers are cross-cutting within the workspace and are used by both the runtime
 * and websocket layers, so they live in a dedicated timing domain rather than being
 * co-located with either sublayer's runtime or websocket implementation files.
 */

// Resolve the high-resolution timer once at module load. The availability of
// `performance.now()` is determined by the host environment and cannot change
// during the lifetime of the process. Eagerly binding here eliminates a
// `typeof` check on every call — a meaningful saving when the function is
// invoked multiple times per hot-reload cycle at 60 fps.
const resolvedTimeFn: () => number =
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? () => performance.now()
        : () => Date.now();

/**
 * Returns a high-resolution timestamp suitable for measuring durations.
 * Uses performance.now() when available (browser/modern Node), falls back to Date.now().
 *
 * @returns Timestamp in milliseconds with sub-millisecond precision when supported
 */
export function getHighResolutionTime(): number {
    return resolvedTimeFn();
}

/**
 * Measures the duration of a synchronous operation.
 *
 * @param fn - The operation to measure
 * @returns The duration in milliseconds and the result of the operation
 */
export function measureDuration<T>(fn: () => T): { durationMs: number; result: T } {
    const start = getHighResolutionTime();
    const result = fn();
    const durationMs = getHighResolutionTime() - start;
    return { durationMs, result };
}
