import { constants, existsSync, readdirSync, statSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";
import * as LintWorkspace from "@gmloop/lint";
import { Command } from "commander";
import { ESLint } from "eslint";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import {
    createConfigOption,
    createListOption,
    createPathOption,
    createVerboseOption,
    PATH_OPTION_FLAGS,
    WRITE_OPTION_DESCRIPTION,
    WRITE_OPTION_FLAGS
} from "../cli-core/shared-command-options.js";
import {
    calculateElapsedNanoseconds,
    formatElapsedNanosecondsAsMilliseconds,
    readMonotonicNanoseconds
} from "../shared/timing/elapsed-time.js";
import {
    discoverProjectRoot,
    resolveExistingGmloopConfigPath,
    resolveExplicitWorkflowTargetPath
} from "../workflow/project-root.js";

const FLAT_CONFIG_CANDIDATES = Object.freeze([
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    "eslint.config.mts",
    "eslint.config.cts"
]);

const SUPPORTED_FORMATTERS = new Set(["stylish", "json", "checkstyle"]);
const GML_FILE_EXTENSION = ".gml";
const LINT_RUNTIME_ERROR_RULE_ID = "gml/internal-runtime-error";

const LINT_COMMAND_CLI_EXAMPLE = "pnpm dlx prettier-plugin-gml lint path/to/project";
const LINT_COMMAND_FIX_EXAMPLE = `pnpm dlx prettier-plugin-gml lint ${WRITE_OPTION_FLAGS} path/to/project`;
const LINT_COMMAND_CI_EXAMPLE = `pnpm dlx prettier-plugin-gml lint --max-warnings 0 path/to/script${GML_FILE_EXTENSION}`;

const LINT_NAMESPACE = LintWorkspace.Lint;

type LintCommandOptions = {
    write?: boolean;
    warnIgnored?: boolean;
    formatter?: string;
    maxWarnings?: number;
    quiet?: boolean;
    config?: string;
    noDefaultConfig?: boolean;
    verbose?: boolean;
    path?: string;
    projectStrict?: boolean;
    allowParseErrors?: boolean;
    list?: boolean;
};

type DiscoveryResult = {
    selectedConfigPath: string | null;
    searchedPaths: Array<string>;
};

type ResolvedConfigLike = {
    plugins?: Record<string, unknown> | null | undefined;
    language?: unknown;
    rules?: Record<string, unknown> | null | undefined;
    processor?: unknown;
};

function isResolvedConfigLike(value: unknown): value is ResolvedConfigLike {
    return typeof value === "object" && value !== null;
}

const OVERLAY_WARNING_CODE = "GML_OVERLAY_WITHOUT_LANGUAGE_WIRING";
const OVERLAY_WARNING_MAX_PATH_SAMPLE = 20;
const PROCESSOR_UNSUPPORTED_ERROR_CODE = "GML_PROCESSOR_UNSUPPORTED";
const PROCESSOR_OBSERVABILITY_WARNING_CODE = "GML_PROCESSOR_OBSERVABILITY_UNAVAILABLE";

function discoverFlatConfig(cwd: string): DiscoveryResult {
    const searchedPaths: Array<string> = [];

    for (const directory of Core.walkAncestorDirectories(cwd, { includeSelf: true })) {
        for (const candidate of FLAT_CONFIG_CANDIDATES) {
            const absolutePath = path.join(directory, candidate);
            searchedPaths.push(absolutePath);

            if (existsSync(absolutePath)) {
                return {
                    selectedConfigPath: absolutePath,
                    searchedPaths
                };
            }
        }
    }

    return {
        selectedConfigPath: null,
        searchedPaths
    };
}

function normalizeFormatterName(formatter: string | undefined): string {
    if (typeof formatter !== "string") {
        return "stylish";
    }

    return formatter.toLowerCase();
}

function normalizeLintTargets(command: CommanderCommandLike): Array<string> {
    const args = Array.isArray(command.args) ? command.args : [];
    if (args.length > 0) {
        return args;
    }

    const options = (command.opts?.() ?? {}) as { path?: unknown };
    if (typeof options.path === "string" && options.path.trim().length > 0) {
        return [resolveExplicitWorkflowTargetPath(options.path.trim()) ?? options.path.trim()];
    }

    return ["."];
}

function formatLintTargetLocation(targets: ReadonlyArray<string>): string {
    if (targets.length === 0) {
        return "for the provided paths";
    }

    if (targets.length === 1) {
        return `in ${targets[0]}`;
    }

    return `across ${targets.length} paths`;
}

function emitNoLintableFilesMessage(targets: ReadonlyArray<string>): void {
    const location = formatLintTargetLocation(targets);
    console.warn(
        `No ${GML_FILE_EXTENSION} files were linted ${location}. ` +
            `Lint only processes ${GML_FILE_EXTENSION} sources. ` +
            "Provide a file or directory containing .gml files, for example: " +
            "pnpm dlx prettier-plugin-gml lint path/to/project."
    );
}

function shouldPreferBundledDefaultsForExternalTargets(parameters: {
    cwd: string;
    targets: ReadonlyArray<string>;
}): boolean {
    if (parameters.targets.length === 0) {
        return false;
    }

    const cwdAbsolute = path.resolve(parameters.cwd);
    return parameters.targets.every((target) => {
        const absoluteTarget = path.resolve(parameters.cwd, target);
        if (absoluteTarget.includes(`${path.sep}vendor${path.sep}`)) {
            return true;
        }
        return !Core.isPathInside(absoluteTarget, cwdAbsolute);
    });
}

function findCommonAncestorDirectory(directoryPaths: ReadonlyArray<string>): string {
    if (directoryPaths.length === 0) {
        throw new Error("Expected at least one directory path to compute a common ancestor.");
    }

    let commonAncestor = path.resolve(directoryPaths[0]);
    for (const directoryPath of directoryPaths.slice(1)) {
        const candidateDirectory = path.resolve(directoryPath);

        while (!Core.isPathInside(candidateDirectory, commonAncestor)) {
            const parentDirectory = path.dirname(commonAncestor);
            if (parentDirectory === commonAncestor) {
                return commonAncestor;
            }
            commonAncestor = parentDirectory;
        }
    }

    return commonAncestor;
}

function resolveEslintCwd(parameters: { cwd: string; targets: ReadonlyArray<string> }): string {
    if (!shouldPreferBundledDefaultsForExternalTargets(parameters)) {
        return parameters.cwd;
    }

    const targetDirectories = parameters.targets.map((target) => {
        const absoluteTarget = path.resolve(parameters.cwd, target);

        try {
            const stats = statSync(absoluteTarget);
            if (stats.isDirectory()) {
                return absoluteTarget;
            }
            if (stats.isFile()) {
                return path.dirname(absoluteTarget);
            }
        } catch {
            // For unmatched globs or future files, anchor at the parent directory.
        }

        return path.dirname(absoluteTarget);
    });

    return findCommonAncestorDirectory(targetDirectories);
}

async function resolveForcedProjectRootFromPathOption(forcedProjectPath: string | null): Promise<{
    forcedProjectRoot: string | null;
    validationError: string | null;
}> {
    if (!forcedProjectPath) {
        return {
            forcedProjectRoot: null,
            validationError: null
        };
    }

    const resolvedPath = path.resolve(forcedProjectPath);
    if (resolvedPath.toLowerCase().endsWith(".yyp")) {
        if (!existsSync(resolvedPath)) {
            return {
                forcedProjectRoot: null,
                validationError: `Forced project .yyp path does not exist: ${resolvedPath}`
            };
        }

        let yypStats: ReturnType<typeof statSync>;
        try {
            yypStats = statSync(resolvedPath);
        } catch (error) {
            return {
                forcedProjectRoot: null,
                validationError: `Unable to inspect forced project .yyp path ${resolvedPath}: ${
                    Core.isErrorLike(error) ? error.message : String(error)
                }`
            };
        }

        if (!yypStats.isFile()) {
            return {
                forcedProjectRoot: null,
                validationError: `Forced project .yyp path must be a file: ${resolvedPath}`
            };
        }

        return {
            forcedProjectRoot: path.dirname(resolvedPath),
            validationError: null
        };
    }

    let resolvedStats: ReturnType<typeof statSync>;
    if (!existsSync(resolvedPath)) {
        return {
            forcedProjectRoot: null,
            validationError: `Forced project path does not exist: ${resolvedPath}`
        };
    }

    try {
        resolvedStats = statSync(resolvedPath);
    } catch (error) {
        return {
            forcedProjectRoot: null,
            validationError: `Unable to inspect forced project path ${resolvedPath}: ${
                Core.isErrorLike(error) ? error.message : String(error)
            }`
        };
    }

    if (resolvedStats.isDirectory()) {
        return {
            forcedProjectRoot: resolvedPath,
            validationError: null
        };
    }

    if (resolvedStats.isFile() && resolvedPath.toLowerCase().endsWith(GML_FILE_EXTENSION)) {
        const forcedProjectRoot = await discoverProjectRoot({
            explicitProjectPath: resolvedPath
        });

        return {
            forcedProjectRoot,
            validationError: null
        };
    }

    return {
        forcedProjectRoot: null,
        validationError: `Forced project path must be a directory, .yyp file, or ${GML_FILE_EXTENSION} file: ${resolvedPath}`
    };
}

type LintRuntimeFailureLocation = Readonly<{
    filePath: string | null;
    line: number;
    column: number;
}>;

type LintResultMessageLike = Readonly<{
    ruleId: string | null;
    fatal?: boolean;
}>;

type LintResultLike = Readonly<{
    filePath: string;
    messages?: ReadonlyArray<LintResultMessageLike>;
}>;

type RetainedLintResult = Pick<
    ESLint.LintResult,
    | "filePath"
    | "messages"
    | "suppressedMessages"
    | "errorCount"
    | "fatalErrorCount"
    | "warningCount"
    | "fixableErrorCount"
    | "fixableWarningCount"
    | "usedDeprecatedRules"
>;

type LintMessageWithOptionalAutofixPayload = ESLint.LintResult["messages"][number] & {
    fix?: unknown;
    suggestions?: unknown;
};

function sanitizeLintMessageForRetention<TMessage extends LintMessageWithOptionalAutofixPayload>(
    message: TMessage
): TMessage {
    const { fix: _fix, suggestions: _suggestions, ...retainedMessage } = message;
    return retainedMessage as TMessage;
}

type LintFilesExecutor = Readonly<{
    lintFiles(filePatterns: string | Array<string>): Promise<Array<ESLint.LintResult>>;
}>;

type RecoverableLintTarget = Readonly<{
    target: string;
    fallbackFilePath: string;
}>;

type LintTargetCompletionHandler = (completion: {
    target: string;
    targetResults: Array<ESLint.LintResult>;
    elapsedNanoseconds: bigint;
}) => Promise<void>;

type LintProgressLineWriter = (line: string) => void;

function collectGmlFilesFromDirectory(directoryPath: string): Array<string> {
    const discoveredFilePaths: Array<string> = [];
    const pendingDirectories = [directoryPath];

    while (pendingDirectories.length > 0) {
        const currentDirectory = pendingDirectories.pop();
        if (!currentDirectory) {
            continue;
        }

        let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
        try {
            entries = readdirSync(currentDirectory, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const entryPath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                pendingDirectories.push(entryPath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            if (!entry.name.toLowerCase().endsWith(GML_FILE_EXTENSION)) {
                continue;
            }

            discoveredFilePaths.push(entryPath);
        }
    }

    return discoveredFilePaths.sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));
}

function expandLintTargetsForRecovery(parameters: {
    cwd: string;
    targets: ReadonlyArray<string>;
}): Readonly<{ fileTargets: Array<string>; passthroughTargets: Array<string> }> {
    const fileTargetSet = new Set<string>();
    const passthroughTargets: Array<string> = [];

    for (const target of parameters.targets) {
        const absoluteTarget = path.resolve(parameters.cwd, target);
        if (!existsSync(absoluteTarget)) {
            passthroughTargets.push(target);
            continue;
        }

        let targetStats: ReturnType<typeof statSync>;
        try {
            targetStats = statSync(absoluteTarget);
        } catch {
            passthroughTargets.push(target);
            continue;
        }

        if (targetStats.isDirectory()) {
            for (const discoveredPath of collectGmlFilesFromDirectory(absoluteTarget)) {
                fileTargetSet.add(discoveredPath);
            }
            continue;
        }

        if (targetStats.isFile()) {
            if (absoluteTarget.toLowerCase().endsWith(GML_FILE_EXTENSION)) {
                fileTargetSet.add(absoluteTarget);
            } else {
                passthroughTargets.push(target);
            }
            continue;
        }

        passthroughTargets.push(target);
    }

    return Object.freeze({
        fileTargets: [...fileTargetSet.values()],
        passthroughTargets: [...new Set(passthroughTargets).values()]
    });
}

function extractLintRuntimeFailureLocation(errorMessage: string): LintRuntimeFailureLocation {
    const occurredLineMatch = /^Occurred while linting ([^\n]+)$/mu.exec(errorMessage);
    if (!occurredLineMatch) {
        return Object.freeze({
            filePath: null,
            line: 1,
            column: 1
        });
    }

    const rawLocation = occurredLineMatch[1].trim();
    const locationMatch = /^(.*?)(?::([0-9]+)(?::([0-9]+))?)?$/u.exec(rawLocation);
    if (!locationMatch) {
        return Object.freeze({
            filePath: null,
            line: 1,
            column: 1
        });
    }

    const extractedLine =
        typeof locationMatch[2] === "string" && locationMatch[2].length > 0 ? Number.parseInt(locationMatch[2]) : 1;
    const extractedColumn =
        typeof locationMatch[3] === "string" && locationMatch[3].length > 0 ? Number.parseInt(locationMatch[3]) : 1;

    return Object.freeze({
        filePath: locationMatch[1]?.trim().length ? locationMatch[1].trim() : null,
        line: Number.isFinite(extractedLine) ? extractedLine : 1,
        column: Number.isFinite(extractedColumn) ? extractedColumn : 1
    });
}

function isRecoverableLintRuntimeError(error: unknown): boolean {
    if (!Core.isErrorLike(error)) {
        return false;
    }

    return error.message.includes("Occurred while linting ");
}

function createLintRuntimeErrorResult(parameters: { error: unknown; fallbackFilePath: string }): ESLint.LintResult {
    const rawMessage = Core.getErrorMessage(parameters.error, { fallback: "Unhandled lint runtime error." });
    const [summaryLine] = rawMessage.split(/\r?\n/u);
    const location = extractLintRuntimeFailureLocation(rawMessage);
    const resolvedFilePath = location.filePath ?? parameters.fallbackFilePath;

    const runtimeMessage = Object.freeze({
        ruleId: LINT_RUNTIME_ERROR_RULE_ID,
        severity: 2,
        message: summaryLine && summaryLine.length > 0 ? summaryLine : "Unhandled lint runtime error.",
        line: location.line,
        column: location.column,
        nodeType: null,
        fatal: true
    });

    return Object.freeze({
        filePath: resolvedFilePath,
        messages: [runtimeMessage],
        suppressedMessages: [],
        errorCount: 1,
        fatalErrorCount: 1,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
        usedDeprecatedRules: []
    });
}

async function lintTargetWithRuntimeRecovery(parameters: {
    eslint: LintFilesExecutor;
    target: string;
    fallbackFilePath: string;
}): Promise<Array<ESLint.LintResult>> {
    try {
        return await parameters.eslint.lintFiles([parameters.target]);
    } catch (error) {
        if (!isRecoverableLintRuntimeError(error)) {
            throw error;
        }

        return [
            createLintRuntimeErrorResult({
                error,
                fallbackFilePath: parameters.fallbackFilePath
            })
        ];
    }
}

/**
 * Convert expanded lint targets into the execution order expected by runtime
 * recovery, keeping file targets ahead of passthrough patterns while
 * centralizing fallback path bookkeeping.
 */
function createRecoverableLintTargets(parameters: {
    cwd: string;
    expandedTargets: Readonly<{ fileTargets: Array<string>; passthroughTargets: Array<string> }>;
}): Array<RecoverableLintTarget> {
    return [
        ...parameters.expandedTargets.fileTargets.map((target) =>
            Object.freeze({
                target,
                fallbackFilePath: target
            })
        ),
        ...parameters.expandedTargets.passthroughTargets.map((target) =>
            Object.freeze({
                target,
                fallbackFilePath: path.resolve(parameters.cwd, target)
            })
        )
    ];
}

/**
 * Retain only the stable lint result fields that downstream reporting uses.
 * This keeps the runtime-recovery orchestration focused on sequencing rather
 * than array mutation details.
 */
function appendRetainedLintResults(
    aggregatedResults: Array<ESLint.LintResult>,
    targetResults: Array<ESLint.LintResult>
): void {
    aggregatedResults.push(...targetResults.map(createRetainedLintResult));
}

function lintTargetsWithRuntimeRecovery(parameters: {
    eslint: LintFilesExecutor;
    cwd: string;
    targets: ReadonlyArray<string>;
    onTargetCompleted: LintTargetCompletionHandler;
    createExecutorForTarget?: () => LintFilesExecutor;
}): Promise<Array<ESLint.LintResult>> {
    const expandedTargets = expandLintTargetsForRecovery({
        cwd: parameters.cwd,
        targets: parameters.targets
    });
    const orderedTargets = createRecoverableLintTargets({
        cwd: parameters.cwd,
        expandedTargets
    });
    const aggregatedResults: Array<ESLint.LintResult> = [];

    const runLintTargetsSequentially = async (): Promise<Array<ESLint.LintResult>> => {
        await orderedTargets.reduce<Promise<void>>(async (previousTargetPromise, lintTarget) => {
            await previousTargetPromise;

            const targetStartedAtNanoseconds = readMonotonicNanoseconds();
            const executorForTarget = parameters.createExecutorForTarget
                ? parameters.createExecutorForTarget()
                : parameters.eslint;
            const targetResults = await lintTargetWithRuntimeRecovery({
                eslint: executorForTarget,
                target: lintTarget.target,
                fallbackFilePath: lintTarget.fallbackFilePath
            });

            await parameters.onTargetCompleted({
                target: lintTarget.target,
                targetResults,
                elapsedNanoseconds: calculateElapsedNanoseconds({
                    startedAtNanoseconds: targetStartedAtNanoseconds,
                    completedAtNanoseconds: readMonotonicNanoseconds()
                })
            });

            appendRetainedLintResults(aggregatedResults, targetResults);
        }, Promise.resolve());

        return aggregatedResults;
    };

    return runLintTargetsSequentially();
}

function createRetainedLintResult(result: ESLint.LintResult): RetainedLintResult {
    return {
        filePath: result.filePath,
        messages: result.messages.map(sanitizeLintMessageForRetention),
        suppressedMessages: result.suppressedMessages.map(sanitizeLintMessageForRetention),
        errorCount: result.errorCount,
        fatalErrorCount: result.fatalErrorCount,
        warningCount: result.warningCount,
        fixableErrorCount: result.fixableErrorCount,
        fixableWarningCount: result.fixableWarningCount,
        usedDeprecatedRules: result.usedDeprecatedRules
    };
}

function normalizeMaxWarnings(rawValue: unknown): number {
    if (typeof rawValue === "string") {
        const parsed = Number.parseInt(rawValue);
        return Number.isNaN(parsed) ? -1 : parsed;
    }

    if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
        return -1;
    }

    return rawValue;
}

