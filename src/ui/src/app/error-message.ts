/**
 * Return a stable user-facing error message for UI-owned async failures.
 *
 * Uses a browser-safe capability probe rather than importing `@gmloop/core`.
 * The public Core namespace includes Node-owned filesystem helpers, so pulling
 * it into the web bundle forces Vite to externalize `node:fs` and prevents the
 * app from rendering in the browser.
 *
 * The returned message is trimmed so whitespace-only values fall back to the
 * caller-supplied UI message rather than being surfaced verbatim.
 *
 * @param {unknown} error Value that may represent a thrown error.
 * @param {string} fallback Caller-specific message to surface when {@link error}
 *        does not expose a usable string.
 * @returns {string} Normalized, non-blank error message.
 */
export function getUiErrorMessage(error: unknown, fallback: string): string {
    const message = readUiErrorMessage(error, fallback);
    const trimmed = message.trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

function readUiErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === "string") {
        return error;
    }

    if (isErrorWithStringMessage(error)) {
        return error.message;
    }

    return fallback;
}

function isErrorWithStringMessage(error: unknown): error is Readonly<{ message: string }> {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
}
