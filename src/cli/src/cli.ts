/**
 * Command-line interface for running utilities for this project.
 *
 * Commands provided include:
 * - A wrapper around the GML-Prettier plugin to provide a convenient
 *   way to format GameMaker Language files.
 * - Direct GML -> JavaScript transpilation utilities for file/directory targets.
 * - Watch mode for monitoring GML source files and coordinating the
 *   hot-reload pipeline (transpiler, semantic analysis, patch streaming).
 * - Regression testing utilities.
 * - Generating/retrieving GML identifiers and Feather metadata (via the GameMaker manual).
 *
 * This CLI is primarily intended for use in development and CI environments.
 * For formatting GML files, it is recommended to use the Prettier CLI or
 * editor integrations directly.
 */

import process from "node:process";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { type CliCatalogEntry, createCliCommandCatalog } from "./cli-core/command-catalog.js";
import { createCliCommandManager } from "./cli-core/command-manager.js";
import { applyStandardCommandOptions } from "./cli-core/command-standard-options.js";
import { handleCliError } from "./cli-core/errors.js";
import { createMcpToolCatalogEntries, type McpToolCatalogEntry } from "./cli-core/mcp-tool-catalog.js";
import { resolveCliVersion } from "./cli-core/version.js";
import { createCollectStatsCommand, runCollectStats } from "./commands/collect-stats.js";
import { createFixCommand, runFixCommand } from "./commands/fix.js";
import { __formatTest__, createFormatCommand, runFormatCommand } from "./commands/format.js";
import { createFeatherMetadataCommand, runGenerateFeatherMetadata } from "./commands/generate-feather-metadata.js";
import { createGenerateIdentifiersCommand, runGenerateGmlIdentifiers } from "./commands/generate-gml-identifiers.js";
import { createGenerateQualityReportCommand, runGenerateQualityReport } from "./commands/generate-quality-report.js";
import { createGraphCommand } from "./commands/graph.js";
import { createLintCommand, runLintCommand } from "./commands/lint.js";
import { createLookupGmlIdentifierCommand, runLookupGmlIdentifierCommand } from "./commands/lookup-gml-identifier.js";
import { createParseCommand, runParseCommand } from "./commands/parse.js";
import { createPrepareHotReloadCommand, runPrepareHotReloadCommand } from "./commands/prepare-hot-reload.js";
import { createRefactorCommand, runRefactorCommand } from "./commands/refactor.js";
import { createTranspileCommand, runTranspileCommand } from "./commands/transpile.js";
import { createWatchCommand, runWatchCommand } from "./commands/watch.js";
import { createWatchStatusCommand, runWatchStatusCommand } from "./commands/watch/status.js";
import { CLI_COMMAND_NAMES } from "./shared/command-names.js";
import { isCliRunSkipped, SKIP_CLI_RUN_ENV_VAR } from "./shared/skip-cli-run.js";

function normalizeWriteChunk(chunk: string | Uint8Array, encoding?: BufferEncoding): string {
    return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(encoding);
}

const { isNonEmptyArray } = Core;

const FORMAT_ACTION = "format";
const HELP_ACTION = "help";

function resolveDefaultAction() {
    return process.env.PRETTIER_PLUGIN_GML_DEFAULT_ACTION === FORMAT_ACTION ? FORMAT_ACTION : HELP_ACTION;
}

function isNodeTestRunnerProcess(execArguments: ReadonlyArray<string> = process.execArgv): boolean {
    return execArguments.some(
        (argument) => argument === "--test" || argument.startsWith("--test=") || argument.startsWith("--test-")
    );
}

function shouldAutoRunCliProcess(
    env: NodeJS.ProcessEnv = process.env,
    execArguments: ReadonlyArray<string> = process.execArgv
): boolean {
    return !isCliRunSkipped(env) && !isNodeTestRunnerProcess(execArguments);
}

function normalizeCommandLineArguments(argv) {
    const normalizedArgs = normalizeArgumentList(argv);
    const withoutSeparator = stripPnpmArgumentSeparators(normalizedArgs);
    return resolveHelpAliasArguments(withoutSeparator);
}

