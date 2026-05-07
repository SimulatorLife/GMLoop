import assert from "node:assert/strict";
import test from "node:test";

import { UI } from "../src/index.js";

void test("UI surface catalog defines implemented and planned cross-workspace views", () => {
    const graphSurface = UI.getUISurfaceDefinition("graph");
    const astSurface = UI.getUISurfaceDefinition("ast");
    const docsSurface = UI.getUISurfaceDefinition("docs");
    const rulesSurface = UI.getUISurfaceDefinition("rules");
    const playgroundSurface = UI.getUISurfaceDefinition("playground");

    assert.equal(graphSurface.status, "implemented");
    assert.equal(astSurface.status, "planned");
    assert.equal(docsSurface.status, "implemented");
    assert.equal(rulesSurface.status, "planned");
    assert.equal(playgroundSurface.status, "implemented");
    assert.deepEqual(
        UI.UI_SURFACE_DEFINITIONS.map((surfaceDefinition) => surfaceDefinition.id),
        ["graph", "ast", "docs", "rules", "playground"]
    );
});
