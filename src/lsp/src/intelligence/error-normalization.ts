import { Core } from "@gmloop/core";

/**
 * Structured representation of an error that can be safely ferried across
 * worker boundaries and consumed by downstream collaborators without further
 * type discrimination.
 *
 * Worker threads in Node.js run in their own realm, so a value that is
 * `instanceof Error` in the worker thread may not be `instanceof Error` after
 * it has been cloned into the parent thread, and conversely an `Error`
 * posted via `parentPort.postMessage` arrives in the parent thread without
 * preserving its prototype chain. The worker-side `normalizeWorkerErrorPayload`
 * helper therefore extracts the contract fields (`message`, `name`, `stack`)
 * instead of relying on `instanceof Error`, so any collaborator — a real
 * `Error` instance, a cross-realm error facade, or a plain object with the
 * error shape — round-trips into the same payload structure.
 */
export interface WorkerErrorPayload {
    /**
     * Human-readable description of the failure. Always non-empty; consumers
     * never need to substitute a fallback when the worker reported any
     * error-like input.
     */
    readonly message: string;
    /**
     * Class or category of the error (e.g. `"Error"`, `"TypeError"`). When
     * the source value did not expose a string `name`, this field falls back
     * to `"Error"` so consumers can rely on a uniform discriminator.
     */
    readonly name: string;
    /**
     * Optional stack trace captured at the failure site. `undefined` when
     * the source value did not expose a string `stack` — that absence is
     * intentionally preserved instead of coerced, because synthesizing a
     * stack would mislead downstream diagnostics.
     */
    readonly stack: string | undefined;
}

/**
 * Read a structured field from an error-like object while tolerating values
 * from any realm or constructor chain. Centralising the property access keeps
 * {@link normalizeWorkerErrorPayload} from branching on `instanceof` and lets
 * it treat real `Error` instances, cross-realm error facades, and plain
 * objects carrying the contract identically.
 *
 * @param error - Candidate error-like value to inspect.
 * @param property - Property name to read.
 * @returns The property's value when it is a string, otherwise `undefined`.
 */
function readStringField(error: unknown, property: "message" | "name" | "stack"): string | undefined {
    if (!Core.isObjectLike(error)) {
        return undefined;
    }

    const value = (error as Record<string, unknown>)[property];
    return typeof value === "string" ? value : undefined;
}

/**
 * Normalize an unknown thrown value into the shared {@link WorkerErrorPayload}
 * contract.
 *
 * Use this helper anywhere the worker thread needs to publish an error to its
 * parent thread (or any other collaborator that consumes structured data
 * instead of live `Error` instances). The function accepts:
 *
 *   - native `Error` subclasses and plain `Error` instances
 *   - cross-realm error facades that expose `{ message, name, stack }` without
 *     sharing a prototype chain with the current realm's `Error`
 *   - plain objects carrying only `message` (or `message` + `name`)
 *   - non-object throw values (strings, numbers, `undefined`, `null`)
 *
 * In every case the helper returns the same structured payload shape, so
 * downstream code never has to branch on the error's constructor or realm.
 *
 * @param error - Unknown value caught from a worker callback or thrown branch.
 * @returns Structured payload describing the error.
 */
export function normalizeWorkerErrorPayload(error: unknown): WorkerErrorPayload {
    const message = readStringField(error, "message") ?? Core.getErrorMessageOrFallback(error);
    const name = readStringField(error, "name") ?? "Error";
    const stack = readStringField(error, "stack");

    return { message, name, stack };
}

/**
 * Coerce an arbitrary thrown value into an `Error` instance.
 *
 * Values that already satisfy the error-like contract — real `Error`
 * instances, cross-realm error facades, and plain objects carrying
 * `{ message }` — are forwarded unchanged so the caller preserves the
 * original stack trace, `cause` chain, and any custom properties the
 * collaborator attached. Plain values (strings, numbers, `undefined`,
 * `null`, objects without a `message`) are wrapped in a fresh `Error` whose
 * message falls back to {@link Core.getErrorMessageOrFallback}.
 *
 * This helper exists so the LSP layer can defensively handle any value the
 * worker thread (or any other collaborator) might surface without relying
 * on `instanceof Error`, which is unreliable across realms and worker
 * boundaries.
 *
 * @param error - Unknown value caught from a worker callback or thrown branch.
 * @returns Error instance that downstream consumers can rely on uniformly.
 */
export function coerceToError(error: unknown): Error {
    if (Core.isErrorLike(error)) {
        return error;
    }

    return new Error(Core.getErrorMessageOrFallback(error));
}
