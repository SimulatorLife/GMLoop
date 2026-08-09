import { Core } from "@gmloop/core";

import { resolveIntegerOption } from "./numeric-options.js";

const { createEnvConfiguredValue } = Core;

interface IntegerEnvConfiguredValueOptions {
    defaultValue: number;
    envVar: string;
    coerce: (value: unknown, context?: Record<string, unknown>) => number | null | undefined;
    typeErrorMessage: (type: string) => string;
}

/**
 * Build an environment-backed integer state container with consistent normalization.
 *
 * The returned state resolves CLI/config/env values through a shared integer parsing
 * strategy so callers can avoid repeating the same `createEnvConfiguredValue` boilerplate.
 * Blank string values are treated as "use default" to align with existing CLI behavior.
 *
 * @param options Integer parsing and environment binding options.
 * @returns Env-configured state for an optional integer value.
 */
export function createIntegerEnvConfiguredValue({
    defaultValue,
    envVar,
    coerce,
    typeErrorMessage
}: IntegerEnvConfiguredValueOptions) {
    return createEnvConfiguredValue<number | undefined>({
        defaultValue,
        envVar,
        normalize: (value, { defaultValue: baseline, previousValue }) => {
            return resolveIntegerOption(value, {
                defaultValue: baseline ?? previousValue,
                coerce,
                typeErrorMessage,
                blankStringReturnsDefault: true
            });
        }
    });
}
