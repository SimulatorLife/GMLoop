/**
 * Format command option collection.
 *
 * Bridges Commander's mutable option bag and the format command action
 * handler by reading the resolved options off a `Command` instance once at
 * the start of the action and returning a strongly-typed, fully-normalized
 * shape that downstream code can depend on without re-checking each field.
 *
 * The collector is intentionally side-effect free: it never touches
 * `process`, never logs, and never mutates the supplied command. Tests
 * exercise it with stub command objects (see
 * `test/format-command-options.test.ts`) to lock down edge cases such as
 * blank `--path` values, the `--write`/`dryRunMode` inversion, and the
 * retired `--ignored-directory-samples` alias.
 */
import { Core } from "@gmloop/core";

import type { CommanderCommandLike } from "./commander-types.js";

const { getNonEmptyTrimmedString } = Core;

/**
 * Sample-limit knobs surfaced to callers for diagnostic summaries.
 *
 * Each field is the per-run ceiling for the corresponding sample bucket
 * (directories skipped, files ignored, unsupported extensions observed);
 * `undefined` indicates the runner default applies.
 */
interface FormatCommandSampleLimits {
    /** Per-run cap for directories skipped during traversal. */
    skippedDirectorySampleLimit?: number;
    /** Per-run cap for files ignored by the formatter's exclude rules. */
    ignoredFileSampleLimit?: number;
    /** Per-run cap for unsupported file extensions surfaced as diagnostics. */
    unsupportedExtensionSampleLimit?: number;
}

/**
 * Fallback values used when an action handler is invoked without supplying
 * explicit defaults. Both fields default to `undefined`, in which case the
 * collector leaves the underlying Prettier configuration untouched.
 */
interface PrettierConfigurationOptions {
    /** Fallback value for `onParseError` when the option bag omits it. */
    defaultParseErrorAction?: string;
    /** Fallback value for `logLevel` when neither `--log-level` nor `--verbose` is set. */
    defaultPrettierLogLevel?: string;
}

/**
 * Normalized Prettier-facing configuration derived from a single options bag.
 *
 * The collector is the single source of truth for the verbose/log-level
 * interaction (verbose forces `prettierLogLevel = "debug"` regardless of
 * the supplied `--log-level`) and for the `--write` → `dryRunMode`
 * inversion the rest of the CLI relies on.
 */
interface ResolvedPrettierConfiguration {
    /** Effective Prettier log level, or `undefined` to defer to Prettier's own default. */
    prettierLogLevel?: string;
    /** Effective `onParseError` value, or `undefined` to defer to Prettier's own default. */
    onParseError?: string;
    /** `true` when the run should preview changes without writing them back to disk. */
    dryRunMode: boolean;
    /** Mirrors the `--verbose` flag verbatim so callers can branch on it without re-reading the option bag. */
    verbose: boolean;
    /** Mirrors the `--list` flag; true asks the formatter to dump effective settings and exit. */
    list: boolean;
}

/**
 * Discriminated `--path` resolution result.
 *
 * Splitting `targetPathProvided` from `targetPathInput` lets downstream
 * code distinguish "the user did not pass `--path`" from "the user passed
 * `--path` but the value trimmed to empty", which have different defaulting
 * implications even when both surface as a null path.
 */
interface TargetPathResolution {
    /** The trimmed `--path` value, the raw non-string value, or `null` when omitted/blank. */
    targetPathInput: unknown;
    /** `true` when `--path` was supplied, even if the value trimmed to empty. */
    targetPathProvided: boolean;
    /**
     * Original, untrimmed `--path` value retained only when trimming removed characters.
     * Lets callers (e.g. CLI logging) echo the user-supplied value back verbatim.
     */
    rawTargetPathInput?: string;
}

/**
 * Optional defaults the caller can override when invoking
 * {@link collectFormatCommandOptions}. Mirrors the historical
 * `defaultParseErrorAction` / `defaultPrettierLogLevel` pair plumbed
 * through the format command's action handler signature.
 */
export interface CollectFormatCommandOptionsParameters {
    defaultParseErrorAction?: string;
    defaultPrettierLogLevel?: string;
}

/**
 * Result returned by {@link collectFormatCommandOptions}.
 *
 * Composed of the per-run sample limits, the resolved Prettier
 * configuration, the target-path resolution, the optional
 * `--config` path, and the help-text snapshot used by help-aware tests
 * and error reporters.
 */
export interface FormatCommandOptionsResult extends FormatCommandSampleLimits, ResolvedPrettierConfiguration {
    targetPathInput: unknown;
    targetPathProvided: boolean;
    configPath: string | null;
    rawTargetPathInput?: string;
    usage: string;
}

type CommandOptionsRecord = Record<string, unknown>;

/**
 * Extract the per-run sample-limit overrides from a raw options bag.
 *
 * The sample-limit flags use the canonical `skippedDirectorySampleLimit` /
 * `ignoredFileSampleLimit` / `unsupportedExtensionSampleLimit` option keys
 * (derived from the public CLI flags). The collector intentionally names
 * each lookup after the canonical long-term flag so retired flag names
 * fall back to the documented default rather than silently opting into
 * an unsupported override path.
 *
 * @param options Raw Commander option bag (`command.opts()`).
 * @returns Sample-limit triple with `undefined` for fields the caller did not set.
 */
