import assert from "node:assert/strict";
import test from "node:test";

import { renderGraphVisualizationHtml } from "../src/graph/graph-visualization-template.js";

type EmbeddedEdgeLineVisualStyle = Readonly<{
    color: string;
    dashArray: string;
    legendBorderStyle: string;
    legendBorderWidth: string;
    strokeLineCap: string;
    strokeWidth: string;
    type: string;
}>;

type EmbeddedNodeVisualStyle = Readonly<{
    color: string;
    kind: string;
}>;

function renderEmptyGraphVisualizationHtml(title: string): string {
    return renderGraphVisualizationHtml(
        {
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        { title }
    );
}

function createDocumentationCatalogsFixture() {
    return {
        cliCommands: [
            {
                arguments: [
                    {
                        choices: [],
                        description: "Target graph node id.",
                        name: "nodeId",
                        required: true,
                        variadic: false
                    }
                ],
                commandPath: ["graph", "context"],
                description: "Retrieve a structured context bundle for a graph node.",
                displayName: "graph context",
                options: [
                    {
                        attributeName: "depth",
                        boolean: false,
                        choices: [],
                        description: "Neighbor traversal depth",
                        flags: "--depth <n>",
                        long: "--depth",
                        short: undefined,
                        variadic: false
                    }
                ],
                usage: "graph context <nodeId> [options]"
            }
        ],
        mcpServer: {
            name: "gmloop-mcp",
            version: "0.0.1"
        },
        mcpTools: [
            {
                commandDisplayName: "graph context",
                description: "Retrieve a structured context bundle for a graph node.",
                fields: [
                    {
                        attributeName: "cwd",
                        choices: [],
                        description: "Optional working directory for the CLI invocation.",
                        kind: "option",
                        multiple: false,
                        name: "cwd",
                        required: false,
                        valueType: "string"
                    },
                    {
                        attributeName: "nodeId",
                        choices: [],
                        description: "Target graph node id.",
                        kind: "argument",
                        multiple: false,
                        name: "nodeId",
                        required: true,
                        valueType: "string"
                    }
                ],
                toolName: "gmloop_graph_context"
            }
        ]
    } as const;
}

function extractCssRuleBody(html: string, selector: string): string {
    const rulePrefix = `${selector} { `;
    const ruleStart = html.indexOf(rulePrefix);
    if (ruleStart === -1) {
        assert.fail(`Expected ${selector} CSS rule to be present`);
    }

    const bodyStart = ruleStart + rulePrefix.length;
    const bodyEnd = html.indexOf(" }", bodyStart);
    if (bodyEnd === -1) {
        assert.fail(`Expected ${selector} CSS rule to be closed`);
    }

    return html.slice(bodyStart, bodyEnd);
}

function extractEmbeddedEdgeLineVisualStyles(html: string): ReadonlyArray<EmbeddedEdgeLineVisualStyle> {
    const declarationPrefix = "const edgeLineVisualStyles = ";
    const declarationStart = html.indexOf(declarationPrefix);
    assert.notEqual(declarationStart, -1, "edge line visual styles should be embedded in the template");

    const valueStart = declarationStart + declarationPrefix.length;
    const valueEnd = html.indexOf(";\n    const edgeLineVisualStyleByType", valueStart);
    assert.notEqual(valueEnd, -1, "edge line visual styles declaration should end before its lookup map");

    return JSON.parse(html.slice(valueStart, valueEnd)) as Array<EmbeddedEdgeLineVisualStyle>;
}

function extractEmbeddedNodeVisualStyles(html: string): ReadonlyArray<EmbeddedNodeVisualStyle> {
    const declarationPrefix = "const nodeVisualStyles = ";
    const declarationStart = html.indexOf(declarationPrefix);
    assert.notEqual(declarationStart, -1, "node visual styles should be embedded in the template");

    const valueStart = declarationStart + declarationPrefix.length;
    const valueEnd = html.indexOf(";\n    const nodeVisualStyleByKind", valueStart);
    assert.notEqual(valueEnd, -1, "node visual styles declaration should end before its lookup map");

    return JSON.parse(html.slice(valueStart, valueEnd)) as Array<EmbeddedNodeVisualStyle>;
}

function findEmbeddedEdgeLineVisualStyle(
    styles: ReadonlyArray<EmbeddedEdgeLineVisualStyle>,
    type: string
): EmbeddedEdgeLineVisualStyle {
    const style = styles.find((entry) => entry.type === type);
    if (!style) {
        assert.fail(`Expected ${type} edge visual style to be embedded`);
    }
    return style;
}

function findEmbeddedNodeVisualStyle(
    styles: ReadonlyArray<EmbeddedNodeVisualStyle>,
    kind: string
): EmbeddedNodeVisualStyle {
    const style = styles.find((entry) => entry.kind === kind);
    if (!style) {
        assert.fail(`Expected ${kind} node visual style to be embedded`);
    }
    return style;
}

void test("graph visualization template exposes view and label toggles", () => {
    const html = renderEmptyGraphVisualizationHtml("Test Graph");

    assert.match(html, /GMLoop/);
    assert.match(html, /id="tab-graph"/);
    assert.match(html, /id="tab-docs"/);
    assert.match(html, /id="tab-config"/);
    assert.match(html, /id="page-toolbar"/);
    assert.match(html, /id="docs-view-cli"/);
    assert.match(html, /id="docs-view-mcp"/);
    assert.match(html, /id="graph-controls"/);
    assert.match(html, /font-size: 15px;/);
    assert.match(html, /id="toggle-view"/);
    assert.match(html, /id="toggle-labels"/);
    assert.match(html, /id="json-view"/);
    assert.match(html, /labelMode = "auto"/);
    assert.match(html, /activeGraphView = "visual"/);
    assert.match(html, /activePage = "graph"/);
    assert.match(html, /function updatePageState\(\)/);
    assert.match(html, /graphControls\.classList\.toggle\("hidden", activePage !== "graph"\)/);
});

void test("graph visualization template omits unstable layout controls and alternate forces", () => {
    const html = renderEmptyGraphVisualizationHtml("Layout Simplification Test");

    assert.doesNotMatch(html, /id="layout-spacing"/);
    assert.doesNotMatch(html, /id="layout-repulsion"/);
    assert.doesNotMatch(html, /id="layout-clustering"/);
    assert.doesNotMatch(html, /id="layout-similarity"/);
    assert.doesNotMatch(html, /id="layout-mode"/);
    assert.doesNotMatch(html, /layoutSettings/u);
    assert.doesNotMatch(html, /applyLayoutForces/u);
    assert.doesNotMatch(html, /alignment-x/u);
    assert.doesNotMatch(html, /alignment-y/u);
    assert.doesNotMatch(html, /semantic-link/u);
    assert.doesNotMatch(html, /buildSemanticSimilarityLinks/u);
    assert.doesNotMatch(html, /tokenizeSemanticDescriptor/u);
    assert.doesNotMatch(html, /measureSemanticSimilarity/u);
    assert.match(html, /\.force\("link", d3\.forceLink\(\)\.id\(d => d\.id\)\.distance\(50\)\)/);
    assert.match(html, /\.force\("charge", d3\.forceManyBody\(\)\.strength\(-100\)\)/);
    assert.match(html, /\.force\("center", d3\.forceCenter\(width \/ 2, height \/ 2\)\)/);
    assert.match(
        html,
        /\.force\("collide", d3\.forceCollide\(\)\.radius\(d => getRadius\(d\) \+ 5\)\.iterations\(2\)\)/
    );
    assert.match(html, /\.alphaDecay\(0\.02\)/);
    assert.match(html, /\.velocityDecay\(0\.3\)/);
    assert.match(html, /simulation\.force\("link"\)\.links\(graphLinks\)/);
    assert.match(html, /simulation\.alpha\(0\.3\)\.restart\(\)/);
    assert.match(html, /simulation\.alphaTarget\(0\.3\)\.restart\(\)/);
});

void test("graph visualization reset rebuilds the live simulation state from the original exported graph", () => {
    const html = renderEmptyGraphVisualizationHtml("Reset Test");

    assert.match(html, /function cloneGraphNodes\(\)/);
    assert.match(html, /function cloneGraphEdges\(\)/);
    assert.match(html, /function resetGraphStateToDefaults\(\)/);
    assert.match(html, /nodesRaw = cloneGraphNodes\(\);/);
    assert.match(html, /linksRaw = cloneGraphEdges\(\);/);
    assert.match(html, /activeFilters = new Set\(edgeTypes\);/);
    assert.match(html, /activeNodeFilters = new Set\(defaultEnabledNodeKinds\);/);
    assert.match(html, /searchHighlightNodeIds\.clear\(\);/);
    assert.match(html, /focusNodeId = null;/);
    assert.match(html, /pinnedTooltipNodeId = null;/);
    assert.match(html, /hideTooltip\(\);/);
    assert.match(html, /searchInput\.value = "";/);
    assert.match(html, /d3\.select\("#reset-default"\)\.on\("click", \(\) => \{/);
    assert.match(html, /resetGraphStateToDefaults\(\);/);
    assert.match(html, /updateGraph\(\);/);
});

void test("graph visualization server mode keeps the current view live while regenerate runs and only reloads on changed data", () => {
    const html = renderGraphVisualizationHtml(
        {
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        {
            documentationCatalogs: createDocumentationCatalogsFixture(),
            isServerMode: true,
            title: "Server Regenerate Test"
        }
    );

    assert.match(html, /id="regenerate"/);
    assert.match(html, /id="open-project"/);
    assert.match(html, /window\.__GMLOOP_LOADED_TARGET__/);
    assert.match(html, /function renderLoadedTargetSummary\(\)/);
    assert.match(html, /fetch\("\/api\/open", \{ method: "POST" \}\)/);
    assert.match(html, /window\.__GMLOOP_DOCUMENTATION_CATALOGS__/);
    assert.match(html, /window\.__GMLOOP_PROJECT_CONFIGURATION__/);
    assert.match(html, /id="docs-page"/);
    assert.match(html, /id="cli-page"/);
    assert.match(html, /id="mcp-page"/);
    assert.match(html, /id="config-page"/);
    assert.match(html, /id="cli-content"/);
    assert.match(html, /id="mcp-content"/);
    assert.match(html, /id="config-content"/);
    assert.match(html, /function renderDocumentationCatalog\(\)/);
    assert.match(html, /function renderProjectConfigurationCatalog\(\)/);
    assert.match(html, /gmloop_graph_context/u);
    assert.match(html, /graph context/u);
    assert.match(html, /Workspace UI driven directly from live CLI and MCP catalogs\./);
    assert.match(html, /id="docs-view-cli"/);
    assert.match(html, /id="docs-view-mcp"/);
    assert.match(html, /Live CLI and MCP workspace catalogs are combined in a single Docs view\./);
    assert.match(html, /Loaded project configuration and workspace-owned normalized views/);
    assert.match(html, /class="button-content"/);
    assert.match(html, /class="button-label">Regenerate<\/span>/);
    assert.match(html, /class="button-label">Open\.\.\.<\/span>/);
    assert.match(html, /\.button-spinner/);
    assert.match(html, /@keyframes graph-button-spin/);
    assert.match(html, /button:disabled \{ cursor: wait; opacity: 0\.8; transform: none; \}/);
    assert.match(html, /fetch\("\/api\/reindex", \{ method: "POST" \}\)/);
    assert.match(html, /btn\.attr\("disabled", "true"\)/);
    assert.match(html, /button-spinner/);
    assert.match(html, /Regenerating…/u);
    assert.match(html, /const payload = await res\.json\(\);/);
    assert.match(html, /if \(payload\.changed === true\) \{/);
    assert.match(html, /window\.location\.reload\(\);/);
    assert.match(
        html,
        /btn\.attr\("disabled", null\)\.html\('<span class="button-content"><span class="button-label">Regenerate<\/span><\/span>'\);/
    );
    assert.match(html, /console\.error\("Reindex failed", responseText\);/);
});

void test("graph visualization server mode supports an empty boot state before any project is loaded", () => {
    const html = renderGraphVisualizationHtml(
        {
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [],
            nodes: [],
            projectRoot: ""
        },
        {
            isServerMode: true,
            title: "No project loaded"
        }
    );

    assert.match(
        html,
        /<div id="loaded-target" class="loaded-path"><strong>Active:<\/strong> No project loaded<\/div>/u
    );
    assert.match(html, /window\.__GMLOOP_LOADED_TARGET__ = null;/);
    assert.match(html, /loadedTargetEl\.textContent = "No active target";/);
    assert.match(html, /id="open-project"/);
});

void test("graph visualization template keeps tooltip interactive for text selection", () => {
    const html = renderEmptyGraphVisualizationHtml("Tooltip Test");

    assert.match(html, /pointer-events: auto/);
    assert.match(html, /tooltip\.on\("mouseenter"/);
    assert.match(html, /hideTooltipWithDelay/);
});

void test("graph visualization template keeps dimmed links visible enough to inspect long-distance connections", () => {
    const html = renderEmptyGraphVisualizationHtml("Edge Visibility Test");
    const linkCssRuleBody = extractCssRuleBody(html, ".link");
    const dimmedLinkCssRuleBody = extractCssRuleBody(html, ".link.dimmed");

    assert.match(linkCssRuleBody, /stroke-opacity: 0\.72;/);
    assert.match(linkCssRuleBody, /stroke-linecap: round;/);
    assert.match(linkCssRuleBody, /vector-effect: non-scaling-stroke;/);
    assert.match(dimmedLinkCssRuleBody, /stroke-opacity: 0\.2 !important;/);
});

void test("graph visualization template wraps and positions tooltip text inside the tooltip box", () => {
    const html = renderEmptyGraphVisualizationHtml("Tooltip Wrap Test");
    const tooltipCssRuleBody = extractCssRuleBody(html, "#tooltip");

    assert.match(tooltipCssRuleBody, /width: max-content;/);
    assert.match(tooltipCssRuleBody, /max-width: min\(520px, calc\(100vw - 24px\)\);/);
    assert.match(tooltipCssRuleBody, /box-sizing: border-box;/);
    assert.match(tooltipCssRuleBody, /overflow-wrap: anywhere;/);
    assert.match(tooltipCssRuleBody, /white-space: normal;/);
    assert.match(html, /function positionTooltip\(event\)/);
    assert.match(html, /getBoundingClientRect\(\)/);
    assert.match(html, /tooltip\.append\("h3"\)\.text\(d\.displayName\)/);
});

void test("graph visualization template pins selected node tooltip until selection changes", () => {
    const html = renderEmptyGraphVisualizationHtml("Pinned Tooltip Test");

    assert.match(html, /let pinnedTooltipNodeId = null/);
    assert.match(html, /pinnedTooltipNodeId = d\.id/);
    assert.match(html, /focusNodeId = d\.id/);
    assert.match(html, /pinnedTooltipNodeId !== null && pinnedTooltipNodeId !== d\.id/);
    assert.match(html, /pinnedTooltipNodeId === null && !tooltip\.node\(\)\.matches\(":hover"\)/);
    assert.doesNotMatch(html, /focusNodeId = focusNodeId === d\.id \? null : d\.id/);
});

void test("graph visualization template gives contains and defines distinct edge and legend styles", () => {
    const html = renderEmptyGraphVisualizationHtml("Legend Style Test");
    const containsCssRuleBody = extractCssRuleBody(html, ".link-contains");
    const definesCssRuleBody = extractCssRuleBody(html, ".link-defines");
    const embeddedStyles = extractEmbeddedEdgeLineVisualStyles(html);
    const containsStyle = findEmbeddedEdgeLineVisualStyle(embeddedStyles, "contains");
    const definesStyle = findEmbeddedEdgeLineVisualStyle(embeddedStyles, "defines");

    assert.match(containsCssRuleBody, /stroke: #2ca02c;/);
    assert.match(containsCssRuleBody, /stroke-dasharray: 1,4;/);
    assert.match(containsCssRuleBody, /stroke-linecap: round;/);
    assert.match(definesCssRuleBody, /stroke: #f2c94c;/);
    assert.doesNotMatch(definesCssRuleBody, /stroke-dasharray/);

    assert.notEqual(containsStyle.color, definesStyle.color);
    assert.notEqual(containsStyle.dashArray, definesStyle.dashArray);
    assert.notEqual(containsStyle.legendBorderStyle, definesStyle.legendBorderStyle);
});

void test("graph visualization template gives fallback, room, shader, and sprite distinct node colors", () => {
    const html = renderEmptyGraphVisualizationHtml("Node Color Test");
    const embeddedStyles = extractEmbeddedNodeVisualStyles(html);
    const defaultStyle = findEmbeddedNodeVisualStyle(embeddedStyles, "default");
    const roomStyle = findEmbeddedNodeVisualStyle(embeddedStyles, "room");
    const shaderStyle = findEmbeddedNodeVisualStyle(embeddedStyles, "shader");
    const spriteStyle = findEmbeddedNodeVisualStyle(embeddedStyles, "sprite");
    const targetColors = new Set([defaultStyle.color, roomStyle.color, shaderStyle.color, spriteStyle.color]);

    assert.equal(targetColors.size, 4);
    assert.match(extractCssRuleBody(html, ".node-default"), new RegExp(`fill: ${defaultStyle.color};`));
    assert.match(extractCssRuleBody(html, ".node-room"), new RegExp(`fill: ${roomStyle.color};`));
    assert.match(extractCssRuleBody(html, ".node-shader"), new RegExp(`fill: ${shaderStyle.color};`));
    assert.match(extractCssRuleBody(html, ".node-sprite"), new RegExp(`fill: ${spriteStyle.color};`));
    assert.match(html, /nodeVisualStyleByKind\.get\(typeVal\)\?\.color/);
});

void test("graph visualization template relies on semantic project nodes instead of a synthetic center node", () => {
    const html = renderGraphVisualizationHtml(
        {
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [
                {
                    source: "project::resource::InterplanetaryFootball.yyp",
                    target: "project::resource::scripts/kickoff/kickoff.yy",
                    type: "contains"
                }
            ],
            nodes: [
                {
                    displayName: "InterplanetaryFootball",
                    graphId: "project",
                    id: "project::resource::InterplanetaryFootball.yyp",
                    kind: "project",
                    name: "InterplanetaryFootball",
                    snippet: "",
                    summary: "project 'InterplanetaryFootball'. Defined in InterplanetaryFootball.yyp."
                }
            ],
            projectRoot: "/tmp/project"
        },
        { title: "Project Root Test" }
    );

    assert.doesNotMatch(html, /project::center/);
    assert.doesNotMatch(html, /Project root node/);
    assert.match(html, /InterplanetaryFootball/);
});
