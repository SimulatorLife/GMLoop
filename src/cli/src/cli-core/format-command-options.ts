import { Core } from "@gmloop/core";

import type { CommanderCommandLike } from "./commander-types.js";

const { getNonEmptyTrimmedString } = Core;

interface FormatCommandSampleLimits {
    skippedDirectorySampleLimit?: number;
    ignoredFileSampleLimit?: number;
    unsupportedExtensionSampleLimit?: number;
}

interface PrettierConfigurationOptions {
    defaultParseErrorAction?: string;
    defaultPrettierLogLevel?: string;
}

interface ResolvedPrettierConfiguration {
    prettierLogLevel?: string;
    onParseError?: string;
    dryRunMode: boolean;
    verbose: boolean;
    list: boolean;
}

interface TargetPathResolution {
    targetPathInput: unknown;
    targetPathProvided: boolean;
    rawTargetPathInput?: string;
}

export interface CollectFormatCommandOptionsParameters {
    defaultParseErrorAction?: string;
    defaultPrettierLogLevel?: string;
}

export interface FormatCommandOptionsResult extends FormatCommandSampleLimits, ResolvedPrettierConfiguration {
    targetPathInput: unknown;
    targetPathProvided: boolean;
    configPath: string | null;
    rawTargetPathInput?: string;
    usage: string;
}

type CommandOptionsRecord = Record<string, unknown>;

function resolveFormatCommandSampleLimits(options: CommandOptionsRecord): FormatCommandSampleLimits {
    const source = options ?? {};
    const skipped = source.ignoredDirectorySamples ?? source.ignoredDirectorySampleLimit ?? undefined;
    return {
        skippedDirectorySampleLimit: skipped as number | undefined,
        ignoredFileSampleLimit: (source.ignoredFileSampleLimit as number | undefined) ?? undefined,
        unsupportedExtensionSampleLimit: (source.unsupportedExtensionSampleLimit as number | undefined) ?? undefined
    };
}

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

function resolveTargetPathInput(options: CommandOptionsRecord): TargetPathResolution {
    const rawTarget = options.path ?? null;

    if (rawTarget === null) {
        return {
            targetPathInput: null,
            targetPathProvided: false
        };
    }

    if (typeof rawTarget !== "string") {
        return {
            targetPathInput: rawTarget,
            targetPathProvided: true
        };
    }

    const trimmedTarget = getNonEmptyTrimmedString(rawTarget);

    return {
        targetPathInput: trimmedTarget ?? null,
        targetPathProvided: true,
        rawTargetPathInput: trimmedTarget !== null && trimmedTarget !== rawTarget ? rawTarget : undefined
    };
}

export function collectFormatCommandOptions(
    command: CommanderCommandLike,
    { defaultParseErrorAction, defaultPrettierLogLevel }: CollectFormatCommandOptionsParameters = {}
): FormatCommandOptionsResult {
    const options = (command?.opts?.() ?? {}) as CommandOptionsRecord;
    console.log("Format options:", options);
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
        configPath: getNonEmptyTrimmedString(options.config as string | undefined) ?? null,
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
