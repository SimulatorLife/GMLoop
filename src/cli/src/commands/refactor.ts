/**
 * Refactor command for safe, project-wide code transformations.
 *
 * This command exposes the refactor engine through the CLI, enabling
 * safe renames and project-configured codemod execution.
 */

import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Refactor } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import { Command, Option } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import { CliUsageError, isCliUsageError } from "../cli-core/errors.js";
import {
    createConfigOption,
    createListOption,
    createPathOption,
    createVerboseOption,
    createWriteOption
} from "../cli-core/shared-command-options.js";
import { createRefactorBridges } from "../modules/refactor/bridge-factory.js";
import { isRefactorResourcePath } from "../modules/refactor/gml-resource-path.js";
import { GmlSemanticBridge } from "../modules/refactor/index.js";
import {
    discoverProjectRoot,
    resolveExistingGmloopConfigPath,
    resolveExplicitWorkflowTargetPath
} from "../workflow/project-root.js";

const { buildProjectIndex } = Semantic;
const {
    RefactorEngine,
    formatRenamePlanReport,
    generateRenamePreview,
    listConfiguredCodemods,
    listSemanticProjectIndexDependentCodemodIds,
    listRegisteredCodemods,
    normalizeRefactorProjectConfig
} = Refactor;
type RegisteredCodemodId = ReturnType<typeof listRegisteredCodemods>[number]["id"];
type LoadedGmloopProjectConfig = Awaited<ReturnType<typeof Core.loadGmloopProjectConfig>> & {
    refactor?: ReturnType<typeof normalizeRefactorProjectConfig>;
};

type RefactorCommandOptions = {
    symbolId?: string;
    oldName?: string;
    newName?: string;
    path?: string;
    config?: string;
    write?: boolean;
    only?: string;
    list?: boolean;
    verbose?: boolean;
    checkHotReload?: boolean;
};

type RefactorContext = {
    projectRoot: string;
    verbose: boolean;
};

type ValidatedRenameOptions = RefactorContext & {
    symbolId?: string;
    oldName?: string;
    newName: string;
    dryRun: boolean;
    checkHotReload: boolean;
    list: boolean;
};

function printRenameSettings(options: ValidatedRenameOptions): void {
    console.log(`Mode: rename`);
    console.log(`Project root: ${options.projectRoot}`);
    console.log(`Target: ${options.symbolId ?? options.oldName ?? "(unresolved)"}`);
    console.log(`New name: ${options.newName}`);
    console.log(`Verbose mode: ${options.verbose ? "enabled" : "disabled"}`);
    console.log(`Execution mode: ${options.dryRun ? "dry-run (default)" : "apply changes (--write)"}`);
    console.log(`Hot reload validation: ${options.checkHotReload ? "enabled" : "disabled"}`);
}

type ValidatedCodemodOptions = RefactorContext & {
    configPath: string;
    dryRun: boolean;
    onlyCodemods: Array<RegisteredCodemodId>;
    list: boolean;
    targetPaths: Array<string>;
};

type RefactorCommandIntent =
    | {
          mode: "rename";
          options: ValidatedRenameOptions;
      }
    | {
          mode: "codemod";
          options: ValidatedCodemodOptions;
      };

type ProjectIndexParseContext = {
    filePath?: string;
};

type SemanticProjectIndex = {
    files?: Record<string, unknown>;
};

function isRecoverableProjectIndexParseError(error: unknown): boolean {
    return Core.getErrorMessage(error).includes("Syntax Error (");
}

async function buildProjectIndexWithParseTolerance(
    projectRoot: string,
    fsFacade: typeof Semantic.defaultFsFacade | undefined,
    verbose: boolean
): Promise<Awaited<ReturnType<typeof buildProjectIndex>>> {
    const parseProjectSource = Semantic.getDefaultProjectIndexParser();
    const skippedFilePaths = new Set<string>();

    return await buildProjectIndex(projectRoot, fsFacade, {
        logger: verbose ? console : undefined,
        parseGml: (sourceText: string, context: ProjectIndexParseContext = {}) => {
            try {
                return parseProjectSource(sourceText, context);
            } catch (error) {
                if (!isRecoverableProjectIndexParseError(error)) {
                    throw error;
                }

                const filePath = context.filePath ?? "<unknown>";
                if (!skippedFilePaths.has(filePath)) {
                    skippedFilePaths.add(filePath);
                    console.warn(
                        `Warning: Skipping parse-invalid file during refactor indexing: ${filePath} (${Core.getErrorMessage(error)})`
                    );
                }

                return parseProjectSource("", context);
            }
        }
    });
}

