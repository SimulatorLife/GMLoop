/**
 * Format command for the GML CLI.
 *
 * Provides a convenient wrapper around the Prettier plugin to format
 * GameMaker Language files.
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";
import { Command, InvalidArgumentError, Option } from "commander";
import type { Options as PrettierOptions } from "prettier";

import { tryAddSample } from "../cli-core/bounded-sample-collector.js";
import { wrapInvalidArgumentResolver } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { CliUsageError, formatCliError } from "../cli-core/errors.js";
import { collectFormatCommandOptions } from "../cli-core/format-command-options.js";
import {
    createConfigOption,
    createListOption,
    createPathOption,
    createVerboseOption,
    createWriteOption
} from "../cli-core/shared-command-options.js";
import {
    hasRegisteredIgnorePath,
    registerIgnorePath,
    resetRegisteredIgnorePaths
} from "../format-runtime/ignore-path-registry.js";
import { importFormatModule, resolveFormatEntryPoint as resolveCliFormatEntryPoint } from "../format-runtime/index.js";
import {
    hasNegatedIgnoreRules,
    markNegatedIgnoreRulesDetected,
    resetNegatedIgnoreRulesFlag
} from "../modules/formatting/ignore-rules-negation-tracker.js";
import {
    clearFormattingCache,
    createFormattingCacheKey,
    getFormattingCacheEntry,
    getFormattingCacheKeys,
    getFormattingCacheStats,
    storeFormattingCacheEntry,
    trimFormattingCache
} from "../modules/formatting/index.js";
import {
    getDefaultIgnoredFileSampleLimit,
    getDefaultSkippedDirectorySampleLimit,
    getDefaultUnsupportedExtensionSampleLimit,
    resolveIgnoredFileSampleLimit,
    resolveSkippedDirectorySampleLimit,
    resolveUnsupportedExtensionSampleLimit
} from "../runtime-options/sample-limits.js";
import { isMissingModuleDependency, resolveModuleDefaultExport } from "../shared/module.js";
import {
    calculateElapsedNanoseconds,
    formatElapsedNanosecondsAsMilliseconds,
    readMonotonicNanoseconds
} from "../shared/timing/elapsed-time.js";
import { resolveExistingGmloopConfigPath } from "../workflow/project-root.js";
import {
    isHelpRequest,
    resolveTargetPathFromInput,
    resolveTargetStats,
    validateTargetPathInput
} from "./format-target-path.js";

const {
    compactArray,
    createEnumeratedOptionHelpers,
    getNonEmptyTrimmedString,
    getErrorMessageOrFallback,
    isErrorLike,
    isNonEmptyArray,
    isPathInside,
    loadGmloopProjectConfig,
    mergeUniqueValues,
    readTextFile,
    toArray,
    toNormalizedLowerCaseSet,
    uniqueArray,
    walkAncestorDirectories,
    withObjectLike
} = Core;

const WRAPPER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FORMAT_PATH = resolveCliFormatEntryPoint();
const IGNORE_PATH = path.resolve(WRAPPER_DIRECTORY, ".prettierignore");

const GML_EXTENSION = ".gml";

const ParseErrorAction = Object.freeze({
    REVERT: "revert",
    SKIP: "skip",
    ABORT: "abort"
});
type ParseErrorActionValue = (typeof ParseErrorAction)[keyof typeof ParseErrorAction];

const VALID_PARSE_ERROR_ACTIONS = new Set(Object.values(ParseErrorAction));
const VALID_PRETTIER_LOG_LEVELS = new Set(["debug", "info", "warn", "error", "silent"]);

const parseErrorActionOption = createEnumeratedOptionHelpers(VALID_PARSE_ERROR_ACTIONS, {
    formatError: (list) => `Must be one of: ${list}`
});
const logLevelOption = createEnumeratedOptionHelpers(VALID_PRETTIER_LOG_LEVELS, {
    formatError: (list) => `Must be one of: ${list}`
});

const FORMAT_COMMAND_CLI_EXAMPLE = "pnpm dlx prettier-plugin-gml format path/to/project";
const FORMAT_COMMAND_WORKSPACE_EXAMPLE = "pnpm run format:gml -- path/to/project";
const FORMAT_COMMAND_FIX_EXAMPLE = `pnpm dlx prettier-plugin-gml format --write --path path/to/script${GML_EXTENSION}`;

const PRETTIER_MODULE_ID = process.env.PRETTIER_PLUGIN_GML_PRETTIER_MODULE ?? "prettier";
const TARGET_EXTENSIONS = Object.freeze([GML_EXTENSION]);

function formatExtensionListForDisplay(extensions) {
    return extensions.map((extension) => `"${extension}"`).join(", ");
}

function createSampleLimitOption({ flag, description, defaultLimit, parseLimit }) {
    const descriptionText = Array.isArray(description) ? description.join(" ") : description;

    return new Option(flag, descriptionText)
        .argParser(wrapInvalidArgumentResolver(parseLimit))
        .default(defaultLimit, String(defaultLimit));
}

function createConfiguredSampleLimitOption({ flag, description, getDefaultLimit, resolveLimit }) {
    const defaultLimit = getDefaultLimit();
    const parseLimit = (value) =>
        resolveLimit(value, {
            defaultLimit
        });
    const descriptionText = typeof description === "function" ? description(defaultLimit) : description;

    return {
        option: createSampleLimitOption({
            flag,
            description: descriptionText,
            defaultLimit,
            parseLimit
        }),
        parseLimit,
        defaultLimit
    };
}

function createSampleLimitState({ getDefaultLimit, resolveLimit }) {
    let currentValue = getDefaultLimit();

    return {
        getLimit: () => currentValue,
        configureLimit(limit) {
            currentValue = resolveLimit(limit);
            return currentValue;
        },
        reset() {
            currentValue = getDefaultLimit();
            return currentValue;
        }
    };
}

function formatPathForDisplay(targetPath) {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedCwd = process.cwd();
    const relativePath = path.relative(resolvedCwd, resolvedTarget);

    if (resolvedTarget === resolvedCwd) {
        return ".";
    }

    if (relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
        return relativePath;
    }

    return resolvedTarget;
}

function describeIgnoreSource(ignorePaths) {
    if (!isNonEmptyArray(ignorePaths)) {
        return null;
    }

    const ignorePath = ignorePaths.at(-1);

    if (typeof ignorePath !== "string" || ignorePath.length === 0) {
        return null;
    }

    return formatPathForDisplay(ignorePath);
}

function isMissingPrettierDependency(error) {
    return isMissingModuleDependency(error, "prettier");
}

let prettierModulePromise = null;
let formatOutputNormalizerPromise: Promise<null | ((formatted: string, source: string) => string)> | null = null;

function resolvePrettier() {
    if (!prettierModulePromise) {
        prettierModulePromise = import(PRETTIER_MODULE_ID).then(resolveModuleDefaultExport).catch((error) => {
            if (isMissingPrettierDependency(error)) {
                const instructions = [
                    "Prettier v3 must be installed alongside prettier-plugin-gml.",
                    "Install it with:",
                    "  pnpm add -D prettier@^3"
                ].join("\n");
                const cliError = new CliUsageError(instructions);
                if (isErrorLike(error)) {
                    cliError.cause = error;
                }
                throw cliError;
            }
            throw error;
        });
    }

    return prettierModulePromise;
}

function resolveFormatOutputNormalizer(): Promise<null | ((formatted: string, source: string) => string)> {
    if (formatOutputNormalizerPromise === null) {
        formatOutputNormalizerPromise = importFormatModule()
            .then((moduleValue) => {
                // `normalizeFormattedOutput` is part of the `Format` namespace per the
                // workspace-root single-namespace contract (target-state.md §2.1).
                const formatNamespace = (moduleValue as { Format?: { normalizeFormattedOutput?: unknown } }).Format;
                const normalizer = formatNamespace?.normalizeFormattedOutput;
                return typeof normalizer === "function"
                    ? (normalizer as (formatted: string, source: string) => string)
                    : null;
            })
            .catch(() => null);
    }

    return formatOutputNormalizerPromise;
}

async function normalizeFormattedOutputWithFormat(formatted: string, source: string): Promise<string> {
    const normalizer = await resolveFormatOutputNormalizer();

    if (typeof normalizer !== "function") {
        return formatted;
    }

    return normalizer(formatted, source);
}

// Default parse error action is intentionally hard-coded to "abort" to enforce
// the target-state malformed-code contract: formatter runs must fail fast when
// parsing fails and must not silently downgrade behavior via ambient process
// environment settings.
const DEFAULT_PARSE_ERROR_ACTION: ParseErrorActionValue = ParseErrorAction.ABORT;

const DEFAULT_PRETTIER_LOG_LEVEL =
    logLevelOption.normalize(process.env.PRETTIER_PLUGIN_GML_LOG_LEVEL, "warn") ?? "warn";

// Save the original console.debug, console.error, console.warn, console.log
// and console.info so we can
// toggle or filter them when the configured Prettier log level requests
// silence. By
// default console.debug is active, which may pollute stdout/stderr during
// repo-wide test runs. The CLI deliberately filters out diagnostic-style
// console.error output (e.g. '[feather:diagnostic]' and '[doc:debug]') when
// the log level is set to 'silent' to keep repo-wide runs deterministic.
const originalConsoleDebug = console.debug;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;

// Lightweight filter used to suppress only the diagnostic lines written by
// internal modules. This avoids fully silencing real error messages while
// preventing noisy diagnostic output that appears on stderr.
function isDiagnosticErrorMessage(message) {
    if (!message || typeof message !== "string") return false;
    return (
        message.startsWith("[feather:diagnostic]") ||
        message.startsWith("[feather:debug]") ||
        message.startsWith("[doc:debug]")
    );
}

// By default, internal modules sometimes write verbose diagnostics to stdout
// via console.log and console.info (e.g. 'promoteLeadingDocCommentTextToDescri
// ption: ...'). When Prettier log level is set to 'silent' we should suppress
// those noisy messages to make repo-wide formatting runs deterministic. We
// specifically filter function-name style debug messages that start with a
// lowercase identifier followed by a colon or known debug phrases.
function isDiagnosticStdoutMessage(message) {
    if (!message || typeof message !== "string") return false;
    // Example: 'promoteLeadingDocCommentTextToDescription: filteredResult pre-promotion'
    if (message.startsWith("promoteLeadingDocCommentTextToDescription:")) {
        return true;
    }
    // FunctionName: pattern (starts with lowercase function name and colon)
    if (/^[a-z][\w.-]*:/.test(message)) {
        return true;
    }
    // Bracketed diagnostic tags (e.g. '[feather:diagnostic]', '[doc:debug]')
    if (
        message.startsWith("[feather:diagnostic]") ||
        message.startsWith("[feather:debug]") ||
        message.startsWith("[doc:debug]")
    ) {
        return true;
    }
    return false;
}

/**
 * Configure console methods based on the requested log level.
 * Handles silencing diagnostic messages and toggling debug output.
 *
 * @param logLevel - The Prettier log level (debug|info|warn|error|silent)
 */