function resolveCommandOptions(command: CommanderCommandLike): Required<Omit<LintCommandOptions, "config">> & {
    config: string | null;
    path: string | null;
} {
    const options = (command.opts() ?? {}) as LintCommandOptions;

    return {
        write: options.write === true,
        warnIgnored: options.warnIgnored === true,
        formatter: normalizeFormatterName(options.formatter),
        maxWarnings: normalizeMaxWarnings(options.maxWarnings),
        quiet: options.quiet === true,
        config: typeof options.config === "string" && options.config.length > 0 ? options.config : null,
        noDefaultConfig: options.noDefaultConfig === true,
        verbose: options.verbose === true,
        path: typeof options.path === "string" && options.path.length > 0 ? options.path : null,
        list: options.list === true,
        projectStrict: options.projectStrict === true,
        allowParseErrors: options.allowParseErrors === true
    };
}

function printLintCommandSettings(
    options: ReturnType<typeof resolveCommandOptions>,
    targets: ReadonlyArray<string>
): void {
    const targetSummary = targets.length > 0 ? targets.join(", ") : ".";
    console.log(`Targets: ${targetSummary}`);
    console.log(`Path override: ${options.path ?? "(auto-discover from cwd/targets)"}`);
    console.log(`Project strict mode: ${options.projectStrict ? "enabled" : "disabled"}`);
    console.log(`Fix mode: ${options.write ? "enabled (--write)" : "disabled (preview/default)"}`);
    console.log(`Formatter: ${options.formatter}`);
    console.log(`Max warnings: ${String(options.maxWarnings)}`);
    console.log(`Config path: ${options.config ?? "(auto-discover or bundled default)"}`);
    console.log(`Default config fallback: ${options.noDefaultConfig ? "disabled" : "enabled"}`);
    console.log(`Warn ignored files: ${options.warnIgnored ? "enabled" : "disabled"}`);
    console.log(`Verbose mode: ${options.verbose ? "enabled" : "disabled"}`);
}

