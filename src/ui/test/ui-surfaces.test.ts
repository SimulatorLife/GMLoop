import assert from "node:assert/strict";
import test from "node:test";

import { UI } from "../src/index.js";

void test("UI surface catalog defines implemented and planned cross-workspace views", () => {
    const graphSurface = UI.getUISurfaceDefinition("graph");
    const astSurface = UI.getUISurfaceDefinition("ast");
    const configSurface = UI.getUISurfaceDefinition("config");
    const docsSurface = UI.getUISurfaceDefinition("docs");
    const fixSurface = UI.getUISurfaceDefinition("fix");
    const liveReloadSurface = UI.getUISurfaceDefinition("live-reload");
    const mcpSurface = UI.getUISurfaceDefinition("mcp");
    const playgroundSurface = UI.getUISurfaceDefinition("playground");
    const rulesSurface = UI.getUISurfaceDefinition("rules");

    assert.equal(graphSurface.status, "implemented");
    assert.equal(astSurface.status, "planned");
    assert.equal(configSurface.status, "implemented");
    assert.equal(docsSurface.status, "implemented");
    assert.equal(fixSurface.status, "implemented");
    assert.equal(liveReloadSurface.status, "implemented");
    assert.equal(mcpSurface.status, "implemented");
    assert.equal(playgroundSurface.status, "implemented");
    assert.equal(rulesSurface.status, "planned");
    assert.deepEqual(
        UI.UI_SURFACE_DEFINITIONS.map((surfaceDefinition) => surfaceDefinition.id),
        ["graph", "ast", "config", "docs", "fix", "live-reload", "mcp", "playground", "rules"]
    );
});
