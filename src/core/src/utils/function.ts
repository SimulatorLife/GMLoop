import { isErrorLike } from "./capability-probes.js";
import { assertFunction } from "./object.js";

/**
 * Return the provided value without modification. Centralizes the identity
 * function used across helper modules so hot paths can reuse a single exported
 * implementation instead of allocating ad-hoc closures.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function identity<T>(value: T): T {
    return value;
}

// Export a singleton no-op function for stable reference equality checks.
// Many helpers (e.g., semantic integrations, CLI cleanup handlers) need a
// shared fallback callback that does nothing. Using a module-level singleton
// allows downstream consumers to detect "was this callback customized?" via
// `callback === noop` instead of threading sentinel flags or magic strings
// around. Manual CLI flows (documented in docs/hot-reload.md)
// stash this exact reference as the fallback `unsubscribe` handler, and
// semantic integrations such as `setReservedIdentifierMetadataLoader` return
// it from their setup methods so try/finally cleanup blocks stay balanced.
// Replacing this with an inline arrow function—even one that does nothing—
// would break reference equality checks, causing consumers to miss the sentinel,
// leak manual overrides, and require bespoke equality logic at every call site.
const NOOP = () => {};

type CallWithFallbackOptions<TResult> = {
    fallback?: TResult | ((error: unknown) => TResult);
    onError?: (error: unknown) => void;
};

/**
 * Invoke {@link action} while capturing synchronous failures and returning a
 * fallback value instead. Centralizes the "try, catch, fallback" pattern used
 * across environment configuration helpers so modules no longer hand-roll
 * boilerplate error handling each time they interact with configurable
 * callbacks. Callers can optionally supply {@link onError} to observe the
 * thrown error before the fallback is returned.
 *
 * @template TResult
 * @param {() => TResult} action Callback to invoke.
 * @param {{
 *   fallback?: TResult | ((error: unknown) => TResult),
 *   onError?: (error: unknown) => void
 * }} [options]
 * @returns {TResult | undefined} The callback result or the computed fallback
 *          when {@link action} throws.
 */
export function callWithFallback<TResult>(
    action: () => TResult,
    { fallback, onError }: CallWithFallbackOptions<TResult> = {}
) {
    const invoke = assertFunction<() => TResult>(action, "action");
    const errorHandler =
        onError === undefined ? undefined : assertFunction<(error: unknown) => void>(onError, "onError");

    try {
        return invoke();
    } catch (error) {
        errorHandler?.(error);
        if (typeof fallback === "function") {
            return (fallback as (caughtError: unknown) => TResult)(error);
        }

        return fallback;
    }
}

export { NOOP as noop };

/**
 * Represents a debounced function with cleanup capabilities.
 */
export interface DebouncedFunction<TArgs extends Array<unknown>> {
    /**
     * Invoke the debounced function. The actual execution will be delayed
     * until the quiet period expires.
     */
    (...args: TArgs): void;

    /**
     * Cancel any pending execution and invoke immediately if pending.
     */
    flush(): void;

    /**
     * Cancel any pending execution without invoking.
     */
    cancel(): void;

    /**
     * Check if there is a pending execution.
     */
    isPending(): boolean;
}

/**
 * Options for configuring debounced function behavior.
 */
export interface DebounceOptions {
    /**
     * Optional callback invoked when the debounced function throws an error.
     * Receives the caught error as its only parameter. If not provided, errors
     * are logged to stderr to ensure they remain visible for debugging.
     */
    onError?: (error: unknown) => void;
}

/**
 * Creates a debounced version of a function that delays execution until after
 * a specified delay has elapsed since the last invocation.
 *
 * @param fn - Function to debounce
 * @param delayMs - Delay in milliseconds to wait before executing
 * @param options - Optional configuration for error handling
 * @returns Debounced function with flush, cancel, and isPending methods
 *
 * @example
 * ```ts
 * const debouncedSave = debounce((filePath: string) => {
 *   console.log('Saving', filePath);
 * }, 200);
 *
 * debouncedSave('/path/to/file.gml'); // Scheduled
 * debouncedSave('/path/to/file.gml'); // Cancels previous, schedules new
 * debouncedSave('/path/to/file.gml'); // Cancels previous, schedules new
 * // After 200ms of quiet, saves once with the last arguments
 *
 * // Force immediate execution
 * debouncedSave.flush();
 *
 * // Cancel pending execution
 * debouncedSave.cancel();
 *
 * // Handle errors with custom callback
 * const debouncedWithErrorHandler = debounce((filePath: string) => {
 *   throw new Error('Save failed');
 * }, 200, {
 *   onError: (error) => {
 *     console.error('Debounced operation failed:', error);
 *   }
 * });
 * ```
 */
export function debounce<TArgs extends Array<unknown>>(
    fn: (...args: TArgs) => void,
    delayMs: number,
    options: DebounceOptions = {}
): DebouncedFunction<TArgs> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pendingArgs: TArgs | null = null;

    const clearPendingTimer = (): void => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    const invokePending = (): void => {
        const argsToUse = pendingArgs;
        pendingArgs = null;

        if (argsToUse === null) {
            return;
        }

        try {
            fn(...argsToUse);
        } catch (error) {
            if (options.onError === undefined) {
                // Use a capability probe rather than `instanceof Error` so that
                // cross-realm errors (e.g. from sandboxed modules) are handled.
                process.stderr.write(
                    `[debounce] Error in debounced function: ${isErrorLike(error) ? error.message : String(error)}\n`
                );
                if (isErrorLike(error) && typeof (error as { stack?: unknown }).stack === "string") {
                    process.stderr.write(`${(error as { stack: string }).stack}\n`);
                }
            } else {
                options.onError(error);
            }
        }
    };

    const debounced = (...args: TArgs): void => {
        pendingArgs = args;
        clearPendingTimer();

        timeoutId = setTimeout(() => {
            timeoutId = null;
            invokePending();
        }, delayMs);
    };

    debounced.flush = (): void => {
        clearPendingTimer();
        invokePending();
    };

    debounced.cancel = (): void => {
        clearPendingTimer();
        pendingArgs = null;
    };

    debounced.isPending = (): boolean => {
        return timeoutId !== null;
    };

    return debounced;
}
