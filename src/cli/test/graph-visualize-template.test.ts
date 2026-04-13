import assert from "node:assert/strict";
import test from "node:test";

import { renderGraphVisualizationHtml } from "../src/commands/graph-visualize-template.js";

void test("renderGraphVisualizationHtml includes variables and structs styles and un-duplicates Resource", () => {
    const html = renderGraphVisualizationHtml("{}", "/fake/project/root");

    // Validates that we have structural additions
    assert.ok(html.includes("else if (typeVal === 'struct') color = \"#e377c2\";"), "Expected struct color");
    assert.ok(html.includes("else if (typeVal.includes('variable')) color = \"#17becf\";"), "Expected variable color");

    // Validate we changed overarching Resource label to Resources so it doesn't duplicate
    assert.ok(
        html.includes('"filter-resource", "Resources", "node-group", "resource-group"'),
        "Expected overarching node-group correctly labeled as Resources"
    );

    // Ensure formatLabel exists to nice-case things like instance_variable -> Instance variable
    assert.ok(html.includes("t.slice(1).replace(/_/g, ' ')"), "formatLabel removes underscores");
});
