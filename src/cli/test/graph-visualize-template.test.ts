import assert from "node:assert/strict";
import test from "node:test";

import { renderGraphVisualizationHtml } from "../src/commands/graph-visualize-template.js";

void test("graph visualization template exposes view and label toggles", () => {
    const html = renderGraphVisualizationHtml(
        JSON.stringify({
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [],
            nodes: [],
            projectRoot: "/tmp/project"
        }),
        "Test Graph"
    );

    assert.match(html, /id="toggle-view"/);
    assert.match(html, /id="toggle-labels"/);
    assert.match(html, /id="json-view"/);
    assert.match(html, /labelMode = "auto"/);
    assert.match(html, /activeView = "visual"/);
});

void test("graph visualization template keeps tooltip interactive for text selection", () => {
    const html = renderGraphVisualizationHtml(
        JSON.stringify({
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            edges: [],
            nodes: [],
            projectRoot: "/tmp/project"
        }),
        "Tooltip Test"
    );

    assert.match(html, /pointer-events: auto/);
    assert.match(html, /tooltip\.on\("mouseenter"/);
    assert.match(html, /hideTooltipWithDelay/);
});