function printFallbackMessageIfNeeded(parameters: { quiet: boolean; searchedPaths: Array<string> }): void {
    if (parameters.quiet) {
        return;
    }

    const lines = [
        "No user flat config found; using bundled defaults.",
        "To disable this fallback, pass --no-default-config.",
        "Searched locations:",
        ...parameters.searchedPaths.map((entry) => `- ${entry}`)
    ];
    console.warn(lines.join("\n"));
}

function printNoConfigMessageIfNeeded(parameters: { quiet: boolean; searchedPaths: Array<string> }): void {
    if (parameters.quiet) {
        return;
    }

    const lines = [
        "No user flat config found.",
        "Searched locations:",
        ...parameters.searchedPaths.map((entry) => `- ${entry}`)
    ];
    console.warn(lines.join("\n"));
}

async function validateExplicitConfigPath(configPath: string): Promise<void> {
    await access(configPath, constants.R_OK);
}

function isSupportedFormatter(formatterName: string): boolean {
    return SUPPORTED_FORMATTERS.has(formatterName);
}

function resolveExitCode(parameters: { errorCount: number; warningCount: number; maxWarnings: number }): number {
    if (parameters.errorCount > 0) {
        return 1;
    }

    if (parameters.maxWarnings >= 0 && parameters.warningCount > parameters.maxWarnings) {
        return 1;
    }

    return 0;
}

