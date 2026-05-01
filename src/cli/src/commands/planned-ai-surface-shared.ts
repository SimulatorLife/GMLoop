import { printProjectPayload, type SharedProjectContextOptions } from "../workflow/project-context.js";

export {
    ensureProjectGraphIndex as ensurePlannedSurfaceGraphIndex,
    printProjectPayload as printPlannedSurfacePayload,
    resolveProjectContext as resolvePlannedSurfaceProjectContext
} from "../workflow/project-context.js";

/** @deprecated Use {@link SharedProjectContextOptions} from `workflow/project-context`. */
export type PlannedSurfaceSharedOptions = SharedProjectContextOptions &
    Readonly<{
        json?: boolean;
    }>;

export type PlannedSurfaceUnsupportedPayload = Readonly<{
    command: string;
    message: string;
    nextSteps: ReadonlyArray<string>;
    state: "unsupported_backend";
}>;

/**
 * Emit a structured non-throwing response when a command leaf is planned but
 * the required mutation/runtime backend is not implemented yet.
 */
export function reportUnsupportedPlannedSurfaceBackend(
    commandName: string,
    _options: PlannedSurfaceSharedOptions,
    message: string,
    nextSteps: ReadonlyArray<string>
): PlannedSurfaceUnsupportedPayload {
    const payload = Object.freeze({
        command: commandName,
        message,
        nextSteps,
        state: "unsupported_backend" as const
    });

    printProjectPayload(payload);

    return payload;
}
