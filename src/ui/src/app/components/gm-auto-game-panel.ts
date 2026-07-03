import { html, nothing } from "lit";

import type {
    GraphVisualizationAutoGameAgentConfig,
    GraphVisualizationAutoGameAgentPackResource,
    GraphVisualizationAutoGamePipelineEvent,
    GraphVisualizationAutoGamePipelineLlmOutput,
    GraphVisualizationAutoGamePipelineStatus
} from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import {
    GRAPH_UI_EVENT_CLEAR_PAGE_ERROR,
    GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK,
    GRAPH_UI_EVENT_SET_AUTO_GAME_SKILL_ENABLED,
    type GraphUiInitializeAutoGameAgentPackDetail
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";
import type { GmBadgeTone } from "./primitives/gm-badge.js";
import { renderProcessButtonContent } from "./primitives/gm-button.js";

function getSkillDescriptionFromContent(content: string): string {
    const match = content.match(/description:\s*(.+)/u);
    return match ? match[1].trim().replaceAll(/^['"]|['"]$/g, "") : "";
}

function getSkillNameFromContent(content: string): string {
    const match = content.match(/name:\s*(.+)/u);
    return match ? match[1].trim().replaceAll(/^['"]|['"]$/g, "") : "";
}

/**
 * Pipeline statuses in which the Start action is enabled (anything that is
 * not already running). Keeping the set frozen at module scope avoids
 * allocating a new Set on every render and lets the lifecycle buttons share
 * a single helper without per-action duplication.
 */

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
        includeGitIgnore: { state: true },
        selectedAgentTargets: { state: true }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    private accessor includeGitIgnore = true;

    private accessor selectedAgentTargets: ReadonlyArray<GraphVisualizationAutoGameAgentConfig["id"]> = [];

    #hasUserSelectedAgentTargets = false;

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

    #hasPipelineController(): boolean {
        return this.model?.isServerMode === true;
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

    #renderUnifiedSkill(skill: {
        name: string;
        description: string;
        enabled: boolean;
        status: "available" | "unreadable" | "packaged";
        sourcePath: string;
        isProjectSkill: boolean;
        diagnostic?: string | null;
    }) {
        const isSkillMutationPending = this.state?.autoGamePendingOperation !== null;
        const isToggleDisabled = !this.#hasPipelineController() || isSkillMutationPending || !skill.isProjectSkill;

        return html`
            <li class=${`auto-game-skill-item auto-game-skill-item--${skill.status}`}>
                <div class="auto-game-skill-item__header">
                    <div class="auto-game-skill-item__identity">
                        <strong>${skill.name}</strong>
                        <gm-badge
                            .label=${skill.status === "available"
                                ? "Skill (Detected)"
                                : skill.status === "unreadable"
                                  ? "Skill (Unreadable)"
                                  : "Skill (Packaged)"}
                            .tone=${skill.status === "available"
                                ? "success"
                                : skill.status === "unreadable"
                                  ? "error"
                                  : "muted"}
                        ></gm-badge>
                    </div>
                    <label class="auto-game-skill-toggle">
                        <span>${skill.enabled ? "Included" : "Excluded"}</span>
                        <input
                            type="checkbox"
                            role="switch"
                            .checked=${skill.enabled}
                            ?disabled=${isToggleDisabled}
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
                ${skill.diagnostic
                    ? html`<p class="auto-game-skill-item__diagnostic" role="status">${skill.diagnostic}</p>`
                    : nothing}
                <code class="auto-game-item-meta">${skill.sourcePath}</code>
            </li>
        `;
    }

    #renderUnifiedTemplate(template: GraphVisualizationAutoGameAgentPackResource) {
        return html`
            <li class="auto-game-skill-item auto-game-template-item">
                <details class="auto-game-resource-preview">
                    <summary>
                        <span>
                            <strong>${template.targetPath}</strong>
                            <code>${template.packagePath}</code>
                        </span>
                        <gm-badge .label=${"Template"} .tone=${"neutral"}></gm-badge>
                    </summary>
                    <pre
                        aria-label=${`${template.targetPath} packaged source preview`}
                    ><code>${template.content}</code></pre>
                </details>
            </li>
        `;
    }

    #getAgentConfigBadgeTone(status: GraphVisualizationAutoGameAgentConfig["status"]): GmBadgeTone {
        if (status === "cli-configurable") {
            return "success";
        }
        if (status === "manual-required") {
            return "warning";
        }
        return "muted";
    }

    #getAgentConfigBadgeLabel(status: GraphVisualizationAutoGameAgentConfig["status"]): string {
        if (status === "cli-configurable") {
            return "CLI Setup";
        }
        if (status === "manual-required") {
            return "Manual";
        }
        return "Unavailable";
    }

    #setAgentTargetSelected(agentId: GraphVisualizationAutoGameAgentConfig["id"], selected: boolean): void {
        const selectedTargets = new Set(this.selectedAgentTargets);
        this.#hasUserSelectedAgentTargets = true;
        if (selected) {
            selectedTargets.add(agentId);
        } else {
            selectedTargets.delete(agentId);
        }
        this.selectedAgentTargets = Object.freeze([...selectedTargets].sort());
    }

    #getSelectedAgentTargets(
        agentConfigs: ReadonlyArray<GraphVisualizationAutoGameAgentConfig>
    ): ReadonlyArray<GraphVisualizationAutoGameAgentConfig["id"]> {
        if (this.#hasUserSelectedAgentTargets) {
            return this.selectedAgentTargets;
        }
        return Object.freeze(
            agentConfigs.filter((agentConfig) => agentConfig.selectedByDefault).map((agentConfig) => agentConfig.id)
        );
    }

    #renderAgentConfigTarget(agentConfig: GraphVisualizationAutoGameAgentConfig, isSkillMutationPending: boolean) {
        const isSelectable = agentConfig.status === "cli-configurable";
        const checked = this.#getSelectedAgentTargets(
            this.model?.autoGamePipeline?.agentPack.agentConfigs ?? []
        ).includes(agentConfig.id);
        return html`
            <li class=${`auto-game-agent-config auto-game-agent-config--${agentConfig.status}`}>
                <div class="auto-game-agent-config__header">
                    <label class="auto-game-agent-config__select">
                        <input
                            type="checkbox"
                            .checked=${checked}
                            ?disabled=${!isSelectable || isSkillMutationPending}
                            aria-label=${`${checked ? "Exclude" : "Include"} ${agentConfig.label} MCP setup`}
                            @change=${(event: Event) => {
                                this.#setAgentTargetSelected(
                                    agentConfig.id,
                                    (event.target as HTMLInputElement).checked
                                );
                            }}
                        />
                        <span>
                            <strong>${agentConfig.label}</strong>
                            <small
                                >${agentConfig.cliInstalled
                                    ? (agentConfig.cliVersion ?? agentConfig.cliName)
                                    : "CLI not detected"}</small
                            >
                        </span>
                    </label>
                    <gm-badge
                        .label=${this.#getAgentConfigBadgeLabel(agentConfig.status)}
                        .tone=${this.#getAgentConfigBadgeTone(agentConfig.status)}
                    ></gm-badge>
                </div>
                <p>${agentConfig.statusDetail}</p>
                ${agentConfig.configPaths.length > 0
                    ? html`<code class="auto-game-item-meta">${agentConfig.configPaths.join(", ")}</code>`
                    : nothing}
                ${agentConfig.status === "manual-required"
                    ? html`<ul class="auto-game-agent-config__manual">
                          ${agentConfig.manualInstructions.map((instruction) => html`<li>${instruction}</li>`)}
                      </ul>`
                    : nothing}
            </li>
        `;
    }

    #renderAgentConfigTargets(
        agentConfigs: ReadonlyArray<GraphVisualizationAutoGameAgentConfig>,
        isSkillMutationPending: boolean
    ) {
        if (agentConfigs.length === 0) {
            return nothing;
        }

        return html`
            <div class="auto-game-agent-configs">
                <div class="auto-game-agent-configs__heading">
                    <strong>Agent MCP Setup</strong>
                    <small>GMLoop only uses provider CLI commands for automatic setup.</small>
                </div>
                <ul class="auto-game-agent-config-list">
                    ${agentConfigs.map((agentConfig) =>
                        this.#renderAgentConfigTarget(agentConfig, isSkillMutationPending)
                    )}
                </ul>
            </div>
        `;
    }

    #renderAiSkills() {
        const skills = this.model?.autoGamePipeline?.skills ?? [];
        const agentPack = this.model?.autoGamePipeline?.agentPack;
        const agentConfigs = agentPack?.agentConfigs ?? [];
        const resources = agentPack?.resources ?? [];
        const shouldOfferAgentPackAction = agentPack !== undefined;
        const hasUntrackedProjectSkills = agentPack?.status === "not-installed" && skills.length > 0;
        const agentPackActionLabel =
            agentPack?.status === "current"
                ? "Update / Re-sync Agent Pack"
                : agentPack?.status === "update-available"
                  ? "Update Auto-Game Agent Pack"
                  : hasUntrackedProjectSkills
                    ? "Complete Auto-Game Setup"
                    : "Initialize Auto-Game Agent Pack";
        const agentPackNoticeLabel =
            agentPack?.status === "current"
                ? "Up to Date"
                : agentPack?.status === "update-available"
                  ? "Update Available"
                  : hasUntrackedProjectSkills
                    ? "Setup Incomplete"
                    : "Not Initialized";
        const agentPackNoticeTone = agentPack?.status === "current" ? "success" : "warning";
        const agentPackNoticeText =
            agentPack?.status === "current"
                ? `This project is synchronized with GMLoop's latest packaged skills and guidance (v${agentPack.installedVersion}). Re-sync to restore missing files or refresh templates without overwriting project changes.`
                : agentPack?.status === "update-available"
                  ? `Auto-Game Agent Pack ${agentPack.availableVersion} is available; this project has ${agentPack.installedVersion ?? "an unknown version"}.`
                  : hasUntrackedProjectSkills
                    ? `${String(skills.length)} project skill${skills.length === 1 ? " was" : "s were"} detected, but this project has no agent-pack installation record. Complete setup to synchronize GMLoop's packaged resources and record their version without overwriting project changes.`
                    : "Initialize GMLoop's Auto-Game Agent Pack to add project skills and guidance.";
        const isAgentPackPending = this.state?.autoGamePendingOperation === "initialize-agent-pack";
        const isSkillMutationPending = this.state?.autoGamePendingOperation !== null;

        const templateItems = resources.filter((resource) => resource.kind === "template");
        const skillsToDisplay: Array<{
            name: string;
            description: string;
            enabled: boolean;
            status: "available" | "unreadable" | "packaged";
            sourcePath: string;
            isProjectSkill: boolean;
            diagnostic?: string | null;
        }> = [];

        // Add project-scoped skills
        for (const skill of skills) {
            skillsToDisplay.push({
                name: skill.name,
                description: skill.description,
                enabled: skill.enabled,
                status: skill.status,
                sourcePath: skill.sourcePath,
                isProjectSkill: true,
                diagnostic: skill.diagnostic
            });
        }

        // Add packaged skills that are not already present in project-scoped skills
        const packagedSkills = resources.filter((resource) => resource.kind === "skill");
        for (const resource of packagedSkills) {
            const parts = resource.targetPath.split("/");
            const name = getSkillNameFromContent(resource.content) || parts.at(-2) || "";
            const exists = skillsToDisplay.some((s) => s.name === name);
            if (!exists) {
                const description = getSkillDescriptionFromContent(resource.content);
                skillsToDisplay.push({
                    name,
                    description,
                    enabled: false,
                    status: "packaged",
                    sourcePath: resource.targetPath,
                    isProjectSkill: false,
                    diagnostic: null
                });
            }
        }

        const totalItemsCount = templateItems.length + skillsToDisplay.length;

        return html`
            <article class="gm-card auto-game-card auto-game-skills-card">
                <div class="auto-game-card__heading">
                    <div>
                        <h3 class="gm-card__heading">AI Skills & Guidance</h3>
                        <p>Configure the skills and templates included in Auto-Game.</p>
                    </div>
                    ${totalItemsCount > 0
                        ? html`<gm-badge .label=${`${totalItemsCount} Resources`}></gm-badge>`
                        : nothing}
                </div>
                ${shouldOfferAgentPackAction
                    ? html`
                          <div class="gm-empty auto-game-skill-empty">
                              <gm-badge .label=${agentPackNoticeLabel} .tone=${agentPackNoticeTone}></gm-badge>
                              <p>${agentPackNoticeText}</p>
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
                              ${this.#renderAgentConfigTargets(agentConfigs, isSkillMutationPending)}
                              <button
                                  id="initialize-auto-game-agent-pack"
                                  class="gm-btn ${agentPack?.status === "current" ? "" : "gm-btn--primary"}"
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
                                                  detail: {
                                                      agentTargets: this.#getSelectedAgentTargets(agentConfigs),
                                                      includeGitIgnore: this.includeGitIgnore
                                                  }
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
                ${this.model?.loadedTarget === null && totalItemsCount > 0
                    ? html`<p class="auto-game-skill-unloaded-notice">
                          Open a GameMaker project to discover its Auto-Game skills.
                      </p>`
                    : nothing}
                <details class="auto-game-skill-disclosure">
                    <summary>
                        <span>
                            <strong>Packaged Skills & Guidance Templates</strong>
                            <small>Review templates and choose which skills are active.</small>
                        </span>
                        <gm-badge .label=${String(totalItemsCount)}></gm-badge>
                    </summary>
                    ${totalItemsCount === 0
                        ? html`
                              <div class="gm-empty auto-game-skill-empty auto-game-skill-empty--skills">
                                  <p>
                                      ${this.model?.loadedTarget === null
                                          ? "Open a GameMaker project to discover its Auto-Game skills."
                                          : "No Auto-Game skills or templates are available."}
                                  </p>
                              </div>
                          `
                        : html`<ul class="auto-game-skill-list">
                              ${skillsToDisplay.map((skill) => this.#renderUnifiedSkill(skill))}
                              ${templateItems.map((template) => this.#renderUnifiedTemplate(template))}
                          </ul>`}
                </details>
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
                        ${this.#renderAiSkills()}
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
