import type { GraphVisualizationProjectWorkflow } from "../../graph/types.js";
import type {
    GraphVisualizationUiConfigView,
    GraphVisualizationUiDocsView,
    GraphVisualizationUiPage
} from "../state/types.js";

export const GRAPH_UI_EVENT_NAVIGATE_PAGE = "gmloop-navigate-page";
export const GRAPH_UI_EVENT_SET_DOCS_VIEW = "gmloop-set-docs-view";
export const GRAPH_UI_EVENT_SET_SEARCH_QUERY = "gmloop-set-search-query";
export const GRAPH_UI_EVENT_TOGGLE_GRAPH_VIEW = "gmloop-toggle-graph-view";
export const GRAPH_UI_EVENT_CYCLE_LABEL_MODE = "gmloop-cycle-label-mode";
export const GRAPH_UI_EVENT_TRIGGER_REGENERATE = "gmloop-trigger-regenerate";
export const GRAPH_UI_EVENT_TRIGGER_FIX = "gmloop-trigger-fix";
export const GRAPH_UI_EVENT_TRIGGER_OPEN_PROJECT = "gmloop-trigger-open-project";
export const GRAPH_UI_EVENT_TRIGGER_START_LIVE_RELOAD = "gmloop-trigger-start-live-reload";
export const GRAPH_UI_EVENT_TRIGGER_STOP_LIVE_RELOAD = "gmloop-trigger-stop-live-reload";
export const GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_PIPELINE = "gmloop-trigger-auto-game-pipeline";
export const GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_TASK = "gmloop-trigger-auto-game-task";
export const GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK = "gmloop-initialize-auto-game-agent-pack";
export const GRAPH_UI_EVENT_SET_AUTO_GAME_SKILL_ENABLED = "gmloop-set-auto-game-skill-enabled";
export const GRAPH_UI_EVENT_TRIGGER_CREATE_CONFIG = "gmloop-trigger-create-config";
export const GRAPH_UI_EVENT_SAVE_CONFIG = "gmloop-save-config";
export const GRAPH_UI_EVENT_SET_CONFIG_VIEW = "gmloop-set-config-view";
export const GRAPH_UI_EVENT_RESET_DEFAULTS = "gmloop-reset-defaults";
export const GRAPH_UI_EVENT_CLEAR_PAGE_ERROR = "gmloop-clear-page-error";

export type GraphUiNavigatePageDetail = Readonly<{ page: GraphVisualizationUiPage }>;
export type GraphUiSetDocsViewDetail = Readonly<{ docsView: GraphVisualizationUiDocsView }>;
export type GraphUiSetConfigViewDetail = Readonly<{ configView: GraphVisualizationUiConfigView }>;
export type GraphUiSaveConfigDetail = Readonly<{ config: Readonly<Record<string, unknown>> }>;
export type GraphUiSetSearchQueryDetail = Readonly<{ searchQuery: string }>;
export type GraphUiClearPageErrorDetail = Readonly<{ page: GraphVisualizationUiPage }>;
export type GraphUiTriggerFixDetail = Readonly<{ workflow: GraphVisualizationProjectWorkflow }>;
export type GraphUiTriggerAutoGamePipelineDetail = Readonly<{ action: "start" | "pause" | "stop" }>;
export type GraphUiTriggerAutoGameTaskDetail = Readonly<{ prompt: string }>;
export type GraphUiInitializeAutoGameAgentPackDetail = Readonly<{ includeGitIgnore: boolean }>;
export type GraphUiSetAutoGameSkillEnabledDetail = Readonly<{ enabled: boolean; name: string }>;
