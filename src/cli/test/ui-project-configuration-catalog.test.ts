import assert from "node:assert/strict";
import test from "node:test";

import { createGraphVisualizationProjectConfigurationCatalog } from "../src/modules/ui/index.js";

void test("project configuration catalog exposes all lint rules and available rulesets", async () => {
    const catalog = await createGraphVisualizationProjectConfigurationCatalog(
        {
            projectConfig: { lintRuleset: "recommended" },
            projectRoot: "/tmp/gmloop-ui-catalog"
        },
        {}
    );

    const rulesetNames = new Set(catalog.lint.rulesets.map((ruleset) => ruleset.name));
    const ruleLevels = new Set(catalog.lint.rules.map((rule) => rule.level));

    assert.ok(rulesetNames.has("recommended"));
    assert.ok(rulesetNames.has("feather"));
    assert.ok(rulesetNames.has("performance"));
    assert.ok(catalog.lint.rules.length > catalog.lint.rulesets[0].ruleIds.length);
    assert.ok(catalog.lint.rules.some((rule) => rule.ruleId === "gml/no-globalvar" && rule.level === "warn"));
    assert.ok(ruleLevels.has("off"));
});
