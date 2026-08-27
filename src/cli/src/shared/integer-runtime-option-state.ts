import { Core } from "@gmloop/core";

import { createIntegerEnvConfiguredValue } from "./env-configured-integer.js";

const { createNumericTypeErrorFormatter, describeValueForError, resolveIntegerOption } = Core;

interface IntegerRuntimeOptionStateParams {
    defaultValue: number;
    envVar: string;
    optionLabel: string;
    createValueErrorMessage: (receivedDescription: string) => string;
    coerceInteger: (value: unknown, context?: Record<string, unknown>) => number | null | undefined;
}

interface IntegerRuntimeOptionResolveOptions {
    defaultValue?: number;
    defaultOverride?: number;
}

interface IntegerRuntimeOptionState {
    get: () => number | undefined;
    set: (value?: unknown) => number | undefined;
    resolve: (rawValue?: unknown, options?: IntegerRuntimeOptionResolveOptions) => number | null | undefined;
    applyEnvOverride: (env?: NodeJS.ProcessEnv) => number | undefined;
}

/**
 * Creates an env-backed integer option state with shared coercion and resolver wiring.
 *
 * Multiple CLI options share the same state machine structure: normalize values,
 * expose mutable defaults, and optionally resolve a domain-specific fallback
 * alias through `defaultOverride`.
 *
 * @param params Integer option descriptor and coercion strategy.
 * @returns Accessors for reading, mutating, resolving, and applying env overrides.
 */
export function createIntegerRuntimeOptionState(params: IntegerRuntimeOptionStateParams): IntegerRuntimeOptionState {
    const { defaultValue, envVar, optionLabel, createValueErrorMessage, coerceInteger } = params;

    const coerce = (value: unknown, context = {}) => {
        const opts = {
            ...context,
            createErrorMessage: () => createValueErrorMessage(describeValueForError(value))
        };
        return coerceInteger(value, opts);
    };

    const typeErrorMessage = createNumericTypeErrorFormatter(optionLabel);

    const state = createIntegerEnvConfiguredValue({
        defaultValue,
        envVar,
        coerce,
        typeErrorMessage
    });

    const resolve = (rawValue?: unknown, options: IntegerRuntimeOptionResolveOptions = {}) => {
        const fallback = options.defaultOverride ?? options.defaultValue ?? state.get();

        return resolveIntegerOption(rawValue, {
            defaultValue: fallback,
            coerce,
            typeErrorMessage,
            blankStringReturnsDefault: true
        });
    };

    return {
        get: state.get,
        set: state.set,
        resolve,
        applyEnvOverride: state.applyEnvOverride
    };
}
