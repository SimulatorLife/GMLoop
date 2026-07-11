import type { GraphVisualizationProjectWorkflow } from "../../graph/types.js";
import type { LifecycleParticipant } from "./lifecycle-participants-controller.js";

const DEFAULT_FIX_RECONNECT_POLL_INTERVAL_MS = 1000;
const FIX_PROGRESS_ENDPOINT_PATHNAME = "/api/fix/progress";

interface FixWorkflowProgressResponse {
    isRunning: boolean;
    logLines: string[];
    status?: string;
    workflow?: GraphVisualizationProjectWorkflow;
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

    public constructor(options: FixWorkflowReconnectParticipantOptions) {
        this.#callbacks = options.callbacks;
        this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_FIX_RECONNECT_POLL_INTERVAL_MS;
    }

    public connect(): void {
        void this.#reconnectToActiveFixWorkflow();
    }

    public disconnect(): void {
        this.#stopPolling();
    }

    async #pollReconnectedFixWorkflowProgress(workflow: GraphVisualizationProjectWorkflow): Promise<void> {
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
            const pollProgress = (await pollResponse.json()) as FixWorkflowProgressResponse;

            this.#callbacks.onProgress(pollProgress.logLines);

            if (!pollProgress.isRunning) {
                this.#stopPolling();
                this.#callbacks.onFinished(workflow, pollProgress.status === "success" ? "success" : "error");
            }
        } catch (error) {
            this.#callbacks.onPollError(error);
        }
    }

    async #reconnectToActiveFixWorkflow(): Promise<void> {
        if (!this.#callbacks.canReconnect()) {
            return;
        }

        const progressEndpoint = resolveServerRelativeApiEndpoint(FIX_PROGRESS_ENDPOINT_PATHNAME);
        if (progressEndpoint === null) {
            return;
        }

        try {
            const response = await fetch(progressEndpoint, {
                cache: "no-store",
                headers: { Accept: "application/json" }
            });
            if (!response.ok) {
                return;
            }
            const progress = (await response.json()) as FixWorkflowProgressResponse;

            if (progress.isRunning && progress.workflow) {
                const workflow = progress.workflow;
                this.#callbacks.onReconnectStarted(workflow, progress.logLines);

                this.#reconnectTimer = globalThis.setInterval(() => {
                    void this.#pollReconnectedFixWorkflowProgress(workflow);
                }, this.#pollIntervalMs);
            }
        } catch (error) {
            this.#callbacks.onReconnectError(error);
        }
    }

    #stopPolling(): void {
        if (this.#reconnectTimer !== null) {
            globalThis.clearInterval(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
    }
}
