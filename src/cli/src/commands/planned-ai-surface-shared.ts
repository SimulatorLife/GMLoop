import { Semantic } from "@gmloop/semantic";

import { resolveCommandProjectContext } from "../workflow/project-root.js";

export type PlannedSurfaceSharedOptions = Readonly<{
    config?: string;
    databasePath?: string;
    force?: boolean;
    json?: boolean;
    path?: string;
    toolsetRoot?: string;
}>;

export type PlannedSurfaceUnsupportedPayload = Readonly<{
    command: string;
    message: string;
    nextSteps: ReadonlyArray<string>;
    state: "unsupported_backend";
}>;

/**
 * Print command payloads as JSON for deterministic machine and MCP parsing.
 */
export function printPlannedSurfacePayload(payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log(JSON.stringify(payload, null, 2));
}

/**
 * Resolve project root and configuration for graph-backed command suites.
 *
 * Delegates to {@link resolveCommandProjectContext} from the shared workflow helpers.
 */
export function resolvePlannedSurfaceProjectContext(options: PlannedSurfaceSharedOptions): Promise<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}> {
    return resolveCommandProjectContext(options);
}

/**
 * Build or refresh the semantic graph index and return the resolved project context.
 */
export async function ensurePlannedSurfaceGraphIndex(options: PlannedSurfaceSharedOptions): Promise<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}> {
    const context = await resolvePlannedSurfaceProjectContext(options);

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
 * Emit a structured non-throwing response when a command leaf is planned but
 * the required mutation/runtime backend is not implemented yet.
 */
export function reportUnsupportedPlannedSurfaceBackend(
    commandName: string,
    options: PlannedSurfaceSharedOptions,
    message: string,
    nextSteps: ReadonlyArray<string>
): PlannedSurfaceUnsupportedPayload {
    const payload = Object.freeze({
        command: commandName,
        message,
        nextSteps,
        state: "unsupported_backend" as const
    });

    printPlannedSurfacePayload(payload, options.json === true);

    return payload;
}
