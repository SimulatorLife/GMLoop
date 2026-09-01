import assert from "node:assert/strict";
import test from "node:test";

import { createGraphVisualizationProjectConfigurationCatalog } from "../src/modules/ui/index.js";

void test("project configuration catalog exposes all lint rules and available rulesets", async () => {
    const catalog = await createGraphVisualizationProjectConfigurationCatalog(
        {
            projectConfig: {
                lintRuleset: "recommended",
                refactor: {
                    codemods: {
                        loopLengthHoisting: {}
                    }
                }
            },
            projectRoot: "/tmp/gmloop-ui-catalog"
        },
        {},
        {
            loadGameMakerCliCatalog: async () => ({
                available: true,
                cliCommands: [
                    {
                        commandPath: ["manual", "read"],
                        description: "Query the GameMaker manual",
                        displayName: "manual read",
                        parameters: [],
                        usageLines: ["gm-cli manual read <query>"]
                    }
                ],
                error: null,
                invocation: "gm-cli",
                mcpServer: {
                    available: true,
                    error: null,
                    name: "ResourceTool",
                    projectPath: "/tmp/gmloop-ui-catalog/Game.yyp",
                    serverId: "gamemaker-resource-tool",
                    sourcePath: "/tmp/gmloop-ui-catalog/.mcp.json",
                    version: "2024.14.15"
                },
                mcpTools: [
                    {
                        description: "Checks the Status of the current Project",
                        fields: [],
                        name: "status"
                    }
                ],
                version: "1.3.0"
            })
        }
    );

    const rulesetNames = new Set(catalog.lint.rulesets.map((ruleset) => ruleset.name));
    const ruleLevels = new Set(catalog.lint.rules.map((rule) => rule.level));

    assert.ok(rulesetNames.has("recommended"));
    assert.ok(rulesetNames.has("all"));
    assert.ok(rulesetNames.has("feather"));
    assert.ok(rulesetNames.has("performance"));
    assert.ok(rulesetNames.has("fixible"));
    const recommendedRuleset = catalog.lint.rulesets.find((ruleset) => ruleset.name === "recommended");
    assert.ok(recommendedRuleset);
    assert.ok(catalog.lint.rules.length > recommendedRuleset.ruleIds.length);
    assert.ok(catalog.lint.rules.some((rule) => rule.ruleId === "gml/no-globalvar" && rule.level === "warn"));
    assert.ok(
        catalog.lint.rules.some((rule) => rule.ruleId === "gml/prefer-direct-boolean-return" && rule.level === "warn")
    );
    const performanceRuleset = catalog.lint.rulesets.find((ruleset) => ruleset.name === "performance");
    assert.ok(performanceRuleset);
    assert.ok(performanceRuleset.ruleIds.includes("gml/prefer-direct-boolean-return"));
    assert.ok(ruleLevels.has("off"));
    assert.equal(catalog.gameMakerCli.available, true);
    assert.equal(catalog.gameMakerCli.cliCommands[0]?.displayName, "manual read");
    assert.equal(catalog.gameMakerCli.mcpTools[0]?.name, "status");
    assert.equal(catalog.gameMakerCli.mcpServer.serverId, "gamemaker-resource-tool");

    const loopLengthHoistingCodemod = catalog.refactor.codemods.find((c) => c.id === "loopLengthHoisting");
    assert.ok(loopLengthHoistingCodemod);
    assert.equal(loopLengthHoistingCodemod.enabled, true);

    const namingConventionCodemod = catalog.refactor.codemods.find((c) => c.id === "namingConvention");
    assert.ok(namingConventionCodemod);
    assert.equal(namingConventionCodemod.enabled, false);

    // Verify rulesets include ruleLevels with proper severity mappings
    assert.ok(recommendedRuleset.ruleLevels);
    assert.ok(Object.keys(recommendedRuleset.ruleLevels).length > 0);
    assert.equal(recommendedRuleset.ruleLevels["gml/no-globalvar"], "warn");
});

void test("fixible ruleset includes ruleLevels for all fixable rules", async () => {
    const catalog = await createGraphVisualizationProjectConfigurationCatalog(
        {
            projectConfig: { lintRuleset: "fixible" },
            projectRoot: "/tmp/gmloop-ui-fixible"
        },
        {},
        {
            loadGameMakerCliCatalog: async () => ({
                available: false,
                cliCommands: [],
                error: null,
                invocation: null,
                mcpServer: {
                    available: false,
                    error: null,
                    name: null,
                    projectPath: null,
                    serverId: null,
                    sourcePath: null,
                    version: null
                },
                mcpTools: [],
                version: null
            })
        }
    );

    const fixibleRuleset = catalog.lint.rulesets.find((ruleset) => ruleset.name === "fixible");
    assert.ok(fixibleRuleset);
    assert.ok(fixibleRuleset.ruleIds.length > 0, "fixible ruleset should have rules");
    assert.ok(Object.keys(fixibleRuleset.ruleLevels).length > 0, "fixible ruleset should have ruleLevels");

    // Every rule in the fixible ruleset should have a non-off severity level
    for (const ruleId of fixibleRuleset.ruleIds) {
        const level = fixibleRuleset.ruleLevels[ruleId];
        assert.ok(
            level === "warn" || level === "error",
            `fixible ruleset rule ${ruleId} should have warn or error level, got ${level}`
        );
    }

    // With fixible as the active ruleset, fixable rules should reflect the ruleset's levels
    for (const rule of catalog.lint.rules) {
        const rulesetLevel = fixibleRuleset.ruleLevels[rule.ruleId];
        if (rulesetLevel !== undefined) {
            assert.equal(rule.level, rulesetLevel, `rule ${rule.ruleId} level should match fixible ruleset level`);
        }
    }
});
