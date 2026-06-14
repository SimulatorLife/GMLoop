import { Core } from "@gmloop/core";

/**
 * Return a stable user-facing error message for UI-owned async failures.
 *
 * Delegates the message-extraction step to
 * {@link Core.getErrorMessageOrFallback} so the UI benefits from the same
 * cross-realm-safe capability probe (`Core.isErrorLike`) used throughout the
 * rest of the codebase. Cross-realm errors — for example those raised by
 * `postMessage` boundaries, web workers, or third-party iframe content — do
 * not satisfy `instanceof Error` and were previously rendered as `String(error)`
 * or `[object Object]`. Routing through the Core helper normalizes those
 * shapes without forcing each call site to repeat the guard.
 *
 * The returned message is then trimmed so whitespace-only values
 * (e.g. `throw new Error("   ")`) fall back to the caller-supplied UI message
 * rather than being surfaced verbatim to the user. This keeps the
 * "non-blank or fallback" contract the rest of the UI components rely on.
 *
 * @param {unknown} error Value that may represent a thrown error.
 * @param {string} fallback Caller-specific message to surface when {@link error}
 *        does not expose a usable string.
 * @returns {string} Normalized, non-blank error message.
 */
export function getUiErrorMessage(error: unknown, fallback: string): string {
    const message = Core.getErrorMessageOrFallback(error, { fallback });
    const trimmed = message.trim();
    return trimmed.length > 0 ? trimmed : fallback;
}