function configureConsoleMethods(logLevel: string): void {
    const silent = logLevel === "silent";
    const debug = logLevel === "debug";

    // Disable console.debug unless the log level is explicitly set to debug.
    // This ensures internal tracing and diagnostic output is hidden by default.
    console.debug = debug ? originalConsoleDebug : () => {};

    if (silent) {
        console.error = (...args) => {
            if (args.length > 0 && isDiagnosticErrorMessage(String(args[0]))) {
                return;
            }
            originalConsoleError.apply(console, args);
        };
        console.warn = (...args) => {
            if (args.length > 0 && isDiagnosticErrorMessage(String(args[0]))) {
                return;
            }
            originalConsoleWarn.apply(console, args);
        };
        console.log = (...args) => {
            if (args.length > 0 && isDiagnosticStdoutMessage(String(args[0]))) {
                return;
            }
            originalConsoleLog.apply(console, args);
        };
        console.info = (...args) => {
            if (args.length > 0 && isDiagnosticStdoutMessage(String(args[0]))) {
                return;
            }
            originalConsoleInfo.apply(console, args);
        };
    } else {
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
        console.log = originalConsoleLog;
        console.info = originalConsoleInfo;
    }
}

// Initialize console methods based on the environment or default log level.
// This ensures console.debug is disabled early on if requested.
configureConsoleMethods(process.env.PRETTIER_PLUGIN_GML_LOG_LEVEL ?? DEFAULT_PRETTIER_LOG_LEVEL);

export function createFormatCommand({ name = "prettier-plugin-gml" } = {}) {
    const { option: skippedDirectorySampleLimitOption, parseLimit: parseSkippedDirectoryLimit } =
        createConfiguredSampleLimitOption({
            flag: "--ignored-directory-sample-limit <count>",
            description: (defaultLimit) =>
                `Max ignored directories shown in summary. Default: ${defaultLimit}, use 0 to hide`,
            getDefaultLimit: getDefaultSkippedDirectorySampleLimit,
            resolveLimit: resolveSkippedDirectorySampleLimit
        });
    const skippedDirectorySamplesAliasOption = new Option(
        "--ignored-directory-samples <count>",
        "Alias for --ignored-directory-sample-limit <count>"
    )
        .argParser(wrapInvalidArgumentResolver(parseSkippedDirectoryLimit))
        .hideHelp();

    const { option: ignoredFileSampleLimitOption } = createConfiguredSampleLimitOption({
        flag: "--ignored-file-sample-limit <count>",
        description: (defaultLimit) => `Max ignored files shown in summary. Default: ${defaultLimit}, use 0 to hide`,
        getDefaultLimit: getDefaultIgnoredFileSampleLimit,
        resolveLimit: resolveIgnoredFileSampleLimit
    });

    const { option: unsupportedExtensionSampleLimitOption } = createConfiguredSampleLimitOption({
        flag: "--unsupported-extension-sample-limit <count>",
        description: (defaultLimit) =>
            `Max unsupported files shown in summary. Default: ${defaultLimit}, use 0 to hide`,
        getDefaultLimit: getDefaultUnsupportedExtensionSampleLimit,
        resolveLimit: resolveUnsupportedExtensionSampleLimit
    });

    return applyStandardCommandOptions(
        new Command()
            .name(name)
            .usage("[options]")
            .description("Format GameMaker Language files using the prettier plugin.")
    )
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createWriteOption())
        .addOption(createListOption())
        .addOption(skippedDirectorySampleLimitOption)
        .addOption(skippedDirectorySamplesAliasOption)
        .addOption(ignoredFileSampleLimitOption)
        .addOption(unsupportedExtensionSampleLimitOption)
        .option(
            "--log-level <level>",
            "Prettier log level: debug|info|warn|error|silent. Default: warn",
            (value) => logLevelOption.requireValue(value, InvalidArgumentError),
            DEFAULT_PRETTIER_LOG_LEVEL
        )
        .option(
            "--on-parse-error <mode>",
            "Parser failure handling: revert|skip|abort. Default: abort",
            (value) => parseErrorActionOption.requireValue(value, InvalidArgumentError),
            DEFAULT_PARSE_ERROR_ACTION
        )
        .addOption(createVerboseOption())
        .addHelpText("after", () =>
            [
                "",
                "Examples:",
                `  ${FORMAT_COMMAND_CLI_EXAMPLE}`,
                `  ${FORMAT_COMMAND_WORKSPACE_EXAMPLE}`,
                `  ${FORMAT_COMMAND_FIX_EXAMPLE}`,
                ""
            ].join("\n")
        );
}

/**
 * Create a lookup set for extension comparisons while formatting.
 *
 * @param {readonly string[]} extensions
 * @returns {Set<string>}
 */
function createTargetExtensionSet(extensions) {
    return toNormalizedLowerCaseSet(extensions);
}

const targetExtensionSet = createTargetExtensionSet(TARGET_EXTENSIONS);
const placeholderExtension = TARGET_EXTENSIONS[0] ?? GML_EXTENSION;

function shouldFormatFile(filePath) {
    const fileExtension = path.extname(filePath).toLowerCase();
    return targetExtensionSet.has(fileExtension);
}

/**
 * Prettier configuration shared by all formatted GameMaker Language files.
 */
const options = {
    parser: "gml-parse",
    plugins: [FORMAT_PATH],
    logLevel: DEFAULT_PRETTIER_LOG_LEVEL,
    ignorePath: IGNORE_PATH,
    noErrorOnUnmatchedPattern: true
};

function configurePrettierOptions({
    logLevel
}: {
    logLevel?: unknown;
} = {}) {
    const normalized = logLevelOption.normalize(logLevel, DEFAULT_PRETTIER_LOG_LEVEL) ?? DEFAULT_PRETTIER_LOG_LEVEL;
    options.logLevel = normalized;
    // Toggle console.debug and filter console.error based on the configured
    // Prettier log level so internal debug and diagnostic output is suppressed
    // when requested. We filter diagnostic lines to avoid hiding genuine
    // runtime errors while keeping repo-wide runs deterministic in tests.
    configureConsoleMethods(normalized);
}

const skippedFileSummary = {
    ignored: 0,
    ignoredSamples: [],
    unsupportedExtension: 0,
    unsupportedExtensionSamples: [],
    symbolicLink: 0
};

const skippedDirectorySummary = {
    ignored: 0,
    ignoredSamples: []
};

let dryRunModeEnabled = true;
let pendingFormatCount = 0;
let formattedFileCount = 0;
let verboseTimingEnabled = false;
let formattingRunStartedAtNanoseconds = 0n;
let timedFormattableFileCount = 0;

function resetDryRunModeTracking() {
    pendingFormatCount = 0;
}

function resetFormattedFileTracking() {
    formattedFileCount = 0;
}

function resetVerboseTimingTracking() {
    verboseTimingEnabled = false;
    formattingRunStartedAtNanoseconds = 0n;
    timedFormattableFileCount = 0;
}

function configureDryRunMode(enabled) {
    dryRunModeEnabled = Boolean(enabled);
    resetDryRunModeTracking();
}

