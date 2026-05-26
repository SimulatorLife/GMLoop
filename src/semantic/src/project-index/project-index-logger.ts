/**
 * Flexible logger interface for project index operations.
 * Accepts loggers that expose `.log`, `.debug`, or both (e.g. `console`).
 */
export type ProjectIndexLogger = {
    log?: (...args: Array<unknown>) => void;
    debug?: (...args: Array<unknown>) => void;
    error?: (...args: Array<unknown>) => void;
} | null;

/**
 * Emits a debug-level message through the given logger, preferring `.log`
 * (which reliably goes to stdout) and falling back to `.debug` when `.log`
 * is unavailable.
 */
export function logProjectIndexDebug(logger: ProjectIndexLogger, message: string, payload?: unknown): void {
    const emitterName = resolveLoggerMethodName(logger, ["log", "debug"]);
    if (!emitterName) {
        return;
    }

    if (payload === undefined) {
        invokeLoggerMethod(logger, emitterName, [message]);
        return;
    }

    invokeLoggerMethod(logger, emitterName, [message, payload]);
}

/**
 * Emit an error-level debug message through the given logger.
 *
 * Errors caught during non-critical operations (e.g. stat failures) are
 * handled differently from fatal errors: we surface them so operators can
 * diagnose filesystem or permission problems, but do not propagate them up
 * the call stack. This pattern aligns with the "safe fallback + structured
 * reporting" principle used by the broader project: callers can log at
 * debug level while keeping the error context available for diagnostics.
 */
export function logProjectIndexDebugError(logger: ProjectIndexLogger, message: string, error: unknown): void {
    const emitterName = resolveLoggerMethodName(logger, ["error", "log", "debug"]);
    if (!emitterName) {
        return;
    }

    // Extract a human-readable reason string from the error using the same
    // strategy as the rest of the project: prefer the error's own message,
    // fall back to string coercion, and fall back to an empty string.
    const reason = getErrorReason(error);
    const suffix = reason.length > 0 ? `: ${reason}` : "";

    invokeLoggerMethod(logger, emitterName, [message + suffix]);
}

function resolveLoggerMethodName(
    logger: ProjectIndexLogger,
    candidates: ReadonlyArray<"log" | "debug" | "error">
): "log" | "debug" | "error" | null {
    if (!logger) {
        return null;
    }

    for (const candidate of candidates) {
        if (typeof logger[candidate] === "function") {
            return candidate;
        }
    }

    return null;
}

function invokeLoggerMethod(
    logger: ProjectIndexLogger,
    methodName: "log" | "debug" | "error",
    args: ReadonlyArray<unknown>
): void {
    if (!logger) {
        return;
    }

    const emitter = logger[methodName];
    if (typeof emitter !== "function") {
        return;
    }

    emitter.call(logger, ...args);
}

/**
 * Extract a human-readable reason string from an error-like value.
 *
 * Mirrors the `getErrorMessage(error, { fallback: "" })` pattern used
 * throughout the project, returning the error's message property when
 * available, or an empty string when the error cannot be meaningfully
 * stringified.
 */
function getErrorReason(error: unknown): string {
    if (error && typeof error === "object" && "message" in error) {
        const msg = error.message;
        if (typeof msg === "string" && msg.length > 0) {
            return msg;
        }
    }
    if (typeof error === "string" && error.length > 0) {
        return error;
    }
    return "";
}
