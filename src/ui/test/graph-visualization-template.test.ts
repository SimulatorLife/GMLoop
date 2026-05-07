import assert from "node:assert/strict";
import test from "node:test";

import {
    renderGraphVisualizationBundle,
    renderGraphVisualizationHtml
} from "../src/graph/graph-visualization-template.js";

function createBaseData() {
    return {
        generatedAt: "2026-01-01T00:00:00.000Z",
        graphs: [],
        edges: [],
        nodes: [],
        projectRoot: "/tmp/project"
    } as const;
}

function decodeBytes(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

function readBundleFileText(bundle: ReturnType<typeof renderGraphVisualizationBundle>, relativePath: string): string {
    const file = bundle.files.find((entry) => entry.relativePath === relativePath);
    assert.ok(file, `Expected bundle file '${relativePath}' to exist.`);
    return decodeBytes(file.bytes);
}

void test("graph visualization bundle emits entry html plus local runtime assets", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), { title: "Test Graph" });

    assert.equal(bundle.entryHtmlPath, "index.html");
    assert.ok(bundle.files.some((entry) => entry.relativePath === "assets/graph-visualization.css"));
    assert.ok(bundle.files.some((entry) => entry.relativePath === "assets/graph-visualization.js"));
    assert.ok(bundle.files.some((entry) => entry.relativePath === "assets/vendor/d3.min.js"));
    assert.ok(bundle.files.some((entry) => entry.relativePath === "assets/vendor/browser-fs-access.js"));
});

void test("graph visualization entry html references local assets and avoids CDN links", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), { title: "No CDN" });
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.match(html, /<link rel="stylesheet" href="\.\/assets\/graph-visualization\.css" \/>/u);
    assert.match(html, /<script src="\.\/assets\/vendor\/d3\.min\.js"><\/script>/u);
    assert.match(html, /<script type="module" src="\.\/assets\/graph-visualization\.js"><\/script>/u);
    assert.doesNotMatch(html, /cdn\./u);
    assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//u);
    assert.doesNotMatch(html, /<link[^>]+href="https?:\/\//u);
    assert.match(html, /id="docs-view-rules"/u);
    assert.match(html, /id="loaded-target-details"/u);
});

void test("graph visualization module script embeds serialized graph payload and boot logic", () => {
    const bundle = renderGraphVisualizationBundle(
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
        { title: "Payload Test" }
    );

    const script = readBundleFileText(bundle, "assets/graph-visualization.js");

    assert.match(script, /const graphVisualizationData = /u);
    assert.match(script, /InterplanetaryFootball/u);
    assert.match(script, /bootstrapGraphVisualizationApp\(\{/u);
    assert.match(script, /import \{ fileOpen, directoryOpen \} from "\.\/vendor\/browser-fs-access\.js";/u);
});

void test("graph visualization module script embeds workspace rule catalogs when provided", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), {
        documentationCatalogs: {
            cliCommands: [],
            mcpServer: {
                name: "gmloop-mcp",
                version: "0.0.1"
            },
            mcpTools: [],
            workspaceRules: {
                formatOptions: [
                    {
                        defaultValue: true,
                        description: "Format option description",
                        name: "gmloop_format"
                    }
                ],
                lintRules: [
                    {
                        description: "Lint rule description",
                        fixable: "code",
                        ruleId: "gml/test-rule"
                    }
                ],
                refactorCodemods: [
                    {
                        description: "Codemod description",
                        id: "refactor/test-codemod",
                        requiresSemanticProjectIndex: false
                    }
                ]
            }
        },
        title: "Rules Catalog"
    });

    const script = readBundleFileText(bundle, "assets/graph-visualization.js");
    assert.match(script, /workspaceRules/u);
    assert.match(script, /gml\/test-rule/u);
    assert.match(script, /refactor\/test-codemod/u);
    assert.match(script, /function createInitialGraphVisualizationUiState/u);
    assert.match(script, /parseGraphVisualizationUiStateFromUrlSearch/u);
    assert.match(script, /replaceGraphVisualizationUiStateInCurrentUrl/u);
});

void test("graph visualization css asset preserves core visual affordances", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), { title: "Styles Test" });
    const css = readBundleFileText(bundle, "assets/graph-visualization.css");

    assert.match(css, /font-size: 15px;/u);
    assert.match(css, /#tooltip/u);
    assert.match(css, /\.link \{ stroke-opacity: 0\.72;/u);
    assert.match(css, /@keyframes graph-button-spin/u);
});

void test("graph visualization server-mode html includes regenerate affordance", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), {
        isServerMode: true,
        title: "Server Mode"
    });
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.match(html, /id="regenerate"/u);
    assert.match(html, /button-label">Regenerate<\/span>/u);
});

void test("graph visualization bundle includes a graph empty state for no-project sessions", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), { title: "Empty State" });
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.match(html, /id="graph-empty-state"/u);
    assert.match(html, /Open a GameMaker project to start exploring the graph/u);
});

void test("renderGraphVisualizationHtml returns the bundle entry html", () => {
    const html = renderGraphVisualizationHtml(createBaseData(), { title: "Legacy Wrapper" });

    assert.match(html, /<!DOCTYPE html>/u);
    assert.match(html, /GMLoop Graph Index - Legacy Wrapper/u);
    assert.match(html, /assets\/graph-visualization\.js/u);
});