function normalizeRequestedCodemods(onlyOption: string | undefined): Array<RegisteredCodemodId> {
    if (!onlyOption) {
        return [];
    }

    const requestedIds = Core.normalizeStringList(onlyOption, {
        splitPattern: Core.createListSplitPattern([","]),
        errorMessage: "--only must be a comma-separated list of codemod ids"
    });
    const validCodemodIds = new Set(listRegisteredCodemods().map((codemod) => codemod.id));

    return requestedIds.map((requestedId) => {
        if (!validCodemodIds.has(requestedId as RegisteredCodemodId)) {
            throw new Error(`Unknown codemod '${requestedId}'. Valid codemods: ${[...validCodemodIds].join(", ")}`);
        }

        return requestedId as RegisteredCodemodId;
    });
}

function resolveDiscoveredProjectRoot(
    projectRootOption: string | undefined,
    configPathOption: string | undefined
): Promise<string> {
    return discoverProjectRoot({
        explicitProjectPath: projectRootOption,
        configPath: configPathOption
    });
}

function resolveCodemodConfigPath(projectRoot: string, configPathOption: string | undefined): Promise<string> {
    return resolveExistingGmloopConfigPath(projectRoot, configPathOption);
}

function hasExplicitRenameIntent(options: RefactorCommandOptions): boolean {
    return Boolean(options.symbolId || options.oldName || options.newName || options.checkHotReload);
}

function hasExplicitCodemodIntentHint(options: RefactorCommandOptions): boolean {
    return Boolean(options.path || options.config || options.write || options.only || options.list);
}

function listIndexedGmlFilePaths(projectIndex: unknown): Array<string> {
    if (!Core.isObjectLike(projectIndex)) {
        return [];
    }

    const files = (projectIndex as SemanticProjectIndex).files;
    if (!Core.isObjectLike(files)) {
        return [];
    }

    return Object.keys(files)
        .filter((filePath) => isRefactorResourcePath(filePath))
        .toSorted();
}

function allTargetsResolveToProjectRoot(projectRoot: string, targetPaths: ReadonlyArray<string>): boolean {
    const normalizedProjectRoot = path.resolve(projectRoot);
    return targetPaths.every((targetPath) => path.resolve(targetPath) === normalizedProjectRoot);
}

/**
 * Reuse semantic index file paths when codemods target the full project root.
 *
 * This avoids a second recursive disk walk immediately after `buildProjectIndex`
 * already discovered the same files.
 */
export function resolveIndexedRootTargetGmlFiles(
    projectRoot: string,
    targetPaths: ReadonlyArray<string>,
    projectIndex: unknown
): Array<string> | null {
    if (targetPaths.length === 0 || !allTargetsResolveToProjectRoot(projectRoot, targetPaths)) {
        return null;
    }

    const indexedGmlFilePaths = listIndexedGmlFilePaths(projectIndex);
    return indexedGmlFilePaths.length > 0 ? indexedGmlFilePaths : null;
}

async function validateRenameOptions(options: RefactorCommandOptions): Promise<ValidatedRenameOptions> {
    if (!options.newName) {
        throw new Error("--new-name is required");
    }

    if (!options.symbolId && !options.oldName) {
        throw new Error("Either --symbol-id or --old-name must be provided");
    }

    if (options.symbolId && options.oldName) {
        throw new Error("Only one of --symbol-id or --old-name should be provided, not both");
    }

    return {
        projectRoot: await resolveDiscoveredProjectRoot(options.path, options.config),
        verbose: Boolean(options.verbose),
        symbolId: options.symbolId,
        oldName: options.oldName,
        newName: options.newName,
        dryRun: !options.write,
        checkHotReload: Boolean(options.checkHotReload),
        list: Boolean(options.list)
    };
}

async function validateCodemodOptions(
    options: RefactorCommandOptions,
    pathArguments: Array<string>
): Promise<ValidatedCodemodOptions> {
    const projectRoot = await resolveDiscoveredProjectRoot(options.path, options.config);
    const explicitTargetPath = resolveExplicitWorkflowTargetPath(options.path);
    const targetPaths =
        pathArguments.length === 0
            ? [explicitTargetPath ?? projectRoot]
            : pathArguments.map((entry) => path.resolve(entry));

    return {
        projectRoot,
        verbose: Boolean(options.verbose),
        configPath: await resolveCodemodConfigPath(projectRoot, options.config),
        dryRun: !options.write,
        onlyCodemods: normalizeRequestedCodemods(options.only),
        list: Boolean(options.list),
        targetPaths
    };
}

