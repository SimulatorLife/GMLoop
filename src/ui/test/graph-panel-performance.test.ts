import assert from "node:assert/strict";
import test from "node:test";

import { createGraphModel, createGraphState, TestableGmGraphPanel } from "./graph-panel-test-harness.js";
import { renderTemplateValue } from "./render-template-helpers.js";

void test("graph panel caches layout and filtering calculations during navigation and selection", () => {
    const panel = new TestableGmGraphPanel();
    panel.model = createGraphModel();
    panel.state = createGraphState();

    // First render should trigger initial layout and filtering calculations
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 1);

    // Second render with no changes should reuse cached layout and filtering
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 1);

    // Selecting a node should trigger a re-render but reuse cached layout and filtering
    panel.selectNodeForTest("script-node");
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 1);

    // Modifying search query should re-trigger filtering but reuse cached layout
    panel.state = {
        ...panel.state,
        searchQuery: "obj"
    };
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 2);

    // Toggling node kinds should re-trigger filtering but reuse cached layout
    panel.toggleNodeKindForTest("script");
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 1);
    assert.equal(panel.filterCalculationCount, 3);

    // Changing model reference should recalculate layout and filtering
    panel.model = createGraphModel();
    renderTemplateValue(panel.renderForTest());
    assert.equal(panel.layoutCalculationCount, 2);
    assert.equal(panel.filterCalculationCount, 4);
});