/** Totals aggregated from a set of ESLint lint results. */
type LintTotals = {
    errorCount: number;
    warningCount: number;
};

/** Minimal shape of a lint result needed for aggregating totals. */
type LintResultCountFields = Pick<ESLint.LintResult, "errorCount" | "fatalErrorCount" | "warningCount">;
type LintResultMessageFields = Pick<ESLint.LintResult, "messages">;
type LintAggregateOptions = {
    allowParseErrors: boolean;
};

function countFatalParseMessages(result: LintResultMessageFields): number {
    const messages = Array.isArray(result.messages) ? result.messages : [];
    return messages.filter((message) => {
        if (message?.fatal !== true) {
            return false;
        }

        return typeof message.message === "string" && message.message.startsWith("Parsing error:");
    }).length;
}

/** Minimal shape of a lint result needed for path-based filtering. */
type LintResultPathField = Pick<ESLint.LintResult, "filePath">;

/**
 * Sum the error and warning counts across all lint results.
 * `fatalErrorCount` (parse failures) is folded into `errorCount` because
 * ESLint itself treats fatal errors as errors when computing exit codes.
 */
function aggregateLintTotals(
    results: ReadonlyArray<LintResultCountFields & LintResultMessageFields>,
    options: LintAggregateOptions
): LintTotals {
    return results.reduce<LintTotals>(
        (accumulator, result) => {
            const ignoredParseErrorCount = options.allowParseErrors ? countFatalParseMessages(result) : 0;
            const effectiveErrorCount = Math.max(0, result.errorCount - ignoredParseErrorCount);
            const effectiveFatalErrorCount = Math.max(0, result.fatalErrorCount - ignoredParseErrorCount);
            return {
                errorCount: accumulator.errorCount + effectiveErrorCount + effectiveFatalErrorCount,
                warningCount: accumulator.warningCount + result.warningCount
            };
        },
        { errorCount: 0, warningCount: 0 }
    );
}

