import { EDGE_LINE_VISUAL_STYLES, NODE_VISUAL_STYLES } from "./graph-visualization-style-metadata.js";
import type {
    GraphVisualizationData,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationEdgeRecord,
    GraphVisualizationLoadedTarget,
    GraphVisualizationNodeKind,
    GraphVisualizationNodeRecord,
    GraphVisualizationProjectConfigurationCatalog
} from "./types.js";

type BrowserFileHandle = Readonly<{
    name: string;
    text(): Promise<string>;
    webkitRelativePath?: string;
}>;

type BrowserAppDependencies = Readonly<{
    data: GraphVisualizationData;
    directoryOpen: (options: Readonly<Record<string, unknown>>) => Promise<ReadonlyArray<BrowserFileHandle>>;
    documentationCatalogs: GraphVisualizationDocumentationCatalogs | null;
    fileOpen: (
        options: Readonly<Record<string, unknown>>
    ) => Promise<BrowserFileHandle | ReadonlyArray<BrowserFileHandle>>;
    isServerMode: boolean;
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

type MutableGraphNodeRecord = Omit<GraphVisualizationNodeRecord, "fx" | "fy" | "x" | "y"> & {
    fx: number | null;
    fy: number | null;
    x: number;
    y: number;
};

type MutableGraphEdgeEndpoint = string | MutableGraphNodeRecord;

type MutableGraphEdgeRecord = Omit<GraphVisualizationEdgeRecord, "source" | "target"> &
    Readonly<{
        source: MutableGraphEdgeEndpoint;
        target: MutableGraphEdgeEndpoint;
    }>;

type GraphSelectionApi = Readonly<{
    append(name: string): GraphSelectionApi;
    attr(name: string, value: string | number | ((datum: never) => string | number | null) | null): GraphSelectionApi;
    call(
        callback: (selection: GraphSelectionApi, ...arguments_: Array<unknown>) => void,
        ...arguments_: Array<unknown>
    ): GraphSelectionApi;
    classed(name: string, value: boolean | ((datum: never) => boolean)): GraphSelectionApi;
    data(dataValues: ReadonlyArray<unknown>, key?: (datum: never) => string): GraphSelectionApi;
    empty(): boolean;
    enter(): GraphSelectionApi;
    exit(): GraphSelectionApi;
    html(value: string): GraphSelectionApi;
    merge(other: GraphSelectionApi): GraphSelectionApi;
    node(): Element | null;
    on(name: string, handler: (event: never, datum: never) => void): GraphSelectionApi;
    property(name: string, value: boolean): GraphSelectionApi;
    remove(): GraphSelectionApi;
    select(selector: string): GraphSelectionApi;
    selectAll(selector: string): GraphSelectionApi;
    style(name: string, value: string | ((datum: never) => string | null) | null): GraphSelectionApi;
    text(value: string | ((datum: never) => string)): GraphSelectionApi;
    transition(): GraphSelectionApi;
}>;

type GraphSimulationApi = Readonly<{
    alpha(value: number): GraphSimulationApi;
    alphaDecay(value: number): GraphSimulationApi;
    alphaTarget(value: number): GraphSimulationApi;
    force(
        name: string,
        forceValue?: unknown
    ): GraphSimulationApi & Readonly<{ links(dataValues: ReadonlyArray<unknown>): void }>;
    nodes(dataValues: ReadonlyArray<unknown>): GraphSimulationApi;
    on(name: string, handler: () => void): GraphSimulationApi;
    restart(): GraphSimulationApi;
    velocityDecay(value: number): GraphSimulationApi;
}>;

type GraphPathRenderer = () => string;

type GraphDragBehavior = ((selection: GraphSelectionApi) => void) &
    Readonly<{
        on(name: string, handler: (event: never, datum: never) => void): GraphDragBehavior;
    }>;

type GraphZoomBehavior = ((selection: GraphSelectionApi, argument?: unknown) => void) &
    Readonly<{
        on(name: string, handler: (event: never) => void): GraphZoomBehavior;
        scaleExtent(values: ReadonlyArray<number>): GraphZoomBehavior;
    }>;

type GraphRuntimeApi = Readonly<{
    drag(): GraphDragBehavior;
    forceCenter(x: number, y: number): unknown;
    forceCollide(): Readonly<{
        iterations(value: number): unknown;
        radius(value: (datum: never) => number): Readonly<{
            iterations(value: number): unknown;
        }>;
    }>;
    forceLink(): Readonly<{
        distance(value: number): unknown;
        id(value: (datum: never) => string): Readonly<{
            distance(distanceValue: number): unknown;
        }>;
    }>;
    forceManyBody(): Readonly<{
        strength(value: number): unknown;
    }>;
    forceSimulation(): GraphSimulationApi;
    select(target: string | Element | null): GraphSelectionApi;
    selectAll(selector: string): GraphSelectionApi;
    symbol(): Readonly<{
        size(value: number): Readonly<{
            type(symbolType: unknown): GraphPathRenderer;
        }>;
        type(symbolType: unknown): Readonly<{
            size(value: number): GraphPathRenderer;
        }>;
    }>;
    symbolCircle: unknown;
    symbolDiamond: unknown;
    symbolSquare: unknown;
    zoom(): GraphZoomBehavior;
    zoomIdentity: unknown;
    zoomTransform(element: Element | null): Readonly<{
        k: number;
    }>;
}>;

type TooltipMouseEvent = MouseEvent &
    Readonly<{
        pageX: number;
        pageY: number;
    }>;

const NODE_GROUP_FILTER_CATEGORY = "node-group";
const RESOURCE_GROUP_FILTER_TYPE = "resource-group";
type FilterCategory = "edge" | "node" | typeof NODE_GROUP_FILTER_CATEGORY;
type FilterType =
    | GraphVisualizationNodeKind
    | "enum-group"
    | typeof RESOURCE_GROUP_FILTER_TYPE
    | GraphVisualizationEdgeRecord["type"];

/**
 * Bootstrap the graph visualization browser application.
 */
export function bootstrapGraphVisualizationApp(dependencies: BrowserAppDependencies): void {
    const resourceKinds = new Set<GraphVisualizationNodeKind>([
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
    const defaultDisabledNodeKinds = new Set<GraphVisualizationNodeKind>([
        "data_file",
        "enum_member",
        "function",
        "global_variable",
        "instance_variable",
        "local_variable",
        "struct_variable"
    ]);
    const openButtonLabel = '<span class="button-content"><span class="button-label">Open...</span></span>';
    const openingButtonLabel =
        '<span class="button-content"><span class="button-spinner" aria-hidden="true"></span><span class="button-label">Opening…</span></span>';
    const regenerateButtonLabel = '<span class="button-content"><span class="button-label">Regenerate</span></span>';
    const regeneratingButtonLabel =
        '<span class="button-content"><span class="button-spinner" aria-hidden="true"></span><span class="button-label">Regenerating…</span></span>';
    const graphRuntime = readGraphRuntime();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const svg = graphRuntime.select("#graph");
    const jsonView = graphRuntime.select("#json-view");
    const container = graphRuntime.select("#container");
    const tooltip = graphRuntime.select("#tooltip");
    const edgeLineVisualStyleByType = new Map(EDGE_LINE_VISUAL_STYLES.map((style) => [style.type, style]));
    const nodeVisualStyleByKind = new Map(NODE_VISUAL_STYLES.map((style) => [style.kind, style]));
    const edgeTypes = Array.from(new Set(dependencies.data.edges.map((edgeValue) => edgeValue.type)));
    const allNodes = dependencies.data.nodes.filter((nodeValue) => nodeValue.kind !== "file");
    const allNodeKinds = Array.from(new Set(allNodes.map((nodeValue) => nodeValue.kind)));
    const defaultEnabledNodeKinds = allNodeKinds.filter((kindValue) => !defaultDisabledNodeKinds.has(kindValue));
    const resourceTypesPresent = allNodeKinds.filter((kindValue) => resourceKinds.has(kindValue));
    const enumTypesPresent = allNodeKinds.filter((kindValue) => kindValue === "enum" || kindValue === "enum_member");
    const otherTypesPresent = allNodeKinds.filter(
        (kindValue) =>
            kindValue !== "resource" &&
            !resourceKinds.has(kindValue) &&
            kindValue !== "enum" &&
            kindValue !== "enum_member"
    );

    let currentLoadedTarget = dependencies.loadedTarget;
    const currentProjectConfiguration = dependencies.projectConfigurationCatalog;
    let selectedProjectConfiguration: LoadedProjectConfiguration | null = null;
    let labelMode: "auto" | "off" | "on" = "auto";
    let activeGraphView: "json" | "visual" = "visual";
    let activePage: "config" | "docs" | "graph" = "graph";
    let activeDocsView: "cli" | "mcp" = "cli";
    let cliMetaText = "";
    let mcpMetaText = "";
    let activeFilters = new Set(edgeTypes);
    let activeNodeFilters = new Set(defaultEnabledNodeKinds);
    let nodesRaw = cloneGraphNodes(allNodes);
    let linksRaw = cloneGraphEdges(dependencies.data.edges);
    let link = container.append("g").selectAll(".link");
    let nodeGroup = container.append("g").selectAll(".node-group");
    let node = nodeGroup.select("path.node");
    let nodeLabels = nodeGroup.select("text");
    const searchHighlightNodeIds = new Set<string>();
    let focusNodeId: string | null = null;
    let pinnedTooltipNodeId: string | null = null;
    let resourceCheckbox: GraphSelectionApi | undefined;
    let enumCheckbox: GraphSelectionApi | undefined;

    const incomingCount = new Map<string, number>();
    const outgoingCount = new Map<string, number>();
    const neighborMap = new Map<string, Set<string>>();
    rebuildGraphIndexes(linksRaw, incomingCount, outgoingCount, neighborMap);

    const zoomBehavior = graphRuntime
        .zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (eventValue) => {
            const transform = readGraphTransform(eventValue);
            container.attr("transform", transform.transformText);
            if (labelMode === "on") {
                nodeLabels.style("display", "block");
            } else if (labelMode === "off") {
                nodeLabels.style("display", "none");
            } else {
                nodeLabels.style("display", transform.k > 0.8 ? "block" : "none");
            }
        });
    svg.call((selection) => {
        selection.call(zoomBehavior as (selection: GraphSelectionApi) => void);
    });

    const simulation = graphRuntime
        .forceSimulation()
        .force(
            "link",
            graphRuntime
                .forceLink()
                .id((datum) => readNodeIdentifier(datum))
                .distance(50)
        )
        .force("charge", graphRuntime.forceManyBody().strength(-100))
        .force("center", graphRuntime.forceCenter(width / 2, height / 2))
        .force(
            "collide",
            graphRuntime
                .forceCollide()
                .radius((datum) => getRadius(readGraphNode(datum)))
                .iterations(2)
        )
        .alphaDecay(0.02)
        .velocityDecay(0.3);

    if (dependencies.data.nodes.length > 2000) {
        console.warn("Large graph detected:", dependencies.data.nodes.length, "nodes. Adjusting rendering parameters.");
    }

    renderLoadedTargetSummary();
    renderDocumentationCatalog();
    renderProjectConfigurationCatalog();
    renderLegend();
    wirePageNavigation();
    wireViewControls();
    wireOpenProjectButton();
    wireRegenerateButton();
    updatePageState();
    updateGraph();

    tooltip.on("mouseenter", () => tooltip.classed("visible", true));
    tooltip.on("mouseleave", () => {
        if (pinnedTooltipNodeId === null) {
            hideTooltip();
        }
    });
    svg.on("click", clearFocus);

    function readGraphRuntime(): GraphRuntimeApi {
        const runtimeValue = Reflect.get(globalThis, "d3");
        if (runtimeValue === undefined || runtimeValue === null) {
            throw new Error("The graph visualization requires the D3 runtime.");
        }
        return runtimeValue as GraphRuntimeApi;
    }

    function readGraphTransform(eventValue: never): Readonly<{ k: number; transformText: string }> {
        const transformValue = Reflect.get(eventValue as object, "transform");
        const zoomFactor = Number(Reflect.get(transformValue as object, "k"));
        return {
            k: Number.isFinite(zoomFactor) ? zoomFactor : 1,
            transformText: String(transformValue ?? "")
        };
    }

    function readNodeIdentifier(nodeValue: never): string {
        return String(Reflect.get(nodeValue as object, "id"));
    }

    function readGraphNode(nodeValue: never): MutableGraphNodeRecord {
        return nodeValue as MutableGraphNodeRecord;
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

    function readEdgeEndpointId(endpoint: MutableGraphEdgeEndpoint): string {
        return typeof endpoint === "string" ? endpoint : endpoint.id;
    }

    function getRadius(nodeValue: MutableGraphNodeRecord): number {
        const degree = (incomingCount.get(nodeValue.id) ?? 0) + (outgoingCount.get(nodeValue.id) ?? 0);
        return Math.max(5, Math.min(25, 4 + Math.log2(degree + 1) * 3));
    }

    function wireViewControls(): void {
        const toggleViewButton = document.getElementById("toggle-view");
        if (toggleViewButton instanceof HTMLButtonElement) {
            toggleViewButton.addEventListener("click", () => {
                activeGraphView = activeGraphView === "visual" ? "json" : "visual";
                updateGraphViewMode();
            });
        }

        const toggleLabelsButton = document.getElementById("toggle-labels");
        if (toggleLabelsButton instanceof HTMLButtonElement) {
            toggleLabelsButton.addEventListener("click", () => {
                labelMode = labelMode === "auto" ? "on" : labelMode === "on" ? "off" : "auto";
                toggleLabelsButton.textContent =
                    labelMode === "auto" ? "Labels: Auto" : labelMode === "on" ? "Labels: On" : "Labels: Off";
                const currentTransform = graphRuntime.zoomTransform(svg.node());
                if (labelMode === "on") {
                    nodeLabels.style("display", "block");
                } else if (labelMode === "off") {
                    nodeLabels.style("display", "none");
                } else {
                    nodeLabels.style("display", currentTransform.k > 0.8 ? "block" : "none");
                }
            });
        }

        graphRuntime.select("#reset-default").on("click", () => {
            svg.transition().call((selection) => {
                selection.call(
                    zoomBehavior as (selection: GraphSelectionApi) => void,
                    graphRuntime.zoomIdentity as never
                );
            });
            resetGraphStateToDefaults();
            updateGraph();
        });

        graphRuntime.select("#search").on("input", (eventValue) => {
            const currentTarget = Reflect.get(eventValue as object, "currentTarget");
            if (!(currentTarget instanceof HTMLInputElement)) {
                return;
            }

            const term = currentTarget.value.toLowerCase().trim();
            searchHighlightNodeIds.clear();
            focusNodeId = null;
            hideTooltip();

            if (term.length > 0) {
                nodesRaw.forEach((nodeValue) => {
                    if (
                        nodeValue.name.toLowerCase().includes(term) ||
                        nodeValue.displayName.toLowerCase().includes(term)
                    ) {
                        searchHighlightNodeIds.add(nodeValue.id);
                    }
                });
            }

            applyHighlights();
        });
    }

    function renderLoadedTargetSummary(): void {
        const loadedTargetElement = document.getElementById("loaded-target");
        const loadedSourceElement = document.getElementById("loaded-source");
        const loadedSelectedElement = document.getElementById("loaded-selected");
        if (
            !(loadedTargetElement instanceof HTMLElement) ||
            !(loadedSourceElement instanceof HTMLElement) ||
            !(loadedSelectedElement instanceof HTMLElement)
        ) {
            return;
        }

        if (currentLoadedTarget === null) {
            loadedTargetElement.textContent = "No active target";
            loadedSourceElement.textContent = "";
            loadedSelectedElement.textContent = "";
            return;
        }

        loadedTargetElement.textContent = `Active: ${currentLoadedTarget.activePath}`;
        loadedSourceElement.textContent = `Source: ${currentLoadedTarget.source} | Project: ${currentLoadedTarget.projectRoot}`;
        if (currentLoadedTarget.selectedPaths.length > 1) {
            const selectedPaths = currentLoadedTarget.selectedPaths;
            loadedSelectedElement.textContent =
                selectedPaths.length > 3
                    ? `Selected paths: ${selectedPaths.slice(0, 3).join(", ")} (+${String(
                          selectedPaths.length - 3
                      )} more files)`
                    : `Selected paths: ${selectedPaths.join(", ")}`;
            return;
        }

        loadedSelectedElement.textContent = "";
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

    function renderDocumentationCatalog(): void {
        const docsMetaElement = document.getElementById("docs-meta");
        const cliContentElement = document.getElementById("cli-content");
        const mcpContentElement = document.getElementById("mcp-content");
        if (
            !(docsMetaElement instanceof HTMLElement) ||
            !(cliContentElement instanceof HTMLElement) ||
            !(mcpContentElement instanceof HTMLElement)
        ) {
            return;
        }

        cliContentElement.innerHTML = "";
        mcpContentElement.innerHTML = "";

        if (dependencies.documentationCatalogs === null) {
            cliMetaText = "No CLI catalog metadata is available for this view.";
            mcpMetaText = "No MCP catalog metadata is available for this view.";
            const emptyState = document.createElement("div");
            emptyState.className = "catalog-empty";
            emptyState.textContent = "Documentation catalogs are not available.";
            cliContentElement.append(emptyState.cloneNode(true));
            mcpContentElement.append(emptyState);
            updateDocsViewState();
            return;
        }

        cliMetaText = `${String(
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
                rows.push(
                    createCatalogItemRow(`<${argument.name}>`, (argument.description || "No description.") + suffix)
                );
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
        mcpMetaText = `${mcpServer.name} v${mcpServer.version} | ${String(
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
            mcpContentElement.append(
                createCatalogCard(entry.toolName, entry.description, entry.commandDisplayName, rows)
            );
        });

        updateDocsViewState();
    }

    function updateDocsViewState(): void {
        const cliPage = document.getElementById("cli-page");
        const mcpPage = document.getElementById("mcp-page");
        const cliButton = document.getElementById("docs-view-cli");
        const mcpButton = document.getElementById("docs-view-mcp");
        const docsMetaElement = document.getElementById("docs-meta");
        if (
            !(cliPage instanceof HTMLElement) ||
            !(mcpPage instanceof HTMLElement) ||
            !(cliButton instanceof HTMLButtonElement) ||
            !(mcpButton instanceof HTMLButtonElement) ||
            !(docsMetaElement instanceof HTMLElement)
        ) {
            return;
        }

        cliPage.classList.toggle("hidden", activeDocsView !== "cli");
        mcpPage.classList.toggle("hidden", activeDocsView !== "mcp");
        cliButton.classList.toggle("active", activeDocsView === "cli");
        mcpButton.classList.toggle("active", activeDocsView === "mcp");
        docsMetaElement.textContent = activeDocsView === "cli" ? cliMetaText : mcpMetaText;
    }

    function createBadge(labelText: string): HTMLSpanElement {
        const badge = document.createElement("span");
        badge.className = "config-badge";
        badge.textContent = labelText;
        return badge;
    }

    function createConfigItem(
        title: string,
        descriptionText: string,
        valueText: string,
        badges: ReadonlyArray<string>
    ): HTMLLIElement {
        const item = document.createElement("li");
        item.className = "config-item";
        const heading = document.createElement("strong");
        heading.textContent = title;
        item.append(heading);
        if (descriptionText.length > 0) {
            const description = document.createElement("span");
            description.textContent = descriptionText;
            item.append(description);
        }
        if (badges.length > 0) {
            const badgeRow = document.createElement("div");
            badgeRow.className = "config-badge-row";
            badges.forEach((badgeText) => badgeRow.append(createBadge(badgeText)));
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

    function createConfigCard(
        title: string,
        descriptionText: string,
        children: ReadonlyArray<HTMLElement>
    ): HTMLElement {
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
                          lint: { rules: [], ruleset: null },
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

        const overviewGrid = document.createElement("div");
        overviewGrid.className = "config-grid";
        const gmloopRaw = document.createElement("pre");
        gmloopRaw.className = "config-raw";
        gmloopRaw.textContent = JSON.stringify(gmloopConfig.rawConfig || {}, null, 2);
        overviewGrid.append(
            createConfigCard("gmloop.json", gmloopConfig.configPath ?? "No gmloop.json file is currently loaded.", [
                gmloopRaw
            ])
        );

        const repositoryLink = document.createElement("a");
        repositoryLink.className = "github-link";
        repositoryLink.href = effectiveConfiguration.githubRepositoryUrl || "https://github.com/SimulatorLife/GMLoop";
        repositoryLink.target = "_blank";
        repositoryLink.rel = "noreferrer";
        repositoryLink.textContent = "Open Public Repository";
        overviewGrid.append(
            createConfigCard("Repository", "Project root and canonical public repository for GMLoop.", [
                createConfigItem(
                    "Project Root",
                    "Active project root used by graph, lint, format, and refactor workflows.",
                    gmloopConfig.projectRoot || "(none)",
                    []
                ),
                repositoryLink
            ])
        );
        configContentElement.append(overviewGrid);

        if (selectedProjectConfiguration !== null) {
            const selectedConfigContainer = document.createElement("div");
            selectedConfigContainer.className = "config-grid";

            selectedProjectConfiguration.prettier.forEach((entry) => {
                const contentPre = document.createElement("pre");
                contentPre.className = "config-raw";
                contentPre.textContent = entry.content;
                selectedConfigContainer.append(
                    createConfigCard(
                        `Prettier config: ${entry.path}`,
                        "Selected project Prettier configuration file.",
                        [contentPre]
                    )
                );
            });

            selectedProjectConfiguration.eslint.forEach((entry) => {
                const contentPre = document.createElement("pre");
                contentPre.className = "config-raw";
                contentPre.textContent = entry.content;
                selectedConfigContainer.append(
                    createConfigCard(`ESLint config: ${entry.path}`, "Selected project ESLint configuration file.", [
                        contentPre
                    ])
                );
            });

            if (selectedConfigContainer.children.length > 0) {
                configContentElement.append(selectedConfigContainer);
            }
        }

        const formatList = document.createElement("ul");
        formatList.className = "config-list";
        effectiveConfiguration.format.entries.forEach((entry) => {
            formatList.append(
                createConfigItem(entry.name, entry.description, JSON.stringify(entry.value, null, 2), [entry.source])
            );
        });
        configContentElement.append(
            createConfigCard("Format / Prettier", "Formatter-owned options sourced from the format workspace.", [
                formatList
            ])
        );

        const lintList = document.createElement("ul");
        lintList.className = "config-list";
        effectiveConfiguration.lint.rules.forEach((entry) => {
            const badges = [entry.level];
            if (entry.fixable !== null) {
                badges.push(`fixable:${entry.fixable}`);
            }
            lintList.append(
                createConfigItem(entry.ruleId, entry.description, JSON.stringify(entry.options, null, 2), badges)
            );
        });
        configContentElement.append(
            createConfigCard(
                "Lint",
                effectiveConfiguration.lint.ruleset === null
                    ? "Resolved lint rules for the active project configuration."
                    : `Resolved lint rules for the active gmloop lintRuleset: ${effectiveConfiguration.lint.ruleset}`,
                [lintList]
            )
        );

        const refactorList = document.createElement("ul");
        refactorList.className = "config-list";
        effectiveConfiguration.refactor.codemods.forEach((entry) => {
            const badges = [entry.enabled ? "enabled" : "disabled"];
            if (entry.requiresSemanticProjectIndex) {
                badges.push("semantic-index");
            }
            refactorList.append(
                createConfigItem(entry.id, entry.description, JSON.stringify(entry.config, null, 2), badges)
            );
        });
        configContentElement.append(
            createConfigCard("Refactor", "Registered codemods and the active project-level codemod configuration.", [
                refactorList
            ])
        );
    }

    function wirePageNavigation(): void {
        ["graph", "docs", "config"].forEach((pageValue) => {
            const button = document.getElementById(`tab-${pageValue}`);
            if (button instanceof HTMLButtonElement) {
                button.addEventListener("click", () => {
                    activePage = pageValue as "config" | "docs" | "graph";
                    updatePageState();
                });
            }
        });

        const docsCliButton = document.getElementById("docs-view-cli");
        const docsMcpButton = document.getElementById("docs-view-mcp");
        if (docsCliButton instanceof HTMLButtonElement) {
            docsCliButton.addEventListener("click", () => {
                activeDocsView = "cli";
                updateDocsViewState();
            });
        }
        if (docsMcpButton instanceof HTMLButtonElement) {
            docsMcpButton.addEventListener("click", () => {
                activeDocsView = "mcp";
                updateDocsViewState();
            });
        }
    }

    function updatePageState(): void {
        [
            { buttonId: "tab-graph", pageId: "graph-page", pageValue: "graph" },
            { buttonId: "tab-docs", pageId: "docs-page", pageValue: "docs" },
            { buttonId: "tab-config", pageId: "config-page", pageValue: "config" }
        ].forEach((entry) => {
            const button = document.getElementById(entry.buttonId);
            const page = document.getElementById(entry.pageId);
            if (button instanceof HTMLButtonElement) {
                button.classList.toggle("active", activePage === entry.pageValue);
            }
            if (page instanceof HTMLElement) {
                page.classList.toggle("active", activePage === entry.pageValue);
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

        graphControls.classList.toggle("hidden", activePage !== "graph");
        if (activePage === "graph") {
            toolbarHeading.textContent = "Graph Index";
            toolbarSubheading.textContent = "Interactive graph exploration controls for the current graph index.";
            updateGraphViewMode();
            return;
        }
        if (activePage === "docs") {
            toolbarHeading.textContent = "Docs";
            toolbarSubheading.textContent = "Live CLI and MCP workspace catalogs are combined in a single Docs view.";
        } else {
            toolbarHeading.textContent = "Config";
            toolbarSubheading.textContent =
                "Loaded project configuration rendered from lint, format, refactor, and gmloop workspace data.";
        }

        svg.classed("hidden", true);
        graphRuntime.select("#legend").classed("hidden", true);
        graphRuntime.select("#tooltip").classed("hidden", true);
        jsonView.classed("hidden", true).style("display", "none");
    }

    function updateGraphViewMode(): void {
        const isVisualView = activeGraphView === "visual";
        svg.classed("hidden", !isVisualView);
        graphRuntime.select("#legend").classed("hidden", !isVisualView);
        graphRuntime.select("#tooltip").classed("hidden", !isVisualView);
        jsonView.classed("hidden", isVisualView).style("display", isVisualView ? "none" : "block");
        graphRuntime.select("#toggle-view").text(isVisualView ? "JSON" : "Visual");
        if (!isVisualView) {
            jsonView.text(
                JSON.stringify(
                    {
                        edges: linksRaw.filter((edgeValue) => activeFilters.has(edgeValue.type)),
                        graphs: dependencies.data.graphs,
                        nodes: nodesRaw.filter((nodeValue) => activeNodeFilters.has(nodeValue.kind))
                    },
                    null,
                    2
                )
            );
        }
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
                (typeof typeValue === "string" && resourceKinds.has(typeValue as GraphVisualizationNodeKind))
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

    function formatLabel(textValue: string): string {
        return textValue.charAt(0).toUpperCase() + textValue.slice(1).replaceAll("_", " ");
    }

    function resetGraphStateToDefaults(): void {
        nodesRaw = cloneGraphNodes(allNodes);
        linksRaw = cloneGraphEdges(dependencies.data.edges);
        activeFilters = new Set(edgeTypes);
        activeNodeFilters = new Set(defaultEnabledNodeKinds);
        searchHighlightNodeIds.clear();
        focusNodeId = null;
        pinnedTooltipNodeId = null;
        hideTooltip();
        rebuildGraphIndexes(linksRaw, incomingCount, outgoingCount, neighborMap);

        const searchInput = document.getElementById("search");
        if (searchInput instanceof HTMLInputElement) {
            searchInput.value = "";
        }

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
            const edgeValue = datumValue as MutableGraphEdgeRecord;
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
        const nodeEnter = nodeGroup
            .enter()
            .append("g")
            .attr("class", "node-group")
            .call((selection) => {
                selection.call(
                    graphRuntime
                        .drag()
                        .on("start", (eventValue, datumValue) => dragStarted(eventValue, datumValue))
                        .on("drag", (eventValue, datumValue) => dragMoved(eventValue, datumValue))
                        .on("end", (eventValue, datumValue) => dragEnded(eventValue, datumValue)) as (
                        selection: GraphSelectionApi
                    ) => void
                );
            });

        nodeEnter
            .append("path")
            .attr("class", (datumValue) => {
                const nodeValue = datumValue as MutableGraphNodeRecord;
                return `node node-${nodeValue.kind}${nodeValue.graphId === "toolset" ? " toolset" : ""}`;
            })
            .attr("d", (datumValue) => renderNodeShape(datumValue as MutableGraphNodeRecord))
            .classed("node", true)
            .classed("toolset", (datumValue) => String(Reflect.get(datumValue as object, "graphId")) === "toolset")
            .on("mouseover", (eventValue, datumValue) =>
                showTooltip(eventValue as TooltipMouseEvent, datumValue as MutableGraphNodeRecord)
            )
            .on("mouseout", () => hideTooltipWithDelay())
            .on("click", (eventValue, datumValue) =>
                handleNodeClick(eventValue as MouseEvent, datumValue as MutableGraphNodeRecord)
            )
            .on("dblclick", (eventValue, datumValue) =>
                handleNodeDoubleClick(eventValue as MouseEvent, datumValue as MutableGraphNodeRecord)
            );

        nodeEnter
            .append("text")
            .attr("dx", 12)
            .attr("dy", ".35em")
            .text((datumValue) => String(Reflect.get(datumValue as object, "displayName")))
            .style("display", "none");

        nodeGroup = nodeEnter.merge(nodeGroup);
        node = nodeGroup.select("path.node");
        nodeLabels = nodeGroup.select("text");
        node.attr("class", (datumValue) => {
            const nodeValue = datumValue as MutableGraphNodeRecord;
            const styleKind = nodeVisualStyleByKind.has(nodeValue.kind) ? nodeValue.kind : "default";
            return `node node-${styleKind}${nodeValue.graphId === "toolset" ? " toolset" : ""}`;
        });

        simulation.nodes(filteredNodes).on("tick", ticked);
        simulation.force("link").links(filteredLinks);
        simulation.alpha(0.3).restart();
        applyHighlights();
    }

    function renderNodeShape(nodeValue: MutableGraphNodeRecord): string {
        const symbolArea = Math.pow(getRadius(nodeValue), 2) * Math.PI;
        let symbolType = graphRuntime.symbolCircle;
        if (nodeValue.kind.endsWith("_variable")) {
            symbolType = graphRuntime.symbolDiamond;
        } else if (resourceKinds.has(nodeValue.kind)) {
            symbolType = graphRuntime.symbolSquare;
        }
        return graphRuntime.symbol().type(symbolType).size(symbolArea)();
    }

    function ticked(): void {
        link.attr("d", (datumValue) => {
            const edgeValue = datumValue as MutableGraphEdgeRecord;
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
            const nodeValue = datumValue as MutableGraphNodeRecord;
            return `translate(${nodeValue.x},${nodeValue.y})`;
        });
    }

    function dragStarted(eventValue: never, datumValue: never): void {
        const nodeValue = datumValue as MutableGraphNodeRecord;
        const isActive = Boolean(Reflect.get(eventValue as object, "active"));
        if (!isActive) {
            simulation.alphaTarget(0.3).restart();
        }
        nodeValue.fx = nodeValue.x;
        nodeValue.fy = nodeValue.y;
    }

    function dragMoved(eventValue: never, datumValue: never): void {
        const nodeValue = datumValue as MutableGraphNodeRecord;
        nodeValue.fx = Number(Reflect.get(eventValue as object, "x"));
        nodeValue.fy = Number(Reflect.get(eventValue as object, "y"));
    }

    function dragEnded(eventValue: never, _datumValue: never): void {
        const isActive = Boolean(Reflect.get(eventValue as object, "active"));
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
        const searchInput = document.getElementById("search");
        if (searchInput instanceof HTMLInputElement) {
            searchInput.value = "";
        }
        applyHighlights();
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
            const edgeValue = datumValue as MutableGraphEdgeRecord;
            const sourceId = readEdgeEndpointId(edgeValue.source);
            const targetId = readEdgeEndpointId(edgeValue.target);
            if (focusNodeId !== null) {
                return sourceId !== focusNodeId && targetId !== focusNodeId;
            }
            return !highlightIds.has(sourceId) || !highlightIds.has(targetId);
        });
    }

    function wireOpenProjectButton(): void {
        const openProjectButton = graphRuntime.select("#open-project");
        if (openProjectButton.empty()) {
            return;
        }
        openProjectButton.on("click", () => {
            void (async () => {
                const button = graphRuntime.select("#open-project");
                button.attr("disabled", "true").html(openingButtonLabel);
                try {
                    let selectedFiles: ReadonlyArray<BrowserFileHandle> | null = null;
                    try {
                        selectedFiles = await dependencies.directoryOpen({ recursive: true });
                    } catch (error) {
                        if (readErrorName(error) === "AbortError") {
                            button.attr("disabled", null).html(openButtonLabel);
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
                        button.attr("disabled", null).html(openButtonLabel);
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
                    renderLoadedTargetSummary();
                    renderProjectConfigurationCatalog();
                    button.attr("disabled", null).html(openButtonLabel);
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
                button.attr("disabled", "true").html(regeneratingButtonLabel);
                try {
                    const response = await fetch("/api/reindex", { method: "POST" });
                    if (response.ok) {
                        const payload = (await response.json()) as Readonly<{ changed?: boolean }>;
                        if (payload.changed === true) {
                            globalThis.location.reload();
                            return;
                        }
                        button.attr("disabled", null).html(regenerateButtonLabel);
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

    function readErrorName(errorValue: unknown): string {
        if (errorValue instanceof Error) {
            return errorValue.name;
        }
        if (typeof errorValue === "object" && errorValue !== null && "name" in errorValue) {
            const candidate = Reflect.get(errorValue, "name");
            return typeof candidate === "string" ? candidate : "";
        }
        return "";
    }
}
