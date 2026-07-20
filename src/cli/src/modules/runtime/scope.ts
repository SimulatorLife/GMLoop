import { Core } from "@gmloop/core";

const { createEnumeratedOptionHelpers } = Core;

/**
 * Canonical `--scope` values accepted by the `runtime get` and `runtime set`
 * subcommands.
 *
 * Exposing these values as a frozen object (instead of inlining the strings in
 * the option type, the runtime branch, and any future tests) makes the valid
 * set easy to enumerate, share, and evolve without touching every call site
 * that compares against the canonical values.
 */
export const RUNTIME_SCOPES = Object.freeze({
    global: "global",
    instance: "instance"
} as const);

/**
 * Union type covering every valid `runtime` `--scope` value.
 */
export type RuntimeScope = (typeof RUNTIME_SCOPES)[keyof typeof RUNTIME_SCOPES];

/**
 * Default value used when the `runtime get` / `runtime set` `--scope` option
 * is not supplied on the command line.
 */
export const DEFAULT_RUNTIME_SCOPE: RuntimeScope = RUNTIME_SCOPES.instance;

/**
 * Helpers for normalizing and validating `--scope` values. Reuses the shared
 * {@link createEnumeratedOptionHelpers} factory so the valid set, error
 * formatting, and string-type guard stay in lockstep with the rest of the
 * CLI's enumerated options.
 */
const runtimeScopeOptionHelpers = createEnumeratedOptionHelpers(Object.values(RUNTIME_SCOPES), {
    formatError: (list, received) => `Invalid --scope value: ${received}. Allowed values: ${list}.`,
    enforceStringType: true,
    valueLabel: "--scope"
});

/**
 * Coerce an arbitrary CLI-supplied value into a {@link RuntimeScope}.
 *
 * Trims surrounding whitespace and rejects non-string inputs with a
 * `TypeError`. Throws a descriptive `Error` when the trimmed value does not
 * match one of the canonical scope values. The CLI layer wraps this function
 * with `wrapInvalidArgumentResolver` so the resulting error becomes a
 * Commander `InvalidArgumentError`, while tests and any other consumers can
 * invoke the raw function directly.
 *
 * @param value Raw value supplied by Commander (or a test).
 * @returns The canonical scope string.
 */
export function coerceRuntimeScope(value: unknown): RuntimeScope {
    return runtimeScopeOptionHelpers.requireValue(value) as RuntimeScope;
}

/**
 * Coerce a value into a {@link RuntimeScope}, falling back to
 * {@link DEFAULT_RUNTIME_SCOPE} when the value is omitted or invalid.
 *
 * Use this helper only in non-strict contexts where the caller already
 * promises to render the value back to the user (e.g. payload echo). Strict
 * paths (such as CLI parsing) should use {@link coerceRuntimeScope} instead
 * so invalid input fails fast.
 *
 * @param value Raw value supplied by the caller.
 * @returns A canonical {@link RuntimeScope}.
 */
export function coerceRuntimeScopeWithDefault(value: unknown): RuntimeScope {
    const normalized = runtimeScopeOptionHelpers.normalize(value, DEFAULT_RUNTIME_SCOPE);
    return (normalized ?? DEFAULT_RUNTIME_SCOPE) as RuntimeScope;
}
