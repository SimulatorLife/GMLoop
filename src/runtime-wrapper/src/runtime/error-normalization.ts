import { Core } from "@gmloop/core";

/**
 * Default fallback message used when an unknown runtime error cannot be
 * reduced to a specific string message.
 */
export const DEFAULT_RUNTIME_ERROR_MESSAGE = "Unknown error";

/**
 * Resolves a stable runtime error message from unknown thrown values.
 *
 * This helper centralizes error normalization so runtime and websocket layers
 * produce consistent diagnostics for non-Error throw values.
 */
export function resolveRuntimeErrorMessage(error: unknown, fallback = DEFAULT_RUNTIME_ERROR_MESSAGE): string {
    return Core.getErrorMessage(error, {
        fallback: (fallbackCandidate) => resolveRuntimeErrorFallbackMessage(fallbackCandidate, fallback)
    });
}

/**
 * Resolves fallback text for unknown thrown values that are not normal Error
 * instances.
 */
export function resolveRuntimeErrorFallbackMessage(error: unknown, fallback: string): string {
    if (error === null || error === undefined) {
        return fallback;
    }

    if (typeof error === "number" || typeof error === "boolean") {
        return String(error);
    }

    return "Non-Error object thrown";
}
