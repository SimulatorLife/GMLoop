import assert from "node:assert/strict";
import test from "node:test";

import { renderGraphVisualizationHtml } from "../src/commands/graph-visualize-template.js";

void test("renderGraphVisualizationHtml groups resource kinds under Resources and styles graph node kinds", () => {
    const html = renderGraphVisualizationHtml("{}", "/fake/project/root");

    // Ensure variable/struct categories are visually distinct in both legend and nodes.
    assert.ok(html.includes("else if (typeVal === 'struct') color = \"#e377c2\";"), "Expected struct color");
    assert.ok(html.includes("else if (typeVal.includes('variable')) color = \"#17becf\";"), "Expected variable color");
    assert.ok(
        html.includes(".node-global_variable, .node-instance_variable { fill: #17becf; }"),
        "Expected variable node styles"
    );
    assert.ok(html.includes(".node-struct, .node-constructor { fill: #e377c2; }"), "Expected struct node styles");

    // Resource parent grouping should include the generic "resource" kind so there is no
    // sibling "resource" entry separate from the "Resources" parent.
    assert.ok(
        html.includes('const resourceKinds = new Set(["resource", "script", "object", "room", "sprite", "shader"]);'),
        "Expected resource kind list to include the resource parent kind"
    );
    assert.ok(
        html.includes('"filter-resource", "Resources", "node-group", "resource-group"'),
        "Expected Resources parent filter"
    );

    // Ensure formatLabel still produces readable labels like "Instance variable".
    assert.ok(html.includes("t.slice(1).replace(/_/g, ' ')"), "formatLabel removes underscores");
});