function resolveFormatCommandSampleLimits(options: CommandOptionsRecord): FormatCommandSampleLimits {
    const source = options ?? {};
    return {
        skippedDirectorySampleLimit: (source.skippedDirectorySampleLimit as number | undefined) ?? undefined,
        ignoredFileSampleLimit: (source.ignoredFileSampleLimit as number | undefined) ?? undefined,
        unsupportedExtensionSampleLimit: (source.unsupportedExtensionSampleLimit as number | undefined) ?? undefined
    };
}

/**
 * Resolve the Prettier-facing configuration from the raw options bag.
 *
 * Encoding the verbose/log-level interaction and the `--write` → `dryRunMode`
 * inversion here keeps the rest of the CLI free of `Boolean(option.write)`
 * ternaries, which previously drifted when new flags were added.
 *
 * @param options Raw Commander option bag (`command.opts()`).
 * @param defaults Fallbacks applied when the option bag omits the relevant keys.
 * @returns Resolved Prettier configuration including `dryRunMode`, `verbose`, and `list`.
 */
function resolvePrettierConfiguration(
    options: CommandOptionsRecord,
    { defaultParseErrorAction, defaultPrettierLogLevel }: PrettierConfigurationOptions
): ResolvedPrettierConfiguration {
    const source = options ?? {};
    const verbose = Boolean(source.verbose);

    return {
        prettierLogLevel: verbose ? "debug" : ((source.logLevel as string) ?? defaultPrettierLogLevel),
        onParseError: (source.onParseError as string) ?? defaultParseErrorAction,
        dryRunMode: source.write !== true,
        verbose,
        list: Boolean(source.list)
    };
}

/**
 * Normalize the `--path` option into the discriminated shape downstream code consumes.
 *
 * The `_args` parameter is accepted for symmetry with Commander's positional
 * argument list but is intentionally ignored: positional targets are not
 * wired up to `--path` because the format command treats positional values
 * as script names instead of input paths.
 *
 * @param options Raw Commander option bag (`command.opts()`).
 * @param _args Unused positional arguments; retained for future expansion.
 * @returns Trimmed path input, a "provided" flag, and the raw input when trimming altered it.
 */
function resolveTargetPathInput(options: CommandOptionsRecord, _args?: unknown): TargetPathResolution {
    const optionPath = options.path ?? null;

    if (optionPath === null) {
        return {
            targetPathInput: null,
            targetPathProvided: false
        };
    }

    if (typeof optionPath !== "string") {
        return {
            targetPathInput: optionPath,
            targetPathProvided: true
        };
    }

    const trimmedTarget = getNonEmptyTrimmedString(optionPath);

    return {
        targetPathInput: trimmedTarget ?? null,
        targetPathProvided: true,
        rawTargetPathInput: trimmedTarget !== null && trimmedTarget !== optionPath ? optionPath : undefined
    };
}

/**
 * Collect and normalize the format command's option bag into a single
 * strongly-typed result.
 *
 * Reads `command.opts()` and `command.helpInformation()` exactly once each
 * so callers receive a stable snapshot of the resolved options and help
 * text without re-querying the Commander instance. The collector never
 * mutates the supplied command and never touches `process` or `console`,
 * making it safe to call from tests with stub objects.
 *
 * @param command Commander command (or compatible duck-typed shape) whose options to read.
 * @param parameters Optional defaults for `defaultParseErrorAction` and `defaultPrettierLogLevel`.
 * @returns Resolved format command options ready for the action handler.
 */
export function collectFormatCommandOptions(
    command: CommanderCommandLike,
    { defaultParseErrorAction, defaultPrettierLogLevel }: CollectFormatCommandOptionsParameters = {}
): FormatCommandOptionsResult {
    const options = (command?.opts?.() ?? {}) as CommandOptionsRecord;
    const { targetPathInput, targetPathProvided, rawTargetPathInput } = resolveTargetPathInput(options);

    const { skippedDirectorySampleLimit, ignoredFileSampleLimit, unsupportedExtensionSampleLimit } =
        resolveFormatCommandSampleLimits(options);
    const { prettierLogLevel, onParseError, dryRunMode, verbose, list } = resolvePrettierConfiguration(options, {
        defaultParseErrorAction,
        defaultPrettierLogLevel
    });

    const usage = typeof command?.helpInformation === "function" ? command.helpInformation() : "";

    return {
        targetPathInput,
        targetPathProvided,
        configPath: getNonEmptyTrimmedString(options.config) ?? null,
        prettierLogLevel,
        onParseError,
        dryRunMode,
        verbose,
        list,
        rawTargetPathInput,
        skippedDirectorySampleLimit,
        ignoredFileSampleLimit,
        unsupportedExtensionSampleLimit,
        usage
    };
}
