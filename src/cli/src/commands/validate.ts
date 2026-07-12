import { lstat } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import * as ParserWorkspace from "@gmloop/parser";
import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import { printProjectPayload, resolveCommandProjectContext } from "../workflow/project-root.js";

type ValidateSharedOptions = Readonly<{
    config?: string;
    databasePath?: string;
    fix?: boolean;
    kind?: "auto" | "gml" | "shader" | "yy" | "yyp";
    json?: boolean;
    path?: string;
    scope?: "all" | "references" | "syntax";
    toolsetRoot?: string;
}>;

type ValidateScope = "file" | "project" | "resource" | "room";

async function runValidateAction(
    scope: ValidateScope,
    options: ValidateSharedOptions,
    action: () => Promise<void>
): Promise<void> {
    try {
        await action();
    } catch (error) {
        if (options.json !== true) {
            throw error;
        }

        printProjectPayload({
            error: { message: Core.getErrorMessage(error) },
            ok: false,
            scope
        });
        process.exitCode = 1;
    }
}

async function runValidateFileAction(targetPath: string, options: ValidateSharedOptions): Promise<void> {
    const sourceText = await Core.readTextFile(targetPath);
    const ast = ParserWorkspace.Parser.GMLParser.parse(sourceText);
    const effectiveKind = options.kind ?? "auto";
    const effectiveScope = options.scope ?? "all";
    printProjectPayload({
        ok: true,
        payload: {
            astNodeType: Core.isObjectLike(ast) && typeof ast.type === "string" ? ast.type : "unknown",
            fixApplied: false,
            kind: effectiveKind,
            scope: effectiveScope,
            targetPath
        },
        scope: "file"
    });
}

async function runValidateProjectAction(options: ValidateSharedOptions): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    await requireGameMakerProjectRoot(context.projectRoot);
    const graphIndex = await Semantic.buildGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printProjectPayload({
        ok: true,
        payload: {
            databasePath: graphIndex.databasePath,
            graphIds: graphIndex.graphIds,
            projectRoot: context.projectRoot
        },
        scope: "project"
    });
}

async function runValidateRoomAction(roomNameOrId: string, options: ValidateSharedOptions): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    await Semantic.buildGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    const search = Semantic.searchGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        query: roomNameOrId,
        toolsetRoot: options.toolsetRoot
    });
    const hasRoomMatch = search.results.some((entry) => entry.kind === "room");
    printProjectPayload({
        ok: hasRoomMatch,
        payload: {
            query: roomNameOrId,
            resultCount: search.results.length
        },
        scope: "room"
    });
}

async function runValidateResourceAction(resourceNameOrId: string, options: ValidateSharedOptions): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    await Semantic.buildGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    const search = Semantic.searchGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        query: resourceNameOrId,
        toolsetRoot: options.toolsetRoot
    });
    printProjectPayload({
        ok: search.results.length > 0,
        payload: {
            query: resourceNameOrId,
            resultCount: search.results.length
        },
        scope: "resource"
    });
}

function addValidateSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--kind <kind>", "Target kind: auto, gml, yy, yyp, or shader.", "auto")
        .option("--scope <scope>", "Validation scope: syntax, references, or all.", "all")
        .option("--fix", "Apply safe automatic fixes when available.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--json", "Emit JSON output.");
}

async function requireReadableFilePath(filePath: string): Promise<void> {
    const targetStats = await lstat(filePath);
    if (!targetStats.isFile()) {
        throw new Error(`Expected file path, received non-file target: ${filePath}`);
    }
}

async function requireGameMakerProjectRoot(projectRoot: string): Promise<void> {
    const projectRootStats = await lstat(projectRoot).catch(() => {
        throw new Error(`GameMaker project directory does not exist: ${projectRoot}`);
    });

    if (!projectRootStats.isDirectory()) {
        throw new Error(`Expected GameMaker project directory, received non-directory target: ${projectRoot}`);
    }

    const discoveredProjectRoot = await Semantic.findProjectRoot({
        filepath: path.join(projectRoot, "gmloop.json")
    });
    if (!discoveredProjectRoot || path.resolve(discoveredProjectRoot) !== path.resolve(projectRoot)) {
        throw new Error(`Could not find a .yyp manifest in GameMaker project directory: ${projectRoot}`);
    }
}

export function createValidateCommand(): Command {
    const command = applyStandardCommandOptions(new Command("validate")).description(
        "Validate file/project/room/resource targets for parser and graph integrity."
    );

    const file = addValidateSharedOptions(
        applyStandardCommandOptions(new Command("file"))
            .description("Validate one GML source file parses successfully.")
            .argument("<target>", "Path to a .gml file.")
    );
    file.action(async function validateFileAction(targetPath: string) {
        const options = this.opts<ValidateSharedOptions>();
        await runValidateAction("file", options, async () => {
            await requireReadableFilePath(targetPath);
            await runValidateFileAction(targetPath, options);
        });
    });

    const project = addValidateSharedOptions(
        applyStandardCommandOptions(new Command("project")).description(
            "Validate project graph index can be built successfully."
        )
    );
    project.action(async function validateProjectAction() {
        const options = this.opts<ValidateSharedOptions>();
        await runValidateAction("project", options, () => runValidateProjectAction(options));
    });

    const room = addValidateSharedOptions(
        applyStandardCommandOptions(new Command("room"))
            .description("Validate a room symbol resolves in the project graph.")
            .argument("<room>", "Room name or graph identifier.")
    );
    room.action(async function validateRoomAction(roomNameOrId: string) {
        const options = this.opts<ValidateSharedOptions>();
        await runValidateAction("room", options, () => runValidateRoomAction(roomNameOrId, options));
    });

    const resource = addValidateSharedOptions(
        applyStandardCommandOptions(new Command("resource"))
            .description("Validate a resource symbol resolves in the project graph.")
            .argument("<resource>", "Resource name or graph identifier.")
    );
    resource.action(async function validateResourceAction(resourceNameOrId: string) {
        const options = this.opts<ValidateSharedOptions>();
        await runValidateAction("resource", options, () => runValidateResourceAction(resourceNameOrId, options));
    });

    command.addCommand(file);
    command.addCommand(project);
    command.addCommand(room);
    command.addCommand(resource);
    return command;
}
