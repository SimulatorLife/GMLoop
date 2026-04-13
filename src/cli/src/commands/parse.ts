import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";
import * as ParserWorkspace from "@gmloop/parser";
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
import { resolveExplicitWorkflowTargetPath } from "../workflow/project-root.js";

const GML_FILE_EXTENSION = ".gml";
const AST_JSON_EXTENSION = ".ast.json";
const PARSE_COMMAND_CLI_EXAMPLE = "pnpm dlx prettier-plugin-gml parse --path path/to/script.gml";
const PARSE_COMMAND_FIX_EXAMPLE = "pnpm dlx prettier-plugin-gml parse --write --path path/to/project";

type ParseCommandOptions = {
    write?: boolean;
    list?: boolean;
    path?: string;
    verbose?: boolean;
};

type ParseCommandSettings = {
    targetPath: string;
    writeMode: boolean;
    list: boolean;
    verbose: boolean;
};

type ParsedGmlAst = Record<string, unknown>;

type ParsedFileAst = {
    sourcePath: string;
    displayPath: string;
    ast: ParsedGmlAst;
};

type DryRunDirectoryEntry = {
    path: string;
    ast: ParsedFileAst["ast"];
};

type DryRunPayload =
    | ParsedGmlAst
    | {
          files: Array<DryRunDirectoryEntry>;
      };

function formatPathForDisplay(targetPath: string): string {
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

function resolveCommandOptions(command: CommanderCommandLike): ParseCommandOptions {
    return command.opts() as ParseCommandOptions;
}

function resolveParseCommandSettings(command: CommanderCommandLike): ParseCommandSettings {
    const options = resolveCommandOptions(command);
    const explicitTargetPath = resolveExplicitWorkflowTargetPath(options.path);
    const targetPath = explicitTargetPath ?? path.resolve(process.cwd(), ".");

    return {
        targetPath,
        writeMode: Boolean(options.write),
        list: Boolean(options.list),
        verbose: Boolean(options.verbose)
    };
}

function printParseCommandSettings(settings: ParseCommandSettings): void {
    console.log(`Target path: ${formatPathForDisplay(settings.targetPath)}`);
    console.log(
        `Execution mode: ${settings.writeMode ? "write AST JSON files (--write)" : "dry-run (stdout AST JSON)"}`
    );
    console.log(`Verbose mode: ${settings.verbose ? "enabled" : "disabled"}`);
    console.log(`Output: ${settings.writeMode ? `sibling *${AST_JSON_EXTENSION} files` : "stdout"}`);
}

async function collectGmlFilePathsFromDirectory(directoryPath: string): Promise<Array<string>> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));
    const discoveredFiles: Array<string> = [];

    await Core.runSequentially(sortedEntries, async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            discoveredFiles.push(...(await collectGmlFilePathsFromDirectory(entryPath)));
            return;
        }

        if (entry.isFile() && path.extname(entry.name).toLowerCase() === GML_FILE_EXTENSION) {
            discoveredFiles.push(entryPath);
        }
    });

    return discoveredFiles;
}

async function collectParseTargetFilePaths(targetPath: string, usage: string): Promise<Array<string>> {
    let targetStats;
    try {
        targetStats = await lstat(targetPath);
    } catch (error) {
        const details = Core.getErrorMessageOrFallback(error);
        throw new CliUsageError(`Unable to access ${formatPathForDisplay(targetPath)}: ${details}.`, { usage });
    }

    if (targetStats.isSymbolicLink()) {
        throw new CliUsageError(`Parse target cannot be a symbolic link: ${formatPathForDisplay(targetPath)}.`, {
            usage
        });
    }

    if (targetStats.isDirectory()) {
        return collectGmlFilePathsFromDirectory(targetPath);
    }

    if (targetStats.isFile() && path.extname(targetPath).toLowerCase() === GML_FILE_EXTENSION) {
        return [targetPath];
    }

    throw new CliUsageError(
        `Parse target must be a ${GML_FILE_EXTENSION} file or a directory containing ${GML_FILE_EXTENSION} files: ${formatPathForDisplay(targetPath)}.`,
        { usage }
    );
}

async function parseFileToAst(filePath: string): Promise<ParsedFileAst> {
    const source = await readFile(filePath, "utf8");
    return {
        sourcePath: filePath,
        displayPath: formatPathForDisplay(filePath),
        ast: ParserWorkspace.Parser.GMLParser.parse(source) as ParsedGmlAst
    };
}

