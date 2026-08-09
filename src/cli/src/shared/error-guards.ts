import { Core } from "@gmloop/core";

/**
 * Type guard: true when `value` is a plain Record (non-null object that is not
 * an Array).  Useful for narrowing unknown JSON-deserialized payloads.
 *
 * Delegates to {@link Core.isPlainObject} so the runtime check matches the
 * shared predicate in `@gmloop/core` (typeof === "object", non-null, and not
 * an Array). The local type predicate narrows the result to
 * `Record<string, unknown>` for downstream property access, which is the same
 * shape historically produced by the bespoke implementation.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return Core.isPlainObject(value);
}

/**
 * Parse a JSON string and return the value on success, or `null` if the input
 * is not valid JSON or the result is not a plain object.
 *
 * Using this helper instead of bare `JSON.parse` in request handlers prevents
 * uncaught `SyntaxError` exceptions from escaping the HTTP response boundary
 * when a client sends malformed JSON or a non-object top-level value.
 */
export function tryParseJsonPayload(input: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(input);
        if (!isRecord(parsed)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export interface ErrorLikeDetails {
    name?: string;
    message?: string;
    stack?: string;
    cause?: unknown;
    code?: unknown;
    usage?: unknown;
}

export function asErrorLike(error: unknown): ErrorLikeDetails | null {
    if (!Core.isErrorLike(error) || !Core.isObjectLike(error)) {
        return null;
    }

    return error;
}

/**
 * Extract a human-readable message from any thrown value, falling back to a
 * non-empty placeholder when no message can be determined.
 *
 * Several call sites across the CLI used to repeat the ad-hoc idiom
 *
 * ```ts
 * const reason = error instanceof Error ? error.message : String(error);
 * ```
 *
 * which silently degrades for `null`/`undefined` (yielding the literal
 * strings `"null"`/`"undefined"`), loses type information on thrown objects
 * with non-primitive toString results, and can produce an empty string when
 * an `Error` has no message. Centralising the extraction through
 * {@link Core.getErrorMessageOrFallback} keeps CLI error reporting aligned
 * with the project-wide helper, ensures every caller produces a non-empty
 * string suitable for embedding in user-facing messages, and gives every
 * site the same fallback semantics for future evolution.
 *
 * @param error Value that may represent an error.
 * @returns A non-empty string describing the value.
 */
export function extractErrorMessage(error: unknown): string {
    return Core.getErrorMessageOrFallback(error);
}
