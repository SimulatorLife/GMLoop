import path from "node:path";

import { Core } from "@gmloop/core";

import { createProjectIndexAbortGuard, PROJECT_ROOT_DISCOVERY_ABORT_MESSAGE } from "./abort-guard.js";
import { isProjectManifestPath } from "./constants.js";
import type { ProjectIndexFsFacade } from "./fs-facade.js";

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
    const directories = Core.walkAncestorDirectories(startDirectory);

    const findManifestDirectory = async (): Promise<string | null> => {
        const nextDirectory = directories.next();
        if (nextDirectory.done === true) {
            return null;
        }

        ensureNotAborted();
        const entries = await Core.listDirectory(fsFacade, nextDirectory.value, { signal });
        ensureNotAborted();

        return entries.some(isProjectManifestPath) ? nextDirectory.value : findManifestDirectory();
    };

    return await findManifestDirectory();
}