function normalizeArgumentList(argv) {
    return isNonEmptyArray(argv) ? [...argv] : [];
}

function stripPnpmArgumentSeparators(args) {
    // pnpm forwards script arguments through `--`, which can show up as
    // standalone tokens in argv (e.g., `format -- --check`). These separators
    // are transport-only and should not reach command handlers because they can
    // be misinterpreted as a positional path.
    return args.filter((argument) => argument !== "--");
}

function resolveHelpAliasArguments(args) {
    if (args.length === 0) {
        // When no arguments are provided, default behavior depends on
        // PRETTIER_PLUGIN_GML_DEFAULT_ACTION environment variable.
        // Default is to show help (user-friendly for first-time users).
        // Set PRETTIER_PLUGIN_GML_DEFAULT_ACTION to "format" for legacy behavior.
        return resolveDefaultAction() === FORMAT_ACTION ? [] : ["--help"];
    }

    if (isStandaloneHelpRequest(args)) {
        return ["--help"];
    }

    if (!isHelpAliasCommand(args)) {
        return normalizeFormatCommandHelpShortcut(args);
    }

    return resolveHelpAliasCommandArguments(args);
}

function normalizeFormatCommandHelpShortcut(args) {
    const firstArgument = args[0];
    if (typeof firstArgument !== "string") {
        return args;
    }

    const normalizedFirstArgument = firstArgument.trim().toLowerCase();
    if (normalizedFirstArgument.length === 0) {
        return args;
    }

    if (normalizedFirstArgument.startsWith("-")) {
        return args;
    }

    if (CLI_COMMAND_NAMES.has(normalizedFirstArgument)) {
        return args;
    }

    if (containsHelpFlag(args)) {
        return [FORMAT_ACTION, "--help"];
    }

    return [FORMAT_ACTION, "--path", firstArgument, ...args.slice(1)];
}

function containsHelpFlag(args) {
    return args.some((argument) => argument === "--help" || argument === "-h");
}

function isHelpRequest(input: unknown): boolean {
    if (typeof input !== "string") {
        return false;
    }

    const normalized = input.trim().toLowerCase();
    return normalized === "--help" || normalized === "-h" || normalized === "help";
}

function isStandaloneHelpRequest(args) {
    return args.length === 1 && isHelpRequest(args[0]);
}

function isHelpAliasCommand(args) {
    return args[0] === "help";
}

function resolveHelpAliasCommandArguments(args) {
    if (args.length === 1) {
        return ["--help"];
    }

    return [...args.slice(1), "--help"];
}

const program = applyStandardCommandOptions(new Command())
    .name("prettier-plugin-gml")
    .usage("[command] [options]")
    .description(
        [
            "Utilities for working with the GMLoop toolchain.",
            "Provides formatting, benchmarking, and manual data generation commands.",
            resolveDefaultAction() === FORMAT_ACTION
                ? `Defaults to running the ${FORMAT_ACTION} command when no command is provided.`
                : [
                      `Run with a command name to get started (e.g., '${FORMAT_ACTION} --help' for formatting options).`,
                      `Tip: passing only a file or directory path runs '${FORMAT_ACTION}' for that target.`
                  ].join(" ")
        ].join(" \n")
    )
    .version(resolveCliVersion(), "-V, --version", "Show CLI version information.");

export const { registry: cliCommandRegistry, runner: cliCommandRunner } = createCliCommandManager({
    program,
    onUnhandledError: (error) =>
        handleCliError(error, {
            prefix: "Failed to run GMLoop CLI.",
            exitCode: 1
        })
});

export { normalizeCommandLineArguments };

/** Well-known name used as the contract discriminant for {@link CliTestExit}. */
const CLI_TEST_EXIT_NAME = "CliTestExit";

class CliTestExit extends Error {
    public readonly exitCode: number;

    constructor(exitCode: number) {
        super(`Cli test exit (${exitCode})`);
        this.name = CLI_TEST_EXIT_NAME;
        this.exitCode = exitCode;
    }
}

/**
 * Determine whether a caught value is a {@link CliTestExit} sentinel using the
 * well-known name string as the contract discriminant rather than `instanceof`.
 */