function setProcessExitCode(code: number): void {
    process.exitCode = code;
}

function toLintProgressDisplayPath(parameters: { cwd: string; filePath: string }): string {
    const absoluteFilePath = path.resolve(parameters.filePath);
    const absoluteCwd = path.resolve(parameters.cwd);
    const relativePath = path.relative(absoluteCwd, absoluteFilePath);

    if (absoluteFilePath === absoluteCwd) {
        return ".";
    }

    if (relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
        return relativePath;
    }

    return absoluteFilePath;
}

function emitLintFixProgressForResults(parameters: {
    cwd: string;
    results: ReadonlyArray<LintResultLike>;
    writeProgressLine: LintProgressLineWriter;
}): void {
    const emittedPaths = new Set<string>();
    for (const result of parameters.results) {
        const displayPath = toLintProgressDisplayPath({
            cwd: parameters.cwd,
            filePath: result.filePath
        });
        if (emittedPaths.has(displayPath)) {
            continue;
        }

        parameters.writeProgressLine(displayPath);
        emittedPaths.add(displayPath);
    }
}

function emitVerboseLintTargetTiming(parameters: {
    cwd: string;
    target: string;
    targetResults: ReadonlyArray<LintResultLike>;
    elapsedNanoseconds: bigint;
    writeProgressLine: LintProgressLineWriter;
}): void {
    const elapsedText = formatElapsedNanosecondsAsMilliseconds(parameters.elapsedNanoseconds);
    if (parameters.targetResults.length === 0) {
        parameters.writeProgressLine(
            `[timing] Lint target '${parameters.target}' completed in ${elapsedText} (no files matched).`
        );
        return;
    }

    if (parameters.targetResults.length === 1) {
        const firstResult = parameters.targetResults[0];
        const displayPath = toLintProgressDisplayPath({
            cwd: parameters.cwd,
            filePath: firstResult.filePath
        });
        parameters.writeProgressLine(`[timing] Linted ${displayPath} in ${elapsedText}.`);
        return;
    }

    const emittedPaths = new Set<string>();
    for (const result of parameters.targetResults) {
        const displayPath = toLintProgressDisplayPath({
            cwd: parameters.cwd,
            filePath: result.filePath
        });
        if (emittedPaths.has(displayPath)) {
            continue;
        }

        parameters.writeProgressLine(`[timing] Linted ${displayPath} in ${elapsedText} (target batch).`);
        emittedPaths.add(displayPath);
    }
}

function emitVerboseLintRunTimingSummary(parameters: {
    lintedFileCount: number;
    elapsedNanoseconds: bigint;
    writeProgressLine: LintProgressLineWriter;
}): void {
    const fileLabel = parameters.lintedFileCount === 1 ? "file" : "files";
    const elapsedText = formatElapsedNanosecondsAsMilliseconds(parameters.elapsedNanoseconds);
    parameters.writeProgressLine(
        `[timing] Completed lint run for ${parameters.lintedFileCount} ${fileLabel} in ${elapsedText}.`
    );
}

/**
 * Print a confirmation message when all linted files pass with no diagnostics.
 *
 * The message mirrors the `format` command's "All matched files are already
 * formatted." signal, giving users and CI pipelines an unambiguous success
 * indicator instead of a silent exit.  It is intentionally suppressed when:
 * - the ESLint formatter already produced visible output (e.g. the `json` and
 *   `checkstyle` formatters always emit content, so they don't need an extra
 *   line); or
 * - `--quiet` is active (callers have explicitly opted for minimal output).
 */
function emitLintCleanSummary(fileCount: number): void {
    const fileLabel = fileCount === 1 ? "file" : "files";
    console.log(`✓ ${fileCount} ${fileLabel} checked, no problems found.`);
}

function toEslintOverrideConfig(): NonNullable<ConstructorParameters<typeof ESLint>[0]>["overrideConfig"] {
    const entries = LINT_NAMESPACE.configs.recommended.map((entry) => ({
        ...entry,
        files: Array.isArray(entry.files) ? [...entry.files] : undefined
    }));

    return entries as NonNullable<ConstructorParameters<typeof ESLint>[0]>["overrideConfig"];
}

function isCanonicalGmlWiring(config: ResolvedConfigLike): boolean {
    return config.plugins?.gml === LINT_NAMESPACE.plugin && config.language === LINT_NAMESPACE.plugin.languages?.gml;
}

function readArrayFirstEntry(value: unknown): unknown {
    if (!Array.isArray(value) || value.length === 0) {
        return undefined;
    }

    return value[0];
}

function getRuleLevel(value: unknown): unknown {
    if (Array.isArray(value)) {
        return readArrayFirstEntry(value);
    }

    return value;
}

function isOffLevel(level: unknown): boolean {
    if (typeof level === "string") {
        return level.trim().toLowerCase() === "off";
    }

    return level === 0;
}

function isAppliedLevel(level: unknown): boolean {
    if (typeof level === "string") {
        const normalizedLevel = level.trim().toLowerCase();
        if (normalizedLevel === "warn" || normalizedLevel === "error") {
            return true;
        }
    }

    if (level === "warn" || level === "error") {
        return true;
    }

    if (level === 1 || level === 2) {
        return true;
    }

    return false;
}

function isAppliedRuleValue(value: unknown): boolean {
    const level = getRuleLevel(value);
    if (isOffLevel(level)) {
        return false;
    }

    if (isAppliedLevel(level)) {
        return true;
    }

    return true;
}

function hasOverlayRuleApplied(config: ResolvedConfigLike): boolean {
    if (!config.rules) {
        return false;
    }

    for (const [ruleId, rawValue] of Object.entries(config.rules)) {
        if (!isAppliedRuleValue(rawValue)) {
            continue;
        }

        if (ruleId.startsWith("feather/")) {
            return true;
        }

        if (LINT_NAMESPACE.services.performanceOverrideRuleIds.includes(ruleId)) {
            return true;
        }
    }

    return false;
}

