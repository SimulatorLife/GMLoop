import { lstat } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import * as ParserWorkspace from "@gmloop/parser";
import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type ValidateSharedOptions = Readonly<{
    config?: string;
    databasePath?: string;
    json?: boolean;
    path?: string;
    toolsetRoot?: string;
}>;

function printValidatePayload(payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    console.log(JSON.stringify(payload, null, 2));
}

async function resolveProjectContext(options: ValidateSharedOptions): Promise<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}> {
    const projectRoot = await discoverProjectRoot({
        configPath: options.config,
        explicitProjectPath: options.path
    });
    const configPath = options.config ?? path.join(projectRoot, "gmloop.json");
    const loadedConfig = await Core.loadGmloopProjectConfig(configPath).catch(() => ({}));
    return {
        projectConfig: Core.isObjectLike(loadedConfig) ? (loadedConfig as Record<string, unknown>) : {},
        projectRoot
    };
}

async function runValidateFileAction(targetPath: string, options: ValidateSharedOptions): Promise<void> {
    const sourceText = await Core.readTextFile(targetPath);
    const ast = ParserWorkspace.Parser.GMLParser.parse(sourceText);
    printValidatePayload(
        {
            ok: true,
            payload: {
                astNodeType: Core.isObjectLike(ast) && typeof ast.type === "string" ? ast.type : "unknown",
                targetPath
            },
            scope: "file"
        },
        options.json === true
    );
}

async function runValidateProjectAction(options: ValidateSharedOptions): Promise<void> {
    const context = await resolveProjectContext(options);
    const graphIndex = await Semantic.buildGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printValidatePayload(
        {
            ok: true,
            payload: {
                databasePath: graphIndex.databasePath,
                graphIds: graphIndex.graphIds,
                projectRoot: context.projectRoot
            },
            scope: "project"
        },
        options.json === true
    );
}

async function runValidateRoomAction(roomNameOrId: string, options: ValidateSharedOptions): Promise<void> {
    const context = await resolveProjectContext(options);
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
    printValidatePayload(
        {
            ok: hasRoomMatch,
            payload: {
                query: roomNameOrId,
                resultCount: search.results.length
            },
            scope: "room"
        },
        options.json === true
    );
}

async function runValidateResourceAction(resourceNameOrId: string, options: ValidateSharedOptions): Promise<void> {
    const context = await resolveProjectContext(options);
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
    printValidatePayload(
        {
            ok: search.results.length > 0,
            payload: {
                query: resourceNameOrId,
                resultCount: search.results.length
            },
            scope: "resource"
        },
        options.json === true
    );
}

function addValidateSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--json", "Emit JSON output.");
}

async function requireReadableFilePath(filePath: string): Promise<void> {
    const targetStats = await lstat(filePath);
    if (!targetStats.isFile()) {
        throw new Error(`Expected file path, received non-file target: ${filePath}`);
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
        await requireReadableFilePath(targetPath);
        await runValidateFileAction(targetPath, this.opts<ValidateSharedOptions>());
    });

    const project = addValidateSharedOptions(
        applyStandardCommandOptions(new Command("project")).description(
            "Validate project graph index can be built successfully."
        )
    );
    project.action(async function validateProjectAction() {
        await runValidateProjectAction(this.opts<ValidateSharedOptions>());
    });

    const room = addValidateSharedOptions(
        applyStandardCommandOptions(new Command("room"))
            .description("Validate a room symbol resolves in the project graph.")
            .argument("<room>", "Room name or graph identifier.")
    );
    room.action(async function validateRoomAction(roomNameOrId: string) {
        await runValidateRoomAction(roomNameOrId, this.opts<ValidateSharedOptions>());
    });

    const resource = addValidateSharedOptions(
        applyStandardCommandOptions(new Command("resource"))
            .description("Validate a resource symbol resolves in the project graph.")
            .argument("<resource>", "Resource name or graph identifier.")
    );
    resource.action(async function validateResourceAction(resourceNameOrId: string) {
        await runValidateResourceAction(resourceNameOrId, this.opts<ValidateSharedOptions>());
    });

    command.addCommand(file);
    command.addCommand(project);
    command.addCommand(room);
    command.addCommand(resource);
    return command;
}