function isCliTestExit(value: unknown): value is CliTestExit {
    if (value === null || value === undefined || typeof value !== "object") {
        return false;
    }

    const candidate = value as { name?: unknown; exitCode?: unknown };
    return candidate.name === CLI_TEST_EXIT_NAME && typeof candidate.exitCode === "number";
}

export interface RunCliTestCommandOptions {
    argv?: Array<string>;
    env?: NodeJS.ProcessEnv;
    cwd?: string | URL;
}

export type RunCliCommandCaptureOptions = RunCliTestCommandOptions;

type ConsoleMethodSnapshot = {
    debug: typeof console.debug;
    error: typeof console.error;
    warn: typeof console.warn;
    log: typeof console.log;
    info: typeof console.info;
};

function captureConsoleMethods(): ConsoleMethodSnapshot {
    return {
        debug: console.debug,
        error: console.error,
        warn: console.warn,
        log: console.log,
        info: console.info
    };
}

function restoreConsoleMethods(snapshot: ConsoleMethodSnapshot): void {
    console.debug = snapshot.debug;
    console.error = snapshot.error;
    console.warn = snapshot.warn;
    console.log = snapshot.log;
    console.info = snapshot.info;
}

type EnvironmentOverrideSnapshot = ReadonlyMap<string, string | undefined>;

function applyProcessEnvironmentOverrides(overrides: NodeJS.ProcessEnv): EnvironmentOverrideSnapshot {
    const originalEnvValues = new Map<string, string | undefined>();

    for (const key of Object.keys(overrides)) {
        originalEnvValues.set(key, process.env[key]);
        const override = overrides[key];

        if (override === undefined) {
            delete process.env[key];
            continue;
        }

        process.env[key] = override;
    }

    return originalEnvValues;
}

function restoreProcessEnvironmentOverrides(snapshot: EnvironmentOverrideSnapshot): void {
    for (const [key, value] of snapshot.entries()) {
        if (value === undefined) {
            delete process.env[key];
            continue;
        }

        process.env[key] = value;
    }
}

type ProcessOutputCapture = {
    capturedStdout: Array<string>;
    capturedStderr: Array<string>;
    restore(): void;
};

function startProcessOutputCapture(): ProcessOutputCapture {
    const capturedStdout: Array<string> = [];
    const capturedStderr: Array<string> = [];
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    const createCaptureWrite =
        (target: Array<string>): typeof process.stdout.write =>
        (chunk, encodingOrCallback?, callback?) => {
            const encoding =
                typeof encodingOrCallback === "string" ? (encodingOrCallback as BufferEncoding) : undefined;
            const text = normalizeWriteChunk(chunk as string | Uint8Array, encoding);
            target.push(text);

            const cb = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;

            if (typeof cb === "function") {
                cb();
            }

            return true;
        };

    process.stdout.write = createCaptureWrite(capturedStdout);
    process.stderr.write = createCaptureWrite(capturedStderr);

    return {
        capturedStdout,
        capturedStderr,
        restore(): void {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
        }
    };
}

export async function runCliCommandCapture({ argv = [], env = {}, cwd }: RunCliCommandCaptureOptions = {}) {
    const envOverrides = {
        ...env,
        [SKIP_CLI_RUN_ENV_VAR]: "1"
    };
    const envSnapshot = applyProcessEnvironmentOverrides(envOverrides);
    const originalConsoleMethods = captureConsoleMethods();

    const originalCwd = process.cwd();
    const normalizedCwd =
        typeof cwd === "string" ? cwd : typeof cwd?.toString === "function" ? cwd.toString() : undefined;
    if (normalizedCwd) {
        process.chdir(normalizedCwd);
    }

    const outputCapture = startProcessOutputCapture();

    const originalExit = process.exit.bind(process);
    let exitCode = 0;
    process.exit = ((code = 0) => {
        exitCode = Number.isNaN(Number(code)) ? 0 : Number(code);
        throw new CliTestExit(exitCode);
    }) as typeof process.exit;
    process.exitCode = 0;

    try {
        const normalizedArgs = normalizeCommandLineArguments(argv);
        await cliCommandRunner.run(normalizedArgs);
        exitCode = typeof process.exitCode === "number" && !Number.isNaN(process.exitCode) ? process.exitCode : 0;
    } catch (error) {
        if (isCliTestExit(error)) {
            exitCode = error.exitCode;
        } else {
            throw error;
        }
    } finally {
        process.exit = originalExit;
        process.exitCode = 0;
        outputCapture.restore();
        restoreConsoleMethods(originalConsoleMethods);

        if (normalizedCwd) {
            process.chdir(originalCwd);
        }

        restoreProcessEnvironmentOverrides(envSnapshot);
    }

    return {
        exitCode,
        stdout: outputCapture.capturedStdout.join(""),
        stderr: outputCapture.capturedStderr.join("")
    };
}