async function validateRefactorIntent(command: CommanderCommandLike): Promise<RefactorCommandIntent> {
    const options = command.opts() as RefactorCommandOptions;
    const [operation, ...remainingArgs] = command.args;

    if (operation === "codemod") {
        return {
            mode: "codemod",
            options: await validateCodemodOptions(options, remainingArgs)
        };
    }

    if (operation !== undefined) {
        throw new Error(`Unknown refactor operation '${operation}'. Supported operations: codemod`);
    }

    if (hasExplicitRenameIntent(options)) {
        return {
            mode: "rename",
            options: await validateRenameOptions(options)
        };
    }

    if (hasExplicitCodemodIntentHint(options)) {
        return {
            mode: "codemod",
            options: await validateCodemodOptions(options, remainingArgs)
        };
    }

    const inferredCodemodOptions = await validateCodemodOptions(options, remainingArgs).catch(() => null);
    if (inferredCodemodOptions) {
        return {
            mode: "codemod",
            options: inferredCodemodOptions
        };
    }

    throw new CliUsageError(
        "Could not infer refactor mode. Provide --old-name/--symbol-id with --new-name for renames, or run inside a project with gmloop.json to execute configured codemods."
    );
}

async function collectGmlFilesFromTarget(
    projectRoot: string,
    absoluteTargetPath: string,
    collectedFiles: Set<string>
): Promise<void> {
    const stats = await lstat(absoluteTargetPath);
    if (stats.isDirectory()) {
        const pendingDirectories = [absoluteTargetPath];
        const processPendingDirectories = async (): Promise<void> => {
            if (pendingDirectories.length === 0) {
                return;
            }
            const currentDirectories = pendingDirectories.splice(0, 16);
            const entriesByDirectory = await Core.runInParallel(currentDirectories, async (directoryPath) => {
                return await readdir(directoryPath, {
                    withFileTypes: true
                });
            });

            for (const [directoryIndex, directoryPath] of currentDirectories.entries()) {
                const entries = entriesByDirectory[directoryIndex];

                for (const entry of entries) {
                    const entryPath = path.join(directoryPath, entry.name);
                    if (entry.isDirectory()) {
                        pendingDirectories.push(entryPath);
                        continue;
                    }

                    if (entry.isFile() && isRefactorResourcePath(entry.name)) {
                        collectedFiles.add(path.relative(projectRoot, entryPath));
                    }
                }
            }

            await processPendingDirectories();
        };

        await processPendingDirectories();
        return;
    }

    if (!stats.isFile() || !isRefactorResourcePath(absoluteTargetPath)) {
        return;
    }

    collectedFiles.add(path.relative(projectRoot, absoluteTargetPath));
}

async function collectTargetGmlFiles(projectRoot: string, targetPaths: Array<string>): Promise<Array<string>> {
    const collectedFiles = new Set<string>();
    await Core.runSequentially(targetPaths, async (targetPath) => {
        await collectGmlFilesFromTarget(projectRoot, targetPath, collectedFiles);
    });
    return [...collectedFiles].sort();
}

function createRefactorEngineForProject(
    projectRoot: string,
    projectIndex: object | null,
    includeSemanticBridge: boolean = projectIndex !== null
): InstanceType<typeof RefactorEngine> {
    const semanticBridge = includeSemanticBridge ? new GmlSemanticBridge(projectIndex ?? {}, projectRoot) : undefined;

    const bridges = createRefactorBridges({ semantic: semanticBridge }, projectRoot);

    return new RefactorEngine({
        semantic: semanticBridge ?? null,
        parser: bridges.parser,
        formatter: bridges.formatter
    });
}

