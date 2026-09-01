import type { GraphVisualizationProjectWorkflow } from "../graph/index.js";

const WORKFLOW_LABELS: Readonly<
    Record<GraphVisualizationProjectWorkflow, Readonly<{ progress: string; start: string }>>
> = Object.freeze({
    fix: { progress: "Fix workflow", start: "project fix workflow" },
    format: { progress: "Project format workflow", start: "project format workflow" },
    lint: { progress: "Project lint workflow", start: "project lint workflow" },
    refactor: { progress: "Project refactor workflow", start: "project refactor workflow" }
});

/**
 * Create the initial log lines shown when a fix run starts.
 */
export function createInitialFixWorkflowLogLines(
    workflow: GraphVisualizationProjectWorkflow = "fix"
): ReadonlyArray<string> {
    const workflowLabel = WORKFLOW_LABELS[workflow];
    return [`Starting ${workflowLabel.start}...`, `${workflowLabel.progress} is still running...`];
}

/**
 * Create progress log lines for an in-flight fix workflow using elapsed wall-clock time.
 *
 * @param elapsedMilliseconds - Wall-clock milliseconds elapsed since the current fix workflow started.
 */
export function createRunningFixWorkflowLogLines(
    elapsedMilliseconds: number,
    workflow: GraphVisualizationProjectWorkflow = "fix"
): ReadonlyArray<string> {
    const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
    const workflowLabel = WORKFLOW_LABELS[workflow];
    return [
        `Starting ${workflowLabel.start}...`,
        `${workflowLabel.progress} is still running (${elapsedSeconds} ${
            elapsedSeconds === 1 ? "second" : "seconds"
        } elapsed)...`
    ];
}
