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

function countTextOccurrences(text: string, pattern: RegExp): number {
    return Array.from(text.matchAll(pattern)).length;
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
    assert.match(html, /id="tab-fix"/u);
    assert.match(html, /id="fix-page"/u);
    assert.match(html, /id="run-fix"/u);
    assert.match(html, /id="tab-live-reload"/u);
    assert.match(html, /id="live-reload-page"/u);
    assert.match(html, /id="start-live-reload"/u);
    assert.match(html, /id="live-reload-content"/u);
    assert.match(html, /Pipeline Overview/u);
    assert.match(html, /class="project-context"/u);
    assert.match(html, /aria-label="Open GameMaker manual"/u);
    assert.match(html, /aria-label="Open GMLoop GitHub repository"/u);
    assert.equal(countTextOccurrences(html, /class="header-link-icon"/gu), 2);
    assert.doesNotMatch(html, />GitHub Repo</u);
    assert.match(html, /id="playground-rule-toolbar" class="rule-details"/u);
    assert.doesNotMatch(html, /id="toggle-lint"/u);
    assert.doesNotMatch(html, /id="toggle-refactor"/u);
});

void test("graph visualization entry html keeps project opening inside the project context card", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), { title: "No project loaded" });
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.equal(countTextOccurrences(html, /id="open-project"/gu), 1);
    assert.match(html, /<div class="loaded-target-actions">[\s\S]*id="open-project"/u);
    assert.match(
        html,
        /<div id="loaded-target" class="loaded-target-card"><span class="loaded-path-label">Loaded Project<\/span><span class="loaded-path-value">No project loaded<\/span><\/div>/u
    );
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
                    filePath: null,
                    graphId: "project",
                    id: "project::resource::InterplanetaryFootball.yyp",
                    kind: "project",
                    name: "InterplanetaryFootball",
                    resourcePath: "InterplanetaryFootball.yyp",
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
    assert.match(script, /const graphVisualizationLiveReload = null;/u);
    assert.match(script, /InterplanetaryFootball/u);
    assert.match(script, /resourcePath":"InterplanetaryFootball\.yyp/u);
    assert.match(script, /function readGraphNodePathLabel/u);
    assert.match(script, /Path:/u);
    assert.match(script, /const DEFAULT_PLAYGROUND_GML_SOURCE = \[/u);
    assert.match(script, /function resolveInitialPlaygroundGmlSource/u);
    assert.match(script, /bootstrapGraphVisualizationApp\(\{/u);
    assert.match(script, /window\.__GMLOOP_LIVE_RELOAD__ = graphVisualizationLiveReload;/u);
    assert.match(script, /import \{ fileOpen, directoryOpen \} from "\.\/vendor\/browser-fs-access\.js";/u);
});

void test("graph visualization module script renders unloaded project state without repeated empty labels", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), { title: "No project loaded" });
    const script = readBundleFileText(bundle, "assets/graph-visualization.js");

    assert.match(script, /loadedTargetLabel\.textContent = "Loaded Project";/u);
    assert.match(script, /loadedTargetValue\.textContent = "No project loaded";/u);
    assert.doesNotMatch(script, /loadedTargetLabel\.textContent = "No project loaded";/u);
});

void test("graph visualization module script shows live-reload startup state via button spinner instead of banner text", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), { title: "Live Reload Startup" });
    const script = readBundleFileText(bundle, "assets/graph-visualization.js");

    assert.match(script, /STARTING_LIVE_RELOAD_BUTTON_LABEL/u);
    assert.match(script, /button-spinner/u);
    assert.doesNotMatch(script, /Restarting live reload pipeline\. Waiting for watcher status/u);
    assert.doesNotMatch(script, /Core\./u);
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
    assert.match(script, /Workspace configuration snapshot/u);
    assert.match(script, /Rendered Workspace View/u);
    assert.match(script, /Raw gmloop\.json/u);
});

void test("graph visualization bundle exposes object inheritance as a readable edge filter and arrow", () => {
    const bundle = renderGraphVisualizationBundle(
        {
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [
                {
                    source: "project::resource::objects/obj_child/obj_child.yy",
                    target: "project::resource::objects/obj_parent/obj_parent.yy",
                    type: "inherits"
                }
            ],
            nodes: [
                {
                    displayName: "obj_child",
                    filePath: null,
                    graphId: "project",
                    id: "project::resource::objects/obj_child/obj_child.yy",
                    kind: "object",
                    name: "obj_child",
                    resourcePath: "objects/obj_child/obj_child.yy",
                    snippet: "",
                    summary: "Object 'obj_child'."
                },
                {
                    displayName: "obj_parent",
                    filePath: null,
                    graphId: "project",
                    id: "project::resource::objects/obj_parent/obj_parent.yy",
                    kind: "object",
                    name: "obj_parent",
                    resourcePath: "objects/obj_parent/obj_parent.yy",
                    snippet: "",
                    summary: "Object 'obj_parent'."
                }
            ],
            projectRoot: "/tmp/project"
        },
        { title: "Inheritance Graph" }
    );

    const html = readBundleFileText(bundle, bundle.entryHtmlPath);
    const script = readBundleFileText(bundle, "assets/graph-visualization.js");

    assert.match(html, /id="arrow-inherits"/u);
    assert.match(script, /"type":"inherits"/u);
    assert.match(script, /`filter-edge-\$\{edgeType\}`/u);
    assert.match(script, /formatLabel\(edgeType\)/u);
    assert.match(script, /edgeType === "inherits"/u);
});

void test("graph visualization css asset preserves core visual affordances", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), { title: "Styles Test" });
    const css = readBundleFileText(bundle, "assets/graph-visualization.css");

    assert.match(css, /font-size: 15px;/u);
    assert.match(css, /#tooltip/u);
    assert.match(css, /\.link \{ stroke-opacity: 0\.72;/u);
    assert.match(css, /@keyframes graph-button-spin/u);
    assert.match(css, /button:disabled \{ cursor: not-allowed;/u);
    assert.match(css, /button:disabled:hover \{ background: rgba\(255,255,255,0\.055\);/u);
    assert.match(css, /\.top-nav-button\.active:disabled \{/u);
    assert.match(css, /\.filter-item:has\(input:disabled\) \{ cursor: not-allowed; opacity: 0\.45; \}/u);
    assert.match(css, /\.live-reload-pipeline/u);
    assert.match(css, /\.live-reload-status-chip/u);
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
    assert.match(html, /id="graph-empty-state-indicator"/u);
    assert.match(html, /Open a GameMaker project to start exploring the graph/u);
});

void test("graph visualization bundle includes startup-loading shell affordances", () => {
    const bundle = renderGraphVisualizationBundle(createBaseData(), {
        startupState: {
            detail: null,
            message: "Loading project data…",
            phase: "loading"
        },
        title: "Startup Loading"
    });

    const script = readBundleFileText(bundle, "assets/graph-visualization.js");
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.match(script, /const graphVisualizationStartupState = /u);
    assert.match(html, /Loading project data…/u);
});

void test("renderGraphVisualizationHtml returns the bundle entry html", () => {
    const html = renderGraphVisualizationHtml(createBaseData(), { title: "Legacy Wrapper" });

    assert.match(html, /<!DOCTYPE html>/u);
    assert.match(html, /GMLoop Graph Index - Legacy Wrapper/u);
    assert.match(html, /assets\/graph-visualization\.js/u);
});
