import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";
import { Transpiler } from "@gmloop/transpiler";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import { CliUsageError } from "../cli-core/errors.js";
import {
    createListOption,
    createPathOption,
    createVerboseOption,
    createWriteOption
} from "../cli-core/shared-command-options.js";
import { type TranspilationContext, transpileFile } from "../modules/transpilation/index.js";

const TRANSPILE_COMMAND_CLI_EXAMPLE = "pnpm dlx prettier-plugin-gml transpile --path path/to/script.gml";
const TRANSPILE_COMMAND_FIX_EXAMPLE = "pnpm dlx prettier-plugin-gml transpile --write --path path/to/project";

type TranspileCommandOptions = {
    path?: string;
    write?: boolean;
    verbose?: boolean;
    list?: boolean;
};

type ResolvedTranspileTarget =
    | {
          kind: "file";
          targetPath: string;
          gmlFiles: Array<string>;
      }
    | {
          kind: "directory";
          targetPath: string;
          gmlFiles: Array<string>;
      };

type TranspileRunSettings = {
    target: ResolvedTranspileTarget;
    dryRun: boolean;
    verbose: boolean;
    list: boolean;
};

function createUsageError(message: string, command: CommanderCommandLike): CliUsageError {
    return new CliUsageError(message, { usage: command.helpInformation() });
}

function resolvePathOptionValue(command: CommanderCommandLike): string {
    const options = (command.opts() ?? {}) as TranspileCommandOptions;
    const configuredPath = typeof options.path === "string" ? options.path.trim() : "";
    if (configuredPath.length === 0) {
        return process.cwd();
    }

    return path.resolve(configuredPath);
}

async function resolveTranspileTarget(command: CommanderCommandLike): Promise<ResolvedTranspileTarget> {
    const configuredPath = resolvePathOptionValue(command);

    let targetStats: Awaited<ReturnType<typeof stat>>;
    try {
        targetStats = await stat(configuredPath);
    } catch (error) {
        const message = Core.isErrorLike(error) ? error.message : String(error);
        throw createUsageError(
            `Target path does not exist or cannot be accessed: ${configuredPath} (${message})`,
            command
        );
    }

    const normalizedTargetPath = configuredPath.toLowerCase().endsWith(".yyp")
        ? path.dirname(configuredPath)
        : configuredPath;
    const normalizedTargetStats =
        normalizedTargetPath === configuredPath ? targetStats : await stat(normalizedTargetPath);

    if (normalizedTargetStats.isFile()) {
        if (path.extname(normalizedTargetPath).toLowerCase() !== ".gml") {
            throw createUsageError(
                `Transpile only accepts .gml files, .yyp files, or directories. Received: ${normalizedTargetPath}`,
                command
            );
        }

        return {
            kind: "file",
            targetPath: normalizedTargetPath,
            gmlFiles: [normalizedTargetPath]
        };
    }

    if (!normalizedTargetStats.isDirectory()) {
        throw createUsageError(
            `Target path must be a .gml file, a .yyp file, or a directory: ${normalizedTargetPath}`,
            command
        );
    }

    const relativeFilePaths = await Core.listRelativeFilePathsRecursively(normalizedTargetPath, {
        includeFile: ({ entryName }) => path.extname(entryName).toLowerCase() === ".gml"
    });
    const gmlFiles = relativeFilePaths.map((relativeFilePath) => path.join(normalizedTargetPath, relativeFilePath));

    return {
        kind: "directory",
        targetPath: normalizedTargetPath,
        gmlFiles
    };
}

function resolveRunSettings(command: CommanderCommandLike, target: ResolvedTranspileTarget): TranspileRunSettings {
    const options = (command.opts() ?? {}) as TranspileCommandOptions;

    return {
        target,
        dryRun: options.write !== true,
        verbose: options.verbose === true,
        list: options.list === true
    };
}

function pluralize(value: number, singular: string, plural: string): string {
    return value === 1 ? singular : plural;
}

function displayPath(value: string): string {
    const relativePath = path.relative(process.cwd(), value);
    if (relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
        return relativePath;
    }

    return value;
}

