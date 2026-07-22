import type { ReactiveController, ReactiveControllerHost } from "lit";

import type {
    GraphVisualizationLiveReloadRecentError,
    GraphVisualizationLiveReloadRecentPatch,
    GraphVisualizationLiveReloadStatusSnapshot
} from "../../graph/index.js";
import { getUiNetworkErrorMessage } from "../error-message.js";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const MIN_POLL_INTERVAL_MS = 500;

type UnknownRecord = Readonly<Record<string, unknown>>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(record: UnknownRecord, key: string): number | null {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: UnknownRecord, key: string): string | null {
    const value = record[key];
    return typeof value === "string" ? value : null;
}

function readBoolean(record: UnknownRecord, key: string): boolean | null {
    const value = record[key];
    return typeof value === "boolean" ? value : null;
}

function readRecentPatches(value: unknown): ReadonlyArray<GraphVisualizationLiveReloadRecentPatch> {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((entry): entry is UnknownRecord => isUnknownRecord(entry))
        .map((entry) => ({
            durationMs: readNumber(entry, "durationMs") ?? 0,
            filePath: readString(entry, "filePath") ?? "unknown",
            hotReloadLatencyMs: readNumber(entry, "hotReloadLatencyMs"),
            id: readString(entry, "id") ?? "unknown",
            timestamp: readNumber(entry, "timestamp") ?? 0
        }));
}

function readRecentErrors(value: unknown): ReadonlyArray<GraphVisualizationLiveReloadRecentError> {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((entry): entry is UnknownRecord => isUnknownRecord(entry))
        .map((entry) => ({
            error: readString(entry, "error") ?? "Unknown error",
            filePath: readString(entry, "filePath") ?? "unknown",
            recoveryHint: readString(entry, "recoveryHint"),
            timestamp: readNumber(entry, "timestamp") ?? 0
        }));
}

function resolveWatcherStatus(
    snapshot: Pick<GraphVisualizationLiveReloadStatusSnapshot, "errorCount" | "scanComplete">,
    hasStatusUrl: boolean
): "inactive" | "scanning" | "running" | "error" {
    if (!hasStatusUrl) {
        return "inactive";
    }

    if (snapshot.errorCount > 0 && snapshot.scanComplete === false) {
        return "error";
    }

    return snapshot.scanComplete ? "running" : "scanning";
}

function normalizeStatusSnapshot(
    value: unknown,
    hasStatusUrl: boolean
): GraphVisualizationLiveReloadStatusSnapshot | null {
    if (!isUnknownRecord(value)) {
        return null;
    }

    const errorCount = readNumber(value, "errorCount") ?? 0;
    const scanComplete = readBoolean(value, "scanComplete") ?? false;
    const baseSnapshot = {
        errorCount,
        scanComplete
    };

    return {
        avgHotReloadLatencyMs: readNumber(value, "avgHotReloadLatencyMs"),
        errorCount,
        maxPatchHistory: readNumber(value, "maxPatchHistory"),
        patchCount: readNumber(value, "patchCount") ?? 0,
        patchHistorySize: readNumber(value, "patchHistorySize"),
        p95HotReloadLatencyMs: readNumber(value, "p95HotReloadLatencyMs"),
        recentErrors: readRecentErrors(value.recentErrors),
        recentPatches: readRecentPatches(value.recentPatches),
        runtimeUrl: readString(value, "runtimeUrl"),
        scanComplete,
        totalPatchCount: readNumber(value, "totalPatchCount"),
        uptimeMs: readNumber(value, "uptime") ?? 0,
        watcherStatus: resolveWatcherStatus(baseSnapshot, hasStatusUrl),
        websocketClients: readNumber(value, "websocketClients") ?? 0
    };
}

interface LiveReloadPollingControllerOptions {
    pollIntervalMs?: number;
    /**
     * Optional callback that returns the polling configuration from the host.
     * Read lazily on every Lit host update so the controller can restart
     * polling when the relevant properties change without the host having
     * to override `updated()` to forward the values.
     */
    getStatusConfig?: () => LiveReloadPollingStatusConfig | null;
}

interface LiveReloadPollingStatusConfig {
    statusUrl: string | null;
    pollIntervalMs?: number;
}

export interface LiveReloadPollingControllerState {
    polledStatus: GraphVisualizationLiveReloadStatusSnapshot | null;
    pollErrorMessage: string | null;
}

export interface LiveReloadPollingControllerCallbacks {
    onStatusChange(status: GraphVisualizationLiveReloadStatusSnapshot | null): void;
    onErrorMessageChange(message: string | null): void;
    requestUpdate(): void;
}

