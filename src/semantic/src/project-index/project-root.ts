import path from "node:path";

import { Core } from "@gmloop/core";

import { createProjectIndexAbortGuard, PROJECT_ROOT_DISCOVERY_ABORT_MESSAGE } from "./abort-guard.js";
import { isProjectManifestPath } from "./constants.js";
import type { ProjectIndexFsFacade } from "./fs-facade.js";

// Use canonical Core namespace access instead of destructuring
// - Core.walkAncestorDirectories

export async function findProjectRoot(
    options,
    fsFacade: Required<Pick<ProjectIndexFsFacade, "readDir">> = Core.defaultFsFacade as Required<ProjectIndexFsFacade>
) {
    const filepath = options?.filepath;
    const { signal, ensureNotAborted } = createProjectIndexAbortGuard(options, {
        message: PROJECT_ROOT_DISCOVERY_ABORT_MESSAGE
    });

    if (!filepath) {
        return null;
    }

    const startDirectory = path.dirname(path.resolve(filepath));

    const directories = [...Core.walkAncestorDirectories(startDirectory)];
    return await directories.reduce(
        (previousPromise, directory) =>
            previousPromise.then(async (found) => {
                if (found) {
                    return found;
                }

                ensureNotAborted();
                const entries = await Core.listDirectory(fsFacade, directory, {
                    signal
                });
                ensureNotAborted();

                if (entries.some(isProjectManifestPath)) {
                    return directory;
                }

                return null;
            }),
        Promise.resolve<string | null>(null)
    );
}
