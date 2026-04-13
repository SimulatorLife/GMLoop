import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";
import { Command, Option } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import { CliUsageError } from "../cli-core/errors.js";
import {
    createConfigOption,
    createListOption,
    createPathOption,
    createVerboseOption,
    createWriteOption
} from "../cli-core/shared-command-options.js";
import { SKIP_CLI_RUN_ENV_VAR } from "../shared/skip-cli-run.js";
import {
    discoverProjectRoot,
    resolveExistingGmloopConfigPath,
    resolveExplicitWorkflowTargetPath
} from "../workflow/project-root.js";
import { runFormatCommand } from "./format.js";
import { runLintCommand } from "./lint.js";
import { executeRefactorCommand } from "./refactor.js";

type FixCommandOptions = {
    path?: string;
    config?: string;
    write?: boolean;
    only?: string;
    verbose?: boolean;
    list?: boolean;
};

type ValidatedFixCommandOptions = {
    projectRoot: string;
    targetPath: string;
    configPath: string;
    dryRun: boolean;
    only: string | undefined;
    verbose: boolean;
    list: boolean;
};

type FixWorkflowStage = {
    label: string;
    failureMessage: string;
    execute: (options: ValidatedFixCommandOptions) => Promise<void>;
};

type StubCommandParameters = {
    args: Array<string>;
    options: Record<string, unknown>;
    helpText: string;
};

type MemorySnapshot = {
    rss: number;
    heapUsed: number;
    heapTotal: number;
};

function takeMemorySnapshot(): MemorySnapshot {
    const usage = process.memoryUsage();
    return {
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal
    };
}

function formatMegabytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function logStageTelemetry(parameters: {
    label: string;
    durationMs: number;
    startMemory: MemorySnapshot;
    endMemory: MemorySnapshot;
    highWaterMemory: MemorySnapshot;
}): void {
    const { label, durationMs, startMemory, endMemory, highWaterMemory } = parameters;
    console.log(
        [
            `[telemetry] ${label}`,
            `duration=${durationMs.toFixed(1)}ms`,
            `rss(start/end/max)=${formatMegabytes(startMemory.rss)}/${formatMegabytes(endMemory.rss)}/${formatMegabytes(highWaterMemory.rss)}`,
            `heapUsed(start/end/max)=${formatMegabytes(startMemory.heapUsed)}/${formatMegabytes(endMemory.heapUsed)}/${formatMegabytes(highWaterMemory.heapUsed)}`
        ].join(" ")
    );
}

/**
 * Build the narrow command shape consumed by the existing command runners.
 */
function createStubCommand(parameters: StubCommandParameters): CommanderCommandLike {
    return {
        args: parameters.args,
        opts: () => parameters.options,
        helpInformation: () => parameters.helpText
    };
}

function getFixCommandUsage(command: CommanderCommandLike): string {
    return command.helpInformation();
}

function createFixCommandValidationError(error: unknown, command: CommanderCommandLike): CliUsageError {
    // Use a capability probe rather than `instanceof Error` so that cross-realm
    // errors (e.g. from sandboxed modules or commander internals) are handled.
    const message = Core.isErrorLike(error) ? error.message : "Invalid fix command options.";
    const usage = getFixCommandUsage(command);

    if (!message.includes("Could not find gmloop config file")) {
        return new CliUsageError(message, { usage });
    }

    return new CliUsageError(
        [
            message,
            "Run this command from a project directory containing gmloop.json or pass --config <path-to-gmloop.json>."
        ].join(" "),
        { usage }
    );
}

async function validateFixCommandOptions(command: CommanderCommandLike): Promise<ValidatedFixCommandOptions> {
    const options = (command.opts() ?? {}) as FixCommandOptions;
    const explicitTargetPath = resolveExplicitWorkflowTargetPath(options.path);

    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.path,
        configPath: options.config
    });

    return {
        projectRoot,
        targetPath: explicitTargetPath ?? projectRoot,
        configPath: await resolveExistingGmloopConfigPath(projectRoot, options.config),
        dryRun: options.write !== true,
        only: options.only,
        verbose: options.verbose === true,
        list: options.list === true
    };
}

