import assert from "node:assert/strict";
import test from "node:test";

import { UI } from "../src/index.js";

void test("UI surface catalog defines graph as implemented and future cross-workspace views as planned", () => {
    const graphSurface = UI.getUISurfaceDefinition("graph");
    const astSurface = UI.getUISurfaceDefinition("ast");
    const cliDocsSurface = UI.getUISurfaceDefinition("cli-docs");
    const mcpSurface = UI.getUISurfaceDefinition("mcp");
    const rulesSurface = UI.getUISurfaceDefinition("rules");

    assert.equal(graphSurface.status, "implemented");
    assert.equal(astSurface.status, "planned");
    assert.equal(cliDocsSurface.status, "planned");
    assert.equal(mcpSurface.status, "planned");
    assert.equal(rulesSurface.status, "planned");
    assert.deepEqual(
        UI.UI_SURFACE_DEFINITIONS.map((surfaceDefinition) => surfaceDefinition.id),
        ["graph", "ast", "cli-docs", "mcp", "rules"]
    );
});
