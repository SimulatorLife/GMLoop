import { Core } from "@gmloop/core";

import { createIntegerEnvConfiguredValue } from "./env-configured-integer.js";

const { callWithFallback, coercePositiveInteger, createNumericTypeErrorFormatter, describeValueForError } = Core;

/**
 * Default V8 old-space heap size, in megabytes, granted to the `refactor
 * codemod` subprocess spawned by `fix` and `graph visualize`.
 *
 * Codemod runs build a full project semantic index in-process, which can
 * exceed Node's default heap on large GameMaker projects; the elevated
 * default avoids out-of-memory failures on typical large projects.
 */
export const DEFAULT_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB = 16_384;

/**
 * Environment variable that overrides the refactor-subprocess heap size, in
 * megabytes. Lets memory-constrained environments (for example CI runners)
 * lower the default, or callers with very large projects raise it further.
 */
export const REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB_ENV_VAR =
    "PRETTIER_PLUGIN_GML_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB";

const subjectLabel = "Refactor subprocess max old space size (MB)";

const maxOldSpaceSizeMb = createIntegerEnvConfiguredValue({
    defaultValue: DEFAULT_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB,
    envVar: REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB_ENV_VAR,
    coerce: (value, context = {}) =>
        coercePositiveInteger(value, {
            ...context,
            createErrorMessage: (received: unknown) =>
                `${subjectLabel} must be a positive integer (received ${describeValueForError(received)}).`
        }),
    typeErrorMessage: createNumericTypeErrorFormatter(subjectLabel)
});

/**
 * Resolve the configured refactor-subprocess heap size, applying an
 * environment override when {@link REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB_ENV_VAR}
 * is set. An invalid override value falls back to the default rather than
 * throwing, matching the tolerant behavior of the other env-configured CLI
 * options in this workspace.
 *
 * @param env Environment map to read the override from; defaults to `process.env`.
 * @returns The heap size, in megabytes, to pass to `--max-old-space-size`.
 */
export function getRefactorSubprocessMaxOldSpaceSizeMb(env?: NodeJS.ProcessEnv): number {
    return callWithFallback(
        () => maxOldSpaceSizeMb.applyEnvOverride(env) ?? DEFAULT_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB,
        { fallback: () => DEFAULT_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB }
    );
}

/**
 * Build the `--max-old-space-size` Node CLI flag for the refactor subprocess,
 * using the configured (and possibly environment-overridden) heap size.
 *
 * @param env Environment map to read the override from; defaults to `process.env`.
 */
export function createRefactorSubprocessMaxOldSpaceSizeArg(env?: NodeJS.ProcessEnv): string {
    return `--max-old-space-size=${getRefactorSubprocessMaxOldSpaceSizeMb(env)}`;
}
