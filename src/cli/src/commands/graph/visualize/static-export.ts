import path from "node:path";

import { Semantic } from "@gmloop/semantic";
import { UI } from "@gmloop/ui";

import { openUrlInDefaultBrowser } from "../../../modules/server/graph-visualization-server.js";
import type { createGraphVisualizationProjectConfigurationCatalog } from "../../../modules/ui/index.js";
import {
    createGraphEnvelope,
    type GraphCommandSharedOptions,
    type GraphResolutionContext,
    printGraphOutput
} from "../shared.js";
import type { AutoGamePipelineModel } from "./auto-game-pipeline.js";
import { writeGraphVisualizationBundleArtifact } from "./bundle.js";
import { createDocumentationCatalogs, type DocumentationCatalogProviders } from "./catalog.js";
import type { GraphVisualizationServePayload, GraphVisualizedLoadedTarget } from "./types.js";

type GraphVisualizationStaticExportInput = Readonly<{
    autoGamePipeline: AutoGamePipelineModel | null;
    context: GraphResolutionContext | null;
    documentationCatalogProviders: DocumentationCatalogProviders;
    loadedTarget: GraphVisualizedLoadedTarget;
    options: GraphCommandSharedOptions;
    payload: GraphVisualizationServePayload;
    projectConfigurationCatalog: Awaited<ReturnType<typeof createGraphVisualizationProjectConfigurationCatalog>>;
}>;

/**
 * Render a one-shot `graph visualize` export bundle and write it to disk.
 *
 * Single responsibility: given a resolved project context, the active
 * visualization payload, the project configuration catalog, and the
 * user-supplied options, render the static HTML+assets bundle to the requested
 * output directory and report the result.
 *
 * This is the static-export counterpart to the inner `runServeVisualizationMode`
 * helper inside {@link runGraphVisualizeAction}. It is intentionally
 * serve-mode-free: it does not consult live-reload sessions, serve-revision
 * counters, bundle caches, or fix-workflow state. By keeping those concerns
 * separate, the outer action can dispatch to the right helper without
 * tangling mode-specific state.
 */
async function runGraphVisualizationStaticExportMode(input: GraphVisualizationStaticExportInput): Promise<void> {
    if (input.context === null) {
        throw new Error("Could not locate a GameMaker project root. Pass --path or run inside a project tree.");
    }

    const activeConfig = Semantic.resolveGraphIndexConfig({
        databasePath: input.options.databasePath,
        projectConfig: input.context.projectConfig,
        projectRoot: input.context.projectRoot,
        toolsetRoot: input.options.toolsetRoot
    });

    const documentationCatalogs = createDocumentationCatalogs(input.documentationCatalogProviders);
    const dbPath = activeConfig.databasePath;
    const bundleArtifact = await UI.renderGraphVisualizationBundle(input.payload, {
        autoGamePipeline: input.autoGamePipeline ?? undefined,
        documentationCatalogs,
        loadedTarget: input.loadedTarget,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: input.projectConfigurationCatalog,
        title: activeConfig.projectRoot
    });
    const outputDirectory = input.options.output ?? path.join(path.dirname(dbPath), "graph-visualization");
    const exportResult = await writeGraphVisualizationBundleArtifact(bundleArtifact, outputDirectory);

    printGraphOutput(
        createGraphEnvelope("graph visualize", input.context, input.options, exportResult),
        input.options.json === true,
        `Exported graph visualization bundle to ${path.join(outputDirectory, exportResult.entryHtmlPath)}`
    );

    if (input.options.open) {
        openUrlInDefaultBrowser(path.join(outputDirectory, exportResult.entryHtmlPath));
    }
}

export { type GraphVisualizationStaticExportInput, runGraphVisualizationStaticExportMode };
