/**
 * Flexible logger interface for project index operations.
 * Accepts loggers that expose `.log`, `.debug`, or both (e.g. `console`).
 */
export type ProjectIndexLogger = {
    log?: (...args: Array<unknown>) => void;
    debug?: (...args: Array<unknown>) => void;
} | null;

/**
 * Emits a debug-level message through the given logger, preferring `.log`
 * (which reliably goes to stdout) and falling back to `.debug` when `.log`
 * is unavailable.
 */
export function logProjectIndexDebug(logger: ProjectIndexLogger, message: string, payload?: unknown): void {
    if (!logger) {
        return;
    }

    const emitter =
        typeof logger.log === "function" ? logger.log : typeof logger.debug === "function" ? logger.debug : null;

    if (!emitter) {
        return;
    }

    if (payload === undefined) {
        emitter(message);
        return;
    }

    emitter(message, payload);
}
