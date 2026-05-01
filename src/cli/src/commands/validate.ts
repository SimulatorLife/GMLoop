import { lstat } from "node:fs/promises";

import { Core } from "@gmloop/core";
import * as ParserWorkspace from "@gmloop/parser";
import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import { printProjectPayload, resolveProjectContext } from "../workflow/project-context.js";

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
    const context = await resolveProjectContext(options);
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
