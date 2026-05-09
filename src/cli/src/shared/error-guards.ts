import { Core } from "@gmloop/core";

/**
 * Type guard: true when `value` is a plain Record (non-null object that is not
 * an Array).  Useful for narrowing unknown JSON-deserialized payloads.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse a JSON string and return the value on success, or `null` if the input
 * is not valid JSON or the result is not a plain object.
 *
 * An empty input string is treated as equivalent to an empty object `{}`,
 * preserving backward-compatible behaviour where callers that sent no body
 * would receive an empty object from `JSON.parse('')`.
 *
 * Using this helper instead of bare `JSON.parse` in request handlers prevents
 * uncaught `SyntaxError` exceptions from escaping the HTTP response boundary
 * when a client sends malformed JSON or a non-object top-level value.
 */
export function tryParseJsonPayload(input: string): Record<string, unknown> | null {
    if (input.length === 0) {
        return Object.freeze({});
    }
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

export interface ErrorWithCodeDetails<TCode> extends ErrorLikeDetails {
    code: TCode;
}

export function asErrorLike(error: unknown): ErrorLikeDetails | null {
    if (!Core.isErrorLike(error) || !Core.isObjectLike(error)) {
        return null;
    }

    return error as ErrorLikeDetails;
}

export function asErrorWithCode<TCode extends string>(
    error: unknown,
    code?: TCode
): ErrorWithCodeDetails<TCode> | null {
    if (!Core.isErrorWithCode(error, code) || !Core.isObjectLike(error)) {
        return null;
    }

    return error as ErrorWithCodeDetails<TCode>;
}
