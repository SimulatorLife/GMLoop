import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverConfiguredGameMakerCliMcpServer } from "../src/modules/game-maker-cli/index.js";

void test("discoverConfiguredGameMakerCliMcpServer reads the gm-cli ResourceTool MCP entry from .mcp.json", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-mcp-json-"));

    try {
        await writeFile(
            path.join(projectRoot, ".mcp.json"),
            JSON.stringify(
                {
                    mcpServers: {
                        gmloop: {
                            command: "gmloop",
                            args: ["mcp"]
                        },
                        "gamemaker-resource-tool": {
                            type: "stdio",
                            command: "npx",
                            args: ["@gamemaker/gm-cli@latest", "resourcetool", "mcp"],
                            env: {
                                GAMEMAKER_CHANNEL: "stable"
                            }
                        }
                    }
                },
                null,
                2
            ),
            "utf8"
        );

        const configuredServer = await discoverConfiguredGameMakerCliMcpServer(projectRoot);

        assert.deepEqual(configuredServer, {
            args: ["@gamemaker/gm-cli@latest", "resourcetool", "mcp"],
            command: "npx",
            displayName: "npx @gamemaker/gm-cli@latest resourcetool mcp",
            env: {
                GAMEMAKER_CHANNEL: "stable"
            },
            serverId: "gamemaker-resource-tool",
            sourcePath: path.join(projectRoot, ".mcp.json")
        });
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("discoverConfiguredGameMakerCliMcpServer reads the gm-cli ResourceTool MCP entry from Codex TOML config", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-codex-toml-"));

    try {
        await mkdir(path.join(projectRoot, ".codex"), { recursive: true });
        await writeFile(
            path.join(projectRoot, ".codex", "config.toml"),
            [
                "[mcp_servers.gmloop]",
                'command = "gmloop"',
                'args = ["mcp"]',
                "enabled = true",
                "",
                "[mcp_servers.gm-cli]",
                'command = "gm-cli"',
                'args = ["resourcetool", "mcp"]',
                "enabled = true",
                "",
                "[mcp_servers.gm-cli.env]",
                'GAMEMAKER_ACCESS_KEY = "abc123"'
            ].join("\n"),
            "utf8"
        );

        const configuredServer = await discoverConfiguredGameMakerCliMcpServer(projectRoot);

        assert.deepEqual(configuredServer, {
            args: ["resourcetool", "mcp"],
            command: "gm-cli",
            displayName: "gm-cli resourcetool mcp",
            env: {
                GAMEMAKER_ACCESS_KEY: "abc123"
            },
            serverId: "gm-cli",
            sourcePath: path.join(projectRoot, ".codex", "config.toml")
        });
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});
