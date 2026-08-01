import type { FixtureAdapter, FixtureSuiteDefinition } from "../types.js";
import { resolveFixtureDirectoryFromModuleUrl } from "./resolve-fixture-directory-from-module-url.js";

export interface FixtureSuiteDefinitionParameters {
    workspaceName: string;
    suiteName: string;
    compiledWorkspaceTestFilePath: string;
    adapter: FixtureAdapter;
    moduleUrl: string;
    sourceRelativeSegments: ReadonlyArray<string>;
    distRelativeSegments: ReadonlyArray<string>;
}

/**
 * Create a canonical fixture-suite definition for a workspace test module.
 *
 * @param parameters Workspace metadata, adapter, and fixture path resolution configuration.
 * @returns Immutable fixture suite metadata for registration and aggregate execution.
 */
export function createFixtureSuiteDefinition(parameters: FixtureSuiteDefinitionParameters): FixtureSuiteDefinition {
    const fixtureRoot = resolveFixtureDirectoryFromModuleUrl({
        moduleUrl: parameters.moduleUrl,
        sourceRelativeSegments: parameters.sourceRelativeSegments,
        distRelativeSegments: parameters.distRelativeSegments
    });

    return Object.freeze({
        workspaceName: parameters.workspaceName,
        suiteName: parameters.suiteName,
        compiledWorkspaceTestFilePath: parameters.compiledWorkspaceTestFilePath,
        fixtureRoot,
        adapter: parameters.adapter
    });
}
