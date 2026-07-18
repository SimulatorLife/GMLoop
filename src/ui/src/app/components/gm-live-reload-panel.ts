import { html } from "lit";

import type {
    GraphVisualizationLiveReloadRecentError,
    GraphVisualizationLiveReloadRecentPatch,
    GraphVisualizationLiveReloadRuntimeHealth,
    GraphVisualizationLiveReloadStatusSnapshot,
    GraphVisualizationLiveReloadWatcherStatus
} from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { EventBusManager } from "./event-bus-mixin.js";
import {
    GRAPH_UI_EVENT_CLEAR_PAGE_ERROR,
    GRAPH_UI_EVENT_LIVE_RELOAD_STATUS_CHANGED,
    type GraphUiLiveReloadStatusChangedDetail
} from "./events.js";
import { LifecycleParticipantsController } from "./lifecycle-participants-controller.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";
import { LiveReloadPollingController } from "./live-reload-polling-controller.js";

function formatDurationMs(value: number | null): string {
    if (value === null) {
        return "-";
    }

    if (value < 1) {
        return `${value.toFixed(2)} ms`;
    }

    return `${value.toFixed(1)} ms`;
}

function formatInteger(value: number | null): string {
    return value === null ? "-" : new Intl.NumberFormat().format(value);
}

