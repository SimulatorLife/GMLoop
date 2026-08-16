import { isErrorLike } from "./capability-probes.js";
import { describeValueForError, isNonEmptyString } from "./string.js";

type ErrorMessageFallback = string | ((value: unknown) => string) | undefined;

type GetErrorMessageOptions = {
    fallback?: ErrorMessageFallback;
};

type GetErrorMessageOrFallbackOptions = {
    fallback?: unknown;
};

/**
 * Style for joining a context prefix with the original error's message when
 * constructing a new wrapped error. Call sites historically used two styles:
 *   - `colon`: `<context>: <message>` (e.g. "Transpilation failed: ENOENT")
 *   - `parentheses`: `<context>. (<message>)` (e.g. "Manual root '/x' is unavailable. (ENOENT)")
 */
type ContextualErrorWrap = "colon" | "parentheses";

interface ToContextualErrorOptions {
    /**
     * Name assigned to the returned error so consumers can distinguish
     * semantic categories (e.g. `"SyntaxError"`, `"AbortError"`). Defaults to
     * the standard `Error` name.
     */
    name?: string;

    /**
     * Separator style used between `context` and the original error message.
     * Defaults to `"colon"` because it is the most common style across the
     * codebase; callers that historically wrapped the message in parentheses
     * can opt into `"parentheses"`.
     */
    wrap?: ContextualErrorWrap;
}

const UNKNOWN_ERROR_FALLBACK = "Unknown error";

/**
 * Extract a string `code` property from an error-like value.
 *
 * Call sites frequently work with errors originating from Node.js, the CLI,
 * and third-party libraries where the `code` field is optional. Instead of
 * repeating the null checks and type guards, this helper centralizes the
 * logic and returns `null` when the code is missing or non-string. The
 * behaviour mirrors how the formatter already treats optional metadata: only
 * truthy, non-empty strings are considered actionable.
 *
 * @param {unknown} error Candidate error-like value.
 * @returns {string | null} Extracted error code, or `null` when unavailable.
 */
export function getErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object") {
        return null;
    }

    const { code } = error as { code?: unknown };
    if (!isNonEmptyString(code)) {
        return null;
    }

    return code;
}

/**
 * Determine whether an error exposes a specific `code` value.
 *
 * Node.js system errors (for example `EACCES`) and some parsing failures use a
 * `code` field to identify the failure category. This guard avoids leaking the
 * string comparison and truthiness checks into consumers by accepting a list
 * of codes and returning `true` only when the error matches one of them.
 *
 * @param {unknown} error Value to inspect for a matching code.
 * @param {...string} codes Allow-listed error codes to test against.
 * @returns {boolean} `true` when {@link error} carries one of {@link codes}.
 */
export function isErrorWithCode(error: unknown, ...codes: Array<string>): boolean {
    if (codes.length === 0) {
        return false;
    }

    const code = getErrorCode(error);
    if (code === null) {
        return false;
    }

    return codes.includes(code);
}

/**
 * Retrieve a human-readable message from an error-like value.
 *
 * Consumers frequently receive thrown values that are either strings or
 * `Error` instances with a `message` property. In some cases the message needs
 * to be synthesized—for example when a caller provides a fallback or when the
 * thrown value cannot be stringified (due to accessor errors). This helper
 * mirrors those semantics by accepting an optional fallback that can either be
 * a string or a thunk for lazy evaluation, and by guarding against thrown
 * errors from `String()` coercion. The function always yields a string so
 * surrounding logging and formatting logic can operate without additional
 * defensive branching.
 *
 * @param {unknown} error Value that may represent an error.
 * @param {{ fallback?: string | ((value: unknown) => string) }} [options]
 *        Optional fallback handling when the error lacks a usable message.
 * @returns {string} Normalized message string (possibly empty).
 */
export function getErrorMessage(error: unknown, { fallback }: GetErrorMessageOptions = {}): string {
    if (isErrorLike(error)) {
        return error.message;
    }

    if (typeof error === "string") {
        return error;
    }

    if (typeof fallback === "function") {
        return fallback(error);
    }

    if (fallback !== undefined) {
        return fallback;
    }

    if (error == null) {
        return "";
    }

    try {
        return describeValueForError(error);
    } catch {
        return "";
    }
}

/**
 * Retrieve an error message that always resolves to a non-empty string.
 *
 * Several CLI commands previously duplicated the pattern
 * `getErrorMessage(error, { fallback: "" }) || "Unknown error"` to ensure a
 * readable fallback. This helper centralizes that behaviour while tolerating
 * non-string fallbacks, mirroring how other shared utilities normalize input.
 *
 * @param {unknown} error Value that may represent an error.
 * @param {{ fallback?: unknown }} [options]
 * @returns {string} Guaranteed non-empty error message string.
 */
