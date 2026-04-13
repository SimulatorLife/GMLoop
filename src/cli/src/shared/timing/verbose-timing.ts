/**
 * CLI-command timing and verbose-logging utilities.
 *
 * Previously lived in `@gmloop/core` (`src/core/src/utils/time.ts`) even though the
 * only consumers were two CLI generator commands (`generate-gml-identifiers` and
 * `generate-feather-metadata`).  Core is intentionally kept to AST types, traversal
 * helpers, and workspace-agnostic primitives — timing utilities that surface verbose
 * progress messages to a CLI user do not belong there.  Moving this module here keeps
 * core lean and co-locates the timing helpers with the CLI commands that rely on them.
 */

const MILLISECOND_PER_SECOND = 1000;
const SUB_SECOND_THRESHOLD_TOLERANCE_MS = 1e-6;

interface VerboseFlagOptions {
    parsing?: boolean;
}

interface VerboseLogger {
    log?: (message: string) => void;
}

export interface VerboseDurationLoggerOptions {
    verbose?: VerboseFlagOptions;
    formatMessage?: string | ((duration: string) => string);
    logger?: VerboseLogger;
}

export interface TimeSyncOptions {
    verbose?: VerboseFlagOptions;
    logger?: VerboseLogger;
}

/**
 * Format the elapsed time since `startTime` as a human-readable string.
 *
 * Returns milliseconds for sub-second durations (e.g. `"200ms"`) and
 * seconds with one decimal place for longer durations (e.g. `"1.5s"`).
 *
 * @param startTime - Epoch millisecond timestamp returned by `Date.now()`.
 * @returns Human-readable elapsed-time string.
 */
export function formatDuration(startTime: number): string {
    const deltaMs = Date.now() - startTime;
    const isEffectivelySubSecond =
        deltaMs < MILLISECOND_PER_SECOND && deltaMs < MILLISECOND_PER_SECOND - SUB_SECOND_THRESHOLD_TOLERANCE_MS;

    if (isEffectivelySubSecond) {
        return `${deltaMs}ms`;
    }

    return `${(deltaMs / MILLISECOND_PER_SECOND).toFixed(1)}s`;
}

/**
 * Create a zero-argument callback that, when invoked, logs the elapsed
 * time since the call to `createVerboseDurationLogger`.
 *
 * Logging is gated behind `verbose.parsing` so callers can pass the flag
 * through unchanged and the helper decides silently whether to emit output.
 *
 * @param options - Optional logger, format message, and verbose flag.
 * @returns A callback that emits the duration log line when called.
 */
export function createVerboseDurationLogger({
    verbose,
    formatMessage,
    logger = console
}: VerboseDurationLoggerOptions = {}): () => void {
    const startTime = Date.now();

    return () => {
        if (!verbose?.parsing) {
            return;
        }

        const duration = formatDuration(startTime);
        const message =
            typeof formatMessage === "function"
                ? formatMessage(duration)
                : (formatMessage ?? `Completed in ${duration}.`);

        if (typeof logger?.log === "function") {
            logger.log(message);
        }
    };
}

/**
 * Run `callback` synchronously, optionally printing a start/end banner when
 * `verbose.parsing` is enabled, and return the callback's result.
 *
 * @param label - Short description of the work being timed.
 * @param callback - Synchronous work to time.
 * @param options - Optional verbose flag and logger.
 * @returns Whatever `callback` returns.
 */
export function timeSync<TResult>(
    label: string,
    callback: () => TResult,
    { verbose, logger = console }: TimeSyncOptions = {}
): TResult {
    if (verbose?.parsing && typeof logger?.log === "function") {
        logger.log(`→ ${label}`);
    }

    const logCompletion = createVerboseDurationLogger({
        verbose,
        formatMessage: (duration) => `  ${label} completed in ${duration}.`,
        logger
    });
    const result = callback();

    logCompletion();

    return result;
}
