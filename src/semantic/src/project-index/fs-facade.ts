import { Core, type FsFacade } from "@gmloop/core";

export type ProjectIndexFsFacade = FsFacade;

export const defaultFsFacade: Required<FsFacade> = Core.defaultFsFacade as Required<FsFacade>;

/**
 * Run an async filesystem operation and recover only from missing-path errors
 * (`ENOENT`). All non-missing-path failures are rethrown so callers preserve
 * existing error semantics while keeping ENOENT fallback handling centralized.
 */
export async function runWithMissingPathFallback<TResult>(
    operation: () => Promise<TResult>,
    onMissingPath: () => TResult
): Promise<TResult> {
    try {
        return await operation();
    } catch (error) {
        if (!Core.isErrorWithCode(error, "ENOENT")) {
            throw error;
        }

        return onMissingPath();
    }
}
