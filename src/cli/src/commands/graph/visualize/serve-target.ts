import { existsSync } from "node:fs";
import path from "node:path";

import { findRepoRootSync } from "../../../shared/repo-root.js";
import {
    readGameMakerCliActiveProjectStateProjectPath,
    resolveGameMakerCliActiveProjectStatePath
} from "../../../workflow/project-root.js";
import { type GraphCommandSharedOptions, resolveGraphContext } from "../shared.js";
import { ensureGraphIndexForServe } from "./child-process.js";
import type { GraphServeSource, GraphVisualizationStartupState } from "./types.js";

const DEMO_PROJECT_DIRECTORY = path.join("vendor", "3DSpider");
const DEMO_PROJECT_MANIFEST = "3D-ish spider thing 2.yyp";

function resolveDefaultGraphVisualizationServeTargetPath(startDirectory: string = process.cwd()): string | null {
    try {
        const repoRoot = findRepoRootSync(startDirectory);
        const demoProjectRoot = path.join(repoRoot, DEMO_PROJECT_DIRECTORY);
        const demoProjectManifest = path.join(demoProjectRoot, DEMO_PROJECT_MANIFEST);
        return existsSync(demoProjectManifest) ? demoProjectRoot : null;
    } catch {
        return null;
    }
}

/**
 * Resolve the initial serve-target by preferring an explicit `--path`,
 * falling back to the gm-cli active project state file, then the working
 * directory, then a vendored demo project. The callback is invoked before
 * any build work so the UI can publish the chosen target immediately.
 */
async function resolveGraphVisualizationServeStartupState(
    options: GraphCommandSharedOptions,
    initialSelectedPath: string | null,
    onTargetResolved: (target: Readonly<{ selectedPaths: ReadonlyArray<string>; source: GraphServeSource }>) => void
): Promise<GraphVisualizationStartupState> {
    if (initialSelectedPath !== null) {
        const context = await resolveGraphContext(options);
        const target = { selectedPaths: [initialSelectedPath], source: "cli-path" as const };
        onTargetResolved(target);
        await ensureGraphIndexForServe(options, context, false);
        return { context, ...target };
    }

    try {
        const statePath = resolveGameMakerCliActiveProjectStatePath({
            env: process.env,
            statePathOption: options.projectState
        });
        const activeProjectPath = await readGameMakerCliActiveProjectStateProjectPath({ statePath });
        if (activeProjectPath !== null) {
            const nextOptions = {
                ...options,
                path: activeProjectPath
            };
            const context = await resolveGraphContext(nextOptions);
            const target = { selectedPaths: [activeProjectPath], source: "active-project-state" as const };
            onTargetResolved(target);
            await ensureGraphIndexForServe(nextOptions, context, false);
            return { context, ...target };
        }
    } catch {
        // Ignore state path load failures and continue with normal discovery.
    }

    try {
        const context = await resolveGraphContext(options);
        const target = { selectedPaths: [context.projectRoot], source: "working-directory" as const };
        onTargetResolved(target);
        await ensureGraphIndexForServe(options, context, false);
        return { context, ...target };
    } catch {
        const defaultServeTargetPath = resolveDefaultGraphVisualizationServeTargetPath();
        if (defaultServeTargetPath === null) {
            const target = { selectedPaths: [], source: "working-directory" as const };
            onTargetResolved(target);
            return { context: null, ...target };
        }

        const nextOptions = {
            ...options,
            path: defaultServeTargetPath
        };
        const context = await resolveGraphContext(nextOptions);
        const target = { selectedPaths: [defaultServeTargetPath], source: "demo-project" as const };
        onTargetResolved(target);
        await ensureGraphIndexForServe(nextOptions, context, false);
        return { context, ...target };
    }
}

export { resolveDefaultGraphVisualizationServeTargetPath, resolveGraphVisualizationServeStartupState };
