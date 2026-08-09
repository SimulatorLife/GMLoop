import path from "node:path";

import type { Refactor } from "@gmloop/refactor";

type RegisteredCodemodId = ReturnType<typeof Refactor.listRegisteredCodemods>[number]["id"];

/**
 * Decide whether the initial semantic project index build should be deferred
 * until after earlier, non-semantic-index-dependent codemods run.
 *
 * Deferring avoids an up-front index build when the configured selection
 * runs one or more non-semantic codemods before the first codemod that
 * needs the semantic index; those earlier codemods may themselves change
 * files, so the index is instead built fresh right before it is needed.
 */
export function shouldDeferInitialSemanticIndexBuild(
    selectedCodemodIds: ReadonlyArray<RegisteredCodemodId>,
    semanticIndexDependentCodemodIds: ReadonlySet<RegisteredCodemodId>
): boolean {
    const firstSemanticCodemodIndex = selectedCodemodIds.findIndex((codemodId) =>
        semanticIndexDependentCodemodIds.has(codemodId)
    );

    return (
        firstSemanticCodemodIndex > 0 &&
        selectedCodemodIds
            .slice(0, firstSemanticCodemodIndex)
            .some((codemodId) => !semanticIndexDependentCodemodIds.has(codemodId))
    );
}

/**
 * Describe a set of changed file paths as "modified" semantic-index changes,
 * resolved against the project root, for use with an incremental project
 * index build.
 */
export function toModifiedSemanticIndexChanges(
    projectRoot: string,
    filePaths: ReadonlyArray<string>
): Array<{ filePath: string; kind: "modified" }> {
    return filePaths.map((filePath) => ({
        filePath: path.resolve(projectRoot, filePath),
        kind: "modified" as const
    }));
}