function formatUptimeMs(value: number | null): string {
    if (value === null) {
        return "Waiting for status";
    }

    const totalSeconds = Math.max(0, Math.floor(value / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
}

function formatWatcherStatus(value: GraphVisualizationLiveReloadWatcherStatus | null): string {
    if (value === null) {
        return "Waiting";
    }

    if (value === "inactive") {
        return "Inactive";
    }

    if (value === "offline") {
        return "Offline";
    }

    if (value === "scanning") {
        return "Scanning";
    }

    if (value === "running") {
        return "Running";
    }

    return "Error";
}

function formatScanState(value: boolean | null): string {
    if (value === null) {
        return "Waiting for first scan";
    }

    return value ? "Scan complete" : "Scan in progress";
}

function formatTimestamp(timestamp: number): string {
    if (timestamp <= 0) {
        return "Unknown time";
    }

    return new Date(timestamp).toLocaleTimeString();
}

function resolveEndpointLabel(value: string | null | undefined): string {
    return value ?? "Not configured";
}

/**
 * Live-reload observability surface for watcher, patch stream, and runtime-wrapper status.
 *
 * The panel no longer overrides `connectedCallback`, `disconnectedCallback`,
 * or `updated()`. Lifecycle wiring is delegated to two injected
 * collaborators:
 *
 * - {@link EventBusManager} owns the `gm-error-banner-dismiss` subscription
 *   so the panel does not have to manage its own `addEventListener` /
 *   `removeEventListener` calls.
 * - {@link LiveReloadPollingController} owns the polling lifecycle and, via
 *   its new `getStatusConfig` callback, reacts to model changes through
 *   Lit's `hostUpdate()` hook instead of the host having to forward
 *   `updated()` invocations.
 *
 * Both collaborators are wired up through a single
 * {@link LifecycleParticipantsController} so connect/disconnect ordering
 * stays explicit and the host stays a thin presentational shell.
 */
export class GmLiveReloadPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #pollErrorMessage: string | null = null;

    #polledStatus: GraphVisualizationLiveReloadStatusSnapshot | null = null;

    #onDismissErrorBanner = (): void => {
        this.#pollErrorMessage = null;
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, {
                bubbles: true,
                composed: true,
                detail: { page: "live-reload" }
            })
        );
    };

    public constructor() {
        super();
        const eventBus = new EventBusManager(this, [
            { event: "gm-error-banner-dismiss", handler: this.#onDismissErrorBanner }
        ]);
        new LiveReloadPollingController(
            this,
            {
                onErrorMessageChange: (message: string | null): void => {
                    this.#pollErrorMessage = message;
                },
                onStatusChange: (status: GraphVisualizationLiveReloadStatusSnapshot | null): void => {
                    this.#polledStatus = status;
                    this.dispatchEvent(
                        new CustomEvent<GraphUiLiveReloadStatusChangedDetail>(
                            GRAPH_UI_EVENT_LIVE_RELOAD_STATUS_CHANGED,
                            {
                                bubbles: true,
                                composed: true,
                                detail: { status }
                            }
                        )
                    );
                },
                requestUpdate: (): void => {
                    this.requestUpdate();
                }
            },
            {
                getStatusConfig: () => ({
                    pollIntervalMs: this.model?.liveReload?.pollIntervalMs,
                    statusUrl: this.model?.liveReload?.endpoints.statusUrl ?? null
                })
            }
        );
        new LifecycleParticipantsController(this, [eventBus]);
    }

    #resolveStatusSnapshot(): GraphVisualizationLiveReloadStatusSnapshot | null {
        if (this.model?.liveReload === null) {
            return null;
        }

        return this.#polledStatus ?? this.model?.liveReload?.statusSnapshot ?? null;
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

    #renderSessionStatus(status: GraphVisualizationLiveReloadStatusSnapshot | null) {
        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Session Status"}>
                <dl class="live-reload-session-list" aria-label="Live reload session status">
                    <div>
                        <dt>Watcher</dt>
                        <dd>${formatWatcherStatus(status?.watcherStatus ?? null)}</dd>
                    </div>
                    <div>
                        <dt>Scan</dt>
                        <dd>${formatScanState(status?.scanComplete ?? null)}</dd>
                    </div>
                    <div>
                        <dt>Uptime</dt>
                        <dd>${formatUptimeMs(status?.uptimeMs ?? null)}</dd>
                    </div>
                    <div>
                        <dt>Errors</dt>
                        <dd>${formatInteger(status?.errorCount ?? null)}</dd>
                    </div>
                </dl>
            </gm-card>
        `;
    }

    #renderConnectionDetails() {
        const endpoints = this.model?.liveReload?.endpoints;

        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Connection Details"}>
                <dl class="live-reload-detail-list">
                    ${this.#renderEndpointDetail("Status", endpoints?.statusUrl)}
                    ${this.#renderEndpointDetail("WebSocket", endpoints?.websocketUrl)}
                    ${this.#renderEndpointDetail("Runtime", endpoints?.runtimeUrl)}
                </dl>
            </gm-card>
        `;
    }

    #renderEndpointDetail(label: string, value: string | null | undefined) {
        const endpointLabel = resolveEndpointLabel(value);

        return html`
            <div>
                <dt>${label}</dt>
                <dd>
                    <span class="live-reload-endpoint-value"><code>${endpointLabel}</code></span>
                    ${
                        value
                            ? html`
                                  <gm-copy-button
                                      class="live-reload-endpoint-copy"
                                      .value=${value}
                                      accessibleLabel=${`Copy ${label.toLowerCase()} endpoint to clipboard`}
                                      label="Copy"
                                      hideLabel
                                  ></gm-copy-button>
                              `
                            : null
                    }
                </dd>
            </div>
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
                ${
                    patches.length === 0
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
                          `
                }
            </gm-card>
        `;
    }

    #renderRecentErrors(errors: ReadonlyArray<GraphVisualizationLiveReloadRecentError>) {
        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Recent Errors"}>
                ${
                    errors.length === 0
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
                          `
                }
            </gm-card>
        `;
    }

    #renderRuntimeHealth(runtimeHealth: GraphVisualizationLiveReloadRuntimeHealth | null) {
        return html`
            <gm-card class="live-reload-panel-card" .heading=${"Runtime Health"}>
                ${
                    runtimeHealth === null
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
                                          ${String(runtimeHealth.appliedPatches)} /
                                          ${String(runtimeHealth.failedPatches)}
                                      </dd>
                                  </div>
                              </dl>
                          `
                }
            </gm-card>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const activeClassName =
            this.state.activePage === "live-reload" ? "page content-page active" : "page content-page";
        const liveReload = this.model.liveReload;
        const status = this.#resolveStatusSnapshot();
        const errorMessage = this.state.liveReloadErrorMessage ?? this.#pollErrorMessage;

        return html`
            <section id="live-reload-page" class=${activeClassName}>
                ${errorMessage ? html`<gm-error-banner .message=${errorMessage}></gm-error-banner>` : null}
                <div class="live-reload-stack" aria-live="polite">
                    ${
                        liveReload === null
                            ? this.#renderSetupState()
                            : html`
                                  ${this.#renderOverview(status)}
                                  <div class="live-reload-status-grid">
                                      ${this.#renderSessionStatus(status)} ${this.#renderPipeline()}
                                  </div>
                                  <div class="live-reload-activity-grid">
                                      ${this.#renderRecentPatches(status?.recentPatches ?? [])}
                                      ${this.#renderRecentErrors(status?.recentErrors ?? [])}
                                  </div>
                                  <div class="live-reload-grid">
                                      ${this.#renderRuntimeHealth(liveReload.runtimeHealth)}
                                      ${this.#renderConnectionDetails()}
                                  </div>
                              `
                    }
                </div>
            </section>
        `;
    }
}