function formatTimingSuffixFromNanoseconds(elapsedNanoseconds: bigint): string {
    return ` (${formatElapsedNanosecondsAsMilliseconds(elapsedNanoseconds)})`;
}

function logVerbosePerFileTiming(parameters: {
    filePath: string;
    phase: "checked" | "would-format" | "formatted";
    elapsedNanoseconds: bigint;
}) {
    if (!verboseTimingEnabled) {
        return;
    }

    const timingSuffix = formatTimingSuffixFromNanoseconds(parameters.elapsedNanoseconds);
    if (parameters.phase === "checked") {
        console.log(
            `Checked ${formatPathForDisplay(parameters.filePath)} (already formatted, ${formatElapsedNanosecondsAsMilliseconds(parameters.elapsedNanoseconds)})`
        );
        return;
    }

    if (parameters.phase === "would-format") {
        console.log(`Would format ${formatPathForDisplay(parameters.filePath)}${timingSuffix}`);
        return;
    }

    console.log(`Formatted ${parameters.filePath}${timingSuffix}`);
}

const skippedDirectorySampleLimitState = createSampleLimitState({
    getDefaultLimit: getDefaultSkippedDirectorySampleLimit,
    resolveLimit: resolveSkippedDirectorySampleLimit
});

const ignoredFileSampleLimitState = createSampleLimitState({
    getDefaultLimit: getDefaultIgnoredFileSampleLimit,
    resolveLimit: resolveIgnoredFileSampleLimit
});

const unsupportedExtensionSampleLimitState = createSampleLimitState({
    getDefaultLimit: getDefaultUnsupportedExtensionSampleLimit,
    resolveLimit: resolveUnsupportedExtensionSampleLimit
});

function resetSkippedFileSummary() {
    skippedFileSummary.ignored = 0;
    skippedFileSummary.ignoredSamples.length = 0;
    skippedFileSummary.unsupportedExtension = 0;
    skippedFileSummary.unsupportedExtensionSamples.length = 0;
    skippedFileSummary.symbolicLink = 0;
}

function resetSkippedDirectorySummary() {
    skippedDirectorySummary.ignored = 0;
    skippedDirectorySummary.ignoredSamples.length = 0;
}

function recordSkippedDirectory(directory) {
    skippedDirectorySummary.ignored += 1;
    const limit = skippedDirectorySampleLimitState.getLimit();
    tryAddSample(skippedDirectorySummary.ignoredSamples, directory, limit);
}
let baseProjectIgnorePaths = [];
const baseProjectIgnorePathSet = new Set();
let encounteredFormattingError = false;
let formattingErrorCount = 0;
const NEGATED_IGNORE_RULE_PATTERN = /^\s*!.*\S/m;
let parseErrorAction: ParseErrorActionValue = DEFAULT_PARSE_ERROR_ACTION;
let abortRequested = false;
let revertTriggered = false;
const formattedFileOriginalContents = new Map();
let revertSnapshotDirectoryPromise = null;
let revertSnapshotDirectory = null;
let revertSnapshotFileCount = 0;
let encounteredFormattableFile = false;

// Limit the number of in-memory snapshots to prevent unbounded memory growth
// when disk writes fail. When this limit is reached, old snapshots are released.
const MAX_IN_MEMORY_SNAPSHOTS = 50;
let inMemorySnapshotCount = 0;

// Track processed files for periodic cache cleanup
let processedFileCount = 0;
// Reduced from 50 to 10 to perform more frequent cleanups and prevent memory buildup
const PERIODIC_CLEANUP_INTERVAL = 10;

function ensureRevertSnapshotDirectory() {
    if (revertSnapshotDirectory) {
        return revertSnapshotDirectory;
    }

    if (!revertSnapshotDirectoryPromise) {
        const prefix = path.join(os.tmpdir(), "prettier-plugin-gml-revert-");
        revertSnapshotDirectoryPromise = mkdtemp(prefix).then(
            (directory) => {
                revertSnapshotDirectory = directory;
                return directory;
            },
            (error) => {
                revertSnapshotDirectoryPromise = null;
                throw error;
            }
        );
    }

    return revertSnapshotDirectoryPromise;
}

async function cleanupRevertSnapshotDirectory() {
    const directory = revertSnapshotDirectory;
    revertSnapshotDirectory = null;
    revertSnapshotDirectoryPromise = null;

    if (!directory) {
        return;
    }

    try {
        await rm(directory, { recursive: true, force: true });
    } catch {
        // Treat teardown of the revert workspace as best-effort. The directory
        // lives under `os.tmpdir()` and only exists when callers opt into the
        // `--on-parse-error=revert` safety net described in
        // README.md#format-from-a-local-clone. Surfacing an ENOENT/EACCES
        // failure here would mask the original parser crash and leave users
        // questioning whether their edits were restored. Leaving the directory
        // behind is harmless because the OS eventually sweeps the temp folder,
        // whereas interrupting the CLI would undermine the recovery guarantee.
    }
}

async function releaseSnapshot(snapshot) {
    await withObjectLike(
        snapshot,
        async (snapshotObject) => {
            const { snapshotPath, inlineContents } = snapshotObject;

            // Track in-memory snapshot count for garbage collection
            if (inlineContents !== null && inMemorySnapshotCount > 0) {
                inMemorySnapshotCount -= 1;
            }

            if (!snapshotPath) {
                return;
            }

            try {
                await rm(snapshotPath, { force: true });
            } catch {
                // Suppress cleanup errors to ensure the original error is not masked.
                // When a snapshot revert fails (e.g., temporary directory cleanup
                // after a formatting error), we catch and ignore the failure rather
                // than propagating it. The revert is a best-effort rollback triggered
                // by an earlier error (parsing failure, write error, etc.), and
                // throwing a new error here would hide the root cause in the output.
                // By ignoring cleanup failures, we allow the original error to surface
                // in diagnostics, making it easier for users to identify and fix the
                // underlying issue. The temporary files may remain on disk, but this
                // is preferable to obscuring the real problem.
            } finally {
                if (revertSnapshotFileCount > 0) {
                    revertSnapshotFileCount -= 1;
                }
            }
        },
        () => {}
    );
}

async function discardFormattedFileOriginalContents() {
    const snapshots = [...formattedFileOriginalContents.values()];
    formattedFileOriginalContents.clear();

    await Core.runSequentially(snapshots, async (snapshot) => {
        // Release each snapshot in sequence so the shared
        // `revertSnapshotFileCount` accounting stays in sync with the
        // filesystem. `releaseSnapshot` also decides whether the directory can
        // be torn down or has to stick around for inline fallbacks, so keeping
        // this loop serial avoids racy cleanups that might drop still-needed
        // backups when the process is under heavy I/O pressure.
        await releaseSnapshot(snapshot);
    });

    if (revertSnapshotFileCount === 0) {
        await cleanupRevertSnapshotDirectory();
    }
}

/**
 * Release old snapshots when the in-memory snapshot count exceeds the limit.
 * This prevents unbounded memory growth when disk writes fail and snapshots
 * must be kept in memory.
 */
async function enforceSnapshotMemoryLimit() {
    if (inMemorySnapshotCount <= MAX_IN_MEMORY_SNAPSHOTS) {
        return;
    }

    const snapshotsToRelease = inMemorySnapshotCount - MAX_IN_MEMORY_SNAPSHOTS;
    const snapshotsToDelete = collectInlineSnapshotsForEviction(snapshotsToRelease);

    // Release snapshots sequentially to maintain correct accounting
    await Core.runSequentially(snapshotsToDelete, async ({ filePath, snapshot }) => {
        formattedFileOriginalContents.delete(filePath);
        await releaseSnapshot(snapshot);
    });
}

function collectInlineSnapshotsForEviction(snapshotsToRelease) {
    if (!Number.isFinite(snapshotsToRelease) || snapshotsToRelease <= 0) {
        return [];
    }

    const snapshotsToDelete = [];
    for (const [filePath, snapshot] of formattedFileOriginalContents) {
        if (snapshot && typeof snapshot === "object" && snapshot.inlineContents !== null) {
            snapshotsToDelete.push({ filePath, snapshot });
        }

        if (snapshotsToDelete.length >= snapshotsToRelease) {
            break;
        }
    }

    return snapshotsToDelete;
}

/**
 * Perform periodic memory cleanup to prevent accumulation during large formatting runs.
 * This includes trimming the formatting cache and triggering garbage collection if available.
 */
function performPeriodicMemoryCleanup() {
    // Trim the formatting cache more aggressively to limit memory usage.
    // Instead of clearing completely, we keep only a small number of recent entries.
    trimFormattingCache(5);

    // Trigger garbage collection if exposed (e.g., when running with --expose-gc)
    if (typeof globalThis.gc === "function") {
        globalThis.gc();
    }
}

async function readSnapshotContents(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
        return "";
    }

    const { inlineContents, snapshotPath } = snapshot;

    if (inlineContents !== null) {
        return inlineContents;
    }

    if (!snapshotPath) {
        return "";
    }

    try {
        return await readTextFile(snapshotPath);
    } catch {
        return null;
    }
}

