type ErrorMessageFallback = string | ((error: unknown) => string);

/**
 * Returns true when a value behaves like an Error instance.
 */
export function isErrorLike(value: unknown): value is Error {
    return Boolean(value) && typeof value === "object" && typeof (value as { message?: unknown }).message === "string";
}

/**
 * Converts an unknown thrown value into a displayable error message.
 */
export function getErrorMessage(error: unknown, options: Readonly<{ fallback?: ErrorMessageFallback }> = {}): string {
    if (isErrorLike(error)) {
        return error.message;
    }

    if (typeof error === "string") {
        return error;
    }

    const fallback = options.fallback ?? "Unknown error";
    return typeof fallback === "function" ? fallback(error) : fallback;
}

/**
 * Creates shallow clones for object entries while preserving primitive entries.
 */
export function cloneObjectEntries<T>(entries: ReadonlyArray<T>): Array<T> {
    return entries.map((entry) => {
        if (!entry || typeof entry !== "object") {
            return entry;
        }

        return { ...entry };
    });
}

/**
 * Reads GameMaker's `_cx._dx` instance store from a browser global object.
 */
export function readCxcDxStore(globalScope: Record<string, unknown>): Record<string, unknown> | undefined {
    const cx = globalScope._cx;
    if (!cx || typeof cx !== "object") {
        return undefined;
    }

    const dx = (cx as { _dx?: unknown })._dx;
    return dx && typeof dx === "object" ? (dx as Record<string, unknown>) : undefined;
}

/**
 * Reads GameMaker's active room object pool from a browser global object.
 */
export function readRuntimeObjectPool(globalScope: Record<string, unknown>): Array<unknown> | undefined {
    const runRoom = globalScope.g_RunRoom;
    if (!runRoom || typeof runRoom !== "object") {
        return undefined;
    }

    const active = (runRoom as { m_Active?: unknown }).m_Active;
    if (!active || typeof active !== "object") {
        return undefined;
    }

    const pool = (active as { pool?: unknown }).pool;
    return Array.isArray(pool) ? pool : undefined;
}

/**
 * Returns true when a value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

/**
 * Returns true when a value is an array with at least one entry.
 */
export function isNonEmptyArray(value: unknown): value is ReadonlyArray<unknown> {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Compares two finite numbers with a small tolerance for floating-point drift.
 */
export function areNumbersApproximatelyEqual(left: number, right: number): boolean {
    return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

/**
 * Wraps a single value in an array and returns arrays unchanged.
 */
export function toArray(value: unknown): ReadonlyArray<unknown> {
    return Array.isArray(value) ? value : [value];
}

/**
 * Parses JSON and annotates syntax errors with source context.
 */
export function parseJsonWithContext(
    text: string,
    context: Readonly<{ description: string; source?: string }>
): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        const source = context.source ? ` from ${context.source}` : "";
        const message = getErrorMessage(error);
        throw new SyntaxError(`Failed to parse ${context.description}${source}: ${message}`, { cause: error });
    }
}

/**
 * Returns true for ArrayBuffer instances without matching typed-array views.
 */
export function isArrayBufferLike(value: unknown): value is ArrayBuffer {
    return value instanceof ArrayBuffer;
}

/**
 * Returns true for ArrayBuffer instances and typed-array/DataView payloads.
 */
export function isBinaryDataLike(value: unknown): value is ArrayBuffer | ArrayBufferView {
    return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
