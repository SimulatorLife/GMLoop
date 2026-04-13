/**
 * Nanosecond-precision monotonic timing helpers used by CLI commands to report
 * per-file and overall processing durations.
 *
 * Previously lived in `@gmloop/core` (`src/core/src/utils/elapsed-time.ts`)
 * despite its only consumers being CLI commands (`format` and `lint`).  Core is
 * intentionally kept to AST types, traversal helpers, and workspace-agnostic
 * primitives — CLI-specific timing utilities that surface verbose progress
 * messages to a command-line user do not belong there.  This module is now
 * co-located with the CLI commands that rely on it.
 */

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const NANOSECONDS_PER_CENTI_MILLISECOND = 10_000n;

/**
 * Read the current monotonic timestamp in nanoseconds.
 *
 * Monotonic time avoids wall-clock jumps (NTP, DST, manual changes) so
 * duration measurements remain stable across long-running operations.
 *
 * @returns {bigint} Monotonic timestamp in nanoseconds.
 */
export function readMonotonicNanoseconds(): bigint {
    return process.hrtime.bigint();
}

/**
 * Calculate elapsed nanoseconds between two monotonic timestamps.
 *
 * @param {{ startedAtNanoseconds: bigint, completedAtNanoseconds: bigint }} parameters
 * @returns {bigint} Non-negative elapsed nanoseconds.
 */
export function calculateElapsedNanoseconds(parameters: {
    startedAtNanoseconds: bigint;
    completedAtNanoseconds: bigint;
}): bigint {
    const elapsedNanoseconds = parameters.completedAtNanoseconds - parameters.startedAtNanoseconds;
    return elapsedNanoseconds > 0n ? elapsedNanoseconds : 0n;
}

/**
 * Render nanoseconds as millisecond text with two decimal digits.
 *
 * @param {bigint} elapsedNanoseconds
 * @returns {string} Millisecond string such as "12.34ms".
 */
export function formatElapsedNanosecondsAsMilliseconds(elapsedNanoseconds: bigint): string {
    const normalizedElapsedNanoseconds = elapsedNanoseconds > 0n ? elapsedNanoseconds : 0n;
    const wholeMilliseconds = normalizedElapsedNanoseconds / NANOSECONDS_PER_MILLISECOND;
    const fractionalHundredths =
        (normalizedElapsedNanoseconds % NANOSECONDS_PER_MILLISECOND) / NANOSECONDS_PER_CENTI_MILLISECOND;
    return `${wholeMilliseconds.toString()}.${fractionalHundredths.toString().padStart(2, "0")}ms`;
}