/**
 * Reset run-specific state between CLI invocations.
 *
 * @param {string} onParseError
 */
async function resetFormattingSession(onParseError: ParseErrorActionValue) {
    parseErrorAction = onParseError;
    abortRequested = false;
    revertTriggered = false;
    await discardFormattedFileOriginalContents();
    resetSkippedFileSummary();
    resetSkippedDirectorySummary();
    encounteredFormattingError = false;
    formattingErrorCount = 0;
    resetRegisteredIgnorePaths();
    resetNegatedIgnoreRulesFlag();
    encounteredFormattableFile = false;
    resetDryRunModeTracking();
    resetFormattedFileTracking();
    resetVerboseTimingTracking();
    clearFormattingCache();
    inMemorySnapshotCount = 0;
    processedFileCount = 0;
}

/**
 * Persist ignore path information for use throughout the run.
 *
 * @param {readonly string[]} ignorePaths
 */
function setBaseProjectIgnorePaths(ignorePaths) {
    baseProjectIgnorePaths = ignorePaths;
    baseProjectIgnorePathSet.clear();

    for (const projectIgnorePath of ignorePaths) {
        baseProjectIgnorePathSet.add(projectIgnorePath);
    }
}

async function recordFormattedFileOriginalContents(filePath, contents) {
    if (parseErrorAction !== ParseErrorAction.REVERT) {
        return;
    }

    if (formattedFileOriginalContents.has(filePath)) {
        return;
    }

    const snapshot = {
        snapshotPath: null,
        inlineContents: null
    };

    try {
        const directory = await ensureRevertSnapshotDirectory();
        const extension = path.extname(filePath) || ".snapshot";
        const snapshotName = `${randomUUID()}${extension}`;
        const snapshotPath = path.join(directory, snapshotName);
        await writeFile(snapshotPath, contents, "utf8");
        snapshot.snapshotPath = snapshotPath;
        revertSnapshotFileCount += 1;
    } catch {
        // Store the snapshot contents in memory when the temporary directory is
        // unavailable or write access fails. This fallback ensures revert operations
        // can still proceed even if disk I/O fails, though it consumes more memory
        // and won't survive process crashes.
        snapshot.inlineContents = contents;
        inMemorySnapshotCount += 1;
    }

    formattedFileOriginalContents.set(filePath, snapshot);

    // Enforce memory limit by releasing old snapshots when the limit is exceeded
    await enforceSnapshotMemoryLimit();
}

async function revertFormattedFiles() {
    if (formattedFileOriginalContents.size === 0) {
        return;
    }

    const revertEntries = [...formattedFileOriginalContents.entries()];
    formattedFileOriginalContents.clear();

    console.warn(
        `Reverting ${revertEntries.length} formatted ${
            revertEntries.length === 1 ? "file" : "files"
        } due to parser failure.`
    );

    await Core.runSequentially(revertEntries, async ([filePath, snapshot]) => {
        try {
            const originalContents = await readSnapshotContents(snapshot);
            if (originalContents == null) {
                throw new Error("Revert snapshot is unavailable");
            }
            await writeFile(filePath, originalContents);
            console.warn(`Reverted ${filePath}`);
        } catch (revertError) {
            logCliErrorWithHeader(revertError, `Failed to revert ${filePath}`);
        } finally {
            // Always release the snapshot so the shared revert bookkeeping can
            // decide whether the temporary directory is still needed. Skipping
            // this step after a failed write would leak backups, block future
            // revert attempts from creating fresh snapshots, and leave the
            // `revertSnapshotFileCount` counter desynchronized from reality.
            await releaseSnapshot(snapshot);
        }
    });

    if (revertSnapshotFileCount === 0) {
        await cleanupRevertSnapshotDirectory();
    }
}

function logCliErrorWithHeader(error, header) {
    const formattedError = formatCliError(error);

    if (!formattedError) {
        console.error(header);
        return;
    }

    const indented = formattedError
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");

    console.error(`${header}\n${indented}`);
}

async function reportAndTrackFormattingError(error, filePath) {
    // Decide whether the error should count as a formatting failure.
    // Treat parser syntax errors as non-fatal when configured to SKIP so
    // repo-wide formatting runs (e.g., in CI/test) don't fail due to
    // intentionally malformed fixtures.
    const isParseError = Core.isGmlParseError(error);

    // When the user specifies `--parse-error-action=SKIP`, they're explicitly opting
    // into a workflow where parse errors are treated as non-fatal: the CLI should
    // quietly skip files with syntax issues rather than halting or printing error
    // diagnostics. Incrementing `formattingErrorCount` or emitting stderr messages
    // would violate that contract and confuse users who expect a clean, silent run
    // when malformed files are present. This guard ensures that SKIP mode suppresses
    // both the failure counter and the user-facing error output, preserving backward
    // compatibility with test suites that rely on quiet runs when parse errors are
    // expected. Other modes (REVERT and ABORT) preserve the original behavior of
    // logging errors and updating counters, since they signal that parse failures
    // should be treated as actionable problems rather than ignorable noise.
    const header = `Failed to format ${filePath}`;
    if (parseErrorAction === ParseErrorAction.SKIP && isParseError) {
        // Suppress parse-error counting and stderr logging when SKIP mode is active.
        // Tests expect quiet runs in this configuration, and incrementing failure
        // counters would incorrectly signal formatting issues for files we deliberately
        // ignored. Return early without updating `encounteredFormattingError` or
        // `formattingErrorCount` so the CLI exit code reflects only genuine failures.
        return;
    }

    encounteredFormattingError = true;
    formattingErrorCount += 1;
    logCliErrorWithHeader(error, header);

    if (parseErrorAction === ParseErrorAction.REVERT) {
        if (revertTriggered) {
            return;
        }

        revertTriggered = true;
        abortRequested = true;
        await revertFormattedFiles();
        return;
    }

    if (parseErrorAction === ParseErrorAction.ABORT) {
        abortRequested = true;
    }
}

async function detectNegatedIgnoreRules(ignoreFilePath) {
    try {
        const contents = await readTextFile(ignoreFilePath);

        if (NEGATED_IGNORE_RULE_PATTERN.test(contents)) {
            markNegatedIgnoreRulesDetected();
        }
    } catch {
        // Tolerate missing or inaccessible ignore files during negation detection.
        // The ignore-file scanning process attempts to detect negated rules
        // (e.g., `!foo.gml`) across all referenced ignore files. If a file is
        // missing, unreadable, or has restrictive permissions, we catch the error
        // and continue without crashing the formatter. The defensive posture here
        // ensures that the formatter remains operational even when the ignore-file
        // infrastructure is incomplete or misconfigured. Missing negation detection
        // for one file is acceptable—the formatter falls back to its default
        // ignore behavior, which is safer than aborting the entire run.
    }
}

/**
 * Register a single ignore file and capture negated rule metadata when needed.
 *
 * Centralizing the per-file bookkeeping keeps the bulk registration flow
 * focused on coordinating the overall workflow.
 */
async function registerIgnoreFile(ignoreFilePath) {
    if (!ignoreFilePath || hasRegisteredIgnorePath(ignoreFilePath)) {
        return;
    }

    registerIgnorePath(ignoreFilePath);

    if (hasNegatedIgnoreRules()) {
        return;
    }

    await detectNegatedIgnoreRules(ignoreFilePath);
}

async function registerIgnorePaths(ignoreFiles) {
    await Core.runSequentially(ignoreFiles, (ignoreFilePath) => registerIgnoreFile(ignoreFilePath));
}

function getIgnorePathOptions(additionalIgnorePaths = []) {
    const ignoreCandidates = compactArray([IGNORE_PATH, ...baseProjectIgnorePaths, ...additionalIgnorePaths]);
    if (ignoreCandidates.length === 0) {
        return null;
    }

    const uniqueIgnorePaths = uniqueArray(ignoreCandidates);
    return uniqueIgnorePaths.length === 1 ? uniqueIgnorePaths[0] : uniqueIgnorePaths;
}

async function shouldSkipDirectory(directory, activeIgnorePaths = []) {
    if (hasNegatedIgnoreRules()) {
        return false;
    }

    const ignorePathOption = getIgnorePathOptions(activeIgnorePaths);
    if (!ignorePathOption) {
        return false;
    }

    const placeholderPath = path.join(directory, `__prettier_plugin_gml_ignore_test__${placeholderExtension}`);

    const prettier = await resolvePrettier();

    try {
        const fileInfo = await prettier.getFileInfo(placeholderPath, {
            ignorePath: ignorePathOption,
            plugins: options.plugins,
            resolveConfig: true
        });

        if (fileInfo.ignored) {
            recordSkippedDirectory(directory);
            return true;
        }
    } catch (error) {
        const message = getErrorMessageOrFallback(error);
        console.warn(`Unable to evaluate ignore rules for ${directory}: ${message}`);
    }

    return false;
}

/**
 * Resolve the directory bounds that should be inspected for ignore files.
 *
 * @param {string} directory
 */