function formatOverlayWarning(paths: Array<string>): string {
    const sample = paths.slice(0, OVERLAY_WARNING_MAX_PATH_SAMPLE);
    const remainderCount = paths.length - sample.length;
    const suffix = remainderCount > 0 ? `\nand ${remainderCount} more...` : "";
    const guidance = [
        `${OVERLAY_WARNING_CODE}: Your ESLint config enables GML overlay rules, but the matching config entry is missing the canonical GML language wiring.`,
        'Add `plugins: { gml: Lint.plugin }` and `language: "gml/gml"` to that config entry, or remove the overlay rules from it.',
        "Affected files:"
    ].join("\n");
    return `${guidance}\n${sample.join("\n")}${suffix}`;
}

async function collectOverlayWithoutLanguageWiringPaths(parameters: {
    eslint: Pick<ESLint, "calculateConfigForFile">;
    results: ReadonlyArray<{ filePath: string }>;
}): Promise<Array<string>> {
    const resolvedPaths: Array<string> = [];

    await parameters.results.reduce<Promise<void>>(async (previousResultPromise, result) => {
        await previousResultPromise;

        const resolvedConfig = await parameters.eslint.calculateConfigForFile(result.filePath);
        if (!isResolvedConfigLike(resolvedConfig)) {
            return;
        }

        if (!hasOverlayRuleApplied(resolvedConfig)) {
            return;
        }

        if (!isCanonicalGmlWiring(resolvedConfig)) {
            resolvedPaths.push(result.filePath);
        }
    }, Promise.resolve());

    return resolvedPaths;
}

async function warnOverlayWithoutLanguageWiringIfNeeded(parameters: {
    eslint: Pick<ESLint, "calculateConfigForFile">;
    results: ReadonlyArray<{ filePath: string }>;
    quiet: boolean;
}): Promise<void> {
    if (parameters.quiet) {
        return;
    }

    const offendingPaths = await collectOverlayWithoutLanguageWiringPaths(parameters);
    if (offendingPaths.length === 0) {
        return;
    }

    console.warn(formatOverlayWarning(offendingPaths));
}

function normalizeProcessorIdentityForEnforcement(processor: unknown): string | null {
    if (processor === null || processor === undefined) {
        return null;
    }

    if (typeof processor === "string") {
        const normalized = processor.trim();
        if (normalized.length === 0) {
            return null;
        }

        return normalized;
    }

    return "<non-string-processor>";
}

async function enforceProcessorPolicyForGmlFiles(parameters: {
    eslint: Pick<ESLint, "calculateConfigForFile">;
    results: ReadonlyArray<{ filePath: string }>;
    verbose: boolean;
}): Promise<Readonly<{ exitCode: number; message: string | null; warning: string | null }>> {
    let observedConfig = false;
    const unsupportedProcessorPaths: Array<string> = [];

    await parameters.results.reduce<Promise<void>>(async (previousResultPromise, result) => {
        await previousResultPromise;

        const resolvedConfig = await parameters.eslint.calculateConfigForFile(result.filePath);
        if (!isResolvedConfigLike(resolvedConfig)) {
            return;
        }

        observedConfig = true;
        const processorIdentity = normalizeProcessorIdentityForEnforcement(resolvedConfig.processor);
        if (processorIdentity !== null) {
            unsupportedProcessorPaths.push(result.filePath);
        }
    }, Promise.resolve());

    if (unsupportedProcessorPaths.length > 0) {
        return Object.freeze({
            exitCode: 2,
            message: `${PROCESSOR_UNSUPPORTED_ERROR_CODE}: GML lint does not support active ESLint processors.\n${formatPathSample(unsupportedProcessorPaths)}`,
            warning: null
        });
    }

    if (parameters.verbose && observedConfig) {
        return Object.freeze({
            exitCode: 0,
            message: null,
            warning: `${PROCESSOR_OBSERVABILITY_WARNING_CODE}: Processor identity could not be observed for one or more resolved GML configs.`
        });
    }

    return Object.freeze({
        exitCode: 0,
        message: null,
        warning: null
    });
}

async function loadRequestedFormatter(
    eslint: ESLint,
    formatterName: string
): Promise<{ format: (results: Array<ESLint.LintResult>) => string }> {
    const formatter = await eslint.loadFormatter(formatterName);

    return {
        format: (results) => {
            const output = formatter.format(results);
            return typeof output === "string" ? output : "";
        }
    };
}

function createEslintConstructorOptions(
    cwd: string,
    write: boolean,
    warnIgnored: boolean
): ConstructorParameters<typeof ESLint>[0] {
    return {
        cwd,
        fix: write,
        warnIgnored
    };
}