async function performRename(options: ValidatedRenameOptions): Promise<void> {
    const { projectRoot, verbose, symbolId, oldName, newName, dryRun, checkHotReload } = options;

    if (verbose) {
        console.log(`\nInitializing refactor context for project: ${projectRoot}`);
    }

    let targetSymbolId = symbolId;

    try {
        const projectIndex = await buildProjectIndexWithParseTolerance(projectRoot, undefined, verbose);
        const engine = createRefactorEngineForProject(projectRoot, projectIndex);
        const semantic = engine.semantic as GmlSemanticBridge;

        if (!targetSymbolId && oldName) {
            if (verbose) {
                console.log(`Searching for symbol matching name: ${oldName}`);
            }

            const resolvedId = semantic.resolveSymbolId(oldName);
            if (resolvedId) {
                targetSymbolId = resolvedId;
                if (verbose) {
                    console.log(`Resolved symbol ID: ${targetSymbolId}`);
                }
            } else {
                const occurrences = await engine.gatherSymbolOccurrences(oldName);
                if (occurrences.length === 0) {
                    throw new Error(`Could not find any symbol named '${oldName}'`);
                }

                targetSymbolId = `gml/script/${oldName}`;
                if (verbose) {
                    console.log(`Warning: resolveSymbolId failed but found ${occurrences.length} occurrences.`);
                    console.log(`Using fallback identifier: ${targetSymbolId}`);
                }
            }
        }

        if (!targetSymbolId) {
            throw new Error("Could not resolve target symbol ID");
        }

        if (verbose) {
            console.log(`Planning rename: ${targetSymbolId} → ${newName}`);
        }

        const plan = await engine.prepareRenamePlan(
            {
                symbolId: targetSymbolId,
                newName
            },
            {
                validateHotReload: checkHotReload
            }
        );

        console.log(`\n${formatRenamePlanReport(plan)}`);

        if (verbose) {
            const preview = generateRenamePreview(plan.workspace, plan.analysis.summary.oldName, newName);
            console.log("\nDetailed File Changes:");
            for (const file of preview.files) {
                console.log(`  ${file.filePath}: ${file.editCount} edits`);
            }
        }

        if (!plan.validation.valid) {
            console.log("\nRename validation failed. Aborting.");
            return;
        }

        if (dryRun) {
            console.log("\n[DRY RUN] No files were modified.");
            return;
        }

        console.log("\nApplying changes...");
        const resolvePath = (filePath: string) => path.resolve(projectRoot, filePath);
        await engine.applyWorkspaceEdit(plan.workspace, {
            readFile: (filePath) => readFile(resolvePath(filePath), "utf8"),
            writeFile: (filePath, content) => writeFile(resolvePath(filePath), content, "utf8"),
            renameFile: (oldPath, newPath) => rename(resolvePath(oldPath), resolvePath(newPath))
        });
        console.log("Success! All files updated.");
    } catch (error) {
        let message = Core.getErrorMessage(error);
        if (message.includes("not found in semantic index")) {
            message =
                `Symbol '${targetSymbolId || oldName}' was not found in the semantic index. ` +
                `This usually means the symbol is not defined in the project or is a built-in symbol that cannot be renamed.\n` +
                `Check that the symbol name is correct (including case) and that it refers to a user-defined resource (Script, Macro, Variable, etc.).`;
        }

        throw new Error(`Refactor operation failed: ${message}`, { cause: error });
    }
}

function formatCodemodSelectionSummary(
    config: LoadedGmloopProjectConfig,
    selectedCodemods: Array<RegisteredCodemodId>
) {
    return listConfiguredCodemods(config.refactor ?? {}, selectedCodemods).map((codemod) => {
        const stateLabel = codemod.configured ? "configured" : "not configured";
        const selectionLabel = codemod.selected ? "selected" : "filtered out";
        const configLabel = codemod.effectiveConfig === null ? "n/a" : JSON.stringify(codemod.effectiveConfig, null, 2);

        return [
            `${codemod.id}: ${stateLabel}, ${selectionLabel}`,
            `  Description: ${codemod.description}`,
            `  Effective config: ${configLabel}`
        ].join("\n");
    });
}

function selectConfiguredCodemodIds(
    config: LoadedGmloopProjectConfig,
    onlyCodemods: Array<RegisteredCodemodId>
): Array<RegisteredCodemodId> {
    return listConfiguredCodemods(config.refactor ?? {}, onlyCodemods)
        .filter((codemod) => codemod.configured && codemod.selected)
        .map((codemod) => codemod.id);
}

