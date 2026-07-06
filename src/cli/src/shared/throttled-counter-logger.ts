/**
 * Create a throttled counter that logs a formatted message at most once per
 * configured interval while still accumulating every increment.
 *
 * Long-running CLI commands emit periodic progress lines such as
 * `[format] Checking GML files... (N processed)`. The inline bookkeeping for
 * that pattern — incrementing a counter, sampling the wall clock, comparing
 * against the previous log timestamp, and emitting when the threshold is
 * crossed — is identical across commands and was previously repeated at each
 * call site (see `format.ts` and `lint.ts`). This helper centralizes the
 * bookkeeping so orchestrators can delegate a single `tick()` call rather
 * than reaching for primitive arithmetic inline.
 *
 * The logger keeps the total count internally but exposes a `getCount()`
 * accessor so callers that still need the final value for summary output
 * (e.g. `finalizeFormattingRun`) do not have to maintain a parallel counter.
 *
 * @example
 * ```ts
 * const progress = createThrottledCounterLogger({
 *     intervalMs: 1000,
 *     formatMessage: (count) => `[format] Checking GML files... (${count} processed)`
 * });
 *
 * for (const file of files) {
 *     await process(file);
 *     progress.tick();
 * }
 * console.log(`Processed ${progress.getCount()} files in total.`);
 * ```
 */

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_FORMAT_MESSAGE = (count: number) => `(${count} processed)`;
const DEFAULT_SINK = (message: string) => console.log(message);
const DEFAULT_NOW = () => Date.now();

export interface ThrottledCounterLoggerSink {
    (message: string): void;
}

export interface ThrottledCounterLoggerClock {
    (): number;
}

export interface ThrottledCounterLoggerOptions {
    /**
     * Minimum wall-clock interval, in milliseconds, that must pass between
     * emitted log lines. Set to `0` to log every tick.
     */
    intervalMs?: number;
    /**
     * Build the log line for a given accumulated count. Invoked only when the
     * throttle window has elapsed.
     */
    formatMessage?: (count: number) => string;
    /**
     * Receiver for emitted log lines. Defaults to `console.log`. Tests inject
     * a recorder to assert on what was emitted.
     */
    sink?: ThrottledCounterLoggerSink;
    /**
     * Clock source used to evaluate the throttle window. Defaults to
     * `Date.now`. Tests inject a deterministic monotonic counter.
     */
    now?: ThrottledCounterLoggerClock;
}

export interface ThrottledCounterLogger {
    /**
     * Increment the internal counter by `delta` (defaulting to `1`) and emit a
     * log line when the throttle window has elapsed since the previous emit.
     *
     * @param delta Optional non-negative increment. Defaults to `1`.
     * @returns The accumulated count after the increment is applied.
     */
    tick(delta?: number): number;
    /**
     * Read the accumulated count without emitting or mutating any state.
     */
    getCount(): number;
    /**
     * Reset both the accumulated count and the throttle window so the next
     * `tick()` is treated as the first tick of a new session.
     */
    reset(): void;
}

/**
 * Build a throttled counter logger.
 *
 * @param options Formatting, throttling, and I/O overrides. All fields are
 *   optional; sensible defaults mirror the historical `format.ts` behaviour.
 * @returns A logger that maintains its own counter and throttle state.
 */
export function createThrottledCounterLogger(options: ThrottledCounterLoggerOptions = {}): ThrottledCounterLogger {
    const {
        intervalMs = DEFAULT_INTERVAL_MS,
        formatMessage = DEFAULT_FORMAT_MESSAGE,
        sink = DEFAULT_SINK,
        now = DEFAULT_NOW
    } = options;

    let count = 0;
    let lastEmittedAt = 0;

    return {
        tick(delta = 1) {
            if (!Number.isFinite(delta) || delta < 0) {
                throw new RangeError(
                    `Throttled counter tick delta must be a non-negative finite number; received ${delta}.`
                );
            }

            count += delta;
            const currentTimestamp = now();
            if (currentTimestamp - lastEmittedAt > intervalMs) {
                sink(formatMessage(count));
                lastEmittedAt = currentTimestamp;
            }
            return count;
        },
        getCount() {
            return count;
        },
        reset() {
            count = 0;
            lastEmittedAt = 0;
        }
    };
}
