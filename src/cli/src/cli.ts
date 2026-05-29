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

import { Command } from "commander";

import { registerCliCommands } from "./cli-command-registration.js";
import {
    FORMAT_ACTION,
    normalizeCommandLineArguments,
    resolveDefaultAction
} from "./cli-core/cli-argument-normalization.js";
import { type CliCatalogEntry, createCliCommandCatalog } from "./cli-core/command-catalog.js";
import { createCliCommandManager } from "./cli-core/command-manager.js";
import { applyStandardCommandOptions } from "./cli-core/command-standard-options.js";
import { handleCliError } from "./cli-core/errors.js";
import { createMcpToolCatalogEntries, type McpToolCatalogEntry } from "./cli-core/mcp-tool-catalog.js";
import { resolveCliVersion } from "./cli-core/version.js";
import { __formatTest__ } from "./commands/format.js";
import { __runtimeTestHelpers__ as __runtimeTest__, parseRuntimeValue } from "./commands/runtime.js";
import { isCliRunSkipped, SKIP_CLI_RUN_ENV_VAR } from "./shared/skip-cli-run.js";

function normalizeWriteChunk(chunk: string | Uint8Array, encoding?: BufferEncoding): string {
    return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(encoding);
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

const program = applyStandardCommandOptions(new Command())
    .name("gmloop")
    .usage("[command] [options]")
    .description(
        `Utilities for working with the GMLoop toolchain.
Provides formatting, linting, refactoring, transpiling, graph analysis, runtime workflows, and report generation commands.
${
    resolveDefaultAction() === FORMAT_ACTION
        ? `Defaults to running the ${FORMAT_ACTION} command when no command is provided.`
        : `Run with a command name to get started (e.g., '${FORMAT_ACTION} --help' for formatting options). Tip: passing only a file or directory path runs '${FORMAT_ACTION}' for that target. Use 'help <command>' to open command-specific usage quickly (for example, 'help lint').`
}`
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

export { normalizeCommandLineArguments } from "./cli-core/cli-argument-normalization.js";

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
    process.exit = (code = 0) => {
        exitCode = Number.isNaN(Number(code)) ? 0 : Number(code);
        throw new CliTestExit(exitCode);
    };
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
    ...__runtimeTest__,
    getMcpToolCatalogEntries,
    getCliCommandCatalog,
    isNodeTestRunnerProcess,
    normalizeCommandLineArguments,
    parseRuntimeValue,
    shouldAutoRunCliProcess
});

registerCliCommands({
    defaultCommandName: FORMAT_ACTION,
    env: process.env,
    registry: cliCommandRegistry
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