async function performConfiguredCodemods(options: ValidatedCodemodOptions): Promise<void> {
    const { projectRoot, verbose, configPath, targetPaths, dryRun, onlyCodemods, list } = options;

    if (verbose) {
        console.log(`\nInitializing refactor codemod context for project: ${projectRoot}`);
        console.log(`Loading gmloop config from: ${configPath}`);
    }

    const rawConfig = await Core.loadGmloopProjectConfig(configPath);
    const config: LoadedGmloopProjectConfig = Object.freeze({
        ...rawConfig,
        refactor: normalizeRefactorProjectConfig(rawConfig.refactor)
    });
    if (list) {
        const selectedCodemodLines = formatCodemodSelectionSummary(config, onlyCodemods);
        const selectedCodemods = onlyCodemods.length > 0 ? onlyCodemods.join(", ") : "(all configured codemods)";
        console.log(`Project root: ${projectRoot}`);
        console.log(`Config path: ${configPath}`);
        console.log(`Selected codemods: ${selectedCodemods}`);
        console.log(`Target paths: ${targetPaths.join(", ")}`);
        console.log(`Verbose mode: ${verbose ? "enabled" : "disabled"}`);
        console.log(`Execution mode: ${dryRun ? "dry-run (default)" : "apply changes (--write)"}`);
        for (const line of selectedCodemodLines) {
            console.log(line);
        }
        return;
    }

    const selectedCodemodIds = selectConfiguredCodemodIds(config, onlyCodemods);
    const semanticIndexDependentCodemodIds = new Set(listSemanticProjectIndexDependentCodemodIds());
    const requiresSemanticProjectIndex = selectedCodemodIds.some((codemodId) =>
        semanticIndexDependentCodemodIds.has(codemodId)
    );
    const firstSemanticCodemodIndex = selectedCodemodIds.findIndex((codemodId) =>
        semanticIndexDependentCodemodIds.has(codemodId)
    );
    const shouldDeferInitialSemanticIndexBuild =
        firstSemanticCodemodIndex > 0 &&
        selectedCodemodIds
            .slice(0, firstSemanticCodemodIndex)
            .some((codemodId) => !semanticIndexDependentCodemodIds.has(codemodId));

    const projectIndex =
        requiresSemanticProjectIndex && !shouldDeferInitialSemanticIndexBuild
            ? await buildProjectIndexWithParseTolerance(projectRoot, undefined, verbose)
            : null;
    const engine = createRefactorEngineForProject(projectRoot, projectIndex, requiresSemanticProjectIndex);
    const indexedRootTargetGmlFiles =
        projectIndex === null ? null : resolveIndexedRootTargetGmlFiles(projectRoot, targetPaths, projectIndex);
    const gmlFilePaths = indexedRootTargetGmlFiles ?? (await collectTargetGmlFiles(projectRoot, targetPaths));
    const remainingSelectedCodemodIds = [...selectedCodemodIds];

    if (selectedCodemodIds.length === 0) {
        console.log("No configured codemods were selected. Nothing to do.");
        return;
    }

    if (verbose) {
        console.log(`Selected codemods: ${selectedCodemodIds.join(", ")}`);
        console.log(`Selected GML files: ${gmlFilePaths.length}`);
    }

    const resolvePath = (filePath: string) => path.resolve(projectRoot, filePath);
    let hasPendingSemanticIndexRefresh = shouldDeferInitialSemanticIndexBuild;
    const result = await engine.executeConfiguredCodemods({
        projectRoot,
        targetPaths,
        gmlFilePaths,
        config: config.refactor ?? {},
        readFile: (filePath) => readFile(resolvePath(filePath), "utf8"),
        writeFile: (filePath, content) => writeFile(resolvePath(filePath), content, "utf8"),
        renameFile: (oldPath, newPath) => rename(resolvePath(oldPath), resolvePath(newPath)),
        dryRun,
        onlyCodemods: selectedCodemodIds,
        onAfterCodemod: async (summary, context) => {
            const completedCodemodId = remainingSelectedCodemodIds.shift();
            if (completedCodemodId !== summary.id) {
                throw new Error(
                    `Configured codemod execution order drifted while refreshing semantic index (expected ${completedCodemodId ?? "<none>"}, received ${summary.id}).`
                );
            }
            if (summary.changed && !semanticIndexDependentCodemodIds.has(summary.id)) {
                hasPendingSemanticIndexRefresh = true;
            }
            const nextCodemodId = remainingSelectedCodemodIds[0];

            const shouldRefreshBeforeRemainingSemanticCodemods =
                hasPendingSemanticIndexRefresh &&
                nextCodemodId !== undefined &&
                semanticIndexDependentCodemodIds.has(nextCodemodId);

            if (shouldRefreshBeforeRemainingSemanticCodemods) {
                hasPendingSemanticIndexRefresh = false;
                if (verbose) {
                    console.log(`Rebuilding project index after codemod ${summary.id}...`);
                }
                const updatedProjectIndex = await buildProjectIndexWithParseTolerance(
                    projectRoot,
                    {
                        ...Semantic.defaultFsFacade,
                        readFile: async (filePath) => {
                            const content = await context.readFile(filePath);
                            return content ?? (await readFile(resolvePath(filePath), "utf8"));
                        }
                    },
                    verbose
                );

                // Access the underlying GmlSemanticBridge and update it directly
                const semanticBridge = engine.semantic as GmlSemanticBridge;
                if (semanticBridge && typeof semanticBridge.updateProjectIndex === "function") {
                    semanticBridge.updateProjectIndex(updatedProjectIndex);
                }
            }
        }
    });

    let encounteredErrors = false;
    for (const summary of result.summaries) {
        console.log(`\n[${summary.id}] ${summary.changed ? "changed" : "no changes"}`);
        if (summary.changedFiles.length > 0) {
            console.log(`Changed files: ${summary.changedFiles.length}`);
        }
        for (const warning of summary.warnings) {
            console.log(`Warning: ${warning}`);
        }
        for (const error of summary.errors) {
            encounteredErrors = true;
            console.log(`Error: ${error}`);
        }
    }

    if (encounteredErrors) {
        throw new Error("Configured codemod execution reported one or more errors.");
    }

    if (dryRun) {
        console.log("\n[DRY RUN] No files were modified.");
    } else {
        console.log("\nSuccess! Configured codemods applied.");
    }
}