/**
 * Check whether a directory contains project-boundary markers.
 *
 * A boundary is detected when the directory contains either `gmloop.json` or
 * at least one `.yyp` file, which indicates that ignore-file discovery should
 * stop walking further into ancestor directories.
 */
async function directoryContainsProjectBoundaryMarker(directory) {
    const projectConfigPath = path.join(directory, "gmloop.json");
    try {
        const configStats = await stat(projectConfigPath);
        if (configStats.isFile()) {
            return true;
        }
    } catch {
        // Continue probing for `.yyp` files when gmloop.json is absent or unreadable.
    }

    try {
        const entries = await readdir(directory, { withFileTypes: true });
        return entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"));
    } catch {
        return false;
    }
}

/**
 * Return the first directory in scan order that contains a project-boundary marker.
 *
 * @param candidateDirectories Ancestor directories to probe from nearest to farthest.
 * @returns The first matching directory, or `null` when no marker is found.
 */
async function findFirstDirectoryContainingProjectBoundaryMarker(candidateDirectories: Array<string>) {
    const matches: Array<string> = [];
    await Core.runSequentially(candidateDirectories, async (candidateDirectory) => {
        if (matches.length > 0 || !candidateDirectory) {
            return;
        }

        if (await directoryContainsProjectBoundaryMarker(candidateDirectory)) {
            matches.push(candidateDirectory);
        }
    });

    return matches[0] ?? null;
}

async function resolveCanonicalDirectoryPath(directory: string): Promise<string> {
    try {
        return path.resolve(await realpath(directory));
    } catch {
        return path.resolve(directory);
    }
}

async function resolveIgnoreSearchBounds(directory) {
    const resolvedDirectory = path.resolve(directory);
    const resolvedWorkingDirectory = process.cwd();
    const canonicalDirectory = await resolveCanonicalDirectoryPath(resolvedDirectory);
    const canonicalWorkingDirectory = await resolveCanonicalDirectoryPath(resolvedWorkingDirectory);
    const shouldLimitToWorkingDirectory = isPathInside(canonicalDirectory, canonicalWorkingDirectory);

    if (!shouldLimitToWorkingDirectory) {
        return {
            resolvedDirectory,
            searchRoot: null
        };
    }

    const candidateDirectories = [...walkAncestorDirectories(resolvedDirectory)];
    const canonicalCandidateDirectories = await Promise.all(
        candidateDirectories.map((candidateDirectory) => resolveCanonicalDirectoryPath(candidateDirectory))
    );
    const workingDirectoryCandidateIndex = canonicalCandidateDirectories.indexOf(canonicalWorkingDirectory);
    const boundedCandidateDirectories =
        workingDirectoryCandidateIndex === -1
            ? candidateDirectories
            : candidateDirectories.slice(0, workingDirectoryCandidateIndex + 1);

    const discoveredProjectBoundaryDirectory =
        await findFirstDirectoryContainingProjectBoundaryMarker(boundedCandidateDirectories);

    if (discoveredProjectBoundaryDirectory !== null) {
        return {
            resolvedDirectory,
            searchRoot: discoveredProjectBoundaryDirectory
        };
    }

    return {
        resolvedDirectory,
        searchRoot: resolvedWorkingDirectory
    };
}

/**
 * Create the list of ignore file candidates from directories.
 *
 * @param {readonly string[]} directories
 */
function collectIgnoreCandidatePaths(directories) {
    return directories.map((candidateDirectory) => path.join(candidateDirectory, ".prettierignore"));
}

function collectIgnoreSearchDirectories(directory, searchRoot) {
    const resolvedDirectory = path.resolve(directory);
    const resolvedSearchRoot = searchRoot ? path.resolve(searchRoot) : null;

    const directories = [];
    for (const candidate of walkAncestorDirectories(resolvedDirectory)) {
        directories.push(candidate);

        if (resolvedSearchRoot && candidate === resolvedSearchRoot) {
            break;
        }
    }

    return directories;
}

/**
 * Filter the provided paths down to the ignore files that exist.
 *
 * @param {readonly string[]} candidatePaths
 */
async function collectExistingIgnoreFiles(candidatePaths) {
    const discovered = await Promise.all(
        candidatePaths.map(async (ignoreCandidate) => {
            try {
                const stats = await stat(ignoreCandidate);
                return stats.isFile() ? ignoreCandidate : null;
            } catch {
                // Tolerate missing or unreadable ignore files during discovery.
                // The formatter scans a standard set of ignore-file candidates
                // (e.g., .prettierignore, .gitignore) without requiring all of them
                // to exist. Projects may provide only a subset of these files, and
                // attempting to stat a missing file throws ENOENT. By catching and
                // suppressing these errors, we register only the files that are
                // present and readable, keeping the collection logic simple and
                // resilient. Failures to read files that do exist (e.g., permission
                // errors) are also silently ignored here, which is acceptable because
                // the formatter falls back to default ignore rules when custom files
                // are unavailable.
                return null;
            }
        })
    );

    return compactArray(discovered);
}

async function resolveProjectIgnorePaths(directory) {
    const { resolvedDirectory, searchRoot } = await resolveIgnoreSearchBounds(directory);
    const directoriesToInspect = collectIgnoreSearchDirectories(resolvedDirectory, searchRoot);
    const candidatePaths = collectIgnoreCandidatePaths(directoriesToInspect);
    return await collectExistingIgnoreFiles(candidatePaths);
}

/**
 * Discover ignore files for a project and register them with Prettier.
 *
 * @param {string} projectRoot
 */
async function initializeProjectIgnorePaths(projectRoot) {
    const projectIgnorePaths = await resolveProjectIgnorePaths(projectRoot);
    setBaseProjectIgnorePaths(projectIgnorePaths);
    await registerIgnorePaths([IGNORE_PATH, ...projectIgnorePaths]);
}

async function resolveDirectoryIgnoreContext(directory, inheritedIgnorePaths) {
    const localIgnorePath = path.join(directory, ".prettierignore");
    let effectiveIgnorePaths = inheritedIgnorePaths;
    let shouldRegisterLocalIgnore = baseProjectIgnorePathSet.has(localIgnorePath);

    try {
        const ignoreStats = await stat(localIgnorePath);

        if (ignoreStats.isFile()) {
            shouldRegisterLocalIgnore = true;

            effectiveIgnorePaths = mergeUniqueValues(inheritedIgnorePaths, [localIgnorePath], { freeze: false });
        }
    } catch {
        // Tolerate missing local ignore files and inherit parent directory rules.
        // When a subdirectory lacks its own .prettierignore file, we catch the
        // stat error and proceed with the inherited ignore paths from parent
        // directories. This resilience allows projects to layer ignore rules
        // hierarchically (e.g., a repo-wide .prettierignore at the root with
        // subdirectory overrides) without requiring every directory to have its
        // own ignore file. Missing files are normal and expected in this workflow,
        // so we suppress the error rather than propagating it and breaking the
        // formatting run.
    }

    return {
        effectiveIgnorePaths,
        localIgnorePath,
        shouldRegisterLocalIgnore
    };
}

async function formatDirectoryEntry(filePath, currentIgnorePaths) {
    const stats = await lstat(filePath);

    if (stats.isSymbolicLink()) {
        console.log(`Skipping ${filePath} (symbolic link)`);
        skippedFileSummary.symbolicLink += 1;
        return;
    }

    if (stats.isDirectory()) {
        if (await shouldSkipDirectory(filePath, currentIgnorePaths)) {
            return;
        }
        await formatDirectoryRecursively(filePath, currentIgnorePaths);
        return;
    }

    if (shouldFormatFile(filePath)) {
        await formatSingleFile(filePath, currentIgnorePaths);
        return;
    }

    recordUnsupportedExtension(filePath);
}

async function formatAllDirectoryEntries(directory: string, files: Array<string>, currentIgnorePaths) {
    await Core.runSequentially(files, async (file) => {
        if (abortRequested) {
            return;
        }

        const filePath = path.join(directory, file);
        await formatDirectoryEntry(filePath, currentIgnorePaths);
    });
}

async function formatDirectoryRecursively(directory, inheritedIgnorePaths = []) {
    if (abortRequested) {
        return;
    }

    const { effectiveIgnorePaths, localIgnorePath, shouldRegisterLocalIgnore } = await resolveDirectoryIgnoreContext(
        directory,
        inheritedIgnorePaths
    );

    if (shouldRegisterLocalIgnore) {
        await registerIgnorePaths([localIgnorePath]);
    }

    const files = await readdir(directory);
    await formatAllDirectoryEntries(directory, files, effectiveIgnorePaths);
}

async function resolveFormattingOptions(filePath): Promise<PrettierOptions> {
    const prettier = await resolvePrettier();
    let resolvedConfig = null;

    try {
        resolvedConfig = await prettier.resolveConfig(filePath, {
            editorconfig: true
        });
    } catch (error) {
        const message = getErrorMessageOrFallback(error);
        console.warn(`Unable to resolve Prettier config for ${filePath}: ${message}`);
    }

    const mergedOptions: PrettierOptions = {
        ...options,
        ...resolvedConfig,
        filepath: filePath
    } as PrettierOptions;

    const basePlugins = toArray(options.plugins);
    const resolvedPlugins = toArray(resolvedConfig?.plugins);
    const combinedPlugins = uniqueArray([...basePlugins, ...resolvedPlugins]);

    if (combinedPlugins.length > 0) {
        mergedOptions.plugins = combinedPlugins as PrettierOptions["plugins"];
    }

    mergedOptions.parser = options.parser;

    return mergedOptions;
}