async function runWorkflowStage(parameters: {
    label: string;
    execute: () => Promise<void>;
    failureMessage: string;
}): Promise<void> {
    console.log(`\n[${parameters.label}]`);
    const startTime = process.hrtime.bigint();
    const startMemory = takeMemorySnapshot();
    let highWaterMemory = startMemory;
    const intervalHandle = setInterval(() => {
        const sample = takeMemorySnapshot();
        highWaterMemory = {
            rss: Math.max(highWaterMemory.rss, sample.rss),
            heapUsed: Math.max(highWaterMemory.heapUsed, sample.heapUsed),
            heapTotal: Math.max(highWaterMemory.heapTotal, sample.heapTotal)
        };
    }, 250);
    intervalHandle.unref();

    process.exitCode = 0;

    try {
        await parameters.execute();
    } finally {
        clearInterval(intervalHandle);
        const endMemory = takeMemorySnapshot();
        highWaterMemory = {
            rss: Math.max(highWaterMemory.rss, endMemory.rss),
            heapUsed: Math.max(highWaterMemory.heapUsed, endMemory.heapUsed),
            heapTotal: Math.max(highWaterMemory.heapTotal, endMemory.heapTotal)
        };
        const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        logStageTelemetry({
            label: parameters.label,
            durationMs,
            startMemory,
            endMemory,
            highWaterMemory
        });
    }

    const stageExitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
    process.exitCode = 0;
    if (stageExitCode !== 0) {
        throw new Error(`${parameters.failureMessage} Code: ${stageExitCode}`);
    }
}

function createRefactorStageCommand(options: ValidatedFixCommandOptions): CommanderCommandLike {
    return createStubCommand({
        args: ["codemod", options.targetPath],
        options: {
            path: options.projectRoot,
            config: options.configPath,
            write: !options.dryRun,
            only: options.only,
            list: false,
            verbose: options.verbose
        },
        helpText: "refactor codemod [paths...]"
    });
}

function createRefactorCodemodArgs(options: ValidatedFixCommandOptions): Array<string> {
    const args = ["refactor", "codemod", "--path", options.projectRoot, "--config", options.configPath];

    if (!options.dryRun) {
        args.push("--write");
    }

    if (options.only) {
        args.push("--only", options.only);
    }

    if (options.verbose) {
        args.push("--verbose");
    }

    args.push(options.targetPath);

    return args;
}

async function runRefactorCodemodSubprocess(options: ValidatedFixCommandOptions): Promise<void> {
    if (process.env[SKIP_CLI_RUN_ENV_VAR] === "1") {
        await executeRefactorCommand(createRefactorStageCommand(options));
        return;
    }

    const cliEntryPath = fileURLToPath(new URL("../../index.js", import.meta.url));

    const subprocessArgs = ["--max-old-space-size=16384", cliEntryPath, ...createRefactorCodemodArgs(options)];

    await new Promise<void>((resolve, reject) => {
        const subprocessEnv = {
            ...process.env
        };
        delete subprocessEnv[SKIP_CLI_RUN_ENV_VAR];

        const childProcess = spawn(process.execPath, subprocessArgs, {
            stdio: "inherit",
            env: subprocessEnv
        });

        childProcess.once("error", reject);
        childProcess.once("exit", (code, signal) => {
            if (typeof code === "number" && code === 0) {
                resolve();
                return;
            }

            reject(
                new Error(
                    `Refactor codemod subprocess failed${
                        signal ? ` with signal ${signal}` : ` with exit code ${String(code)}`
                    }.`
                )
            );
        });
    });
}

