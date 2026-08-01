import path from "node:path";
import { fileURLToPath } from "node:url";

export interface FixtureDirectoryResolutionParameters {
    moduleUrl: string;
    sourceRelativeSegments: ReadonlyArray<string>;
    distRelativeSegments: ReadonlyArray<string>;
}

/**
 * Resolve a fixture directory relative to a test module, accounting for both
 * source-tree execution and compiled `dist/` execution.
 *
 * @param parameters Resolution inputs describing the current module and the
 * relative fixture paths for source and compiled test layouts.
 * @returns The absolute fixture directory path for the current execution mode.
 */
export function resolveFixtureDirectoryFromModuleUrl(parameters: FixtureDirectoryResolutionParameters): string {
    const currentDirectory = fileURLToPath(new URL(".", parameters.moduleUrl));
    const relativeSegments = currentDirectory.includes(`${path.sep}dist${path.sep}`)
        ? parameters.distRelativeSegments
        : parameters.sourceRelativeSegments;

    return path.resolve(currentDirectory, ...relativeSegments);
}
