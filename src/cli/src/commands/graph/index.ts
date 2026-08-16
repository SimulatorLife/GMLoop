import { Command, Option } from "commander";

import { applyStandardCommandOptions } from "../../cli-core/command-standard-options.js";
import { handleCliError } from "../../cli-core/errors.js";
import { runGraphDoctorAction, runGraphIndexAction, runGraphSearchAction } from "./index-action.js";
import { addGraphSharedOptions, type GraphCommandSharedOptions } from "./shared.js";
import type { DocumentationCatalogProviders } from "./visualize/catalog.js";
import { createGraphVisualizationWorkflowArguments, streamProcessOutputByLine } from "./visualize/child-process.js";
import { runGraphVisualizeAction } from "./visualize/index.js";
import {
    createGraphVisualizationLiveReloadModelFromSession,
    createGraphVisualizationLiveReloadSessionState,
    createGraphVisualizationLiveReloadStartArguments,
    ensureGraphVisualizationLiveReloadSession,
    resolveGraphVisualizationLiveReloadStartupOptions,
    stopGraphVisualizationLiveReloadSession,
    stopOwnedGraphVisualizationLiveReloadSession
} from "./visualize/live-reload.js";
import { parsePlaygroundFixtureConfig } from "./visualize/playground.js";
import {
    resolveDefaultGraphVisualizationServeTargetPath,
    resolveGraphVisualizationServeStartupState
} from "./visualize/serve-target.js";
import {
    isGraphVisualizationUiSourceReloadCandidate,
    normalizeGraphVisualizationUiSourceWatchFileName,
    resolveGraphVisualizationUiSourceWatchRoot,
    startGraphVisualizationActiveProjectStateWatcher,
    startGraphVisualizationFeatherMetadataWatcher,
    startGraphVisualizationUiSourceWatcher
} from "./visualize/watchers.js";

async function runGraphCommandAction(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        handleCliError(error, {
            exitCode: 1,
            prefix: "Graph command failed."
        });
    }
}

/**
 * Create the `graph` command suite.
 */
export function createGraphCommand(documentationCatalogProviders: DocumentationCatalogProviders): Command {
    const graphCommand = applyStandardCommandOptions(new Command("graph")).description(
        "Build and query the dual-root semantic graph index."
    );

    const indexCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("index")).description("Build or rebuild the graph index."),
        { includeForce: true }
    );
    indexCommand.action(async function graphIndexCommandAction() {
        await runGraphCommandAction(async () => {
            await runGraphIndexAction(this.opts<GraphCommandSharedOptions>());
        });
    });

    const searchCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("search"))
            .description("Search the graph index.")
            .argument("<query...>", "Search query"),
        { includeLimit: true, includeForce: true }
    );
    searchCommand.action(async function graphSearchCommandAction(query: Array<string>) {
        await runGraphCommandAction(async () => {
            await runGraphSearchAction(query.join(" "), this.opts<GraphCommandSharedOptions>());
        });
    });

    const doctorCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("doctor")).description("Inspect graph-index health and configuration."),
        {}
    ).addOption(
        new Option(
            "--vacuum",
            "Compact the graph database, reclaiming free space left by incremental rebuilds"
        ).default(false)
    );
    doctorCommand.action(async function graphDoctorCommandAction() {
        await runGraphCommandAction(async () => {
            await runGraphDoctorAction(this.opts<GraphCommandSharedOptions>());
        });
    });

    const visualizeCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("visualize")).description(
            "Render an interactive graph index visualization HTML+assets bundle."
        ),
        { includeForce: true }
    );
    visualizeCommand
        .addOption(new Option("--output <path>", "Output visualization directory path"))
        .addOption(new Option("--open", "Open the generated file in your default browser").default(true))
        .addOption(new Option("--no-open", "Do not open the generated file").default(false))
        .addOption(new Option("--serve", "Serve dynamically rather than writing an output file").default(false))
        .addOption(
            new Option("--live-reload", "Auto-rebuild and auto-reload served UI when src/ui/src changes").default(true)
        )
        .addOption(new Option("--project-state <path>", "Active-project state file written by GMLoop UI."))
        .action(async function graphVisualizeCommandAction() {
            await runGraphCommandAction(async () => {
                await runGraphVisualizeAction(this.opts<GraphCommandSharedOptions>(), documentationCatalogProviders);
            });
        });

    graphCommand.addCommand(indexCommand);
    graphCommand.addCommand(searchCommand);
    graphCommand.addCommand(doctorCommand);
    graphCommand.addCommand(visualizeCommand);

    return graphCommand;
}

/**
 * Internal test surface that exposes helpers used by the focused CLI tests.
 *
 * The CLI tests exercise these helpers directly because they are stable seams
 * between the command factory and its underlying helpers. Keeping them in a
 * single frozen object makes the contract obvious and prevents accidental
 * mutation by test code.
 */
export const __graphCommandTest__ = Object.freeze({
    createGraphVisualizationLiveReloadModelFromSession,
    createGraphVisualizationLiveReloadSessionState,
    createGraphVisualizationLiveReloadStartArguments,
    createGraphVisualizationWorkflowArguments,
    ensureGraphVisualizationLiveReloadSession,
    isGraphVisualizationUiSourceReloadCandidate,
    normalizeGraphVisualizationUiSourceWatchFileName,
    parsePlaygroundFixtureConfig,
    resolveDefaultGraphVisualizationServeTargetPath,
    resolveGraphVisualizationLiveReloadStartupOptions,
    resolveGraphVisualizationServeStartupState,
    resolveGraphVisualizationUiSourceWatchRoot,
    startGraphVisualizationActiveProjectStateWatcher,
    startGraphVisualizationFeatherMetadataWatcher,
    startGraphVisualizationUiSourceWatcher,
    stopGraphVisualizationLiveReloadSession,
    stopOwnedGraphVisualizationLiveReloadSession,
    streamProcessOutputByLine
});
