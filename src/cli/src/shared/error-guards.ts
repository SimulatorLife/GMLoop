import { Core } from "@gmloop/core";

/**
 * Type guard: true when `value` is a plain Record (non-null object that is not
 * an Array).  Useful for narrowing unknown JSON-deserialized payloads.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
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