function printFixCommandSettings(options: ValidatedFixCommandOptions): void {
    const normalizedOnly = options.only?.trim();
    const selectedCodemods = normalizedOnly && normalizedOnly.length > 0 ? normalizedOnly : "(all configured codemods)";

    console.log(`Project root: ${options.projectRoot}`);
    console.log(`Target path: ${options.targetPath}`);
    console.log(`Config path: ${options.configPath}`);
    console.log(`Selected codemods: ${selectedCodemods}`);
    console.log(`Verbose mode: ${options.verbose ? "enabled" : "disabled"}`);
    console.log(`Execution mode: ${options.dryRun ? "dry-run (default)" : "apply changes (--write)"}`);
}

function createLintStageCommand(options: ValidatedFixCommandOptions): CommanderCommandLike {
    return createStubCommand({
        args: [options.targetPath],
        options: {
            write: !options.dryRun,
            formatter: "stylish",
            verbose: options.verbose,
            path: options.projectRoot,
            projectStrict: true,
            allowParseErrors: true,
            quiet: false,
            noDefaultConfig: false
        },
        helpText: "lint [paths...]"
    });
}

function createFormatStageCommand(options: ValidatedFixCommandOptions): CommanderCommandLike {
    return createStubCommand({
        args: [],
        options: {
            path: options.targetPath,
            write: !options.dryRun,
            onParseError: "skip",
            verbose: options.verbose
        },
        helpText: "format [options]"
    });
}

function createFixWorkflowStages(): ReadonlyArray<FixWorkflowStage> {
    return Object.freeze([
        {
            label: "1/3 Refactor Codemods",
            failureMessage: "Refactor codemod stage failed.",
            execute: async (options) => {
                await runRefactorCodemodSubprocess(options);
            }
        },
        {
            label: "2/3 Lint Fixes",
            failureMessage: "Lint fix stage reported unresolved diagnostics.",
            execute: async (options) => {
                await runLintCommand(createLintStageCommand(options));
            }
        },
        {
            label: "3/3 Format",
            failureMessage: "Format stage failed.",
            execute: async (options) => {
                await runFormatCommand(createFormatStageCommand(options));
            }
        }
    ]);
}

async function runFixWorkflowStages(options: ValidatedFixCommandOptions): Promise<void> {
    await createFixWorkflowStages().reduce<Promise<void>>(async (previousStage, workflowStage) => {
        await previousStage;
        await runWorkflowStage({
            label: workflowStage.label,
            execute: async () => {
                await workflowStage.execute(options);
            },
            failureMessage: workflowStage.failureMessage
        });
    }, Promise.resolve());
}

export function createFixCommand(): Command {
    return applyStandardCommandOptions(
        new Command("fix")
            .description("Run project codemods, lint fixes, and formatting in sequence")
            .addOption(createPathOption())
            .addOption(createConfigOption())
            .addOption(createWriteOption())
            .addOption(new Option("--only <ids>", "Comma-separated list of configured codemod ids to run"))
            .addOption(createListOption())
            .addOption(createVerboseOption())
            .addHelpText("after", () =>
                [
                    "",
                    "Examples:",
                    "  pnpm dlx prettier-plugin-gml fix --path path/to/project",
                    "  pnpm dlx prettier-plugin-gml fix --write --path path/to/project",
                    "  pnpm dlx prettier-plugin-gml fix --only namingConvention",
                    ""
                ].join("\n")
            )
    );
}

/**
 * Run the project-wide fix workflow:
 * 1. configured refactor codemods
 * 2. lint with `--write`
 * 3. formatting
 */
export async function runFixCommand(command: CommanderCommandLike): Promise<void> {
    let options: ValidatedFixCommandOptions;
    try {
        options = await validateFixCommandOptions(command);
    } catch (error) {
        throw createFixCommandValidationError(error, command);
    }

    if (options.list) {
        printFixCommandSettings(options);
        return;
    }

    console.log(`Project root: ${options.projectRoot}`);
    console.log(`Target path: ${options.targetPath}`);

    await runFixWorkflowStages(options);

    console.log(
        `\nSuccess! Project codemods, lint fixes, and formatting completed (${options.dryRun ? "dry-run" : "write mode"}).`
    );
}