function resolveJavaScriptOutputPath(gmlFilePath: string): string {
    const extension = path.extname(gmlFilePath);
    return `${gmlFilePath.slice(0, -extension.length)}.js`;
}

function countLines(sourceText: string): number {
    if (sourceText.length === 0) {
        return 0;
    }

    return sourceText.split(/\r\n|\r|\n/u).length;
}

function createTranspilationContext(): TranspilationContext {
    return {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        lastSuccessfulPatches: new Map(),
        maxPatchHistory: 1,
        totalPatchCount: 0,
        metrics: [],
        errors: [],
        websocketServer: null,
        scriptNames: new Set()
    };
}

function printTranspileSettings(settings: TranspileRunSettings): void {
    const targetLabel = settings.target.kind === "file" ? "file" : "directory";
    console.log(`Target ${targetLabel}: ${displayPath(settings.target.targetPath)}`);
    console.log(`GML files discovered: ${settings.target.gmlFiles.length}`);
    console.log(`Verbose mode: ${settings.verbose ? "enabled" : "disabled"}`);
    console.log(`Execution mode: ${settings.dryRun ? "dry-run (default, no writes)" : "apply changes (--write)"}`);
}

function emitDryRunOutput(parameters: { outputs: Array<{ sourcePath: string; jsBody: string }> }): void {
    const { outputs } = parameters;
    if (outputs.length === 0) {
        return;
    }

    if (outputs.length === 1) {
        console.log(outputs[0].jsBody);
        return;
    }

    for (const output of outputs) {
        console.log(`// ${displayPath(output.sourcePath)}`);
        console.log(output.jsBody);
        console.log("");
    }
}

export function createTranspileCommand(): Command {
    return applyStandardCommandOptions(
        new Command("transpile")
            .description("Transpile GameMaker Language files to JavaScript using @gmloop/transpiler")
            .addOption(createPathOption())
            .addOption(createWriteOption())
            .addOption(createListOption())
            .addOption(createVerboseOption())
            .addHelpText("after", () =>
                ["", "Examples:", `  ${TRANSPILE_COMMAND_CLI_EXAMPLE}`, `  ${TRANSPILE_COMMAND_FIX_EXAMPLE}`, ""].join(
                    "\n"
                )
            )
    );
}

export async function runTranspileCommand(command: CommanderCommandLike): Promise<void> {
    const target = await resolveTranspileTarget(command);
    const settings = resolveRunSettings(command, target);

    if (settings.list) {
        printTranspileSettings(settings);
        return;
    }

    if (settings.target.gmlFiles.length === 0) {
        console.warn(`No .gml files were found in ${displayPath(settings.target.targetPath)}.`);
        return;
    }

    const context = createTranspilationContext();
    const fileCount = settings.target.gmlFiles.length;
    const outputs = await Promise.all(
        settings.target.gmlFiles.map(async (filePath) => {
            const sourceText = await Core.readTextFile(filePath);
            const transpilationResult = transpileFile(context, filePath, sourceText, countLines(sourceText), {
                verbose: settings.verbose,
                quiet: !settings.verbose
            });

            if (!transpilationResult.success || !transpilationResult.patch) {
                const message = transpilationResult.error?.error ?? "Unknown transpilation error";
                throw new Error(`Failed to transpile ${displayPath(filePath)}: ${message}`);
            }

            const jsBody = transpilationResult.patch.js_body;
            const outputPath = resolveJavaScriptOutputPath(filePath);

            if (!settings.dryRun) {
                await Core.writeTextFile(outputPath, jsBody);
            }

            return {
                sourcePath: filePath,
                jsBody
            };
        })
    );

    if (settings.dryRun) {
        emitDryRunOutput({ outputs });
        console.log(
            `Transpiled ${fileCount} ${pluralize(fileCount, "file", "files")} to JavaScript (dry-run). Re-run with --write to write .js files.`
        );
        return;
    }

    console.log(`Transpiled ${fileCount} ${pluralize(fileCount, "file", "files")} and wrote JavaScript output files.`);
}