export class LiveReloadPollingController implements ReactiveController {
    #callbacks: LiveReloadPollingControllerCallbacks;
    #pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
    #lastStatusUrl: string | null = null;
    #state: LiveReloadPollingControllerState = {
        pollErrorMessage: null,
        polledStatus: null
    };
    #pollIntervalMs: number;
    #getStatusConfig: (() => LiveReloadPollingStatusConfig | null) | null;

    public constructor(
        host: ReactiveControllerHost,
        callbacks: LiveReloadPollingControllerCallbacks,
        options: LiveReloadPollingControllerOptions = {}
    ) {
        this.#callbacks = callbacks;
        this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.#getStatusConfig = options.getStatusConfig ?? null;
        host.addController(this);
    }

    public get state(): LiveReloadPollingControllerState {
        return this.#state;
    }

    public hostConnected(): void {
        document.addEventListener("visibilitychange", this.#onVisibilityChange);
    }

    public hostDisconnected(): void {
        this.stopPolling();
        document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    }

    /**
     * Called by Lit on every render. When the host supplied a
     * {@link LiveReloadPollingControllerOptions.getStatusConfig} callback,
     * this forwards any status-URL or interval change into the existing
     * short-circuited {@link restartPollingIfNeeded} helper. Hosts that
     * drive polling from outside the controller can simply omit the
     * callback and keep using the imperative method directly.
     */
    public hostUpdate(): void {
        const getStatusConfig = this.#getStatusConfig;
        if (getStatusConfig === null) {
            return;
        }

        const statusConfig = getStatusConfig();
        if (statusConfig === null) {
            return;
        }

        this.restartPollingIfNeeded(statusConfig.statusUrl, statusConfig.pollIntervalMs);
    }

    public stopPolling(): void {
        if (this.#pollTimer !== null) {
            globalThis.clearInterval(this.#pollTimer);
            this.#pollTimer = null;
        }
    }

    public restartPollingIfNeeded(statusUrl: string | null, configPollIntervalMs?: number): void {
        if (statusUrl === this.#lastStatusUrl && this.#pollTimer !== null) {
            return;
        }

        this.stopPolling();
        this.#lastStatusUrl = statusUrl;

        if (statusUrl === null) {
            return;
        }

        const effectivePollIntervalMs = Math.max(configPollIntervalMs ?? this.#pollIntervalMs, MIN_POLL_INTERVAL_MS);
        void this.#pollStatusUrl(statusUrl, false);
        this.#pollTimer = globalThis.setInterval(() => {
            void this.#pollStatusUrl(statusUrl, false);
        }, effectivePollIntervalMs);
    }

    /**
     * Fetch the live-reload status snapshot for {@link statusUrl}.
     *
     * @param silent - When `true`, transient poll failures (HTTP errors,
     *   malformed payloads, network errors) are dropped without updating
     *   `pollErrorMessage`. Scheduled polls report failures so the host can
     *   surface an error banner; visibility-triggered polls stay quiet so
     *   a momentary hiccup does not flash one.
     */
    async #pollStatusUrl(statusUrl: string, silent: boolean): Promise<void> {
        try {
            const response = await fetch(statusUrl, {
                headers: { Accept: "application/json" }
            });
            if (!response.ok) {
                throw new Error(`Status request failed with HTTP ${String(response.status)}`);
            }

            const payload: unknown = await response.json();
            const snapshot = normalizeStatusSnapshot(payload, true);
            if (snapshot === null) {
                throw new Error("Status response did not match the live-reload snapshot shape.");
            }

            this.#state = {
                pollErrorMessage: null,
                polledStatus: snapshot
            };
        } catch (error) {
            // Visibility-triggered polls stay quiet on transient errors so
            // a momentary hiccup does not flash an error banner; scheduled
            // polls still surface the failure.
            if (!silent) {
                const message = getUiNetworkErrorMessage(
                    error,
                    `the live-reload status server at ${statusUrl}`,
                    "Unknown polling error."
                );
                this.#state = {
                    pollErrorMessage: message,
                    polledStatus: this.#state.polledStatus
                };
            }
        }

        this.#callbacks.onStatusChange(this.#state.polledStatus);
        this.#callbacks.onErrorMessageChange(this.#state.pollErrorMessage);
        this.#callbacks.requestUpdate();
    }

    #onVisibilityChange = (): void => {
        const statusUrl = this.#lastStatusUrl;
        if (document.visibilityState === "visible" && statusUrl !== null) {
            void this.#pollStatusUrl(statusUrl, true);
        }
    };
}
