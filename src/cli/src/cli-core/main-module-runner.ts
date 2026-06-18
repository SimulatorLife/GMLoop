import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { isCliRunSkipped } from "../shared/skip-cli-run.js";
import { createCliCommandManager } from "./command-manager.js";
import type { CommanderCommandLike } from "./commander-types.js";
import { handleCliError } from "./errors.js";

/**
 * Configuration for running a CLI command as a main module.
 */
export interface RunAsMainModuleOptions {
    /**
     * The name of the command program (e.g., "generate-feather-metadata").
     */
    programName: string;

    /**
     * Factory function that creates the CLI command.
     */
    createCommand: (options?: { env?: NodeJS.ProcessEnv }) => CommanderCommandLike;

    /**
     * Function that executes the command logic.
     */
    run: (context: { command: CommanderCommandLike }) => number | void | Promise<number | void>;

    /**
     * Error message prefix for the command (e.g., "Failed to generate Feather metadata.").
     */
    errorPrefix: string;

    /**
     * Optional environment variables to pass to the command factory.
     * Only passed if the createCommand function requires it.
     */
    env?: NodeJS.ProcessEnv;

    /**
     * Whether to pass options to createCommand. When false, createCommand is called with no arguments.
     * Defaults to true when env is provided, false otherwise.
     */
    passOptionsToCreateCommand?: boolean;
}

function safeRealpath(filePath: string): string | null {
    try {
        return realpathSync(filePath);
    } catch {
        return null;
    }
}

/**
 * Determine whether Node is currently running in test mode.
 *
 * @param execArguments - Process exec arguments to inspect.
 * @returns `true` when the arguments include Node's test-runner flags.
 */
export function isNodeTestRunnerProcess(execArguments: ReadonlyArray<string> = process.execArgv): boolean {
    return execArguments.some(
        (argument) => argument === "--test" || argument.startsWith("--test=") || argument.startsWith("--test-")
    );
}

/**
 * Determine whether the package-level CLI entrypoint is targeting the active CLI module.
 *
 * The compiled package exposes `dist/index.js` as its executable, while source-level
 * tests may exercise `index.ts`. Both package entrypoints re-export `src/cli.js`,
 * so the guard accepts either package entrypoint in addition to the module file itself.
 *
 * @param entrypointPath - The process entrypoint path, usually `process.argv[1]`.
 * @param moduleUrl - The CLI module URL, usually `import.meta.url`.
 * @returns `true` when the entrypoint should trigger the full CLI autorun path.
 */
export function isCliEntrypointModule(
    entrypointPath: string | undefined = process.argv[1],
    moduleUrl = import.meta.url
): boolean {
    if (!entrypointPath) {
        return false;
    }

    const resolvedEntrypoint = safeRealpath(entrypointPath) ?? path.resolve(entrypointPath);
    const resolvedModule = safeRealpath(fileURLToPath(moduleUrl)) ?? fileURLToPath(moduleUrl);

    if (resolvedEntrypoint === resolvedModule) {
        return true;
    }

    const resolvedIndexJs =
        safeRealpath(path.resolve(path.dirname(resolvedModule), "../index.js")) ??
        path.resolve(path.dirname(resolvedModule), "../index.js");
    if (resolvedEntrypoint === resolvedIndexJs) {
        return true;
    }

    const resolvedIndexTs =
        safeRealpath(path.resolve(path.dirname(resolvedModule), "../index.ts")) ??
        path.resolve(path.dirname(resolvedModule), "../index.ts");
    return resolvedEntrypoint === resolvedIndexTs;
}

/**
 * Determine whether the full GMLoop CLI should run during module evaluation.
 *
 * This keeps package imports side-effect free for tests and MCP consumers while
 * still allowing the package executable to dispatch commands normally.
 *
 * @param env - Environment map used for the explicit skip flag.
 * @param execArguments - Process exec arguments used to detect test-runner mode.
 * @param entrypointPath - Process entrypoint path to compare with the CLI module.
 * @param moduleUrl - CLI module URL to compare with the entrypoint.
 * @returns `true` when the current process should dispatch CLI commands.
 */
export function shouldAutoRunCliProcess(
    env: NodeJS.ProcessEnv = process.env,
    execArguments: ReadonlyArray<string> = process.execArgv,
    entrypointPath: string | undefined = process.argv[1],
    moduleUrl = import.meta.url
): boolean {
    return (
        isCliEntrypointModule(entrypointPath, moduleUrl) &&
        !isCliRunSkipped(env) &&
        !isNodeTestRunnerProcess(execArguments)
    );
}

/**
 * Determines whether the current module is being executed as the main module.
 *
 * @param importMetaUrl - The import.meta.url of the calling module.
 * @returns `true` if the current module is the main module being executed.
 */
export function isMainModule(importMetaUrl: string): boolean {
    const resolvedMainPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
    const resolvedModulePath = fileURLToPath(importMetaUrl);
    return resolvedMainPath === resolvedModulePath;
}

/**
 * Extract the exit code from an error object.
 *
 * @param error - An error that may contain an exitCode property.
 * @returns The exit code from the error, or 1 if none is present.
 */
function getExitCode(error: unknown): number {
    const exitCode = (error as { exitCode?: unknown } | null)?.exitCode;
    return typeof exitCode === "number" ? exitCode : 1;
}

/**
 * Execute a CLI command when the module is run as the main entry point.
 *
 * This helper consolidates the boilerplate pattern used across CLI commands
 * that support both module import and direct execution. It handles:
 * - Creating a Commander program with the specified name
 * - Setting up the CLI command manager and registry
 * - Configuring error handling with the appropriate prefix
 * - Registering and running the command
 *
 * @param options - Configuration for the main module execution.
 *
 * @example
 * ```ts
 * // Command that requires env
 * if (isMainModule(import.meta.url)) {
 *     runAsMainModule({
 *         programName: "generate-gml-identifiers",
 *         createCommand: createGenerateIdentifiersCommand,
 *         run: ({ command }) => runGenerateGmlIdentifiers({ command }),
 *         errorPrefix: "Failed to generate GML identifiers.",
 *         env: process.env
 *     });
 * }
 *
 * // Command that doesn't need env
 * if (isMainModule(import.meta.url)) {
 *     runAsMainModule({
 *         programName: "generate-feather-metadata",
 *         createCommand: createFeatherMetadataCommand,
 *         run: ({ command }) => runGenerateFeatherMetadata({ command }),
 *         errorPrefix: "Failed to generate Feather metadata."
 *     });
 * }
 * ```
 */
export function runAsMainModule({
    programName,
    createCommand,
    run,
    errorPrefix,
    env,
    passOptionsToCreateCommand
}: RunAsMainModuleOptions): void {
    const program = new Command().name(programName);
    const { registry, runner } = createCliCommandManager({ program });

    const handleError = (error: unknown) =>
        handleCliError(error, {
            prefix: errorPrefix,
            exitCode: getExitCode(error)
        });

    const shouldPassOptions = passOptionsToCreateCommand ?? env !== undefined;
    const command = shouldPassOptions ? createCommand({ env: env ?? process.env }) : createCommand();

    registry.registerDefaultCommand({
        command,
        run,
        onError: handleError
    });

    runner.run(process.argv.slice(2)).catch(handleError);
}
