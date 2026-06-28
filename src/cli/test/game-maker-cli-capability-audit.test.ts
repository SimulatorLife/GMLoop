import assert from "node:assert/strict";
import test from "node:test";

import type { CliCatalogEntry } from "../src/cli-core/command-catalog.js";
import type { McpToolCatalogEntry } from "../src/cli-core/mcp-tool-catalog.js";
import {
    createGameMakerCapabilityBoundaryAudit,
    type GameMakerCliCompanionCatalog
} from "../src/modules/game-maker-cli/index.js";

function createCliEntry(displayName: string): CliCatalogEntry {
    const commandPath = displayName.split(" ");
    return {
        arguments: [],
        commandName: commandPath.at(-1) ?? displayName,
        commandPath,
        description: `${displayName} command`,
        displayName,
        excludeFromMcp: false,
        options: [],
        usage: displayName
    };
}

function createMcpEntry(commandDisplayName: string): McpToolCatalogEntry {
    const commandPath = commandDisplayName.split(" ");
    return {
        commandDisplayName,
        commandPath,
        description: `${commandDisplayName} tool`,
        fields: [],
        toolName: `gmloop_${commandPath.join("_")}`
    };
}

function createCompanionCatalog(
    parameters: Readonly<{
        cliCommands?: ReadonlyArray<string>;
        mcpTools?: ReadonlyArray<string>;
    }> = {}
): GameMakerCliCompanionCatalog {
    return {
        available: true,
        cliCommands: (parameters.cliCommands ?? []).map((displayName) => ({
            commandPath: displayName.split(" "),
            description: `${displayName} official command`,
            displayName,
            parameters: [],
            usageLines: [displayName]
        })),
        error: null,
        invocation: "gm-cli",
        mcpServer: {
            available: true,
            error: null,
            name: "ResourceTool",
            projectPath: "/tmp/Game.yyp",
            serverId: "gm-cli",
            sourcePath: "/tmp/.mcp.json",
            version: "1.0.0"
        },
        mcpTools: (parameters.mcpTools ?? []).map((name) => ({
            description: `${name} official MCP tool`,
            fields: [],
            name
        })),
        version: "1.0.0"
    };
}

void test("capability audit keeps ordinary resource mutations on the official ResourceTool surface", () => {
    const audit = createGameMakerCapabilityBoundaryAudit({
        cliCatalog: [createCliEntry("resource list")],
        companionCatalog: createCompanionCatalog({
            cliCommands: ["resourcetool resource add"],
            mcpTools: ["resource_add"]
        }),
        mcpCatalog: [createMcpEntry("resource list")]
    });

    const resourceAdd = audit.capabilities.find((entry) => entry.operation === "resource add");
    assert.ok(resourceAdd);
    assert.equal(resourceAdd.classification, "direct_gm_cli_mcp");
    assert.equal(resourceAdd.gmloopCommand, null);
    assert.equal(resourceAdd.gmloopMcpTool, null);
    assert.equal(resourceAdd.status, "external_available");
    assert.deepEqual(resourceAdd.officialMcpTools, ["resource_add"]);
});

void test("capability audit reports implemented companion reads separately from placeholders", () => {
    const audit = createGameMakerCapabilityBoundaryAudit({
        cliCatalog: [
            createCliEntry("object event list"),
            createCliEntry("object event update"),
            createCliEntry("room layer update")
        ],
        companionCatalog: createCompanionCatalog(),
        mcpCatalog: [
            createMcpEntry("object event list"),
            createMcpEntry("object event update"),
            createMcpEntry("room layer update")
        ]
    });

    const objectEventList = audit.capabilities.find((entry) => entry.operation === "object event list");
    assert.ok(objectEventList);
    assert.equal(objectEventList.classification, "gmloop_companion");
    assert.equal(objectEventList.status, "gmloop_available");
    assert.equal(objectEventList.gmloopMcpTool, "gmloop_object_event_list");

    const objectEventUpdate = audit.capabilities.find((entry) => entry.operation === "object event update");
    assert.ok(objectEventUpdate);
    assert.equal(objectEventUpdate.classification, "gmloop_companion");
    assert.equal(objectEventUpdate.status, "gmloop_available");

    const roomLayerUpdate = audit.capabilities.find((entry) => entry.operation === "room layer update");
    assert.ok(roomLayerUpdate);
    assert.equal(roomLayerUpdate.classification, "gmloop_native_missing");
    assert.equal(roomLayerUpdate.status, "gmloop_placeholder");
});
