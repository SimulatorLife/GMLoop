import { Semantic } from "@gmloop/semantic";

import { resolveCommandProjectContext } from "./project-root.js";

/**
 * Minimal shared options type for CLI commands that need to resolve a project
 * root and load its configuration. Individual command option types are
 * structurally compatible with this type via TypeScript's structural subtyping.
 */
export type SharedProjectContextOptions = Readonly<{
    config?: string;
    databasePath?: string;
    force?: boolean;
    path?: string;
    toolsetRoot?: string;
}>;

/**
 * Build or refresh the semantic graph index and return the resolved project
 * context. Passes `rebuild: true` to the index builder when the caller's
 * `--force` flag is set.
 *
 * @param {SharedProjectContextOptions} options CLI option bag. `force` triggers
 *        a full graph rebuild.
 * @returns {{ projectConfig: Record<string, unknown>, projectRoot: string }}
 *          Resolved project context.
 */
export async function ensureProjectGraphIndex(options: SharedProjectContextOptions): Promise<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}> {
    const context = await resolveCommandProjectContext(options);
    await Semantic.buildGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        rebuild: options.force === true,
        toolsetRoot: options.toolsetRoot
    });
    return context;
}

/**
 * Serialize a command result payload as pretty-printed JSON and write it to
 * stdout. All graph-backed commands use this single consistent format so that
 * machine consumers and MCP clients can rely on a stable output shape.
 *
 * @param {unknown} payload Serializable value to emit.
 */
export function printProjectPayload(payload: unknown): void {
    console.log(JSON.stringify(payload, null, 2));
}
