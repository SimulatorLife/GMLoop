import { Core } from "@gmloop/core";

import { createIntegerEnvConfiguredValue } from "../shared/env-configured-integer.js";

const {
    callWithFallback,
    coerceNonNegativeInteger,
    createNumericTypeErrorFormatter,
    describeValueForError,
    resolveIntegerOption
} = Core;

export const DEFAULT_VM_EVAL_TIMEOUT_MS = 5000;
export const VM_EVAL_TIMEOUT_ENV_VAR = "GML_VM_EVAL_TIMEOUT_MS";

const createTimeoutErrorMessage = (received: unknown) =>
    `VM evaluation timeout must be a non-negative integer (received ${describeValueForError(
        received
    )}). Provide 0 to disable the timeout.`;

const createTimeoutTypeErrorMessage = createNumericTypeErrorFormatter("VM evaluation timeout");

const coerce = (value: unknown, context = {}) => {
    const opts = { ...context, createErrorMessage: createTimeoutErrorMessage };
    return coerceNonNegativeInteger(value, opts);
};

const state = createIntegerEnvConfiguredValue({
    defaultValue: DEFAULT_VM_EVAL_TIMEOUT_MS,
    envVar: VM_EVAL_TIMEOUT_ENV_VAR,
    coerce,
    typeErrorMessage: createTimeoutTypeErrorMessage
});

function getDefaultVmEvalTimeoutMs(): number | undefined {
    return state.get();
}

function setDefaultVmEvalTimeoutMs(value?: unknown): number | undefined {
    return state.set(value);
}

function resolveVmEvalTimeout(
    rawValue?: unknown,
    options: Record<string, unknown> & {
        defaultValue?: number;
        defaultTimeout?: number;
    } = {}
): number | undefined {
    const fallback = options.defaultTimeout ?? options.defaultValue ?? state.get();
    return resolveIntegerOption(rawValue, {
        defaultValue: fallback,
        coerce,
        typeErrorMessage: createTimeoutTypeErrorMessage,
        blankStringReturnsDefault: true
    });
}

function applyVmEvalTimeoutEnvOverride(env?: NodeJS.ProcessEnv): number | undefined {
    return callWithFallback(() => state.applyEnvOverride(env), {
        fallback: () => getDefaultVmEvalTimeoutMs()
    });
}

applyVmEvalTimeoutEnvOverride();

export { applyVmEvalTimeoutEnvOverride, getDefaultVmEvalTimeoutMs, resolveVmEvalTimeout, setDefaultVmEvalTimeoutMs };
