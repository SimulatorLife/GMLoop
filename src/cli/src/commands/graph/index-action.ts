import { Semantic } from "@gmloop/semantic";

import {
    createGraphEnvelope,
    ensureGraphIndex,
    ensureGraphIndexForQuery,
    type GraphCommandSharedOptions,
    printGraphOutput,
    resolveGraphContext
} from "./shared.js";

async function runGraphIndexAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    const result = await ensureGraphIndex(options, context);
    const payload = {
        databasePath: result.databasePath,
        graphIds: result.graphIds
    };
    printGraphOutput(
        createGraphEnvelope("graph index", context, options, payload),
        options.json === true,
        `Indexed ${result.graphIds.join(", ")} graph(s) at ${result.databasePath}.`
    );
}

async function runGraphSearchAction(queryText: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndexForQuery(options, context);
    const result = Semantic.searchGraphIndex({
        databasePath: options.databasePath,
        limit: options.limit,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        query: queryText,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(
        createGraphEnvelope("graph search", context, options, result),
        options.json === true,
        `Found ${String(result.results.length)} graph result(s) for "${result.query}".`
    );
}

async function runGraphDoctorAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    if (options.vacuum) {
        const result = Semantic.vacuumGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
        printGraphOutput(
            createGraphEnvelope("graph doctor", context, options, result),
            options.json === true,
            `Compacted graph database at ${result.databasePath} (${String(result.bloatPercentBefore ?? 0)}% -> ${String(result.bloatPercentAfter ?? 0)}% reclaimable space).`
        );
        return;
    }

    const report = Semantic.doctorGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(
        createGraphEnvelope("graph doctor", context, options, report),
        options.json === true,
        report.issues.length === 0
            ? `Graph index is healthy at ${report.databasePath}.`
            : `Graph doctor reported ${String(report.issues.length)} issue(s).`
    );
}

export { runGraphDoctorAction, runGraphIndexAction, runGraphSearchAction };
