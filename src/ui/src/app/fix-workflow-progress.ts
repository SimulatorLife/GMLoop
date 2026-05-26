const FIX_WORKFLOW_START_LOG_LINE = "Starting project fix workflow...";
const FIX_WORKFLOW_PROGRESS_LOG_LABEL = "Fix workflow is still running";

/**
 * Create the initial log lines shown when a fix run starts.
 */
export function createInitialFixWorkflowLogLines(): ReadonlyArray<string> {
    return [FIX_WORKFLOW_START_LOG_LINE, `${FIX_WORKFLOW_PROGRESS_LOG_LABEL}...`];
}

/**
 * Create progress log lines for an in-flight fix workflow using elapsed wall-clock time.
 */
export function createRunningFixWorkflowLogLines(elapsedMilliseconds: number): ReadonlyArray<string> {
    const elapsedSeconds = Math.max(1, Math.floor(elapsedMilliseconds / 1000));
    return [
        FIX_WORKFLOW_START_LOG_LINE,
        `${FIX_WORKFLOW_PROGRESS_LOG_LABEL} (${elapsedSeconds} ${elapsedSeconds === 1 ? "second" : "seconds"} elapsed)...`
    ];
}