export function createRefactorCommand(): Command {
    const command = applyStandardCommandOptions(new Command("refactor"));

    command
        .description("Perform safe, project-wide code transformations")
        .argument("[operation]", 'Optional refactor operation, currently "codemod"')
        .argument("[paths...]", "Optional target paths used by refactor codemod execution")
        .addOption(
            new Option(
                "--symbol-id <id>",
                "Exact SCIP-style identifier (e.g., gml/script/my_func, gml/macro/MY_MACRO, gml/var/my_global)"
            )
        )
        .addOption(
            new Option(
                "--old-name <name>",
                "Search for a symbol by its base name. The tool will try to find the correct kind (script, macro, etc.) automatically."
            )
        )
        .addOption(new Option("--new-name <name>", "New name for the symbol"))
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createWriteOption())
        .addOption(new Option("--only <ids>", "Comma-separated list of configured codemod ids to run"))
        .addOption(createListOption())
        .addOption(createVerboseOption())
        .addOption(
            new Option("--check-hot-reload", "Validate that the refactored code is compatible with hot reload").default(
                false
            )
        )
        .addHelpText(
            "after",
            [
                "",
                "Examples:",
                "  pnpm dlx gmloop refactor --old-name my_script --new-name my_renamed_script path/to/project",
                "  pnpm dlx gmloop refactor --symbol-id gml/script/my_func --new-name my_func_v2",
                "  pnpm dlx gmloop refactor codemod --list",
                "  pnpm dlx gmloop refactor codemod --write path/to/project"
            ].join("\n")
        );

    return command;
}

/**
 * Execute a refactor command intent without installing the CLI-level error
 * wrapper. Composite workflows use this to compose refactor operations with
 * other stages while preserving one shared implementation.
 */
export async function executeRefactorCommand(command: CommanderCommandLike): Promise<void> {
    const intent = await validateRefactorIntent(command);
    if (intent.mode === "rename" && intent.options.list) {
        printRenameSettings(intent.options);
        return;
    }
    await (intent.mode === "codemod" ? performConfiguredCodemods(intent.options) : performRename(intent.options));
}

/**
 * Wrap a caught error as a {@link CliUsageError} so that the outer CLI error
 * handler renders it without a stack trace and appends the command's usage
 * guidance. Already-branded {@link CliUsageError} instances are re-thrown
 * unchanged; all other errors are wrapped with the usage text attached.
 */
export async function runRefactorCommand(command: CommanderCommandLike): Promise<void> {
    try {
        await executeRefactorCommand(command);
    } catch (error) {
        if (isCliUsageError(error)) {
            // Attach the command's help text if the usage error was thrown without it
            // (e.g. from deep inside validateRefactorIntent which has no command reference).
            if (!error.usage) {
                error.usage = command.helpInformation();
            }

            throw error;
        }

        const message = Core.getErrorMessage(error, { fallback: "Unknown refactor error" });
        const usage = command.helpInformation();
        throw new CliUsageError(`Refactor failed: ${message}`, { usage });
    }
}
