import assert from "node:assert/strict";
import test from "node:test";

import { renderGraphVisualizationBundle } from "../src/graph/graph-visualization-bundle.js";

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

type GraphVisualizationBundle = Awaited<ReturnType<typeof renderGraphVisualizationBundle>>;

function readBundleFileText(bundle: GraphVisualizationBundle, relativePath: string): string {
    const file = bundle.files.find((entry) => entry.relativePath === relativePath);
    assert.ok(file, `Expected bundle file '${relativePath}' to exist.`);
    return decodeBytes(file.bytes);
}

function countTextOccurrences(text: string, pattern: RegExp): number {
    return Array.from(text.matchAll(pattern)).length;
}

void test("graph visualization bundle emits entry html plus local runtime assets", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), { title: "Test Graph" });

    assert.equal(bundle.entryHtmlPath, "index.html");
    assert.ok(bundle.files.some((entry) => /^assets\/.+\.css$/u.test(entry.relativePath)));
    assert.ok(bundle.files.some((entry) => /^assets\/.+\.js$/u.test(entry.relativePath)));
    assert.equal(
        bundle.files.some((entry) => entry.relativePath.includes("vendor/d3")),
        false
    );
});

void test("graph visualization entry html references local assets and avoids CDN links", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), { title: "No CDN" });
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.match(html, /<link rel="stylesheet" crossorigin href="\.\/assets\/.+\.css">/u);
    assert.match(html, /<script type="module" crossorigin src="\.\/assets\/.+\.js"><\/script>/u);
    assert.doesNotMatch(html, /cdn\./u);
    assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//u);
    assert.doesNotMatch(html, /<link[^>]+href="https?:\/\//u);
    assert.match(html, /window\.__GMLOOP_GRAPH_VISUALIZATION_DATA__/u);
    assert.match(html, /window\.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__/u);
    assert.doesNotMatch(html, /window\.__GMLOOP_DOCUMENTATION_CATALOGS__/u);
    assert.doesNotMatch(html, /window\.__GMLOOP_LIVE_RELOAD__/u);
    assert.doesNotMatch(html, /window\.__GMLOOP_LOADED_TARGET__/u);
    assert.doesNotMatch(html, /window\.__GMLOOP_PROJECT_CONFIGURATION__/u);
    assert.doesNotMatch(html, /window\.__GMLOOP_STARTUP_STATE__/u);
    assert.doesNotMatch(html, />GitHub Repo</u);
});

void test("graph visualization entry html keeps project opening inside the project context card", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), { title: "No project loaded" });
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.equal(countTextOccurrences(html, /id="root"/gu), 1);
    assert.match(html, /"title":"No project loaded"/u);
});

void test("graph visualization module script embeds serialized graph payload and boot logic", async () => {
    const bundle = await renderGraphVisualizationBundle(
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

    const html = readBundleFileText(bundle, bundle.entryHtmlPath);
    const script = bundle.files
        .filter((entry) => entry.relativePath.endsWith(".js"))
        .map((entry) => decodeBytes(entry.bytes))
        .join("\n");

    assert.match(html, /InterplanetaryFootball/u);
    assert.match(html, /resourcePath":"InterplanetaryFootball\.yyp/u);
    assert.match(script, /Graph Index/u);
    assert.match(script, /Search graph nodes/u);
    assert.match(script, /api\/ui-revision/u);
});

void test("graph visualization module script renders unloaded project state without repeated empty labels", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), { title: "No project loaded" });
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.match(html, /"loadedTarget":null/u);
    assert.match(html, /"title":"No project loaded"/u);
});

void test("graph visualization module script shows live-reload startup state via button spinner instead of banner text", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), { title: "Live Reload Startup" });
    const script = bundle.files
        .filter((entry) => entry.relativePath.endsWith(".js"))
        .map((entry) => decodeBytes(entry.bytes))
        .join("\n");

    assert.match(script, /Building & Starting/u);
    assert.doesNotMatch(script, /Restarting live reload pipeline\. Waiting for watcher status/u);
});

void test("graph visualization module script embeds workspace rule catalogs when provided", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), {
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

    const html = readBundleFileText(bundle, bundle.entryHtmlPath);
    const script = bundle.files
        .filter((entry) => entry.relativePath.endsWith(".js"))
        .map((entry) => decodeBytes(entry.bytes))
        .join("\n");
    assert.match(html, /workspaceRules/u);
    assert.match(html, /gml\/test-rule/u);
    assert.match(html, /refactor\/test-codemod/u);
    assert.match(script, /activePage/u);
    assert.match(script, /history\.replaceState/u);
    assert.match(script, /Rendered/u);
    assert.match(script, /Raw gmloop\.json/u);
});

void test("graph visualization bundle exposes object inheritance as a readable edge filter and arrow", async () => {
    const bundle = await renderGraphVisualizationBundle(
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
    const script = bundle.files
        .filter((entry) => entry.relativePath.endsWith(".js"))
        .map((entry) => decodeBytes(entry.bytes))
        .join("\n");

    assert.match(html, /"type":"inherits"/u);
    assert.match(script, /arrow-inherits/u);
    assert.match(script, /inherits/u);
});

void test("graph visualization css asset preserves core visual affordances", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), { title: "Styles Test" });
    const css = bundle.files
        .filter((entry) => entry.relativePath.endsWith(".css"))
        .map((entry) => decodeBytes(entry.bytes))
        .join("\n");

    assert.match(css, /font-size:\s*15px/u);
    assert.match(css, /#tooltip/u);
    assert.match(css, /#tooltip\{[^}]*top:20px;[^}]*left:20px/u);
    assert.match(css, /\.link/u);
    assert.match(css, /@keyframes graph-button-spin/u);
    assert.match(css, /button:disabled\{cursor:not-allowed/u);
    assert.match(css, /\.top-nav-button\.active:disabled\{/u);
    assert.match(css, /\.live-reload-pipeline/u);
    assert.match(css, /\.live-reload-status-chip/u);
});

void test("graph visualization server-mode html includes regenerate affordance", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), {
        isServerMode: true,
        title: "Server Mode"
    });
    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.match(html, /"isServerMode":true/u);
    const script = bundle.files
        .filter((entry) => entry.relativePath.endsWith(".js"))
        .map((entry) => decodeBytes(entry.bytes))
        .join("\n");
    assert.match(script, /Regenerate/u);
});

void test("graph visualization bundle includes a graph empty state for no-project sessions", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), { title: "Empty State" });
    const script = bundle.files
        .filter((entry) => entry.relativePath.endsWith(".js"))
        .map((entry) => decodeBytes(entry.bytes))
        .join("\n");

    assert.match(script, /graph-empty-state/u);
    assert.match(script, /Open a GameMaker project to start exploring the graph/u);
});

void test("graph visualization bundle includes startup-loading shell affordances", async () => {
    const bundle = await renderGraphVisualizationBundle(createBaseData(), {
        startupState: {
            detail: null,
            message: "Loading project data…",
            phase: "loading"
        },
        title: "Startup Loading"
    });

    const html = readBundleFileText(bundle, bundle.entryHtmlPath);

    assert.match(html, /"startupState":\{"detail":null,"message":"Loading project data…","phase":"loading"\}/u);
});