function serializeAstJson(payload: DryRunPayload): string {
    return Core.stringifyJsonForFile(payload, {
        space: 2,
        includeTrailingNewline: true
    });
}

function resolveAstJsonOutputPath(filePath: string): string {
    return `${filePath}${AST_JSON_EXTENSION}`;
}

async function writeParsedAstJsonFile(parsedFile: ParsedFileAst): Promise<string> {
    const outputPath = resolveAstJsonOutputPath(parsedFile.sourcePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serializeAstJson(parsedFile.ast), "utf8");
    return outputPath;
}

function createDryRunPayload(parsedFiles: ReadonlyArray<ParsedFileAst>): DryRunPayload {
    if (parsedFiles.length === 1) {
        const firstFile = parsedFiles[0];
        if (!firstFile) {
            throw new Error("Expected a parsed file before creating single-file parse output.");
        }
        return firstFile.ast;
    }

    return {
        files: parsedFiles.map((parsedFile) => ({
            path: parsedFile.displayPath,
            ast: parsedFile.ast
        }))
    };
}

function logVerboseParseSummary(filePath: string): void {
    console.error(`Parsed ${formatPathForDisplay(filePath)}`);
}

async function parseTargetFiles(filePaths: ReadonlyArray<string>, verbose: boolean): Promise<Array<ParsedFileAst>> {
    const parsedFiles: Array<ParsedFileAst> = [];

    await Core.runSequentially(filePaths, async (filePath) => {
        const parsedFile = await parseFileToAst(filePath);
        parsedFiles.push(parsedFile);
        if (verbose) {
            logVerboseParseSummary(filePath);
        }
    });

    return parsedFiles;
}

async function writeParsedAstJsonFiles(parsedFiles: ReadonlyArray<ParsedFileAst>): Promise<Array<string>> {
    const outputPaths: Array<string> = [];

    await Core.runSequentially(parsedFiles, async (parsedFile) => {
        outputPaths.push(await writeParsedAstJsonFile(parsedFile));
    });

    return outputPaths;
}

function printDryRunAstJson(parsedFiles: ReadonlyArray<ParsedFileAst>): void {
    process.stdout.write(serializeAstJson(createDryRunPayload(parsedFiles)));
}

function printWriteModeSummary(outputPaths: ReadonlyArray<string>): void {
    for (const outputPath of outputPaths) {
        console.log(`Wrote ${formatPathForDisplay(outputPath)}`);
    }

    const label = outputPaths.length === 1 ? "AST JSON file" : "AST JSON files";
    console.log(`Parsed and wrote ${outputPaths.length} ${label}.`);
}

function printNoMatchingFilesMessage(targetPath: string): void {
    console.log(
        `No ${GML_FILE_EXTENSION} files were found in ${formatPathForDisplay(targetPath)}. Provide a ${GML_FILE_EXTENSION} file or directory target.`
    );
}

/**
 * Create the CLI command that exposes `@gmloop/parser` AST output.
 *
 * @returns Commander command definition for parsing `.gml` targets.
 */
export function createParseCommand(): Command {
    return applyStandardCommandOptions(
        new Command("parse")
            .usage("[options]")
            .description("Parse GameMaker Language files to AST JSON using @gmloop/parser.")
            .addOption(createPathOption())
            .addOption(createWriteOption())
            .addOption(createListOption())
            .addOption(createVerboseOption())
            .addHelpText("after", () =>
                ["", "Examples:", `  ${PARSE_COMMAND_CLI_EXAMPLE}`, `  ${PARSE_COMMAND_FIX_EXAMPLE}`, ""].join("\n")
            )
    );
}

/**
 * Run the parser CLI command for a file or directory target.
 *
 * @param command Commander command instance containing parse options.
 * @returns A promise that resolves after AST output has been printed or written.
 */
export async function runParseCommand(command: CommanderCommandLike): Promise<void> {
    const settings = resolveParseCommandSettings(command);

    if (settings.list) {
        printParseCommandSettings(settings);
        return;
    }

    const filePaths = await collectParseTargetFilePaths(settings.targetPath, command.helpInformation());
    if (filePaths.length === 0) {
        printNoMatchingFilesMessage(settings.targetPath);
        return;
    }

    const parsedFiles = await parseTargetFiles(filePaths, settings.verbose);
    if (!settings.writeMode) {
        printDryRunAstJson(parsedFiles);
        return;
    }

    const outputPaths = await writeParsedAstJsonFiles(parsedFiles);
    printWriteModeSummary(outputPaths);
}
