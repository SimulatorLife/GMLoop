import assert from "node:assert/strict";
import test from "node:test";

import { createGraphVisualizationProjectConfigurationCatalog } from "../src/modules/ui/index.js";

void test("project configuration catalog exposes all lint rules and available rulesets", async () => {
    const catalog = await createGraphVisualizationProjectConfigurationCatalog(
        {
            projectConfig: { lintRuleset: "recommended" },
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
    assert.ok(rulesetNames.has("feather"));
    assert.ok(rulesetNames.has("performance"));
    assert.ok(catalog.lint.rules.length > catalog.lint.rulesets[0].ruleIds.length);
    assert.ok(catalog.lint.rules.some((rule) => rule.ruleId === "gml/no-globalvar" && rule.level === "warn"));
    assert.ok(ruleLevels.has("off"));
    assert.equal(catalog.gameMakerCli.available, true);
    assert.equal(catalog.gameMakerCli.cliCommands[0]?.displayName, "manual read");
    assert.equal(catalog.gameMakerCli.mcpTools[0]?.name, "status");
    assert.equal(catalog.gameMakerCli.mcpServer.serverId, "gamemaker-resource-tool");
});
