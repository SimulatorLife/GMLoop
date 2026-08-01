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

/**
 * Return an actionable message when a browser request cannot reach its
 * endpoint, while preserving ordinary server and application errors.
 *
 * Browser implementations use several equivalent messages for a rejected
 * fetch request (for example, `Failed to fetch`, `Load failed`, or
 * `NetworkError when attempting to fetch resource.`). These failures do not
 * include the server's response body, so the endpoint context is more useful
 * to a user than the browser's implementation-specific message.
 *
 * @param {unknown} error Value caught from a browser request.
 * @param {string} endpointDescription User-facing description of the endpoint
 *        that could not be reached.
 * @param {string} fallback Caller-specific message for non-network failures
 *        that do not expose a usable error message.
 * @returns {string} Actionable network message or the normalized original
 *        error message.
 */
export function getUiNetworkErrorMessage(error: unknown, endpointDescription: string, fallback: string): string {
    if (isUiNetworkError(error)) {
        return `Unable to reach ${endpointDescription}. Check that the server is running and try again.`;
    }

    return getUiErrorMessage(error, fallback);
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

function isUiNetworkError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("name" in error)) {
        return false;
    }

    const name = error.name;
    if (typeof name !== "string" || name !== "TypeError") {
        return false;
    }

    const message = readUiErrorMessage(error, "").trim().toLowerCase();
    return (
        message === "failed to fetch" ||
        message === "fetch failed" ||
        message === "load failed" ||
        message === "network request failed" ||
        message === "networkerror" ||
        message === "networkerror when attempting to fetch resource."
    );
}
