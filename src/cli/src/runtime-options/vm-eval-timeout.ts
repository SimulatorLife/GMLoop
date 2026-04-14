import { Core } from "@gmloop/core";

import { createIntegerRuntimeOptionState } from "../shared/integer-runtime-option-state.js";

const { callWithFallback, coerceNonNegativeInteger } = Core;

export const DEFAULT_VM_EVAL_TIMEOUT_MS = 5000;
export const VM_EVAL_TIMEOUT_ENV_VAR = "GML_VM_EVAL_TIMEOUT_MS";

const runtimeOptionState = createIntegerRuntimeOptionState({
    defaultValue: DEFAULT_VM_EVAL_TIMEOUT_MS,
    envVar: VM_EVAL_TIMEOUT_ENV_VAR,
    optionLabel: "VM evaluation timeout",
    createValueErrorMessage: (receivedDescription) =>
        `VM evaluation timeout must be a non-negative integer (received ${receivedDescription}). Provide 0 to disable the timeout.`,
    coerceInteger: coerceNonNegativeInteger
});

function getDefaultVmEvalTimeoutMs(): number | undefined {
    return runtimeOptionState.get();
}

function setDefaultVmEvalTimeoutMs(value?: unknown): number | undefined {
    return runtimeOptionState.set(value);
}

function resolveVmEvalTimeout(
    rawValue?: unknown,
    options: Record<string, unknown> & {
        defaultValue?: number;
        defaultTimeout?: number;
    } = {}
): number | undefined {
    return (
        runtimeOptionState.resolve(rawValue, {
            defaultValue: options.defaultValue,
            defaultOverride: options.defaultTimeout
        }) ?? undefined
    );
}

function applyVmEvalTimeoutEnvOverride(env?: NodeJS.ProcessEnv): number | undefined {
    return callWithFallback(() => runtimeOptionState.applyEnvOverride(env), {
        fallback: () => getDefaultVmEvalTimeoutMs()
    });
}

applyVmEvalTimeoutEnvOverride();

export { applyVmEvalTimeoutEnvOverride, getDefaultVmEvalTimeoutMs, resolveVmEvalTimeout, setDefaultVmEvalTimeoutMs };
