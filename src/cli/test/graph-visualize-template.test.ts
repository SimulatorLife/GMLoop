import assert from "node:assert/strict";
import test from "node:test";

import { renderGraphVisualizationHtml } from "../src/commands/graph-visualize-template.js";

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
        JSON.stringify({
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [],
            nodes: [],
            projectRoot: "/tmp/project"
        }),
        title
    );
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

    assert.match(html, /id="toggle-view"/);
    assert.match(html, /id="toggle-labels"/);
    assert.match(html, /id="json-view"/);
    assert.match(html, /labelMode = "auto"/);
    assert.match(html, /activeView = "visual"/);
});

void test("graph visualization template keeps tooltip interactive for text selection", () => {
    const html = renderEmptyGraphVisualizationHtml("Tooltip Test");

    assert.match(html, /pointer-events: auto/);
    assert.match(html, /tooltip\.on\("mouseenter"/);
    assert.match(html, /hideTooltipWithDelay/);
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

void test("graph visualization template gives resource, room, shader, and sprite distinct node colors", () => {
    const html = renderEmptyGraphVisualizationHtml("Node Color Test");
    const embeddedStyles = extractEmbeddedNodeVisualStyles(html);
    const resourceStyle = findEmbeddedNodeVisualStyle(embeddedStyles, "resource");
    const roomStyle = findEmbeddedNodeVisualStyle(embeddedStyles, "room");
    const shaderStyle = findEmbeddedNodeVisualStyle(embeddedStyles, "shader");
    const spriteStyle = findEmbeddedNodeVisualStyle(embeddedStyles, "sprite");
    const targetColors = new Set([resourceStyle.color, roomStyle.color, shaderStyle.color, spriteStyle.color]);

    assert.equal(targetColors.size, 4);
    assert.match(extractCssRuleBody(html, ".node-resource"), new RegExp(`fill: ${resourceStyle.color};`));
    assert.match(extractCssRuleBody(html, ".node-room"), new RegExp(`fill: ${roomStyle.color};`));
    assert.match(extractCssRuleBody(html, ".node-shader"), new RegExp(`fill: ${shaderStyle.color};`));
    assert.match(extractCssRuleBody(html, ".node-sprite"), new RegExp(`fill: ${spriteStyle.color};`));
    assert.match(html, /nodeVisualStyleByKind\.get\(typeVal\)\?\.color/);
});

void test("graph visualization template relies on semantic project nodes instead of a synthetic center node", () => {
    const html = renderGraphVisualizationHtml(
        JSON.stringify({
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
        }),
        "Project Root Test"
    );

    assert.doesNotMatch(html, /project::center/);
    assert.doesNotMatch(html, /Project root node/);
    assert.match(html, /InterplanetaryFootball/);
});

void test("graph visualization template exposes missing node kinds with requested default filters", () => {
    const html = renderGraphVisualizationHtml(
        JSON.stringify({
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [],
            nodes: [
                {
                    displayName: "Player",
                    graphId: "project",
                    id: "struct",
                    kind: "struct",
                    name: "Player",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "health",
                    graphId: "project",
                    id: "struct-variable",
                    kind: "struct_variable",
                    name: "health",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "speed_bonus",
                    graphId: "project",
                    id: "instance-variable",
                    kind: "instance_variable",
                    name: "speed_bonus",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "local_value",
                    graphId: "project",
                    id: "local-variable",
                    kind: "local_variable",
                    name: "local_value",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "State.Idle",
                    graphId: "project",
                    id: "enum-member",
                    kind: "enum_member",
                    name: "Idle",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "helper",
                    graphId: "project",
                    id: "function",
                    kind: "function",
                    name: "helper",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "snd_hit",
                    graphId: "project",
                    id: "sound",
                    kind: "sound",
                    name: "snd_hit",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "pth_patrol",
                    graphId: "project",
                    id: "path",
                    kind: "path",
                    name: "pth_patrol",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "seq_intro",
                    graphId: "project",
                    id: "sequence",
                    kind: "sequence",
                    name: "seq_intro",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "note_design",
                    graphId: "project",
                    id: "note",
                    kind: "note",
                    name: "note_design",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "ps_sparks",
                    graphId: "project",
                    id: "particle-system",
                    kind: "particle_system",
                    name: "ps_sparks",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "config",
                    graphId: "project",
                    id: "data-file",
                    kind: "data_file",
                    name: "config",
                    snippet: "",
                    summary: ""
                },
                {
                    displayName: "mystery_resource",
                    graphId: "project",
                    id: "resource",
                    kind: "resource",
                    name: "mystery_resource",
                    snippet: "",
                    summary: ""
                }
            ],
            projectRoot: "/tmp/project"
        }),
        "Filter Test"
    );

    assert.match(html, /const allNodes = DATA\.nodes\.filter\(\(nodeValue\) => nodeValue\.kind !== "file"\)/);
    assert.match(html, /"sound"/);
    assert.match(html, /"path"/);
    assert.match(html, /"sequence"/);
    assert.match(html, /"note"/);
    assert.match(html, /"particle_system"/);
    assert.match(html, /"struct_variable"/);
    assert.match(html, /"instance_variable"/);
    assert.match(html, /"local_variable"/);
    assert.match(html, /"enum_member"/);
    assert.match(html, /"function"/);
    assert.match(html, /"data_file"/);
    assert.match(html, /"resource"/);
    assert.match(html, /const defaultDisabledNodeKinds = new Set\(\[[\s\S]*"struct_variable"[\s\S]*\]\)/);
    assert.match(html, /const defaultDisabledNodeKinds = new Set\(\[[\s\S]*"instance_variable"[\s\S]*\]\)/);
    assert.match(html, /const defaultDisabledNodeKinds = new Set\(\[[\s\S]*"local_variable"[\s\S]*\]\)/);
    assert.match(html, /const defaultDisabledNodeKinds = new Set\(\[[\s\S]*"enum_member"[\s\S]*\]\)/);
    assert.match(html, /const defaultDisabledNodeKinds = new Set\(\[[\s\S]*"function"[\s\S]*\]\)/);
    assert.match(html, /const defaultDisabledNodeKinds = new Set\(\[[\s\S]*"data_file"[\s\S]*\]\)/);
    assert.match(html, /\.property\("checked", createInitialFilterCheckedState\(category, typeVal\)\)/);
    assert.doesNotMatch(html, /\.attr\("checked", createInitialFilterCheckedState\(category, typeVal\)\)/);
});
