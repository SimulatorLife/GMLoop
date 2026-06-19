import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type {
    GraphVisualizationAutoGameAgentPackResource,
    GraphVisualizationAutoGamePipelineAction,
    GraphVisualizationAutoGamePipelineEvent,
    GraphVisualizationAutoGamePipelineLlmOutput,
    GraphVisualizationAutoGamePipelineSkill,
    GraphVisualizationAutoGamePipelineStatus
} from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import {
    GRAPH_UI_EVENT_CLEAR_PAGE_ERROR,
    GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK,
    GRAPH_UI_EVENT_SET_AUTO_GAME_SKILL_ENABLED,
    GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_PIPELINE,
    GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_TASK,
    type GraphUiInitializeAutoGameAgentPackDetail,
    type GraphUiTriggerAutoGamePipelineDetail,
    type GraphUiTriggerAutoGameTaskDetail
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";
import type { GmBadgeTone } from "./primitives/gm-badge.js";
import { renderProcessButtonContent } from "./primitives/gm-button.js";

/**
 * Pipeline statuses in which the Start action is enabled (anything that is
 * not already running). Keeping the set frozen at module scope avoids
 * allocating a new Set on every render and lets the lifecycle buttons share
 * a single helper without per-action duplication.
 */
const AUTO_GAME_LIFECYCLE_START_STATUSES: ReadonlySet<GraphVisualizationAutoGamePipelineStatus> =
    new Set<GraphVisualizationAutoGamePipelineStatus>(["idle", "blocked", "success", "error"]);

/**
 * Pipeline statuses in which the Pause action is enabled (only running).
 */
const AUTO_GAME_LIFECYCLE_PAUSE_STATUSES: ReadonlySet<GraphVisualizationAutoGamePipelineStatus> =
    new Set<GraphVisualizationAutoGamePipelineStatus>(["running"]);

/**
 * Pipeline statuses in which the Stop action is enabled (anything that is
 * not idle).
 */
const AUTO_GAME_LIFECYCLE_STOP_STATUSES: ReadonlySet<GraphVisualizationAutoGamePipelineStatus> =
    new Set<GraphVisualizationAutoGamePipelineStatus>(["running", "blocked", "success", "error"]);

function getPipelineStatusLabel(status: GraphVisualizationAutoGamePipelineStatus): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function getPipelineStatusBadgeTone(status: GraphVisualizationAutoGamePipelineStatus): GmBadgeTone {
    if (status === "success") {
        return "success";
    }
    if (status === "blocked") {
        return "warning";
    }
    if (status === "error") {
        return "error";
    }
    return status === "idle" ? "muted" : "neutral";
}

/**
 * Auto-game creation surface that displays pipeline, AI skill, LLM, and MCP activity.
 */
export class GmAutoGamePanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false },
        taskPrompt: { state: true },
        includeGitIgnore: { state: true }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    private accessor taskPrompt = "";

    private accessor includeGitIgnore = true;

    #onDismissErrorBanner = (): void => {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, {
                bubbles: true,
                composed: true,
                detail: { page: "auto-game" }
            })
        );
    };

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("gm-error-banner-dismiss", this.#onDismissErrorBanner);
    }

    public disconnectedCallback(): void {
        this.removeEventListener("gm-error-banner-dismiss", this.#onDismissErrorBanner);
        super.disconnectedCallback();
    }

    #dispatchPipelineAction(action: GraphUiTriggerAutoGamePipelineDetail["action"]): void {
        this.dispatchEvent(
            new CustomEvent<GraphUiTriggerAutoGamePipelineDetail>(GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_PIPELINE, {
                bubbles: true,
                composed: true,
                detail: { action }
            })
        );
    }

    #onTaskInput = (event: Event): void => {
        this.taskPrompt = (event.target as HTMLTextAreaElement).value;
    };

    #onTaskKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
            return;
        }

        event.preventDefault();
        this.#submitOneTimeTask();
    };

    #submitOneTimeTask(): void {
        const prompt = this.taskPrompt.trim();
        if (!this.#hasPipelineController() || this.state?.autoGamePendingOperation !== null || prompt.length === 0) {
            return;
        }

        this.dispatchEvent(
            new CustomEvent<GraphUiTriggerAutoGameTaskDetail>(GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_TASK, {
                bubbles: true,
                composed: true,
                detail: { prompt }
            })
        );
        this.taskPrompt = "";
    }

    #hasPipelineController(): boolean {
        return this.model?.isServerMode === true;
    }

    #getPipelineStatus(): GraphVisualizationAutoGamePipelineStatus {
        return this.model?.autoGamePipeline?.status ?? "idle";
    }

    /**
     * Decide whether a pipeline lifecycle button can fire its action in the
     * current state. Each lifecycle action is allowed only from a specific set
     * of pipeline statuses, but every action also requires a connected server
     * mode. Centralizing the predicate keeps the per-action call sites to a
     * single read.
     */
    #canRunLifecycleAction(allowedStatuses: ReadonlySet<GraphVisualizationAutoGamePipelineStatus>): boolean {
        return (
            this.#hasPipelineController() &&
            this.state?.autoGamePendingOperation === null &&
            allowedStatuses.has(this.#getPipelineStatus())
        );
    }

    #renderPipelineAction(action: GraphVisualizationAutoGamePipelineAction) {
        return html`
            <button
                class="gm-btn auto-game-action"
                type="button"
                ?disabled=${action.disabled}
                title=${action.description}
            >
                <span class="auto-game-action__label">${action.label}</span>
                <span class="auto-game-action__description">${action.description}</span>
            </button>
        `;
    }

    #renderPipelineControls() {
        const actions = this.model?.autoGamePipeline?.actions ?? [];
        const pendingOperation = this.state?.autoGamePendingOperation ?? null;
        const canRunTask = this.#hasPipelineController() && pendingOperation === null;
        const trimmedTaskPrompt = this.taskPrompt.trim();

        return html`
            <article class="gm-card auto-game-card auto-game-controls-card">
                <div class="auto-game-card__heading">
                    <div>
                        <h3 class="gm-card__heading">Pipeline Controls</h3>
                        <p>Manage the autonomous workflow or run a focused one-time task.</p>
                    </div>
                    <gm-badge
                        .label=${getPipelineStatusLabel(this.#getPipelineStatus())}
                        .tone=${getPipelineStatusBadgeTone(this.#getPipelineStatus())}
                    ></gm-badge>
                </div>
                <div class="auto-game-control-stack">
                    <div class="auto-game-lifecycle-controls" aria-label="Auto-game pipeline lifecycle controls">
                        <button
                            id="start-auto-game-pipeline"
                            class="gm-btn gm-btn--primary"
                            type="button"
                            ?disabled=${!this.#canRunLifecycleAction(AUTO_GAME_LIFECYCLE_START_STATUSES)}
                            aria-busy=${pendingOperation === "pipeline-start" ? "true" : "false"}
                            @click=${() => this.#dispatchPipelineAction("start")}
                        >
                            ${renderProcessButtonContent({
                                label: "Start",
                                pending: pendingOperation === "pipeline-start"
                            })}
                        </button>
                        <button
                            id="pause-auto-game-pipeline"
                            class="gm-btn"
                            type="button"
                            ?disabled=${!this.#canRunLifecycleAction(AUTO_GAME_LIFECYCLE_PAUSE_STATUSES)}
                            aria-busy=${pendingOperation === "pipeline-pause" ? "true" : "false"}
                            @click=${() => this.#dispatchPipelineAction("pause")}
                        >
                            ${renderProcessButtonContent({
                                label: "Pause",
                                pending: pendingOperation === "pipeline-pause"
                            })}
                        </button>
                        <button
                            id="stop-auto-game-pipeline"
                            class="gm-btn gm-btn--destructive"
                            type="button"
                            ?disabled=${!this.#canRunLifecycleAction(AUTO_GAME_LIFECYCLE_STOP_STATUSES)}
                            aria-busy=${pendingOperation === "pipeline-stop" ? "true" : "false"}
                            @click=${() => this.#dispatchPipelineAction("stop")}
                        >
                            ${renderProcessButtonContent({
                                label: "Stop",
                                pending: pendingOperation === "pipeline-stop"
                            })}
                        </button>
                    </div>
                    ${this.#hasPipelineController()
                        ? nothing
                        : html`
                              <p class="gm-empty auto-game-empty--compact" role="status">
                                  No auto-game pipeline controller is connected for this host yet.
                              </p>
                          `}
                    <form
                        class="auto-game-task-form"
                        @submit=${(event: SubmitEvent) => {
                            event.preventDefault();
                            this.#submitOneTimeTask();
                        }}
                    >
                        <div class="auto-game-field-heading">
                            <label for="auto-game-task-prompt">One-Time Task</label>
                            <span>Press Ctrl+Enter or Cmd+Enter to run</span>
                        </div>
                        <textarea
                            id="auto-game-task-prompt"
                            name="auto-game-task-prompt"
                            rows="3"
                            placeholder="Add a player movement task..."
                            .value=${this.taskPrompt}
                            ?disabled=${!canRunTask}
                            @input=${this.#onTaskInput}
                            @keydown=${this.#onTaskKeyDown}
                        ></textarea>
                        <button
                            id="run-auto-game-task"
                            class="gm-btn gm-btn--primary auto-game-task-submit"
                            type="submit"
                            ?disabled=${!canRunTask || trimmedTaskPrompt.length === 0}
                            aria-busy=${pendingOperation === "run-task" ? "true" : "false"}
                        >
                            ${renderProcessButtonContent({
                                label: "Run Task",
                                pending: pendingOperation === "run-task"
                            })}
                        </button>
                    </form>
                    ${actions.length === 0
                        ? nothing
                        : html`<div class="auto-game-action-list" aria-label="Host-provided pipeline actions">
                              ${actions.map((action) => this.#renderPipelineAction(action))}
                          </div>`}
                </div>
            </article>
        `;
    }

    #renderPipelineEvent(event: GraphVisualizationAutoGamePipelineEvent) {
        return html`
            <li class=${`auto-game-feed-item auto-game-feed-item--${event.status}`}>
                <div class="auto-game-item-heading">
                    <strong>${event.title}</strong>
                    <gm-badge
                        .label=${getPipelineStatusLabel(event.status)}
                        .tone=${getPipelineStatusBadgeTone(event.status)}
                    ></gm-badge>
                </div>
                ${event.detail === null ? nothing : html`<p>${event.detail}</p>`}
                <time class="auto-game-item-meta" datetime=${event.timestamp}>${event.timestamp}</time>
            </li>
        `;
    }

    #renderPipelineFeed() {
        const events = this.model?.autoGamePipeline?.events ?? [];

        return html`
            <article class="gm-card auto-game-card">
                <div class="auto-game-card__heading">
                    <div>
                        <h3 class="gm-card__heading">Pipeline Feed</h3>
                        <p>Recent workflow milestones and task activity.</p>
                    </div>
                </div>
                ${events.length === 0
                    ? html`
                          <p class="gm-empty">
                              Pipeline history from .gmloop/agent-log.jsonl and task events will appear here once a host
                              reports it.
                          </p>
                      `
                    : html`<ol class="auto-game-feed-list">
                          ${events.map((event) => this.#renderPipelineEvent(event))}
                      </ol>`}
            </article>
        `;
    }

    #renderSkill(skill: GraphVisualizationAutoGamePipelineSkill) {
        return html`
            <li class=${`auto-game-skill-item auto-game-skill-item--${skill.status}`}>
                <div class="auto-game-skill-item__header">
                    <div class="auto-game-skill-item__identity">
                        <strong>${skill.name}</strong>
                        <gm-badge
                            .label=${skill.status === "available" ? "Detected" : "Unreadable"}
                            .tone=${skill.status === "available" ? "success" : "error"}
                        ></gm-badge>
                    </div>
                    <label class="auto-game-skill-toggle">
                        <span>${skill.enabled ? "Included" : "Excluded"}</span>
                        <input
                            type="checkbox"
                            role="switch"
                            .checked=${skill.enabled}
                            ?disabled=${!this.#hasPipelineController() || this.state?.autoGamePendingOperation !== null}
                            aria-label=${`${skill.enabled ? "Exclude" : "Include"} ${skill.name} ${
                                skill.enabled ? "from" : "in"
                            } Auto-Game`}
                            @change=${(event: Event) => {
                                this.dispatchEvent(
                                    new CustomEvent(GRAPH_UI_EVENT_SET_AUTO_GAME_SKILL_ENABLED, {
                                        bubbles: true,
                                        composed: true,
                                        detail: {
                                            enabled: (event.target as HTMLInputElement).checked,
                                            name: skill.name
                                        }
                                    })
                                );
                            }}
                        />
                        <span class="auto-game-skill-toggle__track" aria-hidden="true">
                            <span class="auto-game-skill-toggle__thumb"></span>
                        </span>
                    </label>
                </div>
                <p>${skill.description}</p>
                ${skill.diagnostic === null
                    ? nothing
                    : html`<p class="auto-game-skill-item__diagnostic" role="status">${skill.diagnostic}</p>`}
                <code class="auto-game-item-meta">${skill.sourcePath}</code>
            </li>
        `;
    }

    #renderAgentPackResource(resource: GraphVisualizationAutoGameAgentPackResource) {
        return html`
            <details class="auto-game-resource-preview">
                <summary>
                    <span>
                        <strong>${resource.targetPath}</strong>
                        <code>${resource.packagePath}</code>
                    </span>
                    <gm-badge .label=${resource.kind === "template" ? "Template" : "Skill"}></gm-badge>
                </summary>
                <pre
                    aria-label=${`${resource.targetPath} packaged source preview`}
                ><code>${resource.content}</code></pre>
            </details>
        `;
    }

    #renderAiSkills() {
        const skills = this.model?.autoGamePipeline?.skills ?? [];
        const agentPack = this.model?.autoGamePipeline?.agentPack;
        const resources = agentPack?.resources ?? [];
        const shouldOfferAgentPackAction = agentPack !== undefined && agentPack.status !== "current";
        const hasUntrackedProjectSkills = agentPack?.status === "not-installed" && skills.length > 0;
        const agentPackActionLabel =
            agentPack?.status === "update-available"
                ? "Update Auto-Game Agent Pack"
                : hasUntrackedProjectSkills
                  ? "Complete Auto-Game Setup"
                  : "Initialize Auto-Game Agent Pack";
        const agentPackNoticeLabel =
            agentPack?.status === "update-available"
                ? "Update Available"
                : hasUntrackedProjectSkills
                  ? "Setup Incomplete"
                  : "Not Initialized";
        const isAgentPackPending = this.state?.autoGamePendingOperation === "initialize-agent-pack";
        const isSkillMutationPending = this.state?.autoGamePendingOperation !== null;

        return html`
            <article class="gm-card auto-game-card auto-game-skills-card">
                <div class="auto-game-card__heading">
                    <div>
                        <h3 class="gm-card__heading">AI Skills</h3>
                        <p>Choose which skills discovered in this project are included in Auto-Game.</p>
                    </div>
                    ${skills.length > 0
                        ? html`<gm-badge .label=${`${skills.length} Project Skills`}></gm-badge>`
                        : nothing}
                </div>
                ${shouldOfferAgentPackAction
                    ? html`
                          <div class="gm-empty auto-game-skill-empty">
                              <gm-badge .label=${agentPackNoticeLabel} .tone=${"warning"}></gm-badge>
                              <p>
                                  ${agentPack.status === "update-available"
                                      ? `Auto-Game Agent Pack ${agentPack.availableVersion} is available; this project has ${agentPack.installedVersion ?? "an unknown version"}.`
                                      : hasUntrackedProjectSkills
                                        ? `${String(skills.length)} project skill${skills.length === 1 ? " was" : "s were"} detected, but this project has no agent-pack installation record. Complete setup to synchronize GMLoop's packaged resources and record their version without overwriting project changes.`
                                        : "Initialize GMLoop's Auto-Game Agent Pack to add project skills and guidance."}
                              </p>
                              <label class="auto-game-initialize-option">
                                  <input
                                      type="checkbox"
                                      .checked=${this.includeGitIgnore}
                                      ?disabled=${isSkillMutationPending}
                                      @change=${(event: Event) => {
                                          this.includeGitIgnore = (event.target as HTMLInputElement).checked;
                                      }}
                                  />
                                  <span>
                                      <strong>Update Project .gitignore</strong>
                                      <small>
                                          Ignore GMLoop caches, local dependencies, and browser automation artifacts.
                                      </small>
                                  </span>
                              </label>
                              <button
                                  id="initialize-auto-game-agent-pack"
                                  class="gm-btn gm-btn--primary"
                                  type="button"
                                  ?disabled=${!this.#hasPipelineController() ||
                                  this.model?.loadedTarget === null ||
                                  isSkillMutationPending}
                                  aria-busy=${isAgentPackPending ? "true" : "false"}
                                  @click=${() => {
                                      this.dispatchEvent(
                                          new CustomEvent<GraphUiInitializeAutoGameAgentPackDetail>(
                                              GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK,
                                              {
                                                  bubbles: true,
                                                  composed: true,
                                                  detail: { includeGitIgnore: this.includeGitIgnore }
                                              }
                                          )
                                      );
                                  }}
                              >
                                  ${renderProcessButtonContent({
                                      label: agentPackActionLabel,
                                      pending: isAgentPackPending
                                  })}
                              </button>
                          </div>
                      `
                    : nothing}
                ${agentPack !== undefined && agentPack.conflicts.length > 0
                    ? html`<p class="auto-game-skill-item__diagnostic auto-game-conflict-notice" role="status">
                          Preserved project-modified agent-pack files: ${agentPack.conflicts.join(", ")}
                      </p>`
                    : nothing}
                <details class="auto-game-skill-disclosure">
                    <summary>
                        <span>
                            <strong>Project Skills</strong>
                            <small>Review and choose the skills included in Auto-Game.</small>
                        </span>
                        <gm-badge .label=${String(skills.length)}></gm-badge>
                    </summary>
                    ${skills.length === 0
                        ? html`
                              <div class="gm-empty auto-game-skill-empty auto-game-skill-empty--skills">
                                  <p>
                                      ${this.model?.loadedTarget === null
                                          ? "Open a GameMaker project to discover its Auto-Game skills."
                                          : "This project has no Auto-Game skills in .agents/skills."}
                                  </p>
                              </div>
                          `
                        : html`<ul class="auto-game-skill-list">
                              ${repeat(
                                  skills,
                                  (skill) => skill.id,
                                  (skill) => this.#renderSkill(skill)
                              )}
                          </ul>`}
                </details>
                <section class="auto-game-resource-section" aria-labelledby="auto-game-resource-heading">
                    <div class="auto-game-resource-section__heading">
                        <div>
                            <h4 id="auto-game-resource-heading">Agent-Pack Resources</h4>
                            <p>Preview packaged sources before they are synchronized into the project.</p>
                        </div>
                        <gm-badge .label=${String(resources.length)}></gm-badge>
                    </div>
                    ${resources.length === 0
                        ? html`<p class="gm-empty auto-game-empty--compact">No packaged resources are available.</p>`
                        : html`<div class="auto-game-resource-list">
                              ${repeat(
                                  resources,
                                  (resource) => resource.packagePath,
                                  (resource) => this.#renderAgentPackResource(resource)
                              )}
                          </div>`}
                </section>
            </article>
        `;
    }

    #renderLlmOutput(output: GraphVisualizationAutoGamePipelineLlmOutput) {
        return html`
            <li class="auto-game-llm-item">
                <div class="auto-game-llm-item__header">
                    <strong>${output.title}</strong>
                    <gm-badge .label=${output.role}></gm-badge>
                </div>
                <pre>${output.content}</pre>
                <time class="auto-game-item-meta" datetime=${output.timestamp}>${output.timestamp}</time>
            </li>
        `;
    }

    #renderLlmOutputs() {
        const llmOutputs = this.model?.autoGamePipeline?.llmOutputs ?? [];

        return html`
            <article class="gm-card auto-game-card">
                <div class="auto-game-card__heading">
                    <div>
                        <h3 class="gm-card__heading">LLM Output</h3>
                        <p>Planning notes and model output reported by the host.</p>
                    </div>
                </div>
                ${llmOutputs.length === 0
                    ? html`
                          <p class="gm-empty">
                              Host-provided planning notes, thought summaries, or model output snippets will appear
                              here.
                          </p>
                      `
                    : html`<ol class="auto-game-llm-list">
                          ${llmOutputs.map((output) => this.#renderLlmOutput(output))}
                      </ol>`}
            </article>
        `;
    }

    #renderServerMetadata() {
        const docsCatalogs = this.model?.documentationCatalogs;
        if (!docsCatalogs?.mcpServer) {
            return null;
        }

        return html`
            <dl class="gm-detail-list">
                <div class="gm-detail-list__item">
                    <dt class="gm-detail-list__key">Name</dt>
                    <dd class="gm-detail-list__value">${docsCatalogs.mcpServer.name}</dd>
                </div>
                <div class="gm-detail-list__item">
                    <dt class="gm-detail-list__key">Version</dt>
                    <dd class="gm-detail-list__value">${docsCatalogs.mcpServer.version}</dd>
                </div>
            </dl>
        `;
    }

    #renderMcpBridge() {
        return html`
            <article class="gm-card auto-game-card auto-game-mcp-card">
                <div class="auto-game-card__heading auto-game-mcp-card__heading">
                    <div>
                        <h3 class="gm-card__heading">MCP Bridge</h3>
                        <p>Connection metadata for agent tool activity.</p>
                    </div>
                    ${this.#renderServerMetadata()}
                </div>
                <p class="gm-empty">
                    MCP lifecycle events and tool call activity will appear here as the host reports server events.
                </p>
            </article>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const autoGamePageClassName =
            this.state.activePage === "auto-game" ? "page content-page active" : "page content-page";

        return html`
            <section id="auto-game-page" class=${autoGamePageClassName}>
                ${this.state.autoGameErrorMessage
                    ? html`<gm-error-banner .message=${this.state.autoGameErrorMessage}></gm-error-banner>`
                    : nothing}
                <div id="auto-game-content" class="auto-game-dashboard">
                    <section class="auto-game-primary-grid" aria-label="Auto-Game operations">
                        ${this.#renderPipelineControls()} ${this.#renderAiSkills()}
                    </section>
                    <section class="auto-game-secondary-grid" aria-label="Auto-Game activity">
                        ${this.#renderPipelineFeed()} ${this.#renderLlmOutputs()}
                    </section>
                    <section class="auto-game-supporting" aria-label="Auto-Game integrations">
                        ${this.#renderMcpBridge()}
                    </section>
                </div>
            </section>
        `;
    }
}
