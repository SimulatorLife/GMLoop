import { Core } from "@gmloop/core";
import type {
    D3DragEvent,
    D3ZoomEvent,
    DragBehavior,
    ForceLink,
    Simulation,
    SimulationLinkDatum,
    SimulationNodeDatum,
    ZoomBehavior,
    ZoomTransform
} from "d3";
import * as d3 from "d3";

import { resolveInitialPlaygroundGmlSource } from "../app/playground-default-gml.js";
import type {
    GraphVisualizationUiLabelMode,
    GraphVisualizationUiPage,
    GraphVisualizationUiState
} from "../app/state/types.js";
import {
    readGraphVisualizationUiStateFromCurrentUrl,
    replaceGraphVisualizationUiStateInCurrentUrl
} from "../app/state/url-state.js";
import { EDGE_LINE_VISUAL_STYLES, NODE_VISUAL_STYLES } from "./graph-visualization-style-metadata.js";
import type {
    GraphVisualizationData,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationEdgeRecord,
    GraphVisualizationLiveReloadModel,
    GraphVisualizationLiveReloadRecentError,
    GraphVisualizationLiveReloadRecentPatch,
    GraphVisualizationLiveReloadRuntimeHealth,
    GraphVisualizationLiveReloadStatusSnapshot,
    GraphVisualizationLiveReloadWatcherStatus,
    GraphVisualizationLoadedTarget,
    GraphVisualizationNodeKind,
    GraphVisualizationNodeRecord,
    GraphVisualizationProjectConfigurationCatalog
} from "./types.js";

export type BrowserFileHandle = Readonly<{
    name: string;
    text(): Promise<string>;
    webkitRelativePath?: string;
}>;

export type BrowserAppDependencies = Readonly<{
    data: GraphVisualizationData;
    directoryOpen: (options: Readonly<Record<string, unknown>>) => Promise<ReadonlyArray<BrowserFileHandle>>;
    documentationCatalogs: GraphVisualizationDocumentationCatalogs | null;
    fileOpen: (
        options: Readonly<Record<string, unknown>>
    ) => Promise<BrowserFileHandle | ReadonlyArray<BrowserFileHandle>>;
    isServerMode: boolean;
    liveReload: GraphVisualizationLiveReloadModel | null;
    loadedTarget: GraphVisualizationLoadedTarget | null;
    projectConfigurationCatalog: GraphVisualizationProjectConfigurationCatalog | null;
}>;

type LoadedProjectConfiguration = Readonly<{
    eslint: ReadonlyArray<Readonly<{ content: string; path: string }>>;
    gmloop: Readonly<{
        configPath: string | null;
        rawConfig: Readonly<Record<string, unknown>>;
    }>;
    prettier: ReadonlyArray<Readonly<{ content: string; path: string }>>;
}>;

type MutableGraphNodeRecord = Omit<GraphVisualizationNodeRecord, "fx" | "fy" | "x" | "y"> &
    SimulationNodeDatum &
    Readonly<{
        fx: number | null;
        fy: number | null;
        x: number;
        y: number;
    }>;

type MutableGraphEdgeEndpoint = string | MutableGraphNodeRecord;

type MutableGraphEdgeRecord = Omit<GraphVisualizationEdgeRecord, "source" | "target"> &
    SimulationLinkDatum<MutableGraphNodeRecord> &
    Readonly<{
        source: MutableGraphEdgeEndpoint;
        target: MutableGraphEdgeEndpoint;
    }>;

type ConfigViewMode = "raw" | "rendered";
type ConfigLintLevelFilter = "all" | "error" | "off" | "warn";

const CONFIG_LIST_CLASS_NAME = "config-list";
const DEFAULT_LIVE_RELOAD_POLL_INTERVAL_MS = 2000;
const MIN_LIVE_RELOAD_POLL_INTERVAL_MS = 500;

function readErrorName(errorValue: unknown): string {
    // Use a capability probe rather than `instanceof Error` so that cross-realm
    // error objects (e.g. from iframes, workers, or sandboxed code) are handled
    // consistently even when their prototype chain differs from the local realm.
    if (Core.isErrorLike(errorValue)) {
        return errorValue.name;
    }
    if (typeof errorValue === "object" && errorValue !== null && "name" in errorValue) {
        const candidate = Reflect.get(errorValue, "name");
        return typeof candidate === "string" ? candidate : "";
    }
    return "";
}