async function configureLintConfig(parameters: {
    eslintConstructorOptions: ConstructorParameters<typeof ESLint>[0];
    cwd: string;
    targets: ReadonlyArray<string>;
    configPath: string | null;
    noDefaultConfig: boolean;
    quiet: boolean;
}): Promise<number> {
    const { eslintConstructorOptions, cwd, targets, configPath, noDefaultConfig, quiet } = parameters;

    if (configPath) {
        let resolvedGmloopConfigPath: string;
        try {
            resolvedGmloopConfigPath = await resolveExistingGmloopConfigPath(cwd, configPath);
        } catch {
            const fallbackEslintConfigPath = path.resolve(configPath);
            try {
                await validateExplicitConfigPath(fallbackEslintConfigPath);
            } catch (configPathError) {
                console.error(
                    `Failed to read config at ${fallbackEslintConfigPath}: ${
                        Core.isErrorLike(configPathError) ? configPathError.message : String(configPathError)
                    }`
                );
                return 2;
            }

            eslintConstructorOptions.overrideConfigFile = fallbackEslintConfigPath;
            return 0;
        }

        try {
            const gmloopConfig = await Core.loadGmloopProjectConfig(resolvedGmloopConfigPath);
            const lintRuleEntries =
                LINT_NAMESPACE.configs.projectConfig.createLintRuleEntriesFromProjectConfig(gmloopConfig);
            const mergedOverrideEntries = LINT_NAMESPACE.configs.recommended.map((entry) => {
                if (!entry.rules) {
                    return entry;
                }

                return {
                    ...entry,
                    rules: {
                        ...entry.rules,
                        ...lintRuleEntries
                    }
                };
            });
            eslintConstructorOptions.overrideConfigFile = true;
            eslintConstructorOptions.overrideConfig = mergedOverrideEntries as NonNullable<
                ConstructorParameters<typeof ESLint>[0]
            >["overrideConfig"];
            return 0;
        } catch (error) {
            console.error(
                `Failed to load gmloop config at ${resolvedGmloopConfigPath}: ${
                    Core.isErrorLike(error) ? error.message : String(error)
                }`
            );
            return 2;
        }
    }

    const preferBundledDefaults = shouldPreferBundledDefaultsForExternalTargets({
        cwd,
        targets
    });
    if (preferBundledDefaults) {
        eslintConstructorOptions.overrideConfigFile = true;

        if (noDefaultConfig) {
            return 0;
        }

        eslintConstructorOptions.overrideConfig = toEslintOverrideConfig();
        return 0;
    }

    const discoveryResult = discoverFlatConfig(cwd);
    if (discoveryResult.selectedConfigPath) {
        // Intentionally let ESLint resolve and select the active config file natively.
        // This preserves ESLint's sibling-config precedence rules and avoids CLI-side
        // config selection divergence from direct ESLint execution.
        return 0;
    }

    if (noDefaultConfig) {
        eslintConstructorOptions.overrideConfigFile = true;
        printNoConfigMessageIfNeeded({ quiet, searchedPaths: discoveryResult.searchedPaths });
        return 0;
    }

    eslintConstructorOptions.overrideConfigFile = true;
    eslintConstructorOptions.overrideConfig = toEslintOverrideConfig();
    printFallbackMessageIfNeeded({
        quiet,
        searchedPaths: discoveryResult.searchedPaths
    });

    return 0;
}

/** Maximum number of out-of-root file paths shown in warnings and error messages. */
const OUT_OF_ROOT_DISPLAY_LIMIT = 20;

/**
 * Collect the file paths from lint results that fall outside the forced project
 * root. Returns an empty array when no forced root is configured.
 */
function collectOutOfRootFilePaths(
    results: ReadonlyArray<LintResultPathField>,
    forcedProjectRoot: string | null
): Array<string> {
    if (!forcedProjectRoot) {
        return [];
    }

    return results
        .map((result) => result.filePath)
        .filter((filePath) => !Core.isPathWithinBoundary(path.resolve(filePath), forcedProjectRoot));
}

/**
 * Render up to `OUT_OF_ROOT_DISPLAY_LIMIT` paths as a newline-separated
 * string, appending "and N more…" when the list is truncated.
 */
function formatPathSample(paths: ReadonlyArray<string>): string {
    const sample = paths.slice(0, OUT_OF_ROOT_DISPLAY_LIMIT);
    const suffix = paths.length > sample.length ? `\nand ${paths.length - sample.length} more...` : "";
    return `${sample.join("\n")}${suffix}`;
}

/**
 * Format the `GML_PROJECT_OUT_OF_ROOT` warning message for the given list of
 * out-of-root paths. When the list exceeds {@link OUT_OF_ROOT_DISPLAY_LIMIT}
 * entries a trailing "and N more…" line is appended.
 */
function formatOutOfRootWarning(outOfRootPaths: ReadonlyArray<string>): string {
    return `GML_PROJECT_OUT_OF_ROOT:\n${formatPathSample(outOfRootPaths)}`;
}

export function createLintCommand(): Command {
    return applyStandardCommandOptions(
        new Command("lint")
            .description("Lint GameMaker Language files using @gmloop/lint")
            .argument("[paths...]", "File or directory paths to lint")
            .option(WRITE_OPTION_FLAGS, WRITE_OPTION_DESCRIPTION, false)
            .option("--warn-ignored", "Report ignored-file warnings from ESLint output", false)
            .option("--formatter <name>", "Formatter output (stylish|json|checkstyle)", "stylish")
            .option("--max-warnings <count>", "Maximum warning count before exit code 1", "-1")
            .addOption(createConfigOption())
            .option("--no-default-config", "Disable bundled default config fallback")
            .addOption(createPathOption())
            .option("--project-strict", `Fail when lint targets fall outside forced ${PATH_OPTION_FLAGS} root`, false)
            .addOption(createListOption())
            .option("--quiet", "Suppress fallback warnings", false)
            .addOption(createVerboseOption())
            .addHelpText("after", () =>
                [
                    "",
                    "Examples:",
                    `  ${LINT_COMMAND_CLI_EXAMPLE}`,
                    `  ${LINT_COMMAND_FIX_EXAMPLE}`,
                    `  ${LINT_COMMAND_CI_EXAMPLE}`,
                    ""
                ].join("\n")
            )
    );
}