async function resolveProjectFormatOverrides(
    configPath: string | null,
    targetPath: string
): Promise<Record<string, unknown>> {
    const normalizedConfigPath = getNonEmptyTrimmedString(configPath);
    if (!normalizedConfigPath) {
        return {};
    }

    const targetStats = await stat(path.resolve(targetPath));
    const projectRoot = targetStats.isDirectory() ? path.resolve(targetPath) : path.dirname(path.resolve(targetPath));
    const resolvedConfigPath = await resolveExistingGmloopConfigPath(projectRoot, normalizedConfigPath);
    const projectConfig = await loadGmloopProjectConfig(resolvedConfigPath);
    const formatModule = await importFormatModule();
    const formatNamespace = (formatModule as { Format?: { extractProjectFormatOptions?: unknown } }).Format;
    const extractProjectFormatOptions = formatNamespace?.extractProjectFormatOptions;
    if (typeof extractProjectFormatOptions !== "function") {
        return {};
    }

    const extractedOptions = extractProjectFormatOptions(projectConfig);
    return typeof extractedOptions === "object" && extractedOptions !== null
        ? (extractedOptions as Record<string, unknown>)
        : {};
}

async function formatSingleFile(filePath, activeIgnorePaths = []) {
    if (abortRequested) {
        return;
    }
    const formatFileStartedAtNanoseconds = readMonotonicNanoseconds();
    try {
        const formattingOptions = await resolveFormattingOptions(filePath);
        const prettier = await resolvePrettier();
        const ignorePathOption = getIgnorePathOptions(activeIgnorePaths);
        const fileInfo = await prettier.getFileInfo(filePath, {
            ...(ignorePathOption ? { ignorePath: ignorePathOption } : {}),
            plugins: formattingOptions.plugins,
            resolveConfig: true
        });

        if (fileInfo.ignored) {
            const ignoreSourceDescription = describeIgnoreSource(activeIgnorePaths);
            const formattedIgnoreSource = ignoreSourceDescription ? `ignored by ${ignoreSourceDescription}` : "ignored";

            recordIgnoredFile({
                filePath,
                sourceDescription: formattedIgnoreSource
            });
            return;
        }

        encounteredFormattableFile = true;
        timedFormattableFileCount += 1;

        const data = await readTextFile(filePath);
        const cacheKey = createFormattingCacheKey(data, formattingOptions);
        let formatted = getFormattingCacheEntry(cacheKey);

        if (formatted === undefined) {
            formatted = await prettier.format(data, formattingOptions);
            storeFormattingCacheEntry(cacheKey, formatted);
        }
        const normalizedOutput = await normalizeFormattedOutputWithFormat(formatted, data);

        if (normalizedOutput === data) {
            logVerbosePerFileTiming({
                filePath,
                phase: "checked",
                elapsedNanoseconds: calculateElapsedNanoseconds({
                    startedAtNanoseconds: formatFileStartedAtNanoseconds,
                    completedAtNanoseconds: readMonotonicNanoseconds()
                })
            });
            return;
        }

        if (dryRunModeEnabled) {
            pendingFormatCount += 1;
            logVerbosePerFileTiming({
                filePath,
                phase: "would-format",
                elapsedNanoseconds: calculateElapsedNanoseconds({
                    startedAtNanoseconds: formatFileStartedAtNanoseconds,
                    completedAtNanoseconds: readMonotonicNanoseconds()
                })
            });
            if (!verboseTimingEnabled) {
                console.log(`Would format ${formatPathForDisplay(filePath)}`);
            }
            return;
        }

        await recordFormattedFileOriginalContents(filePath, data);
        await writeFile(filePath, normalizedOutput);
        formattedFileCount += 1;
        logVerbosePerFileTiming({
            filePath,
            phase: "formatted",
            elapsedNanoseconds: calculateElapsedNanoseconds({
                startedAtNanoseconds: formatFileStartedAtNanoseconds,
                completedAtNanoseconds: readMonotonicNanoseconds()
            })
        });
        if (!verboseTimingEnabled) {
            console.log(`Formatted ${filePath}`);
        }

        // Increment processed file counter and perform periodic cleanup
        processedFileCount += 1;
        if (processedFileCount % PERIODIC_CLEANUP_INTERVAL === 0) {
            performPeriodicMemoryCleanup();
        }
    } catch (error) {
        await reportAndTrackFormattingError(error, filePath);
    }
}

/**
 * Configure global state for a formatting run based on CLI flags.
 *
 * @param {{
 *   prettierLogLevel: string,
 *   onParseError: string,
 *   skippedDirectorySampleLimit: number,
 *   ignoredFileSampleLimit: number,
 *   unsupportedExtensionSampleLimit: number
 * }} params
 */
async function prepareFormattingRun({
    prettierLogLevel,
    onParseError,
    skippedDirectorySampleLimit,
    ignoredFileSampleLimit,
    unsupportedExtensionSampleLimit,
    dryRunMode,
    verbose
}) {
    configurePrettierOptions({ logLevel: prettierLogLevel });
    skippedDirectorySampleLimitState.configureLimit(skippedDirectorySampleLimit);
    ignoredFileSampleLimitState.configureLimit(ignoredFileSampleLimit);
    unsupportedExtensionSampleLimitState.configureLimit(unsupportedExtensionSampleLimit);
    const normalizedParseErrorAction = parseErrorActionOption.requireValue(onParseError) as ParseErrorActionValue;
    await resetFormattingSession(normalizedParseErrorAction);
    configureDryRunMode(dryRunMode);
    verboseTimingEnabled = verbose;
    formattingRunStartedAtNanoseconds = readMonotonicNanoseconds();
}

/**
 * Resolve metadata about the requested target and ensure it can be formatted.
 *
 * @param {string} targetPath
 * @param {string} usage
 * @param {string} [originalInput] - The original user input before path resolution
 * @returns {Promise<{ targetIsDirectory: boolean, projectRoot: string }>}
 */
async function resolveTargetContext(targetPath, usage, originalInput) {
    const normalizedTargetPath = await resolveFormatTargetPath(targetPath, usage, originalInput);
    const targetStats = await resolveTargetStats(normalizedTargetPath, { usage, originalInput });
    const targetIsDirectory = targetStats.isDirectory();

    if (!targetIsDirectory && !targetStats.isFile()) {
        throw new CliUsageError(`${normalizedTargetPath} is not a file or directory that can be formatted`, { usage });
    }

    const projectRoot = targetIsDirectory ? normalizedTargetPath : path.dirname(normalizedTargetPath);

    return { targetIsDirectory, projectRoot, targetPath: normalizedTargetPath };
}

/**
 * Normalize format targets so `.yyp` files behave like project-directory inputs.
 *
 * @param {string} targetPath
 * @param {string} usage
 * @param {string} [originalInput]
 * @returns {Promise<string>}
 */
async function resolveFormatTargetPath(targetPath, usage, originalInput) {
    if (!targetPath.toLowerCase().endsWith(".yyp")) {
        return targetPath;
    }

    const targetStats = await resolveTargetStats(targetPath, { usage, originalInput });
    if (!targetStats.isFile()) {
        throw new CliUsageError(`${targetPath} is not a .yyp file that can be formatted`, { usage });
    }

    return path.dirname(targetPath);
}

/**
 * Format a single-file target when the CLI input does not resolve to a directory.
 *
 * @param {string} targetPath
 */
async function formatNonDirectoryTarget(targetPath) {
    if (shouldFormatFile(targetPath)) {
        await formatSingleFile(targetPath, baseProjectIgnorePaths);
        return;
    }

    recordUnsupportedExtension(targetPath);
}

/**
 * Execute formatting for the resolved target after validation.
 *
 * @param {{ targetPath: string, targetIsDirectory: boolean, projectRoot: string }} params
 */
async function formatResolvedTarget({ targetPath, targetIsDirectory, projectRoot }) {
    await initializeProjectIgnorePaths(projectRoot);

    if (targetIsDirectory) {
        await formatDirectoryRecursively(targetPath);
        return;
    }

    await formatNonDirectoryTarget(targetPath);
}

/**
 * Emit summary information about a formatting run.
 *
 * @param {{ targetPath: string, targetIsDirectory: boolean }} params
 */