export function runCliTestCommand(options: RunCliTestCommandOptions = {}) {
    return runCliCommandCapture(options);
}

export function getCliCommandCatalog(): ReadonlyArray<CliCatalogEntry> {
    return Object.freeze(createCliCommandCatalog(program));
}

export function getMcpToolCatalogEntries(): ReadonlyArray<McpToolCatalogEntry> {
    return createMcpToolCatalogEntries(getCliCommandCatalog());
}

export const __test__ = Object.freeze({
    ...__formatTest__,
    getMcpToolCatalogEntries,
    getCliCommandCatalog,
    isNodeTestRunnerProcess,
    normalizeCommandLineArguments,
    shouldAutoRunCliProcess
});

const formatCommand = createFormatCommand({ name: FORMAT_ACTION });

cliCommandRegistry.registerDefaultCommand({
    command: formatCommand,
    run: ({ command }) => runFormatCommand(command),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to format project.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createGraphCommand(),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Graph command failed.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createLintCommand(),
    run: ({ command }) => runLintCommand(command),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Lint command failed.",
            exitCode: 2
        })
});

cliCommandRegistry.registerCommand({
    command: createLookupGmlIdentifierCommand(),
    run: ({ command }) => runLookupGmlIdentifierCommand(command),
    onError: (error) =>
        handleCliError(error, {
            prefix: "GML identifier lookup command failed.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createParseCommand(),
    run: ({ command }) => runParseCommand(command),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Parse command failed.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createFixCommand(),
    run: ({ command }) => runFixCommand(command),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to run project fix workflow.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createGenerateIdentifiersCommand({ env: process.env }),
    run: ({ command }) => runGenerateGmlIdentifiers({ command }),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to generate GML identifiers.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createGenerateQualityReportCommand(),
    run: ({ command }) => runGenerateQualityReport({ command }),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to generate quality report.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createCollectStatsCommand(),
    run: ({ command }) => runCollectStats({ command }),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to collect project stats.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createFeatherMetadataCommand(),
    run: ({ command }) => runGenerateFeatherMetadata({ command }),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to generate Feather metadata.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createPrepareHotReloadCommand(),
    run: ({ command }) => runPrepareHotReloadCommand(command),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to prepare hot-reload injection.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createRefactorCommand(),
    run: ({ command }) => runRefactorCommand(command),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to perform refactor operation.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createTranspileCommand(),
    run: ({ command }) => runTranspileCommand(command),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Transpile command failed.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createWatchCommand(),
    run: ({ command }) => runWatchCommand(command.args[0], command.opts()),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to start watch mode.",
            exitCode: 1
        })
});

cliCommandRegistry.registerCommand({
    command: createWatchStatusCommand(),
    run: ({ command }) => runWatchStatusCommand(command.opts()),
    onError: (error) =>
        handleCliError(error, {
            prefix: "Failed to query watch status.",
            exitCode: 1
        })
});

if (shouldAutoRunCliProcess()) {
    const normalizedArguments = normalizeCommandLineArguments(process.argv.slice(2));

    try {
        await cliCommandRunner.run(normalizedArguments);
    } catch (error) {
        handleCliError(error, {
            prefix: "Failed to run GMLoop CLI.",
            exitCode: 1
        });
    }
}