function escapeHtmlText(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(record: Readonly<Record<string, unknown>>, key: string): number | null {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: Readonly<Record<string, unknown>>, key: string): null | string {
    const value = record[key];
    return typeof value === "string" ? value : null;
}

function readBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean | null {
    const value = record[key];
    return typeof value === "boolean" ? value : null;
}

function readRecentLiveReloadPatches(value: unknown): ReadonlyArray<GraphVisualizationLiveReloadRecentPatch> {
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

function readRecentLiveReloadErrors(value: unknown): ReadonlyArray<GraphVisualizationLiveReloadRecentError> {
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

function resolveLiveReloadWatcherStatus(
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

function normalizeLiveReloadStatusSnapshot(
    value: unknown,
    hasStatusUrl: boolean
): GraphVisualizationLiveReloadStatusSnapshot | null {
    if (!isUnknownRecord(value)) {
        return null;
    }

    const errorCount = readNumber(value, "errorCount") ?? 0;
    const scanComplete = readBoolean(value, "scanComplete") ?? false;

    return {
        avgHotReloadLatencyMs: readNumber(value, "avgHotReloadLatencyMs"),
        errorCount,
        maxPatchHistory: readNumber(value, "maxPatchHistory"),
        patchCount: readNumber(value, "patchCount") ?? 0,
        patchHistorySize: readNumber(value, "patchHistorySize"),
        p95HotReloadLatencyMs: readNumber(value, "p95HotReloadLatencyMs"),
        recentErrors: readRecentLiveReloadErrors(value.recentErrors),
        recentPatches: readRecentLiveReloadPatches(value.recentPatches),
        scanComplete,
        totalPatchCount: readNumber(value, "totalPatchCount"),
        uptimeMs: readNumber(value, "uptime") ?? 0,
        watcherStatus: resolveLiveReloadWatcherStatus({ errorCount, scanComplete }, hasStatusUrl),
        websocketClients: readNumber(value, "websocketClients") ?? 0
    };
}

function formatLiveReloadDurationMs(value: number | null): string {
    if (value === null) {
        return "n/a";
    }

    if (value < 1) {
        return `${value.toFixed(2)} ms`;
    }

    return `${value.toFixed(1)} ms`;
}

function formatLiveReloadInteger(value: number | null): string {
    return value === null ? "n/a" : new Intl.NumberFormat().format(value);
}

function formatLiveReloadTimestamp(timestamp: number): string {
    if (timestamp <= 0) {
        return "Unknown time";
    }

    return new Date(timestamp).toLocaleTimeString();
}

function formatLiveReloadUptime(uptimeMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(uptimeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
}

type GraphSelectionApi<ElementType extends d3.BaseType = d3.BaseType, Datum = unknown> = d3.Selection<
    ElementType,
    Datum,
    d3.BaseType,
    unknown
>;

type GraphSimulationApi = Simulation<MutableGraphNodeRecord, MutableGraphEdgeRecord>;

type GraphDragBehavior = DragBehavior<SVGGElement, MutableGraphNodeRecord, MutableGraphNodeRecord>;

type GraphZoomBehavior = ZoomBehavior<SVGSVGElement, unknown>;

type TooltipMouseEvent = MouseEvent &
    Readonly<{
        pageX: number;
        pageY: number;
    }>;

type GraphTransform = Readonly<{
    k: number;
    transformText: string;
}>;

const NODE_GROUP_FILTER_CATEGORY = "node-group";
const RESOURCE_GROUP_FILTER_TYPE = "resource-group";
type FilterCategory = "edge" | "node" | typeof NODE_GROUP_FILTER_CATEGORY;
type FilterType =
    | GraphVisualizationNodeKind
    | "enum-group"
    | typeof RESOURCE_GROUP_FILTER_TYPE
    | GraphVisualizationEdgeRecord["type"];

const GRAPH_RESOURCE_KINDS = new Set<GraphVisualizationNodeKind>([
    "anim_curve",
    "data_file",
    "extension",
    "font",
    "note",
    "object",
    "particle_system",
    "path",
    "room",
    "script",
    "sequence",
    "shader",
    "sound",
    "sprite",
    "tileset",
    "timeline"
]);

const DEFAULT_DISABLED_NODE_KINDS = new Set<GraphVisualizationNodeKind>([
    "data_file",
    "enum_member",
    "function",
    "global_variable",
    "instance_variable",
    "local_variable",
    "struct_variable"
]);

const OPEN_PROJECT_BUTTON_LABEL = '<span class="button-content"><span class="button-label">Open...</span></span>';
const OPENING_PROJECT_BUTTON_LABEL =
    '<span class="button-content"><span class="button-spinner" aria-hidden="true"></span><span class="button-label">Opening…</span></span>';
const REGENERATE_BUTTON_LABEL = '<span class="button-content"><span class="button-label">Regenerate</span></span>';
const REGENERATING_BUTTON_LABEL =
    '<span class="button-content"><span class="button-spinner" aria-hidden="true"></span><span class="button-label">Regenerating…</span></span>';

function mapUiLabelModeToBrowserLabelMode(labelMode: GraphVisualizationUiLabelMode): "auto" | "off" | "on" {
    if (labelMode === "always") {
        return "on";
    }

    if (labelMode === "hidden") {
        return "off";
    }

    return "auto";
}

function mapBrowserLabelModeToUiLabelMode(labelMode: "auto" | "off" | "on"): GraphVisualizationUiLabelMode {
    if (labelMode === "on") {
        return "always";
    }

    if (labelMode === "off") {
        return "hidden";
    }

    return "auto";
}

function readGraphNodePathLabel(nodeValue: GraphVisualizationNodeRecord): string | null {
    if (nodeValue.filePath !== null && nodeValue.resourcePath !== null) {
        return `${nodeValue.filePath} (resource: ${nodeValue.resourcePath})`;
    }

    if (nodeValue.filePath !== null) {
        return nodeValue.filePath;
    }

    return nodeValue.resourcePath;
}

function createCurrentGraphVisualizationUiStateSnapshot(
    activePage: GraphVisualizationUiPage,
    activeDocsView: "cli" | "mcp" | "rules",
    activeGraphView: "json" | "visual",
    labelMode: "auto" | "off" | "on",
    searchQuery: string
): GraphVisualizationUiState {
    return {
        activeDocsView,
        activeGraphView,
        activePage,
        errorMessage: null,
        isLiveReloadRefreshPending: false,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: mapBrowserLabelModeToUiLabelMode(labelMode),
        liveReloadErrorMessage: null,
        liveReloadStatus: null,
        mcpServerStatus: "not-started",
        searchQuery
    };
}

function readGraphTransform(eventValue: D3ZoomEvent<SVGSVGElement, unknown>): GraphTransform {
    const transformValue: ZoomTransform = eventValue.transform;
    const zoomFactor = transformValue.k;
    return {
        k: Number.isFinite(zoomFactor) ? zoomFactor : 1,
        transformText: String(transformValue ?? "")
    };
}

function cloneGraphNodes(nodeValues: ReadonlyArray<GraphVisualizationNodeRecord>): Array<MutableGraphNodeRecord> {
    return nodeValues.map((nodeValue) => ({
        ...nodeValue,
        fx: null,
        fy: null,
        x: 0,
        y: 0
    }));
}

function cloneGraphEdges(edgeValues: ReadonlyArray<GraphVisualizationEdgeRecord>): Array<MutableGraphEdgeRecord> {
    return edgeValues.map((edgeValue) => ({ ...edgeValue }));
}

function readEdgeEndpointId(endpoint: MutableGraphEdgeEndpoint): string {
    return typeof endpoint === "string" ? endpoint : endpoint.id;
}

function readGraphNode(nodeValue: MutableGraphNodeRecord): MutableGraphNodeRecord {
    return nodeValue;
}

function readNodeIdentifier(nodeValue: MutableGraphNodeRecord): string {
    return nodeValue.id;
}

function rebuildGraphIndexes(
    edgeValues: ReadonlyArray<MutableGraphEdgeRecord>,
    incomingCounts: Map<string, number>,
    outgoingCounts: Map<string, number>,
    neighbors: Map<string, Set<string>>
): void {
    incomingCounts.clear();
    outgoingCounts.clear();
    neighbors.clear();
    edgeValues.forEach((edgeValue) => {
        const sourceId = readEdgeEndpointId(edgeValue.source);
        const targetId = readEdgeEndpointId(edgeValue.target);
        incomingCounts.set(targetId, (incomingCounts.get(targetId) ?? 0) + 1);
        outgoingCounts.set(sourceId, (outgoingCounts.get(sourceId) ?? 0) + 1);
        if (!neighbors.has(sourceId)) {
            neighbors.set(sourceId, new Set());
        }
        if (!neighbors.has(targetId)) {
            neighbors.set(targetId, new Set());
        }
        neighbors.get(sourceId)?.add(targetId);
        neighbors.get(targetId)?.add(sourceId);
    });
}

function getRadius(
    nodeValue: MutableGraphNodeRecord,
    incomingCount: Map<string, number>,
    outgoingCount: Map<string, number>
): number {
    const degree = (incomingCount.get(nodeValue.id) ?? 0) + (outgoingCount.get(nodeValue.id) ?? 0);
    return Math.max(5, Math.min(25, 4 + Math.log2(degree + 1) * 3));
}

function createCatalogItemRow(labelText: string, valueText: string): HTMLLIElement {
    const row = document.createElement("li");
    row.className = "catalog-item";
    row.innerHTML = `<code>${labelText}</code> ${valueText}`;
    return row;
}

function createCatalogCard(
    title: string,
    descriptionText: string,
    usageText: string,
    rows: ReadonlyArray<HTMLLIElement>
): HTMLElement {
    const card = document.createElement("section");
    card.className = "catalog-card";
    const heading = document.createElement("h3");
    heading.textContent = title;
    card.append(heading);

    if (usageText.length > 0) {
        const usage = document.createElement("code");
        usage.className = "catalog-usage";
        usage.textContent = usageText;
        card.append(usage);
    }

    if (descriptionText.length > 0) {
        const description = document.createElement("p");
        description.textContent = descriptionText;
        card.append(description);
    }

    if (rows.length > 0) {
        const list = document.createElement("ul");
        list.className = "catalog-list";
        rows.forEach((row) => list.append(row));
        card.append(list);
    }

    return card;
}

function createConfigItem(
    title: string,
    descriptionText: string,
    valueText: string,
    badges: ReadonlyArray<string>
): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "config-item";
    const titleRow = document.createElement("div");
    titleRow.className = "config-item-title";
    const heading = document.createElement("strong");
    heading.textContent = title;
    titleRow.append(heading);
    if (descriptionText.length > 0) {
        const help = document.createElement("details");
        help.className = "config-help";
        const helpSummary = document.createElement("summary");
        helpSummary.setAttribute("aria-label", descriptionText);
        helpSummary.textContent = "?";
        const helpBody = document.createElement("p");
        helpBody.textContent = descriptionText;
        help.append(helpSummary, helpBody);
        titleRow.append(help);
    }
    item.append(titleRow);
    if (badges.length > 0) {
        const badgeRow = document.createElement("div");
        badgeRow.className = "config-badge-row";
        badges.forEach((badgeText) => {
            badgeRow.append(isConfigSeverityLevel(badgeText) ? createSeverityBadge(badgeText) : createBadge(badgeText));
        });
        item.append(badgeRow);
    }
    if (valueText.length > 0) {
        const value = document.createElement("div");
        value.className = "config-value";
        value.textContent = valueText;
        item.append(value);
    }
    return item;
}

function createConfigCard(title: string, descriptionText: string, children: ReadonlyArray<HTMLElement>): HTMLElement {
    const card = document.createElement("section");
    card.className = "config-card";
    const heading = document.createElement("h3");
    heading.textContent = title;
    card.append(heading);
    if (descriptionText.length > 0) {
        const description = document.createElement("p");
        description.textContent = descriptionText;
        card.append(description);
    }
    children.forEach((child) => card.append(child));
    return card;
}

function createConfigSection(
    eyebrowText: string,
    title: string,
    descriptionText: string,
    children: ReadonlyArray<HTMLElement>
): HTMLElement {
    const section = document.createElement("section");
    section.className = "config-section";

    const header = document.createElement("div");
    header.className = "config-section-header";

    const eyebrow = document.createElement("span");
    eyebrow.className = "config-section-eyebrow";
    eyebrow.textContent = eyebrowText;
    header.append(eyebrow);

    const heading = document.createElement("h2");
    heading.className = "config-section-title";
    heading.textContent = title;
    header.append(heading);

    const description = document.createElement("p");
    description.className = "config-section-description";
    description.textContent = descriptionText;
    header.append(description);

    section.append(header);

    const body = document.createElement("div");
    body.className = "config-section-body";
    children.forEach((child) => body.append(child));
    section.append(body);

    return section;
}

function createConfigSummaryMetric(
    labelText: string,
    valueText: string,
    tone: "default" | "accent" = "default"
): HTMLElement {
    const metric = document.createElement("div");
    metric.className = `config-summary-metric${tone === "accent" ? " config-summary-metric-accent" : ""}`;

    const label = document.createElement("span");
    label.className = "config-summary-label";
    label.textContent = labelText;
    metric.append(label);

    const value = document.createElement("strong");
    value.className = "config-summary-value";
    value.textContent = valueText;
    metric.append(value);

    return metric;
}

function createBadge(labelText: string): HTMLSpanElement {
    const badge = document.createElement("span");
    badge.className = "config-badge";
    badge.textContent = labelText;
    return badge;
}

function isConfigSeverityLevel(value: string): value is Exclude<ConfigLintLevelFilter, "all"> {
    return value === "error" || value === "off" || value === "warn";
}

function createSeverityBadge(level: Exclude<ConfigLintLevelFilter, "all">): HTMLSpanElement {
    const badge = document.createElement("span");
    badge.className = `config-severity-badge ${level}`;
    badge.textContent = level === "error" ? "Error" : level === "warn" ? "Warn" : "Off";
    return badge;
}

function createConfigFilterField(
    labelText: string,
    helpText: string,
    options: ReadonlyArray<Readonly<{ label: string; value: string }>>,
    selectedValue: string,
    onChange: (value: string) => void
): HTMLLabelElement {
    const field = document.createElement("label");
    field.className = "config-filter-field";

    const label = document.createElement("span");
    label.textContent = labelText;
    const help = document.createElement("details");
    help.className = "config-help";
    const helpSummary = document.createElement("summary");
    helpSummary.setAttribute("aria-label", `${labelText} filter help`);
    helpSummary.textContent = "?";
    const helpBody = document.createElement("p");
    helpBody.textContent = helpText;
    help.append(helpSummary, helpBody);
    label.append(help);
    field.append(label);

    const select = document.createElement("select");
    options.forEach((option) => {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        element.selected = option.value === selectedValue;
        select.append(element);
    });
    select.addEventListener("change", () => {
        onChange(select.value);
    });
    field.append(select);

    return field;
}

function formatLabel(textValue: string): string {
    return textValue.charAt(0).toUpperCase() + textValue.slice(1).replaceAll("_", " ");
}

function dragMoved(eventValue: D3DragEvent<SVGGElement, MutableGraphNodeRecord, MutableGraphNodeRecord>): void {
    const nodeValue = eventValue.subject;
    nodeValue.fx = eventValue.x;
    nodeValue.fy = eventValue.y;
}

function renderLoadedTargetSummary(currentLoadedTarget: GraphVisualizationLoadedTarget | null): void {
    const loadedTargetElement = document.getElementById("loaded-target");
    const loadedTargetDetailsElement = document.getElementById("loaded-target-details");
    if (!(loadedTargetElement instanceof HTMLElement) || !(loadedTargetDetailsElement instanceof HTMLElement)) {
        return;
    }
    const loadedTargetLabel = loadedTargetElement.querySelector(".loaded-path-label");
    const loadedTargetValue = loadedTargetElement.querySelector(".loaded-path-value");
    if (!(loadedTargetLabel instanceof HTMLElement) || !(loadedTargetValue instanceof HTMLElement)) {
        return;
    }

    loadedTargetLabel.textContent = "Loaded Project";
    if (currentLoadedTarget === null) {
        loadedTargetValue.textContent = "No project loaded";
        loadedTargetDetailsElement.textContent = "Use Open... to load a GameMaker project.";
        return;
    }

    loadedTargetValue.textContent = currentLoadedTarget.projectRoot || currentLoadedTarget.activePath;
    loadedTargetDetailsElement.innerHTML = "";
    const source = document.createElement("strong");
    source.textContent = `Source: ${currentLoadedTarget.source}`;
    loadedTargetDetailsElement.append(source);
    const detailText = document.createElement("span");
    detailText.textContent = ` | Selected: ${String(currentLoadedTarget.selectedPaths.length)} item${
        currentLoadedTarget.selectedPaths.length === 1 ? "" : "s"
    }`;
    loadedTargetDetailsElement.append(detailText);
}

function updateGraphInteractionAvailability(
    hasGraphData: boolean,
    hasLoadedProject: boolean,
    isServerMode: boolean
): void {
    const searchInput = document.getElementById("search");
    const toggleViewButton = document.getElementById("toggle-view");
    const toggleLabelsButton = document.getElementById("toggle-labels");
    const resetDefaultButton = document.getElementById("reset-default");
    const regenerateButton = document.getElementById("regenerate");
    const emptyStateElement = document.getElementById("graph-empty-state");
    if (
        !(searchInput instanceof HTMLInputElement) ||
        !(toggleViewButton instanceof HTMLButtonElement) ||
        !(toggleLabelsButton instanceof HTMLButtonElement) ||
        !(resetDefaultButton instanceof HTMLButtonElement) ||
        !(emptyStateElement instanceof HTMLElement)
    ) {
        return;
    }

    const shouldDisableGraphControls = !hasGraphData;
    searchInput.disabled = shouldDisableGraphControls;
    toggleViewButton.disabled = shouldDisableGraphControls;
    toggleLabelsButton.disabled = shouldDisableGraphControls;
    resetDefaultButton.disabled = shouldDisableGraphControls;
    document.querySelectorAll("#legend input[type='checkbox']").forEach((checkboxElement) => {
        if (checkboxElement instanceof HTMLInputElement) {
            checkboxElement.disabled = shouldDisableGraphControls;
        }
    });
    if (regenerateButton instanceof HTMLButtonElement) {
        regenerateButton.disabled = isServerMode && !hasLoadedProject;
    }

    if (hasGraphData) {
        emptyStateElement.classList.add("hidden");
        emptyStateElement.setAttribute("aria-hidden", "true");
        return;
    }

    const titleElement = emptyStateElement.querySelector("strong");
    const descriptionElement = emptyStateElement.querySelector("p");
    if (!(titleElement instanceof HTMLElement) || !(descriptionElement instanceof HTMLElement)) {
        return;
    }

    if (hasLoadedProject) {
        titleElement.textContent = "No graph nodes are available for the current project.";
        descriptionElement.textContent =
            "Rebuild the graph index or load a different target to inspect semantic graph data here.";
    } else {
        titleElement.textContent = "Open a GameMaker project to start exploring the graph.";
        descriptionElement.textContent =
            "Use Open... to load a project, then return here for graph search, filters, and visualization controls.";
    }

    emptyStateElement.classList.remove("hidden");
    emptyStateElement.setAttribute("aria-hidden", "false");
}

function updateDocsViewState(
    state: Readonly<{
        activeDocsView: "cli" | "mcp" | "rules";
        cliMetaText: string;
        mcpMetaText: string;
        rulesMetaText: string;
    }>
): void {
    const cliPage = document.getElementById("cli-page");
    const mcpPage = document.getElementById("docs-mcp-page");
    const rulesPage = document.getElementById("rules-page");
    const cliButton = document.getElementById("docs-view-cli");
    const mcpButton = document.getElementById("docs-view-mcp");
    const rulesButton = document.getElementById("docs-view-rules");
    const docsMetaElement = document.getElementById("docs-meta");
    if (
        !(cliPage instanceof HTMLElement) ||
        !(mcpPage instanceof HTMLElement) ||
        !(rulesPage instanceof HTMLElement) ||
        !(cliButton instanceof HTMLButtonElement) ||
        !(mcpButton instanceof HTMLButtonElement) ||
        !(rulesButton instanceof HTMLButtonElement) ||
        !(docsMetaElement instanceof HTMLElement)
    ) {
        return;
    }

    cliPage.classList.toggle("hidden", state.activeDocsView !== "cli");
    mcpPage.classList.toggle("hidden", state.activeDocsView !== "mcp");
    rulesPage.classList.toggle("hidden", state.activeDocsView !== "rules");
    cliButton.classList.toggle("active", state.activeDocsView === "cli");
    mcpButton.classList.toggle("active", state.activeDocsView === "mcp");
    rulesButton.classList.toggle("active", state.activeDocsView === "rules");
    if (state.activeDocsView === "cli") {
        docsMetaElement.textContent = state.cliMetaText;
        return;
    }
    if (state.activeDocsView === "mcp") {
        docsMetaElement.textContent = state.mcpMetaText;
        return;
    }
    docsMetaElement.textContent = state.rulesMetaText;
}

function wirePageNavigation(
    state: {
        activeDocsView: "cli" | "mcp" | "rules";
        activePage: GraphVisualizationUiPage;
        cliMetaText: string;
        mcpMetaText: string;
        rulesMetaText: string;
    },
    applyPageState: () => void,
    updateDocsViewStateFn: () => void,
    syncUrlState: () => void
): void {
    ["graph", "docs", "config", "playground", "mcp", "live-reload"].forEach((pageValue) => {
        const button = document.getElementById(`tab-${pageValue}`);
        if (button instanceof HTMLButtonElement) {
            button.addEventListener("click", () => {
                state.activePage = pageValue as GraphVisualizationUiPage;
                applyPageState();
                syncUrlState();
            });
        }
    });

    const docsCliButton = document.getElementById("docs-view-cli");
    const docsMcpButton = document.getElementById("docs-view-mcp");
    const docsRulesButton = document.getElementById("docs-view-rules");
    if (docsCliButton instanceof HTMLButtonElement) {
        docsCliButton.addEventListener("click", () => {
            state.activeDocsView = "cli";
            updateDocsViewStateFn();
            syncUrlState();
        });
    }
    if (docsMcpButton instanceof HTMLButtonElement) {
        docsMcpButton.addEventListener("click", () => {
            state.activeDocsView = "mcp";
            updateDocsViewStateFn();
            syncUrlState();
        });
    }
    if (docsRulesButton instanceof HTMLButtonElement) {
        docsRulesButton.addEventListener("click", () => {
            state.activeDocsView = "rules";
            updateDocsViewStateFn();
            syncUrlState();
        });
    }
}

function renderDocumentationCatalog(
    dependencies: BrowserAppDependencies,
    updateDocsViewStateFn: () => void,
    metaState: {
        cliMetaText: string;
        mcpMetaText: string;
        rulesMetaText: string;
    }
): void {
    const docsMetaElement = document.getElementById("docs-meta");
    const cliContentElement = document.getElementById("cli-content");
    const mcpContentElement = document.getElementById("docs-mcp-content");
    const mcpPageMetaElement = document.getElementById("mcp-meta");
    const mcpRuntimeContentElement = document.getElementById("mcp-runtime-content");
    const rulesContentElement = document.getElementById("rules-content");
    if (
        !(docsMetaElement instanceof HTMLElement) ||
        !(cliContentElement instanceof HTMLElement) ||
        !(mcpContentElement instanceof HTMLElement) ||
        !(rulesContentElement instanceof HTMLElement) ||
        !(mcpPageMetaElement instanceof HTMLElement) ||
        !(mcpRuntimeContentElement instanceof HTMLElement)
    ) {
        return;
    }

    cliContentElement.innerHTML = "";
    mcpContentElement.innerHTML = "";
    rulesContentElement.innerHTML = "";
    mcpRuntimeContentElement.innerHTML = "";

    if (dependencies.documentationCatalogs === null) {
        metaState.cliMetaText = "No CLI catalog metadata is available for this view.";
        metaState.mcpMetaText = "No MCP catalog metadata is available for this view.";
        metaState.rulesMetaText = "No workspace rules metadata is available for this view.";
        const emptyState = document.createElement("div");
        emptyState.className = "catalog-empty";
        emptyState.textContent = "Documentation catalogs are not available.";
        cliContentElement.append(emptyState.cloneNode(true));
        mcpContentElement.append(emptyState.cloneNode(true));
        rulesContentElement.append(emptyState);
        mcpPageMetaElement.textContent = "No MCP server catalog metadata is available for this view.";
        mcpRuntimeContentElement.append(emptyState.cloneNode(true));
        updateDocsViewStateFn();
        return;
    }

    metaState.cliMetaText = `${String(
        dependencies.documentationCatalogs.cliCommands.length
    )} CLI command entries sourced directly from the Commander command catalog.`;
    dependencies.documentationCatalogs.cliCommands.forEach((entry) => {
        const rows: Array<HTMLLIElement> = [];
        entry.arguments.forEach((argument) => {
            const detailParts = [argument.required ? "required" : "optional"];
            if (argument.variadic) {
                detailParts.push("variadic");
            }
            if (argument.choices.length > 0) {
                detailParts.push(`choices: ${argument.choices.join(", ")}`);
            }
            const suffix = detailParts.length > 0 ? ` (${detailParts.join(", ")})` : "";
            rows.push(createCatalogItemRow(`<${argument.name}>`, (argument.description || "No description.") + suffix));
        });
        entry.options.forEach((option) => {
            const optionName = option.long ?? option.flags;
            const detailParts: Array<string> = [];
            if (option.boolean) {
                detailParts.push("boolean");
            }
            if (option.variadic) {
                detailParts.push("variadic");
            }
            if (option.choices.length > 0) {
                detailParts.push(`choices: ${option.choices.join(", ")}`);
            }
            const suffix = detailParts.length > 0 ? ` (${detailParts.join(", ")})` : "";
            rows.push(createCatalogItemRow(optionName, (option.description || "No description.") + suffix));
        });
        cliContentElement.append(createCatalogCard(entry.displayName, entry.description, entry.usage, rows));
    });

    const mcpServer = dependencies.documentationCatalogs.mcpServer;
    metaState.mcpMetaText = `${mcpServer.name} v${mcpServer.version} | ${String(
        dependencies.documentationCatalogs.mcpTools.length
    )} MCP tools derived from the CLI catalog.`;
    dependencies.documentationCatalogs.mcpTools.forEach((entry) => {
        const rows = entry.fields.map((field) => {
            const detailParts = [field.kind, field.required ? "required" : "optional"];
            if (field.multiple) {
                detailParts.push("multiple");
            }
            if (field.choices.length > 0) {
                detailParts.push(`choices: ${field.choices.join(", ")}`);
            }
            return createCatalogItemRow(
                field.name,
                `${field.description || "No description."} (${detailParts.join(", ")})`
            );
        });
        mcpContentElement.append(createCatalogCard(entry.toolName, entry.description, entry.commandDisplayName, rows));
    });

    mcpPageMetaElement.textContent = `${mcpServer.name} v${mcpServer.version} | ${String(
        dependencies.documentationCatalogs.mcpTools.length
    )} MCP tools available.`;
    mcpRuntimeContentElement.append(
        createCatalogCard(
            "Runtime Status",
            dependencies.isServerMode
                ? "Graph UI server mode is active and ready to host MCP-backed interactions."
                : "Standalone mode is active; MCP runtime status is informational only.",
            "",
            [createCatalogItemRow("status", dependencies.isServerMode ? "running" : "not-started")]
        )
    );
    mcpRuntimeContentElement.append(
        createCatalogCard(
            "Tool Call Feed",
            "Live tool-call feed wiring is not exposed in this template yet. This section is reserved for streaming events.",
            "",
            []
        )
    );
    mcpRuntimeContentElement.append(
        createCatalogCard(
            "Tool Catalog",
            "MCP tool entries exposed by the active workspace catalog.",
            "",
            dependencies.documentationCatalogs.mcpTools.map((entry) =>
                createCatalogItemRow(
                    entry.toolName,
                    `${entry.commandDisplayName} (${String(entry.fields.length)} fields)`
                )
            )
        )
    );

    const workspaceRules = dependencies.documentationCatalogs.workspaceRules;
    metaState.rulesMetaText = `${String(workspaceRules.formatOptions.length)} format options, ${String(
        workspaceRules.lintRules.length
    )} lint rules, ${String(workspaceRules.refactorCodemods.length)} refactor codemods loaded directly from workspace registries.`;

    const formatRows = workspaceRules.formatOptions.map((entry) =>
        createCatalogItemRow(entry.name, `${entry.description} (default: ${JSON.stringify(entry.defaultValue)})`)
    );
    rulesContentElement.append(
        createCatalogCard(
            "Prettier / Format Options",
            "Live formatter option catalog sourced from @gmloop/format.",
            "Format.listProjectFormatOptionCatalogEntries()",
            formatRows
        )
    );

    const lintRows = workspaceRules.lintRules.map((entry) =>
        createCatalogItemRow(
            entry.ruleId,
            `${entry.description} (${entry.fixable === null ? "not auto-fixable" : `fixable: ${entry.fixable}`})`
        )
    );
    rulesContentElement.append(
        createCatalogCard(
            "Lint Rules",
            "Live lint rule catalog sourced from @gmloop/lint.",
            "Lint.listLintRuleCatalogEntries()",
            lintRows
        )
    );

    const refactorRows = workspaceRules.refactorCodemods.map((entry) =>
        createCatalogItemRow(
            entry.id,
            `${entry.description} (${
                entry.requiresSemanticProjectIndex
                    ? "requires semantic project index"
                    : "does not require semantic project index"
            })`
        )
    );
    rulesContentElement.append(
        createCatalogCard(
            "Refactor Codemods",
            "Live codemod catalog sourced from @gmloop/refactor.",
            "Refactor.listRegisteredCodemods()",
            refactorRows
        )
    );

    updateDocsViewStateFn();
}

function updateGraphViewMode(
    state: Readonly<{
        activeGraphView: "json" | "visual";
        graphRuntime: typeof d3;
        jsonView: GraphSelectionApi;
        linksRaw: Array<MutableGraphEdgeRecord>;
        nodesRaw: Array<MutableGraphNodeRecord>;
        activeFilters: Set<string>;
        activeNodeFilters: Set<GraphVisualizationNodeKind>;
        svg: GraphSelectionApi;
    }>
): void {
    const isVisualView = state.activeGraphView === "visual";
    state.svg.classed("hidden", !isVisualView);
    state.graphRuntime.select("#legend").classed("hidden", !isVisualView);
    state.graphRuntime.select("#tooltip").classed("hidden", !isVisualView);
    state.jsonView.classed("hidden", isVisualView).style("display", isVisualView ? "none" : "block");
    state.graphRuntime.select("#toggle-view").text(isVisualView ? "JSON" : "Visual");
    if (!isVisualView) {
        state.jsonView.text(
            JSON.stringify(
                {
                    edges: state.linksRaw.filter((edgeValue) => state.activeFilters.has(edgeValue.type)),
                    graphs: state.graphRuntime.select("#graph") ? undefined : undefined,
                    nodes: state.nodesRaw.filter((nodeValue) => state.activeNodeFilters.has(nodeValue.kind))
                },
                null,
                2
            )
        );
    }
}

function updatePageState(
    state: Readonly<{
        activePage: GraphVisualizationUiPage;
        graphRuntime: typeof d3;
        jsonView: GraphSelectionApi;
        svg: GraphSelectionApi;
    }>,
    updateGraphViewModeFn: () => void
): void {
    [
        { buttonId: "tab-graph", pageId: "graph-page", pageValue: "graph" },
        { buttonId: "tab-docs", pageId: "docs-page", pageValue: "docs" },
        { buttonId: "tab-config", pageId: "config-page", pageValue: "config" },
        { buttonId: "tab-playground", pageId: "playground-page", pageValue: "playground" },
        { buttonId: "tab-mcp", pageId: "mcp-page", pageValue: "mcp" },
        { buttonId: "tab-live-reload", pageId: "live-reload-page", pageValue: "live-reload" }
    ].forEach((entry) => {
        const button = document.getElementById(entry.buttonId);
        const page = document.getElementById(entry.pageId);
        if (button instanceof HTMLButtonElement) {
            button.classList.toggle("active", state.activePage === entry.pageValue);
        }
        if (page instanceof HTMLElement) {
            page.classList.toggle("active", state.activePage === entry.pageValue);
        }
    });

    const toolbarHeading = document.getElementById("toolbar-heading");
    const toolbarSubheading = document.getElementById("toolbar-subheading");
    const graphControls = document.getElementById("graph-controls");
    if (
        !(toolbarHeading instanceof HTMLElement) ||
        !(toolbarSubheading instanceof HTMLElement) ||
        !(graphControls instanceof HTMLElement)
    ) {
        return;
    }

    graphControls.classList.toggle("hidden", state.activePage !== "graph");
    if (state.activePage === "graph") {
        toolbarHeading.textContent = "Graph Index";
        toolbarSubheading.textContent = "Interactive graph exploration controls for the current graph index.";
        updateGraphViewModeFn();
        return;
    }
    if (state.activePage === "playground") {
        toolbarHeading.textContent = "Playground";
        toolbarSubheading.textContent = "Interactive GML playground for parsing, formatting, and rule experiments.";
        return;
    }
    if (state.activePage === "docs") {
        toolbarHeading.textContent = "Docs";
        toolbarSubheading.textContent =
            "Live CLI, MCP, and workspace rule catalogs are combined in a single Docs view.";
    } else if (state.activePage === "mcp") {
        toolbarHeading.textContent = "MCP";
        toolbarSubheading.textContent =
            "MCP runtime status, host-feed placeholder, and tool catalog details for the active workspace.";
    } else if (state.activePage === "live-reload") {
        toolbarHeading.textContent = "Live Reload";
        toolbarSubheading.textContent = "Hot-reload watcher, patch streaming, and runtime-wrapper observability.";
    } else {
        toolbarHeading.textContent = "Config";
        toolbarSubheading.textContent =
            "Loaded project configuration rendered from lint, format, refactor, and gmloop workspace data.";
    }

    state.svg.classed("hidden", true);
    state.graphRuntime.select("#legend").classed("hidden", true);
    state.graphRuntime.select("#tooltip").classed("hidden", true);
    state.jsonView.classed("hidden", true).style("display", "none");
}

type GraphVisualizationSurfaceInitializer = Readonly<{
    applyLabelModeButtonText: () => void;
    applyPageState: () => void;
    applySearchQuery: (nextSearchQuery: string, shouldSyncUrlState: boolean) => void;
    currentLoadedTarget: GraphVisualizationLoadedTarget | null;
    currentSearchQuery: string;
    dependencies: BrowserAppDependencies;
    hasGraphData: boolean;
    navigationState: {
        activeDocsView: "cli" | "mcp" | "rules";
        activePage: GraphVisualizationUiPage;
        cliMetaText: string;
        mcpMetaText: string;
        rulesMetaText: string;
    };
    renderLegend: () => void;
    renderProjectConfigurationCatalog: () => void;
    syncUrlState: () => void;
    updateDocsViewState: () => void;
    updateGraph: () => void;
    wireLiveReloadControls: () => void;
    wireOpenProjectButton: () => void;
    wireRegenerateButton: () => void;
    wireViewControls: () => void;
    wirePlaygroundControls: () => void;
}>;

function initializeGraphVisualizationSurface(state: GraphVisualizationSurfaceInitializer): void {
    renderLoadedTargetSummary(state.currentLoadedTarget);
    updateGraphInteractionAvailability(
        state.hasGraphData,
        state.currentLoadedTarget !== null,
        state.dependencies.isServerMode
    );
    renderDocumentationCatalog(state.dependencies, state.updateDocsViewState, state.navigationState);
    state.renderProjectConfigurationCatalog();
    state.renderLegend();
    wirePageNavigation(state.navigationState, state.applyPageState, state.updateDocsViewState, state.syncUrlState);
    state.wireViewControls();
    state.applyLabelModeButtonText();
    state.wireOpenProjectButton();
    state.wireRegenerateButton();
    state.wirePlaygroundControls();
    state.wireLiveReloadControls();
    state.applyPageState();
    state.updateGraph();
    state.applySearchQuery(state.currentSearchQuery, false);
}

/**
 * Bootstrap the graph visualization browser application.
 */
export function bootstrapGraphVisualizationApp(dependencies: BrowserAppDependencies): void {
    const initialUiState = readGraphVisualizationUiStateFromCurrentUrl();
    const graphRuntime = d3;
    const { innerHeight: height, innerWidth: width } = globalThis;
    const svg = graphRuntime.select<SVGSVGElement, unknown>("#graph");
    const jsonView = graphRuntime.select<HTMLElement, unknown>("#json-view");
    const container = graphRuntime.select<SVGGElement, unknown>("#container");
    const tooltip = graphRuntime.select<HTMLElement, unknown>("#tooltip");
    const edgeLineVisualStyleByType = new Map(EDGE_LINE_VISUAL_STYLES.map((style) => [style.type, style]));
    const nodeVisualStyleByKind = new Map(NODE_VISUAL_STYLES.map((style) => [style.kind, style]));
    const edgeTypes = Array.from(new Set(dependencies.data.edges.map((edgeValue) => edgeValue.type)));
    const allNodes = dependencies.data.nodes;
    const allNodeKinds = Array.from(new Set(allNodes.map((nodeValue) => nodeValue.kind)));
    const defaultEnabledNodeKinds = allNodeKinds.filter((kindValue) => !DEFAULT_DISABLED_NODE_KINDS.has(kindValue));
    const resourceTypesPresent = allNodeKinds.filter((kindValue) => GRAPH_RESOURCE_KINDS.has(kindValue));
    const enumTypesPresent = allNodeKinds.filter((kindValue) => kindValue === "enum" || kindValue === "enum_member");
    const otherTypesPresent = allNodeKinds.filter(
        (kindValue) =>
            kindValue !== "resource" &&
            !GRAPH_RESOURCE_KINDS.has(kindValue) &&
            kindValue !== "enum" &&
            kindValue !== "enum_member"
    );

    let currentLoadedTarget = dependencies.loadedTarget;
    const currentProjectConfiguration = dependencies.projectConfigurationCatalog;
    let selectedProjectConfiguration: LoadedProjectConfiguration | null = null;
    let labelMode: "auto" | "off" | "on" = mapUiLabelModeToBrowserLabelMode(initialUiState.labelMode);
    let activeGraphView: "json" | "visual" = initialUiState.activeGraphView;
    const navigationState: {
        activeDocsView: "cli" | "mcp" | "rules";
        activePage: GraphVisualizationUiPage;
        cliMetaText: string;
        mcpMetaText: string;
        rulesMetaText: string;
    } = {
        activeDocsView: initialUiState.activeDocsView,
        activePage: initialUiState.activePage,
        cliMetaText: "",
        mcpMetaText: "",
        rulesMetaText: ""
    };
    let searchQuery = initialUiState.searchQuery;
    let activeFilters = new Set(edgeTypes);
    let activeNodeFilters = new Set(defaultEnabledNodeKinds);
    let activeConfigViewMode: ConfigViewMode = "rendered";
    let activeConfigLintLevelFilter: ConfigLintLevelFilter = "all";
    let activeConfigLintRulesetFilter = "all";
    let currentLiveReload = dependencies.liveReload;
    let currentLiveReloadStatus = currentLiveReload?.statusSnapshot ?? null;
    let currentLiveReloadErrorMessage: string | null = null;
    let liveReloadPollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
    let nodesRaw = cloneGraphNodes(allNodes);
    let linksRaw = cloneGraphEdges(dependencies.data.edges);

    if (dependencies.isServerMode) {
        let knownUiRevision: number | null = null;
        globalThis.setInterval(() => {
            void (async () => {
                try {
                    const response = await fetch("/api/ui-revision", { cache: "no-store" });
                    if (!response.ok) {
                        return;
                    }
                    const payload = (await response.json()) as { revision?: unknown };
                    if (typeof payload.revision !== "number") {
                        return;
                    }
                    if (knownUiRevision === null) {
                        knownUiRevision = payload.revision;
                        return;
                    }
                    if (payload.revision !== knownUiRevision) {
                        globalThis.location.reload();
                    }
                } catch {
                    // Ignore transient polling failures (server restart/network hiccups).
                }
            })();
        }, 1500);
    }
    let link: d3.Selection<SVGPathElement, MutableGraphEdgeRecord, SVGGElement, unknown> = container
        .append("g")
        .selectAll<SVGPathElement, MutableGraphEdgeRecord>(".link");
    let nodeGroup: d3.Selection<SVGGElement, MutableGraphNodeRecord, SVGGElement, unknown> = container
        .append("g")
        .selectAll<SVGGElement, MutableGraphNodeRecord>(".node-group");
    let node: d3.Selection<SVGPathElement, MutableGraphNodeRecord, SVGGElement, unknown> =
        nodeGroup.select<SVGPathElement>("path.node");
    let nodeLabels: d3.Selection<SVGTextElement, MutableGraphNodeRecord, SVGGElement, unknown> =
        nodeGroup.select<SVGTextElement>("text");
    const searchHighlightNodeIds = new Set<string>();
    let focusNodeId: string | null = null;
    let pinnedTooltipNodeId: string | null = null;
    let resourceCheckbox: GraphSelectionApi | undefined;
    let enumCheckbox: GraphSelectionApi | undefined;

    const graphIndexes = {
        incomingCount: new Map<string, number>(),
        neighborMap: new Map<string, Set<string>>(),
        outgoingCount: new Map<string, number>()
    };
    const { incomingCount, neighborMap, outgoingCount } = graphIndexes;
    rebuildGraphIndexes(linksRaw, incomingCount, outgoingCount, neighborMap);

    const syncUrlState = (): void => {
        replaceGraphVisualizationUiStateInCurrentUrl(
            createCurrentGraphVisualizationUiStateSnapshot(
                navigationState.activePage,
                navigationState.activeDocsView,
                activeGraphView,
                labelMode,
                searchQuery
            )
        );
    };

    const zoomBehavior: GraphZoomBehavior = graphRuntime
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on("zoom", (eventValue) => {
            const transform = readGraphTransform(eventValue);
            container.attr("transform", transform.transformText);
            applyCurrentLabelMode();
        });
    svg.call(zoomBehavior);

    const simulation: GraphSimulationApi = graphRuntime
        .forceSimulation<MutableGraphNodeRecord>()
        .force(
            "link",
            graphRuntime
                .forceLink<MutableGraphNodeRecord, MutableGraphEdgeRecord>()
                .id((datum) => readNodeIdentifier(datum))
                .distance(50)
        )
        .force("charge", graphRuntime.forceManyBody().strength(-100))
        .force("center", graphRuntime.forceCenter(width / 2, height / 2))
        .force(
            "collide",
            graphRuntime
                .forceCollide<MutableGraphNodeRecord>()
                .radius((datum) => getRadius(readGraphNode(datum), incomingCount, outgoingCount))
                .iterations(2)
        )
        .alphaDecay(0.02)
        .velocityDecay(0.3);

    if (dependencies.data.nodes.length > 2000) {
        console.warn("Large graph detected:", dependencies.data.nodes.length, "nodes. Adjusting rendering parameters.");
    }

    const applyGraphViewMode = (): void => {
        updateGraphViewMode({
            activeFilters,
            activeGraphView,
            activeNodeFilters,
            graphRuntime,
            jsonView,
            linksRaw,
            nodesRaw,
            svg
        });
    };
    const applyPageState = (): void => {
        updatePageState(
            {
                activePage: navigationState.activePage,
                graphRuntime,
                jsonView,
                svg
            },
            applyGraphViewMode
        );
    };

    initializeGraphVisualizationSurface({
        applyLabelModeButtonText,
        applyPageState,
        applySearchQuery,
        currentLoadedTarget,
        currentSearchQuery: searchQuery,
        dependencies,
        hasGraphData: nodesRaw.length > 0,
        navigationState,
        renderLegend,
        renderProjectConfigurationCatalog,
        syncUrlState,
        updateDocsViewState: () => updateDocsViewState(navigationState),
        updateGraph,
        wireLiveReloadControls,
        wireOpenProjectButton,
        wireRegenerateButton,
        wireViewControls,
        wirePlaygroundControls
    });

    globalThis.addEventListener(
        "beforeunload",
        () => {
            stopLiveReloadPolling();
        },
        { once: true }
    );

    tooltip.on("mouseenter", () => tooltip.classed("visible", true));
    tooltip.on("mouseleave", () => {
        if (pinnedTooltipNodeId === null) {
            hideTooltip();
        }
    });
    svg.on("click", clearFocus);

    function wireViewControls(): void {
        const searchInput = document.getElementById("search");
        if (searchInput instanceof HTMLInputElement) {
            searchInput.value = searchQuery;
        }

        const toggleViewButton = document.getElementById("toggle-view");
        if (toggleViewButton instanceof HTMLButtonElement) {
            toggleViewButton.addEventListener("click", () => {
                activeGraphView = activeGraphView === "visual" ? "json" : "visual";
                applyGraphViewMode();
                syncUrlState();
            });
        }

        const toggleLabelsButton = document.getElementById("toggle-labels");
        if (toggleLabelsButton instanceof HTMLButtonElement) {
            toggleLabelsButton.addEventListener("click", () => {
                labelMode = labelMode === "auto" ? "on" : labelMode === "on" ? "off" : "auto";
                applyLabelModeButtonText();
                applyCurrentLabelMode();
                syncUrlState();
            });
        }

        graphRuntime.select("#reset-default").on("click", () => {
            svg.transition().call((selection) => {
                zoomBehavior.transform(selection, graphRuntime.zoomIdentity);
            });
            resetGraphStateToDefaults();
            applyGraphViewMode();
            updateGraph();
            syncUrlState();
        });

        graphRuntime.select("#search").on("input", (eventValue) => {
            const currentTarget = Reflect.get(eventValue as object, "currentTarget");
            if (!(currentTarget instanceof HTMLInputElement)) {
                return;
            }
            applySearchQuery(currentTarget.value, true);
        });
    }

    function applyLabelModeButtonText(): void {
        const toggleLabelsButton = document.getElementById("toggle-labels");
        if (!(toggleLabelsButton instanceof HTMLButtonElement)) {
            return;
        }

        toggleLabelsButton.textContent =
            labelMode === "auto" ? "Labels: Auto" : labelMode === "on" ? "Labels: On" : "Labels: Off";
    }

    function applyCurrentLabelMode(): void {
        const currentTransform = graphRuntime.zoomTransform(svg.node());
        if (labelMode === "on") {
            nodeLabels.style("display", "block");
            return;
        }

        if (labelMode === "off") {
            nodeLabels.style("display", "none");
            return;
        }

        nodeLabels.style("display", currentTransform.k > 0.8 ? "block" : "none");
    }

    function applySearchQuery(nextSearchQuery: string, shouldSyncUrl: boolean): void {
        searchQuery = nextSearchQuery;
        const term = nextSearchQuery.toLowerCase().trim();
        searchHighlightNodeIds.clear();
        focusNodeId = null;
        hideTooltip();

        if (term.length > 0) {
            nodesRaw.forEach((nodeValue) => {
                const pathLabel = readGraphNodePathLabel(nodeValue);
                if (
                    nodeValue.name.toLowerCase().includes(term) ||
                    nodeValue.displayName.toLowerCase().includes(term) ||
                    pathLabel?.toLowerCase().includes(term) === true
                ) {
                    searchHighlightNodeIds.add(nodeValue.id);
                }
            });
        }

        applyHighlights();
        if (shouldSyncUrl) {
            syncUrlState();
        }
    }

    async function loadProjectConfigurationFromFiles(
        files: ReadonlyArray<BrowserFileHandle>
    ): Promise<LoadedProjectConfiguration> {
        const normalizePath = (file: BrowserFileHandle): string =>
            typeof file.webkitRelativePath === "string" && file.webkitRelativePath.length > 0
                ? file.webkitRelativePath
                : file.name;

        const projectFiles = files.map((file) => ({
            basename: normalizePath(file).replace(/^.*[\\/]/u, ""),
            file,
            path: normalizePath(file)
        }));

        const gmloopEntry = projectFiles.find((entry) => entry.basename.toLowerCase() === "gmloop.json");
        let gmloopRawConfig: Readonly<Record<string, unknown>> = {};
        let gmloopConfigPath: string | null = null;
        if (gmloopEntry !== undefined) {
            gmloopConfigPath = gmloopEntry.path;
            try {
                const parsedValue = JSON.parse(await gmloopEntry.file.text());
                if (parsedValue !== null && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
                    gmloopRawConfig = parsedValue as Readonly<Record<string, unknown>>;
                }
            } catch {
                gmloopRawConfig = {};
            }
        }

        const prettierConfigNames = new Set([
            ".prettierrc",
            ".prettierrc.json",
            ".prettierrc.yaml",
            ".prettierrc.yml",
            ".prettierrc.js",
            "prettier.config.js",
            "prettier.config.cjs",
            "prettier.config.mjs"
        ]);
        const eslintConfigNames = new Set([
            ".eslintrc",
            ".eslintrc.json",
            ".eslintrc.yaml",
            ".eslintrc.yml",
            ".eslintrc.js",
            ".eslintrc.cjs",
            ".eslintrc.mjs",
            "eslint.config.js",
            "eslint.config.cjs",
            "eslint.config.mjs"
        ]);

        const readFileContent = async (entry: Readonly<{ file: BrowserFileHandle; path: string }>) => {
            try {
                return await entry.file.text();
            } catch {
                return "";
            }
        };

        const prettierEntries = projectFiles.filter((entry) => prettierConfigNames.has(entry.basename.toLowerCase()));
        const eslintEntries = projectFiles.filter((entry) => eslintConfigNames.has(entry.basename.toLowerCase()));

        return {
            eslint: await Promise.all(
                eslintEntries.map(async (entry) => ({ content: await readFileContent(entry), path: entry.path }))
            ),
            gmloop: {
                configPath: gmloopConfigPath,
                rawConfig: gmloopRawConfig
            },
            prettier: await Promise.all(
                prettierEntries.map(async (entry) => ({ content: await readFileContent(entry), path: entry.path }))
            )
        };
    }

    function renderProjectConfigurationCatalog(): void {
        const configMetaElement = document.getElementById("config-meta");
        const configContentElement = document.getElementById("config-content");
        if (!(configMetaElement instanceof HTMLElement) || !(configContentElement instanceof HTMLElement)) {
            return;
        }

        configContentElement.innerHTML = "";

        if (currentProjectConfiguration === null && selectedProjectConfiguration === null) {
            configMetaElement.textContent = "No project configuration is available for this view.";
            const emptyState = document.createElement("div");
            emptyState.className = "catalog-empty";
            emptyState.textContent = "Load a project to inspect gmloop, lint, format, and refactor configuration.";
            configContentElement.append(emptyState);
            return;
        }

        const effectiveConfiguration =
            selectedProjectConfiguration === null
                ? currentProjectConfiguration
                : {
                      ...(currentProjectConfiguration ?? {
                          format: { entries: [] },
                          githubRepositoryUrl: "https://github.com/SimulatorLife/GMLoop",
                          gmloop: {
                              configPath: null,
                              exists: false,
                              projectRoot: "",
                              rawConfig: {}
                          },
                          lint: { rules: [], rulesets: [], ruleset: null },
                          refactor: { codemods: [] }
                      }),
                      gmloop: {
                          ...(currentProjectConfiguration?.gmloop ?? {
                              configPath: null,
                              exists: false,
                              projectRoot: "",
                              rawConfig: {}
                          }),
                          configPath: selectedProjectConfiguration.gmloop.configPath,
                          rawConfig: selectedProjectConfiguration.gmloop.rawConfig
                      }
                  };

        const gmloopConfig = effectiveConfiguration.gmloop;
        configMetaElement.textContent =
            selectedProjectConfiguration === null
                ? gmloopConfig.exists
                    ? "Loaded project configuration and workspace-owned normalized views for the active project."
                    : "No gmloop.json was found for the active selection. Defaults and registered workspace metadata are shown where available."
                : "Loaded project configuration from the selected project.";

        const summaryPanel = document.createElement("section");
        summaryPanel.className = "config-summary-panel";
        const summaryHeader = document.createElement("div");
        summaryHeader.className = "config-summary-header";
        const summaryTitle = document.createElement("h2");
        summaryTitle.className = "config-summary-title";
        summaryTitle.textContent = "Workspace configuration snapshot";
        summaryHeader.append(summaryTitle);
        const summaryDescription = document.createElement("p");
        summaryDescription.className = "config-summary-description";
        summaryDescription.textContent =
            selectedProjectConfiguration === null
                ? "The Config page combines the active project file, repository context, and the workspace-resolved format, lint, and refactor views."
                : "The Config page combines the selected project file contents with workspace-resolved format, lint, and refactor views.";
        summaryHeader.append(summaryDescription);
        summaryPanel.append(summaryHeader);

        const summaryMetrics = document.createElement("div");
        summaryMetrics.className = "config-summary-metrics";
        summaryMetrics.append(
            createConfigSummaryMetric("gmloop.json", gmloopConfig.exists ? "Loaded" : "Defaults", "accent"),
            createConfigSummaryMetric("Project Root", gmloopConfig.projectRoot || "(none)")
        );
        summaryPanel.append(summaryMetrics);
        configContentElement.append(summaryPanel);

        const configToggleRow = document.createElement("div");
        configToggleRow.className = "config-view-selector view-selector";
        configToggleRow.setAttribute("role", "group");
        configToggleRow.setAttribute("aria-label", "Configuration view selector");

        const renderedButton = document.createElement("button");
        renderedButton.id = "config-view-rendered";
        renderedButton.type = "button";
        renderedButton.className = activeConfigViewMode === "rendered" ? "view-option active" : "view-option";
        renderedButton.setAttribute("aria-pressed", activeConfigViewMode === "rendered" ? "true" : "false");
        renderedButton.textContent = "Rendered";
        renderedButton.addEventListener("click", () => {
            activeConfigViewMode = "rendered";
            renderProjectConfigurationCatalog();
        });
        configToggleRow.append(renderedButton);

        const rawButton = document.createElement("button");
        rawButton.id = "config-view-raw";
        rawButton.type = "button";
        rawButton.className = activeConfigViewMode === "raw" ? "view-option active" : "view-option";
        rawButton.setAttribute("aria-pressed", activeConfigViewMode === "raw" ? "true" : "false");
        rawButton.textContent = "Raw gmloop.json";
        rawButton.addEventListener("click", () => {
            activeConfigViewMode = "raw";
            renderProjectConfigurationCatalog();
        });
        configToggleRow.append(rawButton);
        configContentElement.append(configToggleRow);

        if (activeConfigViewMode === "raw") {
            const gmloopRaw = document.createElement("pre");
            gmloopRaw.className = "config-raw";
            gmloopRaw.textContent = JSON.stringify(gmloopConfig.rawConfig || {}, null, 2);
            configContentElement.append(
                createConfigCard("gmloop.json", gmloopConfig.configPath ?? "No gmloop.json file is currently loaded.", [
                    gmloopRaw
                ])
            );
            return;
        }

        const formatList = document.createElement("ul");
        formatList.className = CONFIG_LIST_CLASS_NAME;
        effectiveConfiguration.format.entries.forEach((entry) => {
            formatList.append(
                createConfigItem(entry.name, entry.description, JSON.stringify(entry.value, null, 2), [entry.source])
            );
        });
        const resolvedWorkspaceGrid = document.createElement("div");
        resolvedWorkspaceGrid.className = "config-grid config-grid-wide";
        resolvedWorkspaceGrid.append(
            createConfigCard(
                `Format (${String(effectiveConfiguration.format.entries.length)})`,
                "Formatter-owned options sourced from the format workspace.",
                [formatList]
            )
        );

        const lintRulesets = effectiveConfiguration.lint.rulesets ?? [];
        const selectedRuleset = lintRulesets.find((ruleset) => ruleset.name === activeConfigLintRulesetFilter);
        const rulesetRuleIds =
            activeConfigLintRulesetFilter === "all" || selectedRuleset === undefined
                ? null
                : new Set(selectedRuleset.ruleIds);
        const filteredLintRules = effectiveConfiguration.lint.rules.filter((entry) => {
            const matchesRuleset = rulesetRuleIds === null || rulesetRuleIds.has(entry.ruleId);
            const matchesLevel = activeConfigLintLevelFilter === "all" || entry.level === activeConfigLintLevelFilter;
            return matchesRuleset && matchesLevel;
        });

        const lintFilterRow = document.createElement("div");
        lintFilterRow.className = "config-filter-row";
        lintFilterRow.append(
            createConfigFilterField(
                "Ruleset",
                "Filter the lint list to rules included by one ruleset. All rules is the default catalog view.",
                [
                    { label: "All Rules", value: "all" },
                    ...lintRulesets.map((ruleset) => ({ label: ruleset.name, value: ruleset.name }))
                ],
                activeConfigLintRulesetFilter,
                (value) => {
                    activeConfigLintRulesetFilter = value.length > 0 ? value : "all";
                    renderProjectConfigurationCatalog();
                }
            ),
            createConfigFilterField(
                "Level",
                "Filter by the effective lint severity after gmloop.json ruleset and rule overrides are applied.",
                [
                    { label: "All Levels", value: "all" },
                    { label: "Error", value: "error" },
                    { label: "Warn", value: "warn" },
                    { label: "Off", value: "off" }
                ],
                activeConfigLintLevelFilter,
                (value) => {
                    if (value === "all" || value === "error" || value === "off" || value === "warn") {
                        activeConfigLintLevelFilter = value;
                        renderProjectConfigurationCatalog();
                    }
                }
            )
        );

        const lintList = document.createElement("ul");
        lintList.className = CONFIG_LIST_CLASS_NAME;
        filteredLintRules.forEach((entry) => {
            const badges: Array<string> = [entry.level];
            if (entry.fixable !== null) {
                badges.push(`fixable:${entry.fixable}`);
            }
            lintList.append(
                createConfigItem(
                    entry.ruleId,
                    entry.description,
                    Object.keys(entry.options).length > 0 ? JSON.stringify(entry.options, null, 2) : "",
                    badges
                )
            );
        });
        if (filteredLintRules.length === 0) {
            const emptyItem = document.createElement("li");
            emptyItem.className = "config-empty";
            emptyItem.textContent = "No lint rules match these filters.";
            lintList.append(emptyItem);
        }
        resolvedWorkspaceGrid.append(
            createConfigCard(
                `Lint (${String(filteredLintRules.length)})`,
                effectiveConfiguration.lint.ruleset === null
                    ? "Resolved lint rules for the active project configuration."
                    : `Resolved lint rules for the active gmloop lintRuleset: ${effectiveConfiguration.lint.ruleset}`,
                [lintFilterRow, lintList]
            )
        );

        const refactorList = document.createElement("ul");
        refactorList.className = CONFIG_LIST_CLASS_NAME;
        effectiveConfiguration.refactor.codemods.forEach((entry) => {
            const badges = [entry.enabled ? "enabled" : "disabled"];
            if (entry.requiresSemanticProjectIndex) {
                badges.push("semantic-index");
            }
            refactorList.append(
                createConfigItem(entry.id, entry.description, JSON.stringify(entry.config, null, 2), badges)
            );
        });
        resolvedWorkspaceGrid.append(
            createConfigCard(
                `Refactor (${String(effectiveConfiguration.refactor.codemods.length)})`,
                "Registered codemods and the active project-level codemod configuration.",
                [refactorList]
            )
        );
        const projectMetadataList = document.createElement("ul");
        projectMetadataList.className = CONFIG_LIST_CLASS_NAME;
        projectMetadataList.append(
            createConfigItem(
                "Config path",
                "Location of the active gmloop configuration file.",
                gmloopConfig.configPath ?? "Not found",
                []
            ),
            createConfigItem(
                "Configuration exists",
                "Whether a gmloop.json file was found for the active project.",
                gmloopConfig.exists ? "Yes" : "No",
                []
            )
        );
        configContentElement.append(
            createConfigSection(
                "Rendered Workspace View",
                "Effective settings used by GMLoop",
                "This view keeps the human-friendly project summary and the normalized format, lint, and refactor settings together.",
                [
                    createConfigCard(
                        "Project Metadata",
                        "Active project root used by graph, lint, format, and refactor workflows.",
                        [projectMetadataList]
                    ),
                    resolvedWorkspaceGrid
                ]
            )
        );
    }

    function renderLegend(): void {
        const legendDiv = graphRuntime.select("#legend");
        legendDiv.html("");
        const nodesSection = legendDiv.append("div").attr("class", "filter-section");
        nodesSection.append("strong").text("Nodes");

        if (resourceTypesPresent.length > 0) {
            resourceCheckbox = createFilterCheckbox(
                nodesSection,
                "filter-resource",
                "Resources",
                NODE_GROUP_FILTER_CATEGORY,
                RESOURCE_GROUP_FILTER_TYPE,
                (checked) => {
                    resourceTypesPresent.forEach((kindValue) => {
                        if (checked) {
                            activeNodeFilters.add(kindValue);
                        } else {
                            activeNodeFilters.delete(kindValue);
                        }
                        graphRuntime.select(`#filter-node-${kindValue}`).property("checked", checked);
                    });
                }
            );
            resourceTypesPresent.forEach((kindValue) => {
                createFilterCheckbox(
                    nodesSection,
                    `filter-node-${kindValue}`,
                    formatLabel(kindValue),
                    "node",
                    kindValue,
                    (checked) => {
                        if (checked) {
                            activeNodeFilters.add(kindValue);
                        } else {
                            activeNodeFilters.delete(kindValue);
                        }
                        const allResourceKindsChecked = resourceTypesPresent.every((resourceKind) =>
                            activeNodeFilters.has(resourceKind)
                        );
                        resourceCheckbox?.property("checked", allResourceKindsChecked);
                        resourceCheckbox?.property(
                            "indeterminate",
                            !allResourceKindsChecked &&
                                resourceTypesPresent.some((resourceKind) => activeNodeFilters.has(resourceKind))
                        );
                    },
                    "sub-filter"
                );
            });
            syncGroupCheckboxState(resourceCheckbox, resourceTypesPresent);
        }

        if (enumTypesPresent.length > 0) {
            enumCheckbox = createFilterCheckbox(
                nodesSection,
                "filter-enum",
                "Enums",
                NODE_GROUP_FILTER_CATEGORY,
                "enum-group",
                (checked) => {
                    enumTypesPresent.forEach((kindValue) => {
                        if (checked) {
                            activeNodeFilters.add(kindValue);
                        } else {
                            activeNodeFilters.delete(kindValue);
                        }
                        graphRuntime.select(`#filter-node-${kindValue}`).property("checked", checked);
                    });
                }
            );
            enumTypesPresent.forEach((kindValue) => {
                createFilterCheckbox(
                    nodesSection,
                    `filter-node-${kindValue}`,
                    formatLabel(kindValue),
                    "node",
                    kindValue,
                    (checked) => {
                        if (checked) {
                            activeNodeFilters.add(kindValue);
                        } else {
                            activeNodeFilters.delete(kindValue);
                        }
                        const allEnumKindsChecked = enumTypesPresent.every((enumKind) =>
                            activeNodeFilters.has(enumKind)
                        );
                        enumCheckbox?.property("checked", allEnumKindsChecked);
                        enumCheckbox?.property(
                            "indeterminate",
                            !allEnumKindsChecked && enumTypesPresent.some((enumKind) => activeNodeFilters.has(enumKind))
                        );
                    },
                    "sub-filter"
                );
            });
            syncGroupCheckboxState(enumCheckbox, enumTypesPresent);
        }

        otherTypesPresent.forEach((kindValue) => {
            createFilterCheckbox(
                nodesSection,
                `filter-node-${kindValue}`,
                formatLabel(kindValue),
                "node",
                kindValue,
                (checked) => {
                    if (checked) {
                        activeNodeFilters.add(kindValue);
                    } else {
                        activeNodeFilters.delete(kindValue);
                    }
                }
            );
        });

        const edgesSection = legendDiv.append("div").attr("class", "filter-section").style("margin-top", "15px");
        edgesSection.append("strong").text("Edges");
        edgeTypes.forEach((edgeType) => {
            createFilterCheckbox(
                edgesSection,
                `filter-edge-${edgeType}`,
                formatLabel(edgeType),
                "edge",
                edgeType,
                (checked) => {
                    if (checked) {
                        activeFilters.add(edgeType);
                    } else {
                        activeFilters.delete(edgeType);
                    }
                }
            );
        });

        updateGraphInteractionAvailability(
            nodesRaw.length > 0,
            currentLoadedTarget !== null,
            dependencies.isServerMode
        );
    }

    function createFilterCheckbox(
        containerSelection: GraphSelectionApi,
        id: string,
        labelText: string,
        category: FilterCategory,
        typeValue: FilterType,
        changeHandler: (checked: boolean) => void,
        customClass = ""
    ): GraphSelectionApi {
        const wrapper = containerSelection.append("label").attr("class", `filter-item ${customClass}`);
        const checkbox = wrapper
            .append("input")
            .attr("type", "checkbox")
            .attr("id", id)
            .property("checked", createInitialFilterCheckedState(category, typeValue))
            .on("change", (eventValue) => {
                const currentTarget = Reflect.get(eventValue as object, "currentTarget");
                if (!(currentTarget instanceof HTMLInputElement)) {
                    return;
                }
                changeHandler(currentTarget.checked);
                updateGraph();
            });

        if (category === "node" || category === NODE_GROUP_FILTER_CATEGORY) {
            const styleKind: GraphVisualizationNodeKind | "default" =
                typeValue === RESOURCE_GROUP_FILTER_TYPE || typeValue === "enum-group"
                    ? "default"
                    : (typeValue as GraphVisualizationNodeKind | "default");
            const color =
                nodeVisualStyleByKind.get(styleKind)?.color ?? nodeVisualStyleByKind.get("default")?.color ?? "#888";
            let shapeHtml = `<span style="color:${color}">&#9679;</span>`;
            if (typeof typeValue === "string" && typeValue.endsWith("_variable")) {
                shapeHtml = `<span style="color:${color}">&#9830;</span>`;
            } else if (
                typeValue === RESOURCE_GROUP_FILTER_TYPE ||
                (typeof typeValue === "string" && GRAPH_RESOURCE_KINDS.has(typeValue as GraphVisualizationNodeKind))
            ) {
                shapeHtml = `<span style="color:${color}">&#9632;</span>`;
            }
            wrapper.append("span").html(`${shapeHtml} ${labelText}`);
        } else {
            const visualStyle =
                typeof typeValue === "string"
                    ? edgeLineVisualStyleByType.get(typeValue as GraphVisualizationEdgeRecord["type"])
                    : undefined;
            const strokeStyle = visualStyle
                ? `border-bottom: ${visualStyle.legendBorderWidth} ${visualStyle.legendBorderStyle} ${visualStyle.color};`
                : "border-bottom: 2px solid #555;";
            wrapper
                .append("span")
                .html(
                    `<span style="display:inline-block; width:12px; margin-right:4px; ${strokeStyle}"></span>${labelText}`
                );
        }

        return checkbox;
    }

    function createInitialFilterCheckedState(category: FilterCategory, typeValue: FilterType): boolean {
        if (category === "edge") {
            return true;
        }
        if (category === NODE_GROUP_FILTER_CATEGORY) {
            return isNodeGroupCheckedByDefault(typeValue);
        }
        return defaultEnabledNodeKinds.includes(typeValue as GraphVisualizationNodeKind);
    }

    function isNodeGroupCheckedByDefault(typeValue: FilterType): boolean {
        if (typeValue === RESOURCE_GROUP_FILTER_TYPE) {
            return (
                resourceTypesPresent.length > 0 &&
                resourceTypesPresent.every((kindValue) => defaultEnabledNodeKinds.includes(kindValue))
            );
        }
        if (typeValue === "enum-group") {
            return (
                enumTypesPresent.length > 0 &&
                enumTypesPresent.every((kindValue) => defaultEnabledNodeKinds.includes(kindValue))
            );
        }
        return defaultEnabledNodeKinds.includes(typeValue as GraphVisualizationNodeKind);
    }

    function syncGroupCheckboxState(
        checkbox: GraphSelectionApi | undefined,
        childKinds: ReadonlyArray<GraphVisualizationNodeKind>
    ): void {
        if (checkbox === undefined || childKinds.length === 0) {
            return;
        }
        const enabledChildCount = childKinds.filter((kindValue) => activeNodeFilters.has(kindValue)).length;
        checkbox.property("checked", enabledChildCount === childKinds.length);
        checkbox.property("indeterminate", enabledChildCount > 0 && enabledChildCount < childKinds.length);
    }

    function resetGraphStateToDefaults(): void {
        nodesRaw = cloneGraphNodes(allNodes);
        linksRaw = cloneGraphEdges(dependencies.data.edges);
        activeFilters = new Set(edgeTypes);
        activeNodeFilters = new Set(defaultEnabledNodeKinds);
        activeGraphView = "visual";
        labelMode = "auto";
        searchQuery = "";
        searchHighlightNodeIds.clear();
        focusNodeId = null;
        pinnedTooltipNodeId = null;
        hideTooltip();
        rebuildGraphIndexes(linksRaw, incomingCount, outgoingCount, neighborMap);

        const searchInput = document.getElementById("search");
        if (searchInput instanceof HTMLInputElement) {
            searchInput.value = "";
        }

        applyLabelModeButtonText();

        graphRuntime.selectAll("#legend input[type='checkbox']").property("indeterminate", false);
        allNodeKinds.forEach((kindValue) => {
            graphRuntime
                .select(`#filter-node-${kindValue}`)
                .property("checked", defaultEnabledNodeKinds.includes(kindValue));
        });
        edgeTypes.forEach((edgeType) => {
            graphRuntime.select(`#filter-edge-${edgeType}`).property("checked", true);
        });
        syncGroupCheckboxState(resourceCheckbox, resourceTypesPresent);
        syncGroupCheckboxState(enumCheckbox, enumTypesPresent);
    }

    function updateGraph(): void {
        const validNodeIds = new Set(
            nodesRaw.filter((nodeValue) => activeNodeFilters.has(nodeValue.kind)).map((nodeValue) => nodeValue.id)
        );
        const filteredLinks = linksRaw.filter((edgeValue) => {
            const sourceId = readEdgeEndpointId(edgeValue.source);
            const targetId = readEdgeEndpointId(edgeValue.target);
            return activeFilters.has(edgeValue.type) && validNodeIds.has(sourceId) && validNodeIds.has(targetId);
        });

        const activeNodeIds = new Set(validNodeIds);
        filteredLinks.forEach((edgeValue) => {
            activeNodeIds.add(readEdgeEndpointId(edgeValue.source));
            activeNodeIds.add(readEdgeEndpointId(edgeValue.target));
        });
        nodesRaw.forEach((nodeValue) => {
            if (searchHighlightNodeIds.has(nodeValue.id) && activeNodeFilters.has(nodeValue.kind)) {
                activeNodeIds.add(nodeValue.id);
            }
        });

        const filteredNodes = nodesRaw.filter(
            (nodeValue) => activeNodeIds.has(nodeValue.id) && activeNodeFilters.has(nodeValue.kind)
        );
        link = link.data(filteredLinks, (datumValue) => {
            const edgeValue = datumValue;
            return `${readEdgeEndpointId(edgeValue.source)}-${readEdgeEndpointId(edgeValue.target)}-${edgeValue.type}`;
        });
        link.exit().remove();
        const linkEnter = link
            .enter()
            .append("path")
            .attr("class", (datumValue) => `link link-${String(Reflect.get(datumValue as object, "type"))}`)
            .attr("marker-end", (datumValue) => {
                const edgeType = String(Reflect.get(datumValue as object, "type"));
                if (edgeType === "calls") {
                    return "url(#arrow-calls)";
                }
                if (edgeType === "inherits") {
                    return "url(#arrow-inherits)";
                }
                if (edgeType === "depends_on") {
                    return "url(#arrow-depends_on)";
                }
                return "";
            });
        link = linkEnter.merge(link);

        nodeGroup = nodeGroup.data(filteredNodes, (datumValue) => String(Reflect.get(datumValue as object, "id")));
        nodeGroup.exit().remove();
        const nodeDragBehavior: GraphDragBehavior = graphRuntime
            .drag<SVGGElement, MutableGraphNodeRecord, MutableGraphNodeRecord>()
            .on("start", (eventValue) => dragStarted(eventValue))
            .on("drag", (eventValue) => dragMoved(eventValue))
            .on("end", (eventValue) => dragEnded(eventValue));

        const nodeEnter = nodeGroup
            .enter()
            .append("g")
            .attr("class", "node-group")
            .call((selection) => {
                selection.call(nodeDragBehavior);
            });

        nodeEnter
            .append("path")
            .attr("class", (datumValue) => {
                const nodeValue = datumValue;
                return `node node-${nodeValue.kind}${nodeValue.graphId === "toolset" ? " toolset" : ""}`;
            })
            .attr("d", (datumValue) => renderNodeShape(datumValue))
            .classed("node", true)
            .classed("toolset", (datumValue) => String(Reflect.get(datumValue as object, "graphId")) === "toolset")
            .on("mouseover", (eventValue, datumValue) => showTooltip(eventValue as TooltipMouseEvent, datumValue))
            .on("mouseout", () => hideTooltipWithDelay())
            .on("click", (eventValue, datumValue) => handleNodeClick(eventValue as MouseEvent, datumValue))
            .on("dblclick", (eventValue, datumValue) => handleNodeDoubleClick(eventValue as MouseEvent, datumValue));

        nodeEnter
            .append("text")
            .attr("dx", 12)
            .attr("dy", ".35em")
            .text((datumValue) => String(Reflect.get(datumValue as object, "displayName")))
            .style("display", "none");

        nodeGroup = nodeEnter.merge(nodeGroup);
        node = nodeGroup.select<SVGPathElement>("path.node");
        nodeLabels = nodeGroup.select<SVGTextElement>("text");
        node.attr("class", (datumValue) => {
            const nodeValue = datumValue;
            const styleKind = nodeVisualStyleByKind.has(nodeValue.kind) ? nodeValue.kind : "default";
            return `node node-${styleKind}${nodeValue.graphId === "toolset" ? " toolset" : ""}`;
        });

        simulation.nodes(filteredNodes).on("tick", ticked);
        const linkForce = simulation.force("link");
        if (linkForce !== undefined && "links" in linkForce) {
            (linkForce as ForceLink<MutableGraphNodeRecord, MutableGraphEdgeRecord>).links(filteredLinks);
        }
        simulation.alpha(0.3).restart();
        applyCurrentLabelMode();
        applyHighlights();
    }

    function renderNodeShape(nodeValue: MutableGraphNodeRecord): string {
        const symbolArea = Math.pow(getRadius(nodeValue, incomingCount, outgoingCount), 2) * Math.PI;
        let symbolType = graphRuntime.symbolCircle;
        if (nodeValue.kind.endsWith("_variable")) {
            symbolType = graphRuntime.symbolDiamond;
        } else if (GRAPH_RESOURCE_KINDS.has(nodeValue.kind)) {
            symbolType = graphRuntime.symbolSquare;
        }
        return graphRuntime.symbol().type(symbolType).size(symbolArea)() ?? "";
    }

    function ticked(): void {
        link.attr("d", (datumValue) => {
            const edgeValue = datumValue;
            const sourceNode = edgeValue.source as MutableGraphNodeRecord;
            const targetNode = edgeValue.target as MutableGraphNodeRecord;
            const dx = targetNode.x - sourceNode.x;
            const dy = targetNode.y - sourceNode.y;
            if (edgeValue.type === "references" || edgeValue.type === "contains") {
                const radius = Math.hypot(dx, dy);
                return `M${sourceNode.x},${sourceNode.y}A${radius},${radius} 0 0,1 ${targetNode.x},${targetNode.y}`;
            }
            return `M${sourceNode.x},${sourceNode.y}L${targetNode.x},${targetNode.y}`;
        });
        nodeGroup.attr("transform", (datumValue) => {
            const nodeValue = datumValue;
            return `translate(${nodeValue.x},${nodeValue.y})`;
        });
    }

    function dragStarted(eventValue: D3DragEvent<SVGGElement, MutableGraphNodeRecord, MutableGraphNodeRecord>): void {
        const nodeValue = eventValue.subject;
        const isActive = eventValue.active;
        if (!isActive) {
            simulation.alphaTarget(0.3).restart();
        }
        nodeValue.fx = nodeValue.x;
        nodeValue.fy = nodeValue.y;
    }

    function dragEnded(eventValue: D3DragEvent<SVGGElement, MutableGraphNodeRecord, MutableGraphNodeRecord>): void {
        const isActive = eventValue.active;
        if (!isActive) {
            simulation.alphaTarget(0);
        }
    }

    function renderTooltip(eventValue: TooltipMouseEvent, nodeValue: MutableGraphNodeRecord): void {
        const incomingConnections = incomingCount.get(nodeValue.id) ?? 0;
        const outgoingConnections = outgoingCount.get(nodeValue.id) ?? 0;
        const summaryText =
            nodeValue.summary.length > 200 ? `${nodeValue.summary.slice(0, 197)}...` : nodeValue.summary;

        tooltip
            .html("")
            .style("left", "0px")
            .style("top", "0px")
            .style("visibility", "hidden")
            .classed("visible", true);
        tooltip.append("h3").text(nodeValue.displayName);

        const details = tooltip.append("div");
        details.append("strong").text("Kind:");
        details.append("span").text(` ${nodeValue.kind} | `);
        details.append("strong").text("Graph:");
        details.append("span").text(` ${nodeValue.graphId}`);

        const pathLabel = readGraphNodePathLabel(nodeValue);
        if (pathLabel !== null) {
            const pathDetails = tooltip.append("div");
            pathDetails.append("strong").text("Path:");
            pathDetails.append("span").text(` ${pathLabel}`);
        }

        const connections = tooltip.append("div");
        connections.append("strong").text("Connections:");
        connections.append("span").text(` ${String(incomingConnections)} in, ${String(outgoingConnections)} out`);
        tooltip.append("p").text(summaryText);
        positionTooltip(eventValue);
        tooltip.style("visibility", "visible");
    }

    function positionTooltip(eventValue: TooltipMouseEvent): void {
        const tooltipElement = tooltip.node();
        if (!(tooltipElement instanceof HTMLElement)) {
            return;
        }

        const margin = 12;
        const offset = 15;
        const tooltipBounds = tooltipElement.getBoundingClientRect();
        let left = eventValue.pageX + offset;
        let top = eventValue.pageY + offset;
        const maxLeft = window.scrollX + window.innerWidth - tooltipBounds.width - margin;
        const maxTop = window.scrollY + window.innerHeight - tooltipBounds.height - margin;
        if (left > maxLeft) {
            left = Math.max(window.scrollX + margin, eventValue.pageX - tooltipBounds.width - offset);
        }
        if (top > maxTop) {
            top = Math.max(window.scrollY + margin, eventValue.pageY - tooltipBounds.height - offset);
        }
        tooltip.style("left", `${left}px`).style("top", `${top}px`);
    }

    function showTooltip(eventValue: TooltipMouseEvent, nodeValue: MutableGraphNodeRecord): void {
        if (pinnedTooltipNodeId !== null && pinnedTooltipNodeId !== nodeValue.id) {
            return;
        }
        renderTooltip(eventValue, nodeValue);
    }

    function hideTooltip(): void {
        pinnedTooltipNodeId = null;
        tooltip.classed("visible", false).style("visibility", "hidden");
    }

    function hideTooltipWithDelay(): void {
        globalThis.setTimeout(() => {
            const tooltipElement = tooltip.node();
            if (
                pinnedTooltipNodeId === null &&
                tooltipElement instanceof Element &&
                !tooltipElement.matches(":hover")
            ) {
                hideTooltip();
            }
        }, 120);
    }

    function handleNodeClick(eventValue: MouseEvent, nodeValue: MutableGraphNodeRecord): void {
        eventValue.stopPropagation();
        focusNodeId = nodeValue.id;
        pinnedTooltipNodeId = nodeValue.id;
        renderTooltip(eventValue as TooltipMouseEvent, nodeValue);
        applyHighlights();
    }

    function handleNodeDoubleClick(eventValue: MouseEvent, nodeValue: MutableGraphNodeRecord): void {
        eventValue.stopPropagation();
        if (nodeValue.fx === null) {
            nodeValue.fx = nodeValue.x;
            nodeValue.fy = nodeValue.y;
            graphRuntime
                .select(eventValue.currentTarget instanceof Element ? eventValue.currentTarget : null)
                .style("stroke", "#000")
                .style("stroke-width", "3px");
            return;
        }
        nodeValue.fx = null;
        nodeValue.fy = null;
        graphRuntime
            .select(eventValue.currentTarget instanceof Element ? eventValue.currentTarget : null)
            .style("stroke", null)
            .style("stroke-width", null);
    }

    function clearFocus(): void {
        focusNodeId = null;
        hideTooltip();
        searchHighlightNodeIds.clear();
        searchQuery = "";
        const searchInput = document.getElementById("search");
        if (searchInput instanceof HTMLInputElement) {
            searchInput.value = "";
        }
        applyHighlights();
        syncUrlState();
    }

    function applyHighlights(): void {
        const isSearchActive = searchHighlightNodeIds.size > 0;
        const isFocusActive = focusNodeId !== null;
        const isAnyHighlightActive = isSearchActive || isFocusActive;
        if (!isAnyHighlightActive) {
            nodeGroup.classed("dimmed", false);
            node.classed("highlighted", false);
            link.classed("dimmed", false);
            return;
        }

        const highlightIds = new Set<string>();
        searchHighlightNodeIds.forEach((nodeId) => highlightIds.add(nodeId));
        if (focusNodeId !== null) {
            highlightIds.add(focusNodeId);
            neighborMap.get(focusNodeId)?.forEach((neighborId) => highlightIds.add(neighborId));
        }

        nodeGroup.classed("dimmed", (datumValue) => !highlightIds.has(String(Reflect.get(datumValue as object, "id"))));
        node.classed("highlighted", (datumValue) => {
            const nodeId = String(Reflect.get(datumValue as object, "id"));
            return (isFocusActive && nodeId === focusNodeId) || (isSearchActive && searchHighlightNodeIds.has(nodeId));
        });
        link.classed("dimmed", (datumValue) => {
            const edgeValue = datumValue;
            const sourceId = readEdgeEndpointId(edgeValue.source);
            const targetId = readEdgeEndpointId(edgeValue.target);
            if (focusNodeId !== null) {
                return sourceId !== focusNodeId && targetId !== focusNodeId;
            }
            return !highlightIds.has(sourceId) || !highlightIds.has(targetId);
        });
    }

    function stopLiveReloadPolling(): void {
        if (liveReloadPollTimer !== null) {
            globalThis.clearInterval(liveReloadPollTimer);
            liveReloadPollTimer = null;
        }
    }

    async function pollLiveReloadStatusOnce(): Promise<void> {
        const statusUrl = currentLiveReload?.endpoints.statusUrl ?? null;
        if (statusUrl === null) {
            currentLiveReloadStatus = null;
            currentLiveReloadErrorMessage = null;
            renderLiveReloadPanel();
            return;
        }

        try {
            const response = await fetch(statusUrl, {
                headers: { Accept: "application/json" }
            });
            if (!response.ok) {
                throw new Error(`Status request failed with HTTP ${String(response.status)}`);
            }

            const payload = await response.json();
            const snapshot = normalizeLiveReloadStatusSnapshot(payload, true);
            if (snapshot === null) {
                throw new Error("Status response did not match the expected live-reload snapshot shape.");
            }

            currentLiveReloadStatus = snapshot;
            currentLiveReloadErrorMessage = null;
        } catch (error) {
            currentLiveReloadErrorMessage = Core.getErrorMessage(error, {
                fallback: "Failed to refresh live-reload status."
            });
        }

        renderLiveReloadPanel();
    }

    function restartLiveReloadPolling(): void {
        stopLiveReloadPolling();

        const statusUrl = currentLiveReload?.endpoints.statusUrl ?? null;
        if (statusUrl === null) {
            renderLiveReloadPanel();
            return;
        }

        void pollLiveReloadStatusOnce();
        const pollIntervalMs = Math.max(
            currentLiveReload?.pollIntervalMs ?? DEFAULT_LIVE_RELOAD_POLL_INTERVAL_MS,
            MIN_LIVE_RELOAD_POLL_INTERVAL_MS
        );
        liveReloadPollTimer = globalThis.setInterval(() => {
            void pollLiveReloadStatusOnce();
        }, pollIntervalMs);
    }

    async function startLiveReloadFromHost(): Promise<void> {
        if (!dependencies.isServerMode) {
            return;
        }

        const startButton = document.getElementById("start-live-reload");
        if (!(startButton instanceof HTMLButtonElement)) {
            return;
        }

        startButton.disabled = true;
        startButton.textContent = "Starting...";

        try {
            const response = await fetch("/api/live-reload/start", {
                method: "POST"
            });
            const responsePayload = (await response.json()) as Readonly<{ error?: string; liveReload?: unknown }>;
            if (!response.ok) {
                throw new Error(
                    typeof responsePayload.error === "string" ? responsePayload.error : "Failed to start live reload."
                );
            }

            if (!isUnknownRecord(responsePayload.liveReload)) {
                throw new Error("Live-reload start response did not include endpoint configuration.");
            }

            const liveReloadRecord = responsePayload.liveReload;
            const endpointRecord = isUnknownRecord(liveReloadRecord.endpoints) ? liveReloadRecord.endpoints : null;
            currentLiveReload = {
                endpoints: {
                    runtimeUrl: endpointRecord ? readString(endpointRecord, "runtimeUrl") : null,
                    statusUrl: endpointRecord ? readString(endpointRecord, "statusUrl") : null,
                    websocketUrl: endpointRecord ? readString(endpointRecord, "websocketUrl") : null
                },
                pollIntervalMs: readNumber(liveReloadRecord, "pollIntervalMs") ?? DEFAULT_LIVE_RELOAD_POLL_INTERVAL_MS,
                runtimeHealth: null as GraphVisualizationLiveReloadRuntimeHealth | null,
                statusSnapshot:
                    normalizeLiveReloadStatusSnapshot(
                        isUnknownRecord(liveReloadRecord.statusSnapshot) ? liveReloadRecord.statusSnapshot : null,
                        true
                    ) ?? null
            };
            currentLiveReloadStatus = currentLiveReload.statusSnapshot;
            currentLiveReloadErrorMessage = null;
            renderLiveReloadPanel();
            restartLiveReloadPolling();
        } catch (error) {
            currentLiveReloadErrorMessage = Core.getErrorMessage(error, {
                fallback: "Failed to start live reload."
            });
            renderLiveReloadPanel();
        } finally {
            const currentStartButton = document.getElementById("start-live-reload");
            if (currentStartButton instanceof HTMLButtonElement) {
                currentStartButton.disabled = false;
                currentStartButton.textContent =
                    currentLiveReload?.endpoints.statusUrl === null || currentLiveReload === null
                        ? "Start Live Reload"
                        : "Restart Live Reload";
            }
        }
    }

    function renderLiveReloadPanel(): void {
        const metaElement = document.getElementById("live-reload-meta");
        const contentElement = document.getElementById("live-reload-content");
        const refreshButton = document.getElementById("refresh-live-reload");
        const startButton = document.getElementById("start-live-reload");

        if (
            !(metaElement instanceof HTMLElement) ||
            !(contentElement instanceof HTMLElement) ||
            !(refreshButton instanceof HTMLButtonElement) ||
            !(startButton instanceof HTMLButtonElement)
        ) {
            return;
        }

        const endpoints = currentLiveReload?.endpoints ?? null;
        const status = currentLiveReloadStatus;
        const watcherStatus = status?.watcherStatus ?? (endpoints?.statusUrl ? "offline" : "inactive");
        const watcherStatusLabel =
            watcherStatus === "running"
                ? "Running"
                : watcherStatus === "scanning"
                  ? "Scanning"
                  : watcherStatus === "offline"
                    ? "Offline"
                    : watcherStatus === "error"
                      ? "Error"
                      : "Inactive";

        metaElement.innerHTML =
            endpoints === null
                ? "Start live reload to prepare the HTML5 runtime wrapper, launch the watcher, and expose patch status for the active project."
                : `Status <code>${escapeHtmlText(endpoints.statusUrl ?? "not configured")}</code> • WebSocket <code>${escapeHtmlText(endpoints.websocketUrl ?? "not configured")}</code>`;

        refreshButton.disabled = endpoints?.statusUrl === null || endpoints === null;
        startButton.disabled = dependencies.isServerMode === false || currentLoadedTarget === null;
        startButton.textContent =
            endpoints?.statusUrl === null || endpoints === null ? "Start Live Reload" : "Restart Live Reload";
        startButton.style.display = dependencies.isServerMode ? "" : "none";

        const recentPatchesMarkup =
            status && status.recentPatches.length > 0
                ? `<ul class="live-reload-event-list">${status.recentPatches
                      .map(
                          (patch) =>
                              `<li><strong>${escapeHtmlText(patch.filePath)}</strong><span>${escapeHtmlText(
                                  `${patch.id} • ${formatLiveReloadTimestamp(patch.timestamp)} • ${formatLiveReloadDurationMs(
                                      patch.hotReloadLatencyMs
                                  )}`
                              )}</span></li>`
                      )
                      .join("")}</ul>`
                : `<p class="catalog-empty">No patches have been broadcast yet.</p>`;
        const recentErrorsMarkup =
            status && status.recentErrors.length > 0
                ? `<ul class="live-reload-event-list">${status.recentErrors
                      .map(
                          (entry) =>
                              `<li class="live-reload-error-item"><strong>${escapeHtmlText(
                                  entry.filePath
                              )}</strong><span>${escapeHtmlText(
                                  `${formatLiveReloadTimestamp(entry.timestamp)} • ${entry.error}`
                              )}</span></li>`
                      )
                      .join("")}</ul>`
                : `<p class="catalog-empty">No hot-reload errors reported.</p>`;
        const runtimeHealthMarkup =
            currentLiveReload?.runtimeHealth === null || currentLiveReload?.runtimeHealth === undefined
                ? `<p class="catalog-empty">Runtime-wrapper diagnostics are not available from the host.</p>`
                : `<dl class="live-reload-health-list">
                      <div><dt>Runtime Status</dt><dd>${escapeHtmlText(currentLiveReload.runtimeHealth.runtimeStatus)}</dd></div>
                      <div><dt>Registry Version</dt><dd>${String(currentLiveReload.runtimeHealth.registryVersion)}</dd></div>
                      <div><dt>Scripts / Events / Closures</dt><dd>${String(currentLiveReload.runtimeHealth.scriptCount)} / ${String(currentLiveReload.runtimeHealth.eventCount)} / ${String(currentLiveReload.runtimeHealth.closureCount)}</dd></div>
                      <div><dt>Patch Queue Depth</dt><dd>${String(currentLiveReload.runtimeHealth.patchQueueDepth)}</dd></div>
                      <div><dt>Applied / Failed</dt><dd>${String(currentLiveReload.runtimeHealth.appliedPatches)} / ${String(currentLiveReload.runtimeHealth.failedPatches)}</dd></div>
                  </dl>`;
        const errorBannerMarkup =
            currentLiveReloadErrorMessage === null
                ? ""
                : `<div class="catalog-card live-reload-panel-card" role="alert"><h3>Refresh Status</h3><p>${escapeHtmlText(currentLiveReloadErrorMessage)}</p></div>`;

        contentElement.innerHTML = `
            ${errorBannerMarkup}
            <div class="catalog-card live-reload-panel-card">
              <h3>Pipeline Overview</h3>
              <ol class="live-reload-pipeline" aria-label="Live reload pipeline">
                <li><span class="live-reload-pipeline-node">File Watcher</span></li>
                <li><span class="live-reload-pipeline-node">Transpiler</span></li>
                <li><span class="live-reload-pipeline-node">WebSocket Server</span></li>
                <li><span class="live-reload-pipeline-node">Runtime Wrapper</span></li>
                <li><span class="live-reload-pipeline-node">Game Runtime</span></li>
              </ol>
            </div>
            <div class="live-reload-grid">
              <div class="catalog-card live-reload-panel-card">
                <h3>Watcher</h3>
                <span class="live-reload-status-chip ${watcherStatus}"><span class="live-reload-status-dot" aria-hidden="true"></span>${watcherStatusLabel}</span>
                <p>${status ? `Recent scan uptime ${escapeHtmlText(formatLiveReloadUptime(status.uptimeMs))}.` : "No watcher status has been received yet."}</p>
              </div>
              <div class="catalog-card live-reload-panel-card">
                <h3>Patch Stream</h3>
                <strong class="live-reload-metric-value">${formatLiveReloadInteger(status?.websocketClients ?? null)}</strong>
                <p>Connected WebSocket clients.</p>
                <code>${escapeHtmlText(endpoints?.websocketUrl ?? "No WebSocket URL configured")}</code>
              </div>
              <div class="catalog-card live-reload-panel-card">
                <h3>Runtime</h3>
                <p>${endpoints?.runtimeUrl ? "Game runtime endpoint is configured." : "No runtime endpoint configured."}</p>
                <code>${escapeHtmlText(endpoints?.runtimeUrl ?? "Runtime URL unavailable")}</code>
              </div>
            </div>
            <div class="live-reload-metric-grid">
              <div class="catalog-card live-reload-metric-card"><h3>Total Patches</h3><strong class="live-reload-metric-value">${formatLiveReloadInteger(status?.totalPatchCount ?? null)}</strong><p>Cumulative patches broadcast by the watcher.</p></div>
              <div class="catalog-card live-reload-metric-card"><h3>Retained History</h3><strong class="live-reload-metric-value">${status ? `${formatLiveReloadInteger(status.patchHistorySize)} / ${formatLiveReloadInteger(status.maxPatchHistory)}` : "n/a / n/a"}</strong><p>Bounded patch history currently retained by the status server.</p></div>
              <div class="catalog-card live-reload-metric-card"><h3>Average Latency</h3><strong class="live-reload-metric-value">${formatLiveReloadDurationMs(status?.avgHotReloadLatencyMs ?? null)}</strong><p>Mean file-change to broadcast latency for the current metrics window.</p></div>
              <div class="catalog-card live-reload-metric-card"><h3>P95 Latency</h3><strong class="live-reload-metric-value">${formatLiveReloadDurationMs(status?.p95HotReloadLatencyMs ?? null)}</strong><p>95th percentile hot-reload latency for recent patches.</p></div>
            </div>
            <div class="live-reload-grid">
              <div class="catalog-card live-reload-panel-card">
                <h3>Recent Patches</h3>
                ${recentPatchesMarkup}
              </div>
              <div class="catalog-card live-reload-panel-card">
                <h3>Recent Errors</h3>
                ${recentErrorsMarkup}
              </div>
              <div class="catalog-card live-reload-panel-card">
                <h3>Runtime Health</h3>
                ${runtimeHealthMarkup}
              </div>
            </div>`;
    }

    function wireLiveReloadControls(): void {
        const refreshButton = document.getElementById("refresh-live-reload");
        const startButton = document.getElementById("start-live-reload");
        if (!(refreshButton instanceof HTMLButtonElement) || !(startButton instanceof HTMLButtonElement)) {
            return;
        }

        refreshButton.addEventListener("click", () => {
            void pollLiveReloadStatusOnce();
        });
        startButton.addEventListener("click", () => {
            void startLiveReloadFromHost();
        });
        renderLiveReloadPanel();
        restartLiveReloadPolling();
    }

    function wireOpenProjectButton(): void {
        const openProjectButton = graphRuntime.select("#open-project");
        if (openProjectButton.empty()) {
            return;
        }
        openProjectButton.on("click", () => {
            void (async () => {
                const button = graphRuntime.select("#open-project");
                button.attr("disabled", "true").html(OPENING_PROJECT_BUTTON_LABEL);
                try {
                    if (dependencies.isServerMode) {
                        const openResponse = await fetch("/api/open", {
                            method: "POST"
                        });
                        if (!openResponse.ok) {
                            const responseText = await openResponse.text();
                            throw new Error(responseText || "Server rejected project load request.");
                        }
                        const responsePayload = (await openResponse.json()) as Readonly<{ changed?: boolean }>;
                        if (responsePayload.changed === true) {
                            globalThis.location.reload();
                            return;
                        }
                        button.attr("disabled", null).html(OPEN_PROJECT_BUTTON_LABEL);
                        return;
                    }

                    let selectedFiles: ReadonlyArray<BrowserFileHandle> | null = null;
                    try {
                        selectedFiles = await dependencies.directoryOpen({ recursive: true });
                    } catch (error) {
                        if (readErrorName(error) === "AbortError") {
                            button.attr("disabled", null).html(OPEN_PROJECT_BUTTON_LABEL);
                            return;
                        }
                        console.warn("Directory picker failed, falling back to file picker:", error);
                    }

                    if (selectedFiles === null || selectedFiles.length === 0) {
                        const fileSelection = await dependencies.fileOpen({
                            description: "GameMaker project files and folders",
                            extensions: [".gml", ".yyp", ".json"],
                            multiple: true
                        });
                        selectedFiles = Array.isArray(fileSelection) ? fileSelection : [fileSelection];
                    }

                    if (selectedFiles.length === 0) {
                        button.attr("disabled", null).html(OPEN_PROJECT_BUTTON_LABEL);
                        return;
                    }

                    const selectedPaths = selectedFiles.map((file) =>
                        typeof file.webkitRelativePath === "string" && file.webkitRelativePath.length > 0
                            ? file.webkitRelativePath
                            : file.name
                    );
                    const activePath = selectedPaths[0] ?? "selected items";
                    currentLoadedTarget = Object.freeze({
                        activePath,
                        projectRoot: activePath,
                        selectedPaths,
                        source: "finder-open"
                    });
                    selectedProjectConfiguration = await loadProjectConfigurationFromFiles(selectedFiles);
                    renderLoadedTargetSummary(currentLoadedTarget);
                    updateGraphInteractionAvailability(
                        nodesRaw.length > 0,
                        currentLoadedTarget !== null,
                        dependencies.isServerMode
                    );
                    renderProjectConfigurationCatalog();
                    button.attr("disabled", null).html(OPEN_PROJECT_BUTTON_LABEL);
                } catch (error) {
                    console.error("Open project failed:", error);
                    button
                        .attr("disabled", null)
                        .html('<span class="button-content"><span class="button-label">Error</span></span>');
                }
            })();
        });
    }

    function wireRegenerateButton(): void {
        if (!dependencies.isServerMode) {
            return;
        }
        graphRuntime.select("#regenerate").on("click", () => {
            void (async () => {
                const button = graphRuntime.select("#regenerate");
                button.attr("disabled", "true").html(REGENERATING_BUTTON_LABEL);
                try {
                    const response = await fetch("/api/reindex", { method: "POST" });
                    if (response.ok) {
                        const payload = (await response.json()) as Readonly<{ changed?: boolean }>;
                        if (payload.changed === true) {
                            globalThis.location.reload();
                            return;
                        }
                        button.attr("disabled", null).html(REGENERATE_BUTTON_LABEL);
                        return;
                    }
                    const responseText = await response.text();
                    console.error("Reindex failed", responseText);
                    button
                        .attr("disabled", null)
                        .html('<span class="button-content"><span class="button-label">Failed</span></span>');
                } catch (error) {
                    console.error(error);
                    button
                        .attr("disabled", null)
                        .html('<span class="button-content"><span class="button-label">Error</span></span>');
                }
            })();
        });
    }

    function wirePlaygroundControls(): void {
        type PlaygroundFormatOptionEntry = Readonly<{ description: string; name: string }>;
        type PlaygroundLintRuleEntry = Readonly<{ description: string; ruleId: string }>;
        type PlaygroundCodemodEntry = Readonly<{ description: string; id: string }>;

        const input = document.getElementById("playground-input") as HTMLTextAreaElement | null;
        const output = document.getElementById("playground-output");
        const outputTitle = document.getElementById("playground-output-title");
        const ruleToolbar = document.getElementById("playground-rule-toolbar");
        const patchTranspileBtn = document.getElementById("toggle-transpile-patch");
        const expressionTranspileBtn = document.getElementById("toggle-transpile-expression");
        const codeViewBtn = document.getElementById("view-mode-code");
        const astViewBtn = document.getElementById("view-mode-ast");

        if (
            !input ||
            !output ||
            !outputTitle ||
            !ruleToolbar ||
            !patchTranspileBtn ||
            !expressionTranspileBtn ||
            !codeViewBtn ||
            !astViewBtn
        ) {
            return;
        }

        let transpileMode: "none" | "patch" | "expression" = "none";
        let viewMode: "code" | "ast" = "code";
        let lastAst = "{}";
        let lastOutput = "";
        let debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
        const enabledFormatOptions = new Map<string, boolean>();
        const enabledLintRules = new Map<string, boolean>();
        const enabledCodemods = new Map<string, boolean>();
        let showFormatDetails = false;
        let showLintDetails = false;
        let showCodemodDetails = false;
        let formatSearchQuery = "";
        let lintSearchQuery = "";
        let codemodSearchQuery = "";

        const workspaceRules = dependencies.documentationCatalogs?.workspaceRules;
        const configuredFormatEntries = currentProjectConfiguration?.format.entries;
        const formatOptions: ReadonlyArray<PlaygroundFormatOptionEntry> =
            configuredFormatEntries && configuredFormatEntries.length > 0
                ? configuredFormatEntries.map((entry) => ({ description: entry.description, name: entry.name }))
                : (workspaceRules?.formatOptions ?? []).map((entry) => ({
                      description: entry.description,
                      name: entry.name
                  }));
        const lintRules: ReadonlyArray<PlaygroundLintRuleEntry> =
            currentProjectConfiguration?.lint.rules && currentProjectConfiguration.lint.rules.length > 0
                ? currentProjectConfiguration.lint.rules
                : (workspaceRules?.lintRules ?? []);
        const codemods: ReadonlyArray<PlaygroundCodemodEntry> =
            currentProjectConfiguration?.refactor.codemods && currentProjectConfiguration.refactor.codemods.length > 0
                ? currentProjectConfiguration.refactor.codemods
                : (workspaceRules?.refactorCodemods ?? []);

        function renderPlaygroundRuleDetails(): void {
            ruleToolbar.replaceChildren();

            const hasAnyEntries = formatOptions.length > 0 || lintRules.length > 0 || codemods.length > 0;
            if (!hasAnyEntries) {
                return;
            }

            const ruleDetailsRoot = document.createElement("div");
            ruleDetailsRoot.className = "rule-details";

            const createDetailSection = (parameters: {
                count: number;
                entries: ReadonlyArray<{
                    description: string;
                    key: string;
                    selected: boolean;
                    onToggleEntry: () => void;
                }>;
                expanded: boolean;
                label: string;
                onToggleExpanded: () => void;
                searchQuery: string;
                selectedCount: number;
                setAllEntriesSelected: (selected: boolean) => void;
                setSearchQuery: (value: string) => void;
            }): HTMLElement => {
                const section = document.createElement("div");
                section.className = "rule-details-section";

                const headerButton = document.createElement("button");
                headerButton.type = "button";
                headerButton.className = `rule-details-header ${parameters.expanded ? "expanded" : ""}`;
                headerButton.addEventListener("click", () => {
                    parameters.onToggleExpanded();
                    renderPlaygroundRuleDetails();
                });

                const icon = document.createElement("span");
                icon.className = "rule-details-header-icon";
                icon.textContent = parameters.expanded ? "▾" : "▸";
                const headerLabel = document.createElement("span");
                headerLabel.className = "rule-details-header-label";
                headerLabel.textContent = parameters.label;
                const headerCount = document.createElement("span");
                headerCount.className = "rule-details-count";
                headerCount.textContent = `${String(parameters.selectedCount)}/${String(parameters.count)} enabled`;

                headerButton.append(icon, headerLabel, headerCount);
                section.append(headerButton);

                if (!parameters.expanded) {
                    return section;
                }

                const controls = document.createElement("div");
                controls.className = "rule-details-controls";

                const searchInput = document.createElement("input");
                searchInput.className = "rule-details-search";
                searchInput.placeholder = `Search ${parameters.label.toLowerCase()}...`;
                searchInput.value = parameters.searchQuery;
                searchInput.addEventListener("input", () => {
                    parameters.setSearchQuery(searchInput.value.trim().toLowerCase());
                    renderPlaygroundRuleDetails();
                });
                controls.append(searchInput);

                const enableAllButton = document.createElement("button");
                enableAllButton.type = "button";
                enableAllButton.className = "rule-details-bulk-action";
                enableAllButton.textContent = "Enable all";
                enableAllButton.addEventListener("click", () => {
                    parameters.setAllEntriesSelected(true);
                    void processPlaygroundInput();
                    renderPlaygroundRuleDetails();
                });
                controls.append(enableAllButton);

                const disableAllButton = document.createElement("button");
                disableAllButton.type = "button";
                disableAllButton.className = "rule-details-bulk-action";
                disableAllButton.textContent = "Disable all";
                disableAllButton.addEventListener("click", () => {
                    parameters.setAllEntriesSelected(false);
                    void processPlaygroundInput();
                    renderPlaygroundRuleDetails();
                });
                controls.append(disableAllButton);
                section.append(controls);

                const filteredEntries =
                    parameters.searchQuery.length === 0
                        ? parameters.entries
                        : parameters.entries.filter(
                              (entry) =>
                                  entry.key.toLowerCase().includes(parameters.searchQuery) ||
                                  entry.description.toLowerCase().includes(parameters.searchQuery)
                          );

                const content = document.createElement("div");
                content.className = "rule-details-list";
                for (const entry of filteredEntries) {
                    const row = document.createElement("label");
                    row.className = "rule-details-item";
                    row.title = entry.description;

                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = entry.selected;
                    checkbox.addEventListener("change", () => {
                        entry.onToggleEntry();
                        void processPlaygroundInput();
                        renderPlaygroundRuleDetails();
                    });
                    row.append(checkbox);

                    const keyText = document.createElement("span");
                    keyText.className = "rule-details-item-key";
                    keyText.textContent = entry.key;
                    row.append(keyText);

                    const descriptionText = document.createElement("span");
                    descriptionText.className = "rule-details-item-description";
                    descriptionText.textContent = entry.description;
                    row.append(descriptionText);

                    content.append(row);
                }

                section.append(content);

                const footer = document.createElement("div");
                footer.className = "rule-details-footer";
                footer.textContent =
                    filteredEntries.length === parameters.entries.length
                        ? `${String(parameters.entries.length)} items`
                        : `${String(filteredEntries.length)} of ${String(parameters.entries.length)} items`;
                section.append(footer);

                return section;
            };

            if (formatOptions.length > 0) {
                ruleDetailsRoot.append(
                    createDetailSection({
                        count: formatOptions.length,
                        entries: formatOptions.map((entry) => ({
                            description: entry.description,
                            key: entry.name,
                            selected: enabledFormatOptions.get(entry.name) ?? true,
                            onToggleEntry: () => {
                                const current = enabledFormatOptions.get(entry.name) ?? true;
                                enabledFormatOptions.set(entry.name, !current);
                            }
                        })),
                        expanded: showFormatDetails,
                        label: "Format Options",
                        onToggleExpanded: () => {
                            showFormatDetails = !showFormatDetails;
                        },
                        searchQuery: formatSearchQuery,
                        selectedCount: formatOptions.filter((entry) => enabledFormatOptions.get(entry.name) ?? true)
                            .length,
                        setAllEntriesSelected: (selected) => {
                            for (const entry of formatOptions) {
                                enabledFormatOptions.set(entry.name, selected);
                            }
                        },
                        setSearchQuery: (value) => {
                            formatSearchQuery = value;
                        }
                    })
                );
            }

            if (lintRules.length > 0) {
                ruleDetailsRoot.append(
                    createDetailSection({
                        count: lintRules.length,
                        entries: lintRules.map((entry) => ({
                            description: entry.description,
                            key: entry.ruleId,
                            selected: enabledLintRules.get(entry.ruleId) ?? true,
                            onToggleEntry: () => {
                                const current = enabledLintRules.get(entry.ruleId) ?? true;
                                enabledLintRules.set(entry.ruleId, !current);
                            }
                        })),
                        expanded: showLintDetails,
                        label: "Lint Rules",
                        onToggleExpanded: () => {
                            showLintDetails = !showLintDetails;
                        },
                        searchQuery: lintSearchQuery,
                        selectedCount: lintRules.filter((entry) => enabledLintRules.get(entry.ruleId) ?? true).length,
                        setAllEntriesSelected: (selected) => {
                            for (const entry of lintRules) {
                                enabledLintRules.set(entry.ruleId, selected);
                            }
                        },
                        setSearchQuery: (value) => {
                            lintSearchQuery = value;
                        }
                    })
                );
            }

            if (codemods.length > 0) {
                ruleDetailsRoot.append(
                    createDetailSection({
                        count: codemods.length,
                        entries: codemods.map((entry) => ({
                            description: entry.description,
                            key: entry.id,
                            selected: enabledCodemods.get(entry.id) ?? true,
                            onToggleEntry: () => {
                                const current = enabledCodemods.get(entry.id) ?? true;
                                enabledCodemods.set(entry.id, !current);
                            }
                        })),
                        expanded: showCodemodDetails,
                        label: "Codemods",
                        onToggleExpanded: () => {
                            showCodemodDetails = !showCodemodDetails;
                        },
                        searchQuery: codemodSearchQuery,
                        selectedCount: codemods.filter((entry) => enabledCodemods.get(entry.id) ?? true).length,
                        setAllEntriesSelected: (selected) => {
                            for (const entry of codemods) {
                                enabledCodemods.set(entry.id, selected);
                            }
                        },
                        setSearchQuery: (value) => {
                            codemodSearchQuery = value;
                        }
                    })
                );
            }

            ruleToolbar.append(ruleDetailsRoot);
        }

        function updateTranspileButtonState(): void {
            patchTranspileBtn.classList.toggle("active", transpileMode === "patch");
            expressionTranspileBtn.classList.toggle("active", transpileMode === "expression");
        }

        const savedInput = localStorage.getItem("gmloop-playground-input");
        input.value = resolveInitialPlaygroundGmlSource(savedInput);
        if (savedInput !== input.value) {
            localStorage.setItem("gmloop-playground-input", input.value);
        }
        void processPlaygroundInput();

        function updateView() {
            if (viewMode === "code") {
                outputTitle.textContent = transpileMode === "none" ? "GML" : "JS";
                output.textContent = lastOutput;
                codeViewBtn.classList.add("active");
                astViewBtn.classList.remove("active");
            } else {
                outputTitle.textContent = "Parsed AST";
                output.textContent = lastAst;
                codeViewBtn.classList.remove("active");
                astViewBtn.classList.add("active");
            }
        }

        async function processPlaygroundInput() {
            const gml = input.value;
            const formatOptionNames = formatOptions
                .filter((option) => enabledFormatOptions.get(option.name) ?? true)
                .map((option) => option.name);
            const lintRuleIds = lintRules
                .filter((rule) => enabledLintRules.get(rule.ruleId) ?? true)
                .map((rule) => rule.ruleId);
            const codemodIds = codemods
                .filter((codemod) => enabledCodemods.get(codemod.id) ?? true)
                .map((codemod) => codemod.id);
            if (!gml.trim()) {
                lastOutput = "";
                lastAst = "";
                updateView();
                return;
            }

            try {
                const response = await fetch("/api/playground/process", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        gml,
                        format: formatOptionNames.length > 0,
                        formatOptionNames,
                        lint: lintRuleIds.length > 0,
                        lintRuleIds,
                        refactor: codemodIds.length > 0,
                        codemodIds,
                        transpileMode
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error ?? `Server error: ${response.status}`);
                }

                const data = await response.json();
                if (data.payload.error) {
                    lastOutput = data.payload.error;
                    lastAst = "";
                } else {
                    lastOutput = data.payload.output;
                    lastAst = data.payload.ast;
                }
            } catch (error) {
                // Use a capability probe rather than `instanceof Error` so that
                // cross-realm errors from sandboxed code are handled consistently.
                lastOutput = Core.isErrorLike(error) ? error.message : String(error);
                lastAst = "";
            }
            updateView();
        }

        input.addEventListener("input", () => {
            localStorage.setItem("gmloop-playground-input", input.value);
            if (debounceTimer !== null) {
                globalThis.clearTimeout(debounceTimer);
            }
            debounceTimer = globalThis.setTimeout(() => {
                void processPlaygroundInput();
            }, 300);
        });

        patchTranspileBtn.addEventListener("click", () => {
            transpileMode = transpileMode === "patch" ? "none" : "patch";
            updateTranspileButtonState();
            void processPlaygroundInput();
        });

        expressionTranspileBtn.addEventListener("click", () => {
            transpileMode = transpileMode === "expression" ? "none" : "expression";
            updateTranspileButtonState();
            void processPlaygroundInput();
        });

        codeViewBtn.addEventListener("click", () => {
            viewMode = "code";
            updateView();
        });

        astViewBtn.addEventListener("click", () => {
            viewMode = "ast";
            updateView();
        });

        renderPlaygroundRuleDetails();
    }
}