function finalizeFormattingRun({ targetPath, targetIsDirectory, targetPathProvided }) {
    if (encounteredFormattableFile) {
        if (dryRunModeEnabled) {
            logDryRunModeSummary();
        } else {
            logWriteModeSummary({
                targetPath,
                targetIsDirectory,
                targetPathProvided
            });
        }
        logSkippedFileSummary();
    } else {
        logNoMatchingFiles({
            targetPath,
            targetIsDirectory,
            targetPathProvided,
            extensions: TARGET_EXTENSIONS
        });
    }

    if (dryRunModeEnabled && pendingFormatCount > 0) {
        process.exitCode = 1;
    }
    if (encounteredFormattingError) {
        logFormattingErrorSummary();
        process.exitCode = 1;
    }

    if (verboseTimingEnabled) {
        const elapsedNanoseconds = calculateElapsedNanoseconds({
            startedAtNanoseconds: formattingRunStartedAtNanoseconds,
            completedAtNanoseconds: readMonotonicNanoseconds()
        });
        const label = timedFormattableFileCount === 1 ? "file" : "files";
        console.log(
            `Verbose timing: processed ${timedFormattableFileCount} formattable ${label} in ${formatElapsedNanosecondsAsMilliseconds(elapsedNanoseconds)}.`
        );
    }
}

/**
 * Fully execute the formatting workflow for a validated target path.
 *
 * @param {{ targetPath: string, usage: string, originalInput?: string }} params
 */
async function runFormattingWorkflow({ targetPath, usage, targetPathProvided, originalInput }) {
    const {
        targetPath: resolvedTargetPath,
        targetIsDirectory,
        projectRoot
    } = await resolveTargetContext(targetPath, usage, originalInput);

    await formatResolvedTarget({
        targetPath: resolvedTargetPath,
        targetIsDirectory,
        projectRoot
    });

    finalizeFormattingRun({
        targetPath: resolvedTargetPath,
        targetIsDirectory,
        targetPathProvided
    });
}

function printFormatCommandSettings(commandOptions: ReturnType<typeof collectFormatCommandOptions>): void {
    console.log(
        `Target path: ${typeof commandOptions.targetPathInput === "string" ? commandOptions.targetPathInput : "(cwd)"}`
    );
    console.log(
        `Execution mode: ${commandOptions.dryRunMode ? "dry-run (default, no writes)" : "apply changes (--write)"}`
    );
    console.log(`Verbose mode: ${commandOptions.verbose ? "enabled" : "disabled"}`);
    console.log(`Config path: ${commandOptions.configPath ?? "(auto-discover gmloop.json in project root)"}`);
    console.log(`Log level: ${commandOptions.prettierLogLevel}`);
    console.log(`Parse error mode: ${commandOptions.onParseError}`);
    console.log(
        `Ignored directory sample limit: ${String(commandOptions.skippedDirectorySampleLimit ?? getDefaultSkippedDirectorySampleLimit())}`
    );
    console.log(
        `Ignored file sample limit: ${String(commandOptions.ignoredFileSampleLimit ?? getDefaultIgnoredFileSampleLimit())}`
    );
    console.log(
        `Unsupported extension sample limit: ${String(
            commandOptions.unsupportedExtensionSampleLimit ?? getDefaultUnsupportedExtensionSampleLimit()
        )}`
    );
}

export async function runFormatCommand(command) {
    const commandOptions = collectFormatCommandOptions(command, {
        defaultParseErrorAction: DEFAULT_PARSE_ERROR_ACTION,
        defaultPrettierLogLevel: DEFAULT_PRETTIER_LOG_LEVEL
    });
    const {
        usage,
        list,
        targetPathInput,
        targetPathProvided,
        rawTargetPathInput,
        skippedDirectorySampleLimit,
        ignoredFileSampleLimit,
        unsupportedExtensionSampleLimit,
        configPath
    } = commandOptions;

    if (list) {
        printFormatCommandSettings(commandOptions);
        return;
    }

    // If the targetPath looks like a help flag, display help instead of treating it as a path.
    // This handles cases where --help is passed after -- (e.g., `pnpm run format:gml -- --help`)
    // and gets interpreted as a positional argument rather than a flag.
    if (targetPathProvided && isHelpRequest(targetPathInput)) {
        command.outputHelp();
        return;
    }

    validateTargetPathInput(commandOptions);

    const targetPath = resolveTargetPathFromInput(targetPathInput, {
        rawTargetPathInput
    });
    const projectFormatOverrides = await resolveProjectFormatOverrides(configPath, targetPath);
    Object.assign(options, projectFormatOverrides);

    // Keep the original input (before path resolution) for better error messages
    const originalInput = typeof targetPathInput === "string" ? targetPathInput : undefined;

    await prepareFormattingRun({
        prettierLogLevel: commandOptions.prettierLogLevel,
        onParseError: commandOptions.onParseError,
        skippedDirectorySampleLimit,
        ignoredFileSampleLimit,
        unsupportedExtensionSampleLimit,
        dryRunMode: commandOptions.dryRunMode,
        verbose: commandOptions.verbose
    });

    try {
        await runFormattingWorkflow({
            targetPath,
            usage,
            targetPathProvided,
            originalInput
        });
    } finally {
        await discardFormattedFileOriginalContents();
    }
}

function logNoMatchingFiles({ targetPath, targetIsDirectory, targetPathProvided, extensions }) {
    const formattedExtensions = formatExtensionListForDisplay(extensions);
    const formattedTarget = formatPathForDisplay(targetPath);
    const locationDescription = targetIsDirectory
        ? describeDirectoryWithoutMatches({
              formattedTargetPath: formattedTarget,
              targetPathProvided
          })
        : formattedTarget;
    const nothingToFormatMessage = "Nothing to format.";
    const exampleGuidance = `For example: ${FORMAT_COMMAND_CLI_EXAMPLE} or ${FORMAT_COMMAND_WORKSPACE_EXAMPLE}.`;
    const guidance = targetIsDirectory
        ? [
              `Provide a directory or file containing ${GML_EXTENSION} sources.`,
              exampleGuidance,
              "Update your .prettierignore files if this is unexpected."
          ].join(" ")
        : [
              `Pass a ${GML_EXTENSION} file or a directory containing ${GML_EXTENSION} files, or adjust your .prettierignore files if this is unexpected.`,
              exampleGuidance
          ].join(" ");
    const ignoredFilesSkipped = skippedFileSummary.ignored > 0;
    const ignoredMessageSuffix = "Adjust your .prettierignore files or refine the target path if this is unexpected.";

    if (targetIsDirectory) {
        if (ignoredFilesSkipped) {
            console.log(
                [
                    `All files matching ${formattedExtensions} were skipped ${locationDescription} by ignore rules.`,
                    nothingToFormatMessage,
                    ignoredMessageSuffix
                ].join(" ")
            );
        } else {
            console.log(
                [
                    `No files matching ${formattedExtensions} were found ${locationDescription}.`,
                    nothingToFormatMessage,
                    guidance
                ].join(" ")
            );
        }
    } else {
        if (ignoredFilesSkipped) {
            console.log(
                [
                    `${locationDescription} was skipped by ignore rules and not formatted.`,
                    nothingToFormatMessage,
                    ignoredMessageSuffix
                ].join(" ")
            );
        } else {
            console.log(
                [
                    `${locationDescription} does not match the supported extension ${formattedExtensions}.`,
                    nothingToFormatMessage,
                    guidance
                ].join(" ")
            );
        }
    }

    logSkippedFileSummary();
}

function describeDirectoryWithoutMatches({ formattedTargetPath, targetPathProvided }) {
    if (!targetPathProvided) {
        return "in the current working directory (.)";
    }

    if (formattedTargetPath === ".") {
        return "in the current directory";
    }

    return `in ${formattedTargetPath}`;
}

function logDryRunModeSummary() {
    if (pendingFormatCount === 0) {
        console.log("All matched files are already formatted.");
        return;
    }

    const label = pendingFormatCount === 1 ? "file requires" : "files require";
    console.log(`${pendingFormatCount} ${label} formatting. Re-run with --write to write changes.`);
}

function logWriteModeSummary({
    targetPath,
    targetIsDirectory,
    targetPathProvided
}: {
    targetPath?: string;
    targetIsDirectory?: boolean;
    targetPathProvided?: boolean;
}) {
    if (formattedFileCount === 0) {
        console.log("All matched files are already formatted.");
        return;
    }

    const label = formattedFileCount === 1 ? "file" : "files";

    // Try to include a location phrase when logging from directory targets.
    // The tests expect a phrase like "found in the current working directory (.)"
    // which we'll construct without duplicating punctuation.
    let message = `Formatted ${formattedFileCount} ${label}.`;
    if (targetIsDirectory) {
        // Compose a phrase for the location that avoids starting with 'in ' so
        // we can naturaly say 'found in <location>'.
        const formattedTarget = formatPathForDisplay(targetPath || ".");
        const locationPhrase = formatLocationPhrase({
            formattedTargetPath: formattedTarget,
            targetPathProvided
        });
        message = `Formatted ${formattedFileCount} ${label} found in ${locationPhrase}.`;
        // When the wrapper runs against the current working directory (no
        // explicit target path provided) remind users of the recommended
        // CLI/workspace wrapper usage examples so they can adopt a scoped
        // workflow rather than running across the repository.
        if (!targetPathProvided) {
            const exampleGuidance = `For example: ${FORMAT_COMMAND_CLI_EXAMPLE} or ${FORMAT_COMMAND_WORKSPACE_EXAMPLE}.`;
            message = `${message} ${exampleGuidance}`;
        }
    }

    console.log(message);
}

