import { Core } from "@gmloop/core";

export const PROJECT_ROOT_DISCOVERY_ABORT_MESSAGE = "Project root discovery was aborted.";
export const PROJECT_INDEX_BUILD_ABORT_MESSAGE = "Project index build was aborted.";

type ProjectIndexAbortGuardConfig = {
    key?: string | number | symbol;
    message?: string | null;
    fallbackMessage?: string | null;
};

type CoreAbortGuard = ReturnType<typeof Core.createAbortGuard>;

export type ProjectIndexAbortGuard = {
    signal: CoreAbortGuard["signal"];
    ensureNotAborted(this: void): void;
};

/**
 * Create a reusable cancellation checkpoint for project-index work.
 *
 * The guard reads `options.signal` unless `config.key` selects another
 * property. Construction throws for an already-aborted signal; cancellation
 * after construction is observed when callers invoke `ensureNotAborted()`.
 *
 * @param {unknown} options Candidate options bag containing the abort signal.
 * @param {ProjectIndexAbortGuardConfig} [config] Signal property and fallback
 *        message overrides. A non-null `fallbackMessage` takes precedence over
 *        `message`; otherwise the project-index build message is used.
 * @returns {ProjectIndexAbortGuard} The normalized signal, or `null` when no
 *          usable signal exists, together with its checkpoint.
 */
export function createProjectIndexAbortGuard(
    options: unknown,
    config: ProjectIndexAbortGuardConfig = {}
): ProjectIndexAbortGuard {
    const { message, fallbackMessage, key } = config;
    const resolvedFallback = fallbackMessage ?? message ?? PROJECT_INDEX_BUILD_ABORT_MESSAGE;

    const keyOption = key == null ? {} : { key };

    return Core.createAbortGuard(options, {
        fallbackMessage: resolvedFallback,
        ...keyOption
    });
}