export function getErrorMessageOrFallback(error: unknown, { fallback }: GetErrorMessageOrFallbackOptions = {}): string {
    const message = getErrorMessage(error, { fallback: "" });

    if (isNonEmptyString(message)) {
        return message;
    }

    if (isNonEmptyString(fallback)) {
        return fallback;
    }

    if (fallback == null) {
        return UNKNOWN_ERROR_FALLBACK;
    }

    const normalized = describeValueForError(fallback);
    return normalized.length > 0 ? normalized : UNKNOWN_ERROR_FALLBACK;
}

/**
 * Format a type validation error message with a standardized structure.
 *
 * Consolidates the repeated pattern of formatting "must be provided as <expected>
 * (received type '<actual>')" error messages that appear across validation
 * helpers in enumerated-options.ts and numeric-options.ts. Centralizes both the
 * message structure and the logic for determining the actual type so call sites
 * can focus on their specific validation rules without duplicating formatting
 * logic.
 *
 * @param {string} expectedType The type that was expected (e.g., "string", "number", "an array").
 * @param {unknown} receivedValue The actual value that was received.
 * @param {{ label?: string }} [options] Optional configuration.
 * @param {string} [options.label="Value"] Label to use in the error message (e.g., "Output format").
 * @returns {string} Formatted error message.
 *
 * @example
 * formatTypeValidationError("string", 42);
 * // => "Value must be provided as a string (received type 'number')."
 *
 * @example
 * formatTypeValidationError("number", "text", { label: "Port" });
 * // => "Port must be provided as a number (received type 'string')."
 */
export function formatTypeValidationError(
    expectedType: string,
    receivedValue: unknown,
    { label = "Value" }: { label?: string } = {}
): string {
    const receivedType = typeof receivedValue;
    return `${label} must be provided as ${expectedType} (received type '${receivedType}').`;
}

/**
 * Wrap an unknown thrown value with a contextual message while preserving it
 * as the new error's `cause`.
 *
 * Several call sites across the project repeat the same five-line idiom:
 *
 * ```ts
 * try {
 *     // ...
 * } catch (error) {
 *     const message = getErrorMessageOrFallback(error);
 *     throw new Error(`Failed to X: ${message}`, { cause: error });
 * }
 * ```
 *
 * This helper centralises that idiom so the wrapper construction, the
 * fallback message extraction, and the cause preservation are all handled in
 * one place. The returned `Error` always:
 *   - carries a non-empty message (`context` joined with the cause's message
 *     via the chosen {@link ToContextualErrorOptions.wrap} style)
 *   - preserves the original value as `cause` for downstream diagnostics and
 *     structured logging
 *   - uses `Error` as the constructor so the returned value is always a real
 *     `Error` instance regardless of what was originally thrown
 *
 * Callers that previously mutated the resulting error further (for example to
 * attach extra metadata) can do so on the returned value before throwing it.
 *
 * @param {string} context Short human-readable prefix describing where the
 *   error originated. Should not include a trailing separator.
 * @param {unknown} cause Value that was caught; preserved as `cause` on the
 *   returned error.
 * @param {ToContextualErrorOptions} [options] Optional wrapper configuration.
 * @param {string} [options.name="Error"] Name assigned to the returned error.
 * @param {"colon" | "parentheses"} [options.wrap="colon"] Separator style.
 * @returns {Error} Newly constructed error ready to throw.
 *
 * @example
 * try {
 *     await fs.readFile(path, "utf8");
 * } catch (error) {
 *     throw toContextualError(`Failed to read ${path}`, error);
 * }
 */
export function toContextualError(
    context: string,
    cause: unknown,
    { name = "Error", wrap = "colon" }: ToContextualErrorOptions = {}
): Error {
    const causeMessage = getErrorMessageOrFallback(cause);
    const message = wrap === "parentheses" ? `${context}. (${causeMessage})` : `${context}: ${causeMessage}`;

    const error = new Error(message);
    error.name = name;
    error.cause = cause;
    return error;
}

/**
 * Retrieve the most diagnostic-friendly string available for an error-like
 * value: its stack trace when present, otherwise its message.
 *
 * Top-level CLI entry points want a full stack trace when one is available
 * (it locates the failure precisely) but must still degrade gracefully for
 * non-`Error` thrown values, which have no `stack`. This mirrors
 * {@link getErrorMessage}'s tolerance for arbitrary thrown values while
 * preferring the richer `stack` field when the error exposes one.
 *
 * @param {unknown} error Value that may represent an error.
 * @returns {string} Stack trace when available, otherwise the error message.
 */
export function getErrorStackOrMessage(error: unknown): string {
    if (isErrorLike(error) && isNonEmptyString(error.stack)) {
        return error.stack;
    }

    return getErrorMessage(error);
}
