import { html } from "lit";

import type {
    GraphVisualizationAutoGamePipelineAction,
    GraphVisualizationAutoGamePipelineEvent,
    GraphVisualizationAutoGamePipelineLlmOutput,
    GraphVisualizationAutoGamePipelineSkill
} from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import {
    GRAPH_UI_EVENT_CLEAR_PAGE_ERROR,
    GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_PIPELINE,
    GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_TASK,
    type GraphUiTriggerAutoGamePipelineDetail,
    type GraphUiTriggerAutoGameTaskDetail
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Auto-game creation surface that displays pipeline, AI skill, LLM, and MCP activity.
 */
export class GmAutoGamePanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false },
        taskPrompt: { state: true }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    private accessor taskPrompt = "";

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
        if (!this.#canRunOneTimeTask() || prompt.length === 0) {
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

    #getPipelineStatus() {
        return this.model?.autoGamePipeline?.status ?? "idle";
    }

    #canStartPipeline(): boolean {
        return this.#hasPipelineController() && this.#getPipelineStatus() !== "running";
    }

    #canPausePipeline(): boolean {
        return this.#hasPipelineController() && this.#getPipelineStatus() === "running";
    }

    #canStopPipeline(): boolean {
        return this.#hasPipelineController() && this.#getPipelineStatus() !== "idle";
    }

    #canRunOneTimeTask(): boolean {
        return this.#hasPipelineController();
    }

    #renderPipelineAction(action: GraphVisualizationAutoGamePipelineAction) {
        return html`
            <button class="auto-game-action" type="button" ?disabled=${action.disabled} title=${action.description}>
                <span class="auto-game-action__label">${action.label}</span>
                <span class="auto-game-action__description">${action.description}</span>
            </button>
        `;
    }

    #renderPipelineControls() {
        const actions = this.model?.autoGamePipeline?.actions ?? [];
        const canRunTask = this.#canRunOneTimeTask();
        const trimmedTaskPrompt = this.taskPrompt.trim();

        return html`
            <gm-card class="catalog-card" .heading=${"Pipeline Controls"}>
                <div class="auto-game-control-stack">
                    <div class="auto-game-lifecycle-controls" aria-label="Auto-game pipeline lifecycle controls">
                        <button
                            id="start-auto-game-pipeline"
                            class="auto-game-control auto-game-control--primary"
                            type="button"
                            ?disabled=${!this.#canStartPipeline()}
                            @click=${() => this.#dispatchPipelineAction("start")}
                        >
                            Start
                        </button>
                        <button
                            id="pause-auto-game-pipeline"
                            class="auto-game-control"
                            type="button"
                            ?disabled=${!this.#canPausePipeline()}
                            @click=${() => this.#dispatchPipelineAction("pause")}
                        >
                            Pause
                        </button>
                        <button
                            id="stop-auto-game-pipeline"
                            class="auto-game-control auto-game-control--danger"
                            type="button"
                            ?disabled=${!this.#canStopPipeline()}
                            @click=${() => this.#dispatchPipelineAction("stop")}
                        >
                            Stop
                        </button>
                    </div>
                    ${this.#hasPipelineController()
                        ? null
                        : html`
                              <p class="auto-game-empty auto-game-empty--compact">
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
                        <label for="auto-game-task-prompt">One-time task</label>
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
                            class="auto-game-control auto-game-control--primary"
                            type="submit"
                            ?disabled=${!canRunTask || trimmedTaskPrompt.length === 0}
                        >
                            Run Task
                        </button>
                    </form>
                    ${actions.length === 0
                        ? null
                        : html`<div class="auto-game-action-list" aria-label="Host-provided pipeline actions">
                              ${actions.map((action) => this.#renderPipelineAction(action))}
                          </div>`}
                </div>
            </gm-card>
        `;
    }

    #renderPipelineEvent(event: GraphVisualizationAutoGamePipelineEvent) {
        return html`
            <li class=${`auto-game-feed-item auto-game-feed-item--${event.status}`}>
                <span class="auto-game-feed-item__time">${event.timestamp}</span>
                <strong>${event.title}</strong>
                ${event.detail === null ? null : html`<span>${event.detail}</span>`}
            </li>
        `;
    }

    #renderPipelineFeed() {
        const events = this.model?.autoGamePipeline?.events ?? [];

        return html`
            <gm-card class="catalog-card" .heading=${"Pipeline Feed"}>
                ${events.length === 0
                    ? html`
                          <p class="auto-game-empty">
                              Pipeline history from .gmloop/agent-log.jsonl and task events will appear here once a host
                              reports it.
                          </p>
                      `
                    : html`<ol class="auto-game-feed-list">
                          ${events.map((event) => this.#renderPipelineEvent(event))}
                      </ol>`}
            </gm-card>
        `;
    }

    #renderSkill(skill: GraphVisualizationAutoGamePipelineSkill) {
        return html`
            <li class=${`auto-game-skill-item auto-game-skill-item--${skill.status}`}>
                <strong>${skill.name}</strong>
                <span>${skill.description}</span>
                <span class="auto-game-skill-item__meta"
                    >${skill.status}${skill.sourcePath === null ? "" : ` - ${skill.sourcePath}`}</span
                >
            </li>
        `;
    }

    #renderAiSkills() {
        const skills = this.model?.autoGamePipeline?.skills ?? [];

        return html`
            <gm-card class="catalog-card" .heading=${"AI Skills"}>
                ${skills.length === 0
                    ? html`
                          <p class="auto-game-empty">
                              Game-design and GameMaker resource skill readiness will appear here once provided by the
                              host.
                          </p>
                      `
                    : html`<ul class="auto-game-skill-list">
                          ${skills.map((skill) => this.#renderSkill(skill))}
                      </ul>`}
            </gm-card>
        `;
    }

    #renderLlmOutput(output: GraphVisualizationAutoGamePipelineLlmOutput) {
        return html`
            <li class="auto-game-llm-item">
                <div class="auto-game-llm-item__header">
                    <strong>${output.title}</strong>
                    <span>${output.role} - ${output.timestamp}</span>
                </div>
                <pre>${output.content}</pre>
            </li>
        `;
    }

    #renderLlmOutputs() {
        const llmOutputs = this.model?.autoGamePipeline?.llmOutputs ?? [];

        return html`
            <gm-card class="catalog-card" .heading=${"LLM Output"}>
                ${llmOutputs.length === 0
                    ? html`
                          <p class="auto-game-empty">
                              Host-provided planning notes, thought summaries, or model output snippets will appear
                              here.
                          </p>
                      `
                    : html`<ol class="auto-game-llm-list">
                          ${llmOutputs.map((output) => this.#renderLlmOutput(output))}
                      </ol>`}
            </gm-card>
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
            <gm-card class="catalog-card" .heading=${"MCP Bridge"}>
                ${this.#renderServerMetadata()}
                <p class="auto-game-empty">
                    MCP lifecycle events and tool call activity will appear here as the host reports server events.
                </p>
            </gm-card>
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
                    : null}
                <p id="auto-game-meta" class="docs-meta">
                    Auto-game creation pipeline, AI skill readiness, MCP bridge status, and automation activity.
                </p>
                <div id="auto-game-content" class="docs-grid auto-game-grid">
                    ${this.#renderPipelineControls()} ${this.#renderPipelineFeed()} ${this.#renderAiSkills()}
                    ${this.#renderLlmOutputs()} ${this.#renderMcpBridge()}
                </div>
            </section>
        `;
    }
}
