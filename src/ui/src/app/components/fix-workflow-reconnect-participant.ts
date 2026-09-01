import { type GraphVisualizationProjectWorkflow, PROJECT_WORKFLOWS } from "../../graph/index.js";
import type { LifecycleParticipant } from "./lifecycle-participants-controller.js";

const DEFAULT_FIX_RECONNECT_POLL_INTERVAL_MS = 1000;
const FIX_PROGRESS_ENDPOINT_PATHNAME = "/api/fix/progress";

interface FixWorkflowProgressResponse {
    isRunning: boolean;
    logLines: string[];
    status?: string;
    workflow?: GraphVisualizationProjectWorkflow;
}

// The server response is untrusted network input: it may be malformed, come
// from a stale/incompatible server build, or omit fields entirely. Callers
// (e.g. gm-fix-panel's `logLines.join(...)`) assume `logLines` is always a
// real array, so an unvalidated cast here would defer the crash downstream
// where it is much harder to trace back to a bad poll response.
function isFixWorkflowProgressResponse(value: unknown): value is FixWorkflowProgressResponse {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        typeof record.isRunning === "boolean" &&
        Array.isArray(record.logLines) &&
        record.logLines.every((line) => typeof line === "string") &&
        (record.status === undefined || typeof record.status === "string") &&
        (record.workflow === undefined || (PROJECT_WORKFLOWS as ReadonlyArray<unknown>).includes(record.workflow))
    );
}

/**
 * Host callbacks used by the fix-workflow reconnect participant to report lifecycle-driven progress.
 */
export interface FixWorkflowReconnectParticipantCallbacks {
    canReconnect(): boolean;
    onReconnectStarted(workflow: GraphVisualizationProjectWorkflow, logLines: readonly string[]): void;
    onProgress(logLines: readonly string[]): void;
    onFinished(workflow: GraphVisualizationProjectWorkflow, status: "success" | "error"): void;
    onReconnectError(error: unknown): void;
    onPollError(error: unknown): void;
}

/**
 * Options for configuring fix-workflow reconnect lifecycle behaviour.
 */
export interface FixWorkflowReconnectParticipantOptions {
    callbacks: FixWorkflowReconnectParticipantCallbacks;
    pollIntervalMs?: number;
}

function resolveServerRelativeApiEndpoint(pathname: string): string | null {
    if (globalThis.location === undefined) {
        return null;
    }

    try {
        return new URL(pathname, globalThis.location.href).toString();
    } catch {
        return null;
    }
}

/**
 * Lifecycle participant that reconnects to an already-running project fix workflow.
 */
export class FixWorkflowReconnectParticipant implements LifecycleParticipant {
    #callbacks: FixWorkflowReconnectParticipantCallbacks;
    #pollIntervalMs: number;
    #reconnectTimer: ReturnType<typeof globalThis.setInterval> | null = null;
    #observedWorkflow: GraphVisualizationProjectWorkflow | null = null;

    public constructor(options: FixWorkflowReconnectParticipantOptions) {
        this.#callbacks = options.callbacks;
        this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_FIX_RECONNECT_POLL_INTERVAL_MS;
    }

    public connect(): void {
        if (this.#reconnectTimer === null) {
            this.#reconnectTimer = globalThis.setInterval(() => {
                void this.#pollProjectOperationProgress();
            }, this.#pollIntervalMs);
        }
        void this.#pollProjectOperationProgress();
    }

    public disconnect(): void {
        this.#stopPolling();
    }

    async #pollProjectOperationProgress(): Promise<void> {
        if (this.#observedWorkflow === null && !this.#callbacks.canReconnect()) {
            return;
        }

        const progressEndpoint = resolveServerRelativeApiEndpoint(FIX_PROGRESS_ENDPOINT_PATHNAME);
        if (progressEndpoint === null) {
            return;
        }

        try {
            const pollResponse = await fetch(progressEndpoint, {
                cache: "no-store",
                headers: { Accept: "application/json" }
            });
            if (!pollResponse.ok) {
                return;
            }
            const pollPayload: unknown = await pollResponse.json();
            if (!isFixWorkflowProgressResponse(pollPayload)) {
                return;
            }
            const pollProgress = pollPayload;

            if (pollProgress.isRunning && pollProgress.workflow) {
                if (this.#observedWorkflow === null) {
                    this.#observedWorkflow = pollProgress.workflow;
                    this.#callbacks.onReconnectStarted(pollProgress.workflow, pollProgress.logLines);
                }
                this.#callbacks.onProgress(pollProgress.logLines);
                return;
            }

            this.#callbacks.onProgress(pollProgress.logLines);

            if (this.#observedWorkflow !== null) {
                const workflow = this.#observedWorkflow;
                this.#observedWorkflow = null;
                this.#stopPolling();
                this.#callbacks.onFinished(workflow, pollProgress.status === "success" ? "success" : "error");
            }
        } catch (error) {
            this.#callbacks.onPollError(error);
        }
    }

    #stopPolling(): void {
        if (this.#reconnectTimer !== null) {
            globalThis.clearInterval(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
        this.#observedWorkflow = null;
    }
}
