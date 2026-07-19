import type {
    GraphVisualizationGraphIndexBuildSummary,
    GraphVisualizationGraphIndexProgress
} from "../../graph/types.js";
import type { LifecycleParticipant } from "./lifecycle-participants-controller.js";

const DEFAULT_GRAPH_INDEX_PROGRESS_POLL_INTERVAL_MS = 1000;
const GRAPH_INDEX_PROGRESS_ENDPOINT_PATHNAME = "/api/graph-index/progress";

interface GraphIndexProgressParticipantCallbacks {
    canPoll(): boolean;
    onPollError(error: unknown): void;
    onProgress(progress: GraphVisualizationGraphIndexProgress): void;
}

interface GraphIndexProgressParticipantOptions {
    callbacks: GraphIndexProgressParticipantCallbacks;
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

function isGraphIndexBuildSummary(value: unknown): value is GraphVisualizationGraphIndexBuildSummary {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        typeof record.cacheHitCount === "number" &&
        typeof record.cacheMissCount === "number" &&
        typeof record.totalDurationMs === "number" &&
        Array.isArray(record.slowestFiles) &&
        record.slowestFiles.every((entry) => {
            if (entry === null || typeof entry !== "object") {
                return false;
            }
            const fileEntry = entry as Record<string, unknown>;
            return typeof fileEntry.relativePath === "string" && typeof fileEntry.durationMs === "number";
        })
    );
}

function isGraphIndexProgress(value: unknown): value is GraphVisualizationGraphIndexProgress {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        (record.current === null || typeof record.current === "number") &&
        typeof record.isRunning === "boolean" &&
        Array.isArray(record.logLines) &&
        record.logLines.every((line) => typeof line === "string") &&
        (record.stage === null || record.stage === "gml-parse" || record.stage === "complete") &&
        (record.status === "idle" ||
            record.status === "running" ||
            record.status === "success" ||
            record.status === "error") &&
        (record.summary === null || isGraphIndexBuildSummary(record.summary)) &&
        (record.total === null || typeof record.total === "number")
    );
}

/** Polls the project-local semantic-index operation exposed by the graph server. */
export class GraphIndexProgressParticipant implements LifecycleParticipant {
    #callbacks: GraphIndexProgressParticipantCallbacks;
    #pollIntervalMs: number;
    #pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
    #observedRunning = false;

    public constructor(options: GraphIndexProgressParticipantOptions) {
        this.#callbacks = options.callbacks;
        this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_GRAPH_INDEX_PROGRESS_POLL_INTERVAL_MS;
    }

    public connect(): void {
        if (this.#pollTimer === null) {
            this.#pollTimer = globalThis.setInterval(() => {
                void this.#pollProgress();
            }, this.#pollIntervalMs);
        }
        void this.#pollProgress();
    }

    public disconnect(): void {
        if (this.#pollTimer !== null) {
            globalThis.clearInterval(this.#pollTimer);
            this.#pollTimer = null;
        }
        this.#observedRunning = false;
    }

    async #pollProgress(): Promise<void> {
        if (!this.#callbacks.canPoll()) {
            return;
        }
        const endpoint = resolveServerRelativeApiEndpoint(GRAPH_INDEX_PROGRESS_ENDPOINT_PATHNAME);
        if (endpoint === null) {
            return;
        }
        try {
            const response = await fetch(endpoint, {
                cache: "no-store",
                headers: { Accept: "application/json" }
            });
            if (!response.ok) {
                return;
            }
            const payload = (await response.json()) as { ok?: boolean; [key: string]: unknown };
            if (payload.ok !== true || !isGraphIndexProgress(payload)) {
                return;
            }
            this.#callbacks.onProgress({
                current: payload.current,
                isRunning: payload.isRunning,
                logLines: payload.logLines,
                stage: payload.stage,
                status: payload.status,
                summary: payload.summary,
                total: payload.total
            });
            if (payload.isRunning) {
                this.#observedRunning = true;
            } else if (this.#observedRunning) {
                this.#observedRunning = false;
                if (payload.status === "success" && typeof globalThis.location?.reload === "function") {
                    globalThis.location.reload();
                }
            }
        } catch (error) {
            this.#callbacks.onPollError(error);
        }
    }
}