export async function runLintCommand(command: CommanderCommandLike): Promise<void> {
    const options = resolveCommandOptions(command);
    const targets = normalizeLintTargets(command);

    if (options.list) {
        printLintCommandSettings(options, targets);
        return;
    }

    const commandCwd = process.cwd();
    const eslintCwd = resolveEslintCwd({ cwd: commandCwd, targets });
    const eslintConstructorOptions = createEslintConstructorOptions(eslintCwd, options.write, options.warnIgnored);

    if (!isSupportedFormatter(options.formatter)) {
        console.error(
            `Unsupported formatter "${options.formatter}". Supported formatters: ${Array.from(SUPPORTED_FORMATTERS).join(", ")}`
        );
        setProcessExitCode(2);
        return;
    }

    const configExitCode = await configureLintConfig({
        eslintConstructorOptions,
        cwd: commandCwd,
        targets,
        configPath: options.config,
        noDefaultConfig: options.noDefaultConfig,
        quiet: options.quiet
    });

    if (configExitCode !== 0) {
        setProcessExitCode(configExitCode);
        return;
    }

    const { forcedProjectRoot, validationError: forcedProjectValidationError } =
        await resolveForcedProjectRootFromPathOption(options.path);
    if (forcedProjectValidationError) {
        console.error(forcedProjectValidationError);
        setProcessExitCode(2);
        return;
    }

    let eslint: ESLint;
    try {
        eslint = new ESLint(eslintConstructorOptions);
    } catch (error) {
        console.error(Core.isErrorLike(error) ? error.message : String(error));
        setProcessExitCode(2);
        return;
    }

    const lintRunStartedAtNanoseconds = readMonotonicNanoseconds();
    let lintedFileCount = 0;

    let results: Array<ESLint.LintResult>;
    try {
        results = await lintTargetsWithRuntimeRecovery({
            eslint,
            cwd: commandCwd,
            targets,
            createExecutorForTarget: () => new ESLint(eslintConstructorOptions),
            onTargetCompleted: async ({ target, targetResults, elapsedNanoseconds }) => {
                lintedFileCount += targetResults.length;

                if (options.verbose) {
                    emitVerboseLintTargetTiming({
                        cwd: commandCwd,
                        target,
                        targetResults,
                        elapsedNanoseconds,
                        writeProgressLine: (line) => {
                            process.stderr.write(`${line}\n`);
                        }
                    });
                }

                if (!options.write) {
                    return;
                }

                await ESLint.outputFixes(targetResults);
                emitLintFixProgressForResults({
                    cwd: commandCwd,
                    results: targetResults,
                    writeProgressLine: (line) => {
                        process.stderr.write(`${line}\n`);
                    }
                });
            }
        });
    } catch (error) {
        console.error(Core.isErrorLike(error) ? error.message : String(error));
        setProcessExitCode(2);
        return;
    }

    try {
        await warnOverlayWithoutLanguageWiringIfNeeded({ eslint, results, quiet: options.quiet });

        if (results.length === 0) {
            emitNoLintableFilesMessage(targets);
            setProcessExitCode(0);
            return;
        }

        const processorPolicy = await enforceProcessorPolicyForGmlFiles({
            eslint,
            results,
            verbose: options.verbose
        });

        if (processorPolicy.warning) {
            console.warn(processorPolicy.warning);
        }

        if (processorPolicy.exitCode !== 0) {
            if (processorPolicy.message) {
                console.error(processorPolicy.message);
            }

            setProcessExitCode(processorPolicy.exitCode);
            return;
        }

        const outOfRootPaths = collectOutOfRootFilePaths(results, forcedProjectRoot);

        if (!options.quiet && outOfRootPaths.length > 0) {
            console.warn(formatOutOfRootWarning(outOfRootPaths));
        }

        if (options.projectStrict && outOfRootPaths.length > 0) {
            console.error(
                `Project strict mode failed. Forced root: ${forcedProjectRoot ?? "<none>"}\n` +
                    `Offending paths:\n${formatPathSample(outOfRootPaths)}`
            );
            setProcessExitCode(2);
            return;
        }

        try {
            const formatter = await loadRequestedFormatter(eslint, options.formatter);
            const formatterOutput = formatter.format(results);
            if (formatterOutput.length > 0) {
                process.stdout.write(`${formatterOutput}\n`);
            }

            const totals = aggregateLintTotals(results, {
                allowParseErrors: options.allowParseErrors
            });

            const exitCode = resolveExitCode({
                errorCount: totals.errorCount,
                warningCount: totals.warningCount,
                maxWarnings: options.maxWarnings
            });

            // When the stylish formatter produces no output it means no
            // diagnostics were reported.  Emit a single confirmation line so
            // users and CI pipelines get an explicit success signal rather
            // than a silent zero exit, consistent with the format command's
            // "All matched files are already formatted." message.
            //
            // This condition is intentionally formatter-agnostic: the `json`
            // and `checkstyle` formatters always emit non-empty output even
            // for clean runs (a JSON array, an XML document), so
            // `formatterOutput.length === 0` is only true when using `stylish`
            // or any other formatter that is deliberately silent on success.
            // We do not check `options.formatter` by name to avoid hardcoding
            // that assumption and to remain compatible with future formatters
            // that follow the same silent-on-success convention.
            if (exitCode === 0 && formatterOutput.length === 0 && results.length > 0 && !options.quiet) {
                emitLintCleanSummary(results.length);
            }

            setProcessExitCode(exitCode);
        } catch (error) {
            console.error(Core.isErrorLike(error) ? error.message : String(error));
            setProcessExitCode(2);
        }
    } finally {
        if (options.verbose) {
            const elapsedNanoseconds = calculateElapsedNanoseconds({
                startedAtNanoseconds: lintRunStartedAtNanoseconds,
                completedAtNanoseconds: readMonotonicNanoseconds()
            });
            emitVerboseLintRunTimingSummary({
                lintedFileCount,
                elapsedNanoseconds,
                writeProgressLine: (line) => {
                    process.stderr.write(`${line}\n`);
                }
            });
        }
    }
}

export const __lintCommandTest__ = Object.freeze({
    OVERLAY_WARNING_CODE,
    FLAT_CONFIG_CANDIDATES,
    isCanonicalGmlWiring,
    isAppliedRuleValue,
    hasOverlayRuleApplied,
    formatOverlayWarning,
    discoverFlatConfig,
    extractLintRuntimeFailureLocation,
    createRecoverableLintTargets,
    appendRetainedLintResults,
    lintTargetsWithRuntimeRecovery,
    createRetainedLintResult,
    toLintProgressDisplayPath,
    emitLintFixProgressForResults,
    resolveEslintCwd,
    createEslintConstructorOptions,
    shouldPreferBundledDefaultsForExternalTargets,
    normalizeFormatterName,
    isSupportedFormatter,
    validateExplicitConfigPath,
    configureLintConfig,
    collectOverlayWithoutLanguageWiringPaths,
    normalizeProcessorIdentityForEnforcement,
    enforceProcessorPolicyForGmlFiles,
    PROCESSOR_UNSUPPORTED_ERROR_CODE,
    PROCESSOR_OBSERVABILITY_WARNING_CODE,
    aggregateLintTotals,
    collectOutOfRootFilePaths,
    formatPathSample,
    formatOutOfRootWarning,
    OUT_OF_ROOT_DISPLAY_LIMIT,
    emitLintCleanSummary
});