function formatLocationPhrase({
    formattedTargetPath,
    targetPathProvided
}: {
    formattedTargetPath: string;
    targetPathProvided: boolean | undefined;
}) {
    // For the current working directory invocation where no targetPath was
    // provided we prefer the explicit phrase used elsewhere in the CLI helpers
    // without a leading 'in', so it can be used following 'found'.
    if (!targetPathProvided) {
        return "the current working directory (.)";
    }

    if (formattedTargetPath === ".") {
        return "the current directory";
    }

    return formattedTargetPath;
}

function logFormattingErrorSummary() {
    if (formattingErrorCount === 0) {
        return;
    }

    const failureLabel = formattingErrorCount === 1 ? "file" : "files";
    console.error(
        [
            `Formatting failed for ${formattingErrorCount} ${failureLabel}.`,
            "Review the errors above for details.",
            "Adjust --on-parse-error (skip, abort, or revert) if you need to change how failures are handled."
        ].join(" ")
    );
}

/**
 * Build human-readable detail messages describing skipped file categories.
 *
 * @param {{
 *     ignored: number,
 *     unsupportedExtension: number,
 *     unsupportedExtensionSamples: readonly string[],
 *     symbolicLink: number
 * }} summary
 * @returns {string[]}
 */
function formatExampleSuffix(formattedSamples, totalCount) {
    if (formattedSamples.length === 0) {
        return "";
    }

    const sampleList = formattedSamples.join(", ");
    const ellipsis = totalCount > formattedSamples.length ? ", ..." : "";
    return ` (e.g., ${sampleList}${ellipsis})`;
}

function formatIgnoredFileSample(sample) {
    if (!sample || typeof sample !== "object") {
        return null;
    }

    const { filePath, sourceDescription } = sample;
    if (typeof filePath !== "string" || filePath.length === 0) {
        return null;
    }

    const formattedPath = formatPathForDisplay(filePath);

    if (!sourceDescription || sourceDescription === "ignored") {
        return formattedPath;
    }

    return `${formattedPath} (${sourceDescription})`;
}

function formatIgnoredDetail({ ignored, ignoredSamples }) {
    if (ignored <= 0) {
        return null;
    }

    const formattedSamples = compactArray((ignoredSamples ?? []).map((sample) => formatIgnoredFileSample(sample)));
    const suffix = formatExampleSuffix(formattedSamples, ignored);

    return `ignored by .prettierignore (${ignored})${suffix}`;
}

function formatUnsupportedExtensionSample(sample) {
    if (typeof sample !== "string" || sample.length === 0) {
        return null;
    }

    return formatPathForDisplay(sample);
}

function formatUnsupportedExtensionDetail({ unsupportedExtension, unsupportedExtensionSamples }) {
    if (unsupportedExtension <= 0) {
        return null;
    }

    const formattedSamples = compactArray(
        (unsupportedExtensionSamples ?? []).map((sample) => formatUnsupportedExtensionSample(sample))
    );
    const suffix = formatExampleSuffix(formattedSamples, unsupportedExtension);

    return `unsupported extensions (${unsupportedExtension})${suffix}`;
}

function formatSymbolicLinkDetail(symbolicLink) {
    if (symbolicLink <= 0) {
        return null;
    }

    return `symbolic links (${symbolicLink})`;
}

function buildSkippedFileDetailEntries({
    ignored,
    ignoredSamples,
    unsupportedExtension,
    unsupportedExtensionSamples,
    symbolicLink
}) {
    const detailEntries = [];

    const ignoredDetail = formatIgnoredDetail({
        ignored,
        ignoredSamples
    });
    if (ignoredDetail) {
        detailEntries.push(ignoredDetail);
    }

    const unsupportedExtensionDetail = formatUnsupportedExtensionDetail({
        unsupportedExtension,
        unsupportedExtensionSamples
    });
    if (unsupportedExtensionDetail) {
        detailEntries.push(unsupportedExtensionDetail);
    }

    const symbolicLinkDetail = formatSymbolicLinkDetail(symbolicLink);
    if (symbolicLinkDetail) {
        detailEntries.push(symbolicLinkDetail);
    }

    return detailEntries;
}

function logSkippedFileSummary() {
    const directorySummaryMessage = buildSkippedDirectorySummaryMessage();

    if (directorySummaryMessage) {
        console.log(directorySummaryMessage);
    }

    const skippedFileCount =
        skippedFileSummary.ignored + skippedFileSummary.unsupportedExtension + skippedFileSummary.symbolicLink;
    const skipLabel = skippedFileCount === 1 ? "file" : "files";
    const summary = `Skipped ${skippedFileCount} ${skipLabel}.`;

    if (skippedFileCount === 0) {
        console.log(summary);
        return;
    }

    const detailEntries = buildSkippedFileDetailEntries(skippedFileSummary);

    if (detailEntries.length === 0) {
        console.log(summary);
        return;
    }

    console.log(`${summary} Breakdown: ${detailEntries.join("; ")}.`);
}

function buildSkippedDirectorySummaryMessage() {
    const { ignored, ignoredSamples } = skippedDirectorySummary;

    if (ignored === 0) {
        return null;
    }

    const label = ignored === 1 ? "directory" : "directories";
    const formattedSamples = ignoredSamples.map((directory) => formatPathForDisplay(directory));

    if (formattedSamples.length === 0) {
        return `Skipped ${ignored} ${label} ignored by .prettierignore.`;
    }

    const exampleSuffix = formatExampleSuffix(formattedSamples, ignored);
    return `Skipped ${ignored} ${label} ignored by .prettierignore${exampleSuffix}.`;
}

function areIgnoredFileSamplesEqual(existing, candidate) {
    return existing?.filePath === candidate?.filePath && existing?.sourceDescription === candidate?.sourceDescription;
}

function recordIgnoredFile({ filePath, sourceDescription }) {
    skippedFileSummary.ignored += 1;

    const limit = ignoredFileSampleLimitState.getLimit();
    const sample = { filePath, sourceDescription };

    if (tryAddSample(skippedFileSummary.ignoredSamples, sample, limit, areIgnoredFileSamplesEqual)) {
        console.log(`Skipping ${filePath} (${sourceDescription})`);
    }
}
function recordUnsupportedExtension(filePath) {
    skippedFileSummary.unsupportedExtension += 1;
    const limit = unsupportedExtensionSampleLimitState.getLimit();
    tryAddSample(skippedFileSummary.unsupportedExtensionSamples, filePath, limit);
}

// Export test helpers for internal testing
export const __formatTest__ = Object.freeze({
    resetFormattingSessionForTests: resetFormattingSession,
    configurePrettierOptionsForTests: configurePrettierOptions,
    getPrettierOptionsForTests: () => options,
    validateTargetPathInputForTests: validateTargetPathInput,
    resolveTargetPathFromInputForTests: resolveTargetPathFromInput,
    resolveProjectIgnorePathsForTests: resolveProjectIgnorePaths,
    clearFormattingCacheForTests: clearFormattingCache,
    getFormattingCacheStatsForTests: getFormattingCacheStats,
    setFormattingCacheEntryForTests: (cacheKey: string, formatted: string) =>
        storeFormattingCacheEntry(cacheKey, formatted),
    getFormattingCacheKeysForTests: getFormattingCacheKeys,
    createFormattingCacheKeyForTests: createFormattingCacheKey,
    // Memory management test helpers
    getMemoryManagementStatsForTests: () => ({
        inMemorySnapshotCount,
        maxInMemorySnapshots: MAX_IN_MEMORY_SNAPSHOTS,
        processedFileCount,
        periodicCleanupInterval: PERIODIC_CLEANUP_INTERVAL,
        formattedFileOriginalContentsSize: formattedFileOriginalContents.size,
        inlineSnapshotBytes: [...formattedFileOriginalContents.values()].reduce((total, snapshot) => {
            if (!snapshot || typeof snapshot !== "object" || snapshot.inlineContents === null) {
                return total;
            }

            return total + snapshot.inlineContents.length * 2;
        }, 0)
    }),
    setInMemorySnapshotCountForTests: (count: number) => {
        inMemorySnapshotCount = count;
    },
    setProcessedFileCountForTests: (count: number) => {
        processedFileCount = count;
    },
    addFormattedFileSnapshotForTests: (
        filePath: string,
        inlineContents: string | null,
        snapshotPath: string | null = null
    ) => {
        formattedFileOriginalContents.set(filePath, {
            snapshotPath,
            inlineContents
        });
        if (inlineContents !== null) {
            inMemorySnapshotCount += 1;
        }
    },
    clearFormattedFileSnapshotsForTests: () => {
        formattedFileOriginalContents.clear();
        inMemorySnapshotCount = 0;
    },
    collectInlineSnapshotsForEvictionForTests: collectInlineSnapshotsForEviction,
    enforceSnapshotMemoryLimitForTests: enforceSnapshotMemoryLimit,
    performPeriodicMemoryCleanupForTests: performPeriodicMemoryCleanup
});
