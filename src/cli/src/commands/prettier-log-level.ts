import { Core } from "@gmloop/core";

/**
 * Canonical set of Prettier log levels accepted by the gmloop CLI.
 *
 * The values intentionally mirror Prettier's own log-level vocabulary
 * (`debug`, `info`, `warn`, `error`, `silent`). Centralising the values in
 * a frozen enum object lets call sites branch on named constants instead of
 * repeating raw string literals, and lets the matching enumerated-option
 * helper reject out-of-range values before they reach Prettier's
 * configuration object.
 */
export const PrettierLogLevel = Object.freeze({
    DEBUG: "debug",
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
    SILENT: "silent"
} as const);

export type PrettierLogLevelValue = (typeof PrettierLogLevel)[keyof typeof PrettierLogLevel];

/**
 * Default log level applied when the `--log-level` flag and the
 * `PRETTIER_PLUGIN_GML_LOG_LEVEL` environment variable are both unset.
 */
export const DEFAULT_PRETTIER_LOG_LEVEL: PrettierLogLevelValue = PrettierLogLevel.WARN;

/**
 * Enumerated-option helpers for the `--log-level` flag.
 *
 * Derived directly from {@link PrettierLogLevel} so the validation set and
 * the enum object can never drift apart: adding or removing a key from the
 * enum automatically updates the value set used by `requireValue` /
 * `normalize`.
 */
export const prettierLogLevelOption = Core.createEnumeratedOptionHelpers(
    new Set<PrettierLogLevelValue>(Object.values(PrettierLogLevel)),
    {
        formatError: (list) => `Must be one of: ${list}`
    }
);

/**
 * Sorted, comma-separated list of valid log levels for use in user-facing
 * messages and error reports.
 */
export function formatPrettierLogLevelList(): string {
    return prettierLogLevelOption.formatList();
}

/**
 * Returns the canonical Prettier log-level values, useful for tests and
 * documentation that need to enumerate the supported set.
 */
export function getPrettierLogLevelValues(): readonly PrettierLogLevelValue[] {
    return Object.values(PrettierLogLevel);
}
