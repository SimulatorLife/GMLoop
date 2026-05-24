import { html } from "lit";

import type {
    GraphVisualizationLiveReloadRecentError,
    GraphVisualizationLiveReloadRecentPatch,
    GraphVisualizationLiveReloadRuntimeHealth,
    GraphVisualizationLiveReloadStatusSnapshot,
    GraphVisualizationLiveReloadWatcherStatus
} from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import { getUiErrorMessage } from "../error-message.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { GRAPH_UI_EVENT_TRIGGER_REFRESH_LIVE_RELOAD, GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD } from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

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

    return value.filter(isUnknownRecord).map((entry) => ({
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

    return value.filter(isUnknownRecord).map((entry) => ({
        error: readString(entry, "error") ?? "Unknown error",
        filePath: readString(entry, "filePath") ?? "unknown",
        recoveryHint: readString(entry, "recoveryHint"),
        timestamp: readNumber(entry, "timestamp") ?? 0
    }));
}

function resolveWatcherStatus(
    snapshot: Pick<GraphVisualizationLiveReloadStatusSnapshot, "errorCount" | "scanComplete">,
    hasStatusUrl: boolean
): GraphVisualizationLiveReloadWatcherStatus {
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
        scanComplete,
        totalPatchCount: readNumber(value, "totalPatchCount"),
        uptimeMs: readNumber(value, "uptime") ?? 0,
        watcherStatus: resolveWatcherStatus(baseSnapshot, hasStatusUrl),
        websocketClients: readNumber(value, "websocketClients") ?? 0
    };
}

function formatDurationMs(value: number | null): string {
    if (value === null) {
        return "n/a";
    }

    if (value < 1) {
        return `${value.toFixed(2)} ms`;
    }

    return `${value.toFixed(1)} ms`;
}

function formatInteger(value: number | null): string {
    return value === null ? "n/a" : new Intl.NumberFormat().format(value);
}

function formatTimestamp(timestamp: number): string {
    if (timestamp <= 0) {
        return "Unknown time";
    }

    return new Date(timestamp).toLocaleTimeString();
}

function formatUptime(uptimeMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(uptimeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
}

function resolveEndpointLabel(value: string | null | undefined): string {
    return value ?? "Not configured";
}

/**
 * Live-reload observability surface for watcher, patch stream, and runtime-wrapper status.
 */
export class GmLiveReloadPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;

    #polledStatus: GraphVisualizationLiveReloadStatusSnapshot | null = null;

    #pollErrorMessage: string | null = null;

    #lastStatusUrl: string | null = null;

    #onDismissErrorBanner = (): void => {
        this.#pollErrorMessage = null;
    };

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("gm-error-banner-dismiss", this.#onDismissErrorBanner);
        this.#restartPollingIfNeeded();
    }

    public disconnectedCallback(): void {
        this.#stopPolling();
        this.removeEventListener("gm-error-banner-dismiss", this.#onDismissErrorBanner);
        super.disconnectedCallback();
    }

    protected updated(): void {
        this.#restartPollingIfNeeded();
    }

    #stopPolling(): void {
        if (this.#pollTimer !== null) {
            globalThis.clearInterval(this.#pollTimer);
            this.#pollTimer = null;
        }
    }

    #restartPollingIfNeeded(): void {
        const statusUrl = this.model?.liveReload?.endpoints.statusUrl ?? null;
        if (statusUrl === this.#lastStatusUrl && this.#pollTimer !== null) {
            return;
        }

        this.#stopPolling();
        this.#lastStatusUrl = statusUrl;

        if (statusUrl === null) {
            return;
        }

        void this.#pollStatusUrl(statusUrl);
        const pollIntervalMs = Math.max(
            this.model?.liveReload?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
            MIN_POLL_INTERVAL_MS
        );
        this.#pollTimer = globalThis.setInterval(() => {
            void this.#pollStatusUrl(statusUrl);
        }, pollIntervalMs);
    }

    async #pollStatusUrl(statusUrl: string): Promise<void> {
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

            this.#polledStatus = snapshot;
            this.#pollErrorMessage = null;
        } catch (error) {
            this.#pollErrorMessage = getUiErrorMessage(error, "Failed to refresh live-reload status.");
        }

        this.requestUpdate();
    }

    #emitRefreshStatus(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_REFRESH_LIVE_RELOAD, {
                bubbles: true,
                composed: true
            })
        );
    }

    #emitStartLiveReload(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD, {
                bubbles: true,
                composed: true
            })
        );
    }

    #resolveStatusSnapshot(): GraphVisualizationLiveReloadStatusSnapshot | null {
        return this.state?.liveReloadStatus ?? this.#polledStatus ?? this.model?.liveReload?.statusSnapshot ?? null;
    }

    #renderStatusChip(status: GraphVisualizationLiveReloadWatcherStatus) {
        const label =
            status === "running"
                ? "Running"
                : status === "scanning"
                  ? "Scanning"
                  : status === "offline"
                    ? "Offline"
                    : status === "error"
                      ? "Error"
                      : "Inactive";

        return html`
            <span class="live-reload-status-chip ${status}">
                <span class="live-reload-status-dot" aria-hidden="true"></span>
                ${label}
            </span>
        `;
    }

    #renderStatusSummary(
        status: GraphVisualizationLiveReloadStatusSnapshot | null,
        hasLiveReloadConfiguration: boolean
    ): string {
        if (!hasLiveReloadConfiguration) {
            return "Start live reload to launch the watcher, patch stream, and runtime bridge.";
        }

        if (status === null) {
            return "Waiting for the watcher to report its current status.";
        }

        const scanState = status.scanComplete ? "scan complete" : "scan in progress";
        return `Uptime ${formatUptime(status.uptimeMs)} with ${scanState}.`;
    }

    #renderActionButtons() {
        return html`
            <div class="live-reload-actions">
                ${this.model?.isServerMode
                    ? html`
                          <button
                              id="start-live-reload"
                              type="button"
                              class="top-nav-button live-reload-action-button"
                              ?disabled=${this.state?.isLiveReloadStartPending}
                              aria-busy=${this.state?.isLiveReloadStartPending ? "true" : "false"}
                              @click=${() => this.#emitStartLiveReload()}
                          >
                              <span class="button-content">
                                  ${this.state?.isLiveReloadStartPending
                                      ? html`<span class="button-spinner" aria-hidden="true"></span>`
                                      : null}
                                  <span class="button-label">Start Live Reload</span>
                              </span>
                          </button>
                      `
                    : null}
                <button
                    id="refresh-live-reload"
                    type="button"
                    class="top-nav-button live-reload-action-button"
                    ?disabled=${this.state?.isLiveReloadRefreshPending}
                    aria-busy=${this.state?.isLiveReloadRefreshPending ? "true" : "false"}
                    @click=${() => this.#emitRefreshStatus()}
                >
                    <span class="button-content">
                        ${this.state?.isLiveReloadRefreshPending
                            ? html`<span class="button-spinner" aria-hidden="true"></span>`
                            : null}
                        <span class="button-label">Refresh Status</span>
                    </span>
                </button>
            </div>
        `;
    }

    #renderPipeline() {
        const steps = ["File Watcher", "Transpiler", "WebSocket Server", "Runtime Wrapper", "Game Runtime"];

        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Pipeline Overview"}>
                <ol class="live-reload-pipeline" aria-label="Live reload pipeline">
                    ${steps.map(
                        (step, index) => html`
                            <li>
                                <span class="live-reload-pipeline-node">
                                    <span class="live-reload-pipeline-index">${String(index + 1)}</span>
                                    <span>${step}</span>
                                </span>
                            </li>
                        `
                    )}
                </ol>
            </gm-card>
        `;
    }

    #renderMetricItem(label: string, value: string, description: string) {
        return html`
            <div class="live-reload-metric-item">
                <span>${label}</span>
                <strong>${value}</strong>
                <small>${description}</small>
            </div>
        `;
    }

    #renderOverview(status: GraphVisualizationLiveReloadStatusSnapshot | null) {
        return html`
            <gm-card class="live-reload-overview-card" .heading=${"Overview"}>
                <div class="live-reload-metric-strip">
                    ${this.#renderMetricItem(
                        "Clients",
                        formatInteger(status?.websocketClients ?? null),
                        status?.websocketClients === 1 ? "Connected runtime" : "Connected runtimes"
                    )}
                    ${this.#renderMetricItem(
                        "Patches",
                        formatInteger(status?.totalPatchCount ?? status?.patchCount ?? null),
                        "Prepared this session"
                    )}
                    ${this.#renderMetricItem(
                        "Average",
                        formatDurationMs(status?.avgHotReloadLatencyMs ?? null),
                        "File change to patch"
                    )}
                    ${this.#renderMetricItem(
                        "P95",
                        formatDurationMs(status?.p95HotReloadLatencyMs ?? null),
                        "Recent worst case"
                    )}
                    ${this.#renderMetricItem(
                        "History",
                        `${formatInteger(status?.patchHistorySize ?? null)} / ${formatInteger(status?.maxPatchHistory ?? null)}`,
                        "Retained updates"
                    )}
                </div>
            </gm-card>
        `;
    }

    #renderConnectionDetails() {
        const endpoints = this.model?.liveReload?.endpoints;

        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Connection Details"}>
                <dl class="live-reload-detail-list">
                    <div>
                        <dt>Status</dt>
                        <dd><code>${resolveEndpointLabel(endpoints?.statusUrl)}</code></dd>
                    </div>
                    <div>
                        <dt>WebSocket</dt>
                        <dd><code>${resolveEndpointLabel(endpoints?.websocketUrl)}</code></dd>
                    </div>
                    <div>
                        <dt>Runtime</dt>
                        <dd><code>${resolveEndpointLabel(endpoints?.runtimeUrl)}</code></dd>
                    </div>
                </dl>
            </gm-card>
        `;
    }

    #renderSetupState() {
        return html`
            <gm-card class="live-reload-setup-card" .heading=${"Live Reload Not Connected"}>
                <p>
                    Start live reload to watch project files, prepare patches, and connect the GameMaker runtime bridge.
                </p>
            </gm-card>
        `;
    }

    #renderRecentPatches(patches: ReadonlyArray<GraphVisualizationLiveReloadRecentPatch>) {
        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Recent Patches"}>
                ${patches.length === 0
                    ? html`<p class="catalog-empty">No patches yet.</p>`
                    : html`
                          <ul class="live-reload-event-list">
                              ${patches.map(
                                  (patch) => html`
                                      <li>
                                          <strong>${patch.id}</strong>
                                          <span>${patch.filePath}</span>
                                          <div class="config-badge-row">
                                              <gm-badge .label=${formatDurationMs(patch.durationMs)}></gm-badge>
                                              <gm-badge
                                                  .label=${`reload:${formatDurationMs(patch.hotReloadLatencyMs)}`}
                                              ></gm-badge>
                                              <gm-badge .label=${formatTimestamp(patch.timestamp)}></gm-badge>
                                          </div>
                                      </li>
                                  `
                              )}
                          </ul>
                      `}
            </gm-card>
        `;
    }

    #renderRecentErrors(errors: ReadonlyArray<GraphVisualizationLiveReloadRecentError>) {
        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Recent Errors"}>
                ${errors.length === 0
                    ? html`<p class="catalog-empty">No errors reported.</p>`
                    : html`
                          <ul class="live-reload-event-list">
                              ${errors.map(
                                  (error) => html`
                                      <li class="live-reload-error-item">
                                          <strong>${error.filePath}</strong>
                                          <span>${error.error}</span>
                                          ${error.recoveryHint ? html`<p>${error.recoveryHint}</p>` : null}
                                          <div class="config-badge-row">
                                              <gm-badge .label=${formatTimestamp(error.timestamp)}></gm-badge>
                                          </div>
                                      </li>
                                  `
                              )}
                          </ul>
                      `}
            </gm-card>
        `;
    }

    #renderRuntimeHealth(runtimeHealth: GraphVisualizationLiveReloadRuntimeHealth | null) {
        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Runtime Health"}>
                ${runtimeHealth === null
                    ? html`<p class="catalog-empty">Runtime details unavailable.</p>`
                    : html`
                          <dl class="live-reload-health-list">
                              <div>
                                  <dt>Status</dt>
                                  <dd>${runtimeHealth.runtimeStatus}</dd>
                              </div>
                              <div>
                                  <dt>Registry Version</dt>
                                  <dd>${String(runtimeHealth.registryVersion)}</dd>
                              </div>
                              <div>
                                  <dt>Scripts / Events / Closures</dt>
                                  <dd>
                                      ${String(runtimeHealth.scriptCount)} / ${String(runtimeHealth.eventCount)} /
                                      ${String(runtimeHealth.closureCount)}
                                  </dd>
                              </div>
                              <div>
                                  <dt>Patch Queue Depth</dt>
                                  <dd>${String(runtimeHealth.patchQueueDepth)}</dd>
                              </div>
                              <div>
                                  <dt>Applied / Failed</dt>
                                  <dd>
                                      ${String(runtimeHealth.appliedPatches)} / ${String(runtimeHealth.failedPatches)}
                                  </dd>
                              </div>
                          </dl>
                      `}
            </gm-card>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const activeClassName = this.state.activePage === "live-reload" ? "page docs-page active" : "page docs-page";
        const liveReload = this.model.liveReload;
        const status = this.#resolveStatusSnapshot();
        const errorMessage = this.state.liveReloadErrorMessage ?? this.#pollErrorMessage;
        const watcherStatus = status?.watcherStatus ?? (liveReload?.endpoints.statusUrl ? "offline" : "inactive");
        const statusSummary = this.#renderStatusSummary(status, liveReload !== null);

        return html`
            <section id="live-reload-page" class=${activeClassName}>
                <div class="live-reload-hero">
                    <div class="live-reload-title-block">
                        <div class="live-reload-title-row">
                            <h2>Live Reload</h2>
                            ${this.#renderStatusChip(watcherStatus)}
                        </div>
                        <p id="live-reload-meta" class="docs-meta">${statusSummary}</p>
                    </div>
                    ${this.#renderActionButtons()}
                </div>
                ${errorMessage ? html`<gm-error-banner .message=${errorMessage}></gm-error-banner>` : null}
                <div class="live-reload-stack" aria-live="polite">
                    ${liveReload === null
                        ? html`${this.#renderSetupState()} ${this.#renderConnectionDetails()}`
                        : html`
                              ${this.#renderOverview(status)} ${this.#renderPipeline()}
                              <div class="live-reload-activity-grid">
                                  ${this.#renderRecentPatches(status?.recentPatches ?? [])}
                                  ${this.#renderRecentErrors(status?.recentErrors ?? [])}
                              </div>
                              <div class="live-reload-grid">
                                  ${this.#renderRuntimeHealth(liveReload.runtimeHealth)}
                                  ${this.#renderConnectionDetails()}
                              </div>
                          `}
                </div>
            </section>
        `;
    }
}
