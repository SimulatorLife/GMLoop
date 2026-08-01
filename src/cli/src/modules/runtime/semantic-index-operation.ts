import path from "node:path";

import {
    getCurrentProjectOperation,
    type ProjectOperationLease,
    runProjectOperation
} from "./project-operation-state.js";
import type { ProjectSemanticIndexProgress } from "./semantic-index-progress.js";

type SemanticIndexProgressCallback = (progress: ProjectSemanticIndexProgress) => void;
const SEMANTIC_INDEX_OPERATION_KIND = "semantic-index";

function createProgressReporter(operation: ProjectOperationLease): SemanticIndexProgressCallback {
    return (progress): void => {
        operation.updateSemanticIndexProgress(progress);
    };
}

/**
 * Run semantic indexing under the current project operation when one exists,
 * otherwise acquire the shared project operation lock for the index build.
 *
 * This keeps nested semantic refreshes (for example refactor codemods) inside
 * their parent operation while standalone graph/MCP requests still contend on
 * the same project-local lock.
 */
export async function runSemanticIndexOperation<TValue>(
    projectRoot: string,
    execute: (onProgress: SemanticIndexProgressCallback) => Promise<TValue>
): Promise<TValue> {
    const resolvedRoot = path.resolve(projectRoot);
    const currentOperation = getCurrentProjectOperation();
    if (currentOperation !== null && path.resolve(currentOperation.projectRoot) === resolvedRoot) {
        currentOperation.update(SEMANTIC_INDEX_OPERATION_KIND, "Semantic index build started.");
        try {
            return await execute(createProgressReporter(currentOperation));
        } finally {
            currentOperation.clearSemanticIndexProgress();
        }
    }

    return runProjectOperation(
        {
            command: SEMANTIC_INDEX_OPERATION_KIND,
            kind: SEMANTIC_INDEX_OPERATION_KIND,
            projectRoot: resolvedRoot
        },
        (operation) => {
            operation.update(SEMANTIC_INDEX_OPERATION_KIND, "Semantic index build started.");
            return execute(createProgressReporter(operation));
        }
    );
}
