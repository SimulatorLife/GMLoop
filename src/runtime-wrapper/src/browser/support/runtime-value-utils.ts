type ErrorMessageFallback = string | ((error: unknown) => string);

/**
 * Determine whether {@link value} behaves like a plain object (i.e. a non-null
 * `typeof === "object"` value that is not an array). Capability probes below
 * use this guard so cross-realm collaborators — which cannot rely on
 * `instanceof` — are accepted when they expose the expected surface.
 */
function isObjectLike(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

/**
 * Capability probe that accepts any value exposing the standard Error surface.
 *
 * @remarks
 * `instanceof Error` fails for errors raised across iframe or worker
 * boundaries because each realm owns its own `Error` constructor. This probe
 * inspects the duck-typed `message` (and optional `name`) fields instead, so
 * the runtime wrapper treats a foreign-realm `Error` and a plain
 * `{ message, name }` object the same way as a native `Error`. The shape
 * mirrors `@gmloop/core`'s `Core.isErrorLike`; both probes must classify the
 * same samples (pinned by the `contract symmetry with Core probes` test).
 */
export function isErrorLike(value: unknown): value is Error {
    if (!isObjectLike(value)) {
        return false;
    }

    const candidate = value;
    if (typeof candidate.message !== "string") {
        return false;
    }

    const { name } = candidate;
    if (name !== undefined && name !== null && typeof name !== "string") {
        return false;
    }

    return true;
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
 * Capability probe for `ArrayBuffer`-shaped collaborators.
 *
 * @remarks
 * The previous implementation used `value instanceof ArrayBuffer`, which
 * fails for buffers that cross iframe or worker boundaries because each realm
 * owns its own `ArrayBuffer` constructor. The duck-typed check below accepts
 * any value exposing the standard surface (a numeric `byteLength` plus a
 * callable `slice`), so buffer-shaped collaborators and cross-realm buffers
 * are recognised uniformly. The shape mirrors `@gmloop/core`'s
 * `Core.isArrayBufferLike`; both probes must classify the same samples
 * (pinned by the `contract symmetry with Core probes` test).
 */
export function isArrayBufferLike(value: unknown): value is ArrayBuffer {
    if (!isObjectLike(value)) {
        return false;
    }

    const candidate = value;
    return typeof candidate.byteLength === "number" && typeof candidate.slice === "function";
}

/**
 * Capability probe for `ArrayBufferView`-shaped collaborators (typed arrays
 * and `DataView` instances).
 *
 * @remarks
 * `ArrayBuffer.isView(value)` inspects the internal `[[ViewedArrayBuffer]]`
 * slot, so it accepts cross-realm typed arrays but rejects duck-typed
 * substitutes such as `Proxy` wrappers or plain objects produced by browser
 * shims and test doubles — even when those substitutes expose the
 * documented view surface. The duck-typed check below inspects the public
 * shape (`buffer`, `byteOffset`, `byteLength`) so any collaborator exposing
 * the view contract is classified uniformly, regardless of realm, prototype
 * chain, or shim. Exposes the same surface as `@gmloop/core`'s
 * `Core.isArrayBufferViewLike` so the runtime wrapper and shared core
 * utility classify view-shaped collaborators consistently. Pinning this
 * symmetry is enforced by the `contract symmetry with Core probes` test in
 * `runtime-value-utils.test.ts`.
 */
export function isArrayBufferViewLike(value: unknown): value is ArrayBufferView {
    if (!isObjectLike(value)) {
        return false;
    }

    const candidate = value;
    return (
        isObjectLike(candidate.buffer) &&
        typeof candidate.byteOffset === "number" &&
        typeof candidate.byteLength === "number"
    );
}

/**
 * Capability probe for any binary payload (an `ArrayBuffer`, a typed-array
 * view, or a duck-typed substitute).
 *
 * @remarks
 * Replaces the previous `value instanceof ArrayBuffer || ArrayBuffer.isView(value)`
 * combination, which collapsed on cross-realm collaborators and on duck-typed
 * look-alikes produced by browser shims. The probe composes the
 * `isArrayBufferLike` and `isArrayBufferViewLike` duck-typed checks so that
 * any substitute exposing the standard surface is treated as binary payload.
 * The shape mirrors `@gmloop/core`'s `Core.isBinaryDataLike`; both probes must
 * classify the same samples (pinned by the `contract symmetry with Core
 * probes` test).
 */
export function isBinaryDataLike(value: unknown): value is ArrayBuffer | ArrayBufferView {
    return isArrayBufferLike(value) || isArrayBufferViewLike(value);
}

/**
 * Trim the oldest entries from {@link array} so its length does not exceed
 * {@link maxSize}.
 *
 * A non-positive {@link maxSize} is treated as unbounded (no trimming),
 * which mirrors the runtime wrapper's policy of treating `0` as "no cap" for
 * the undo stack and error history. The previous helper wrapped this decision
 * in an `evaluateUndoStackTrimPolicy` object that every caller immediately
 * spliced after inspecting; the direct mutation here removes that wrapper
 * without changing observable behaviour.
 */
export function trimArrayToMaxSize<T>(array: Array<T>, maxSize: number): void {
    if (maxSize <= 0 || array.length <= maxSize) {
        return;
    }

    array.splice(0, array.length - maxSize);
}
