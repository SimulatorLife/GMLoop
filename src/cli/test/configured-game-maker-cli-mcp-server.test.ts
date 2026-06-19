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

void test("discoverConfiguredGameMakerCliMcpServer falls through a malformed .mcp.json to a valid mcp.json", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-mcp-malformed-"));

    try {
        // Truncated payload — simulates a partially-written or hand-edited
        // .mcp.json that previously surfaced as an uncaught `SyntaxError`
        // and aborted discovery for every subsequent candidate path.
        await writeFile(
            path.join(projectRoot, ".mcp.json"),
            '{ "mcpServers": { "gm-cli": { "command": "gm-cli" ',
            "utf8"
        );
        await writeFile(
            path.join(projectRoot, "mcp.json"),
            JSON.stringify({
                mcpServers: {
                    "gamemaker-resource-tool": {
                        type: "stdio",
                        command: "gm-cli",
                        args: ["resourcetool", "mcp"]
                    }
                }
            }),
            "utf8"
        );

        const configuredServer = await discoverConfiguredGameMakerCliMcpServer(projectRoot);

        assert.deepEqual(configuredServer, {
            args: ["resourcetool", "mcp"],
            command: "gm-cli",
            displayName: "gm-cli resourcetool mcp",
            env: {},
            serverId: "gamemaker-resource-tool",
            sourcePath: path.join(projectRoot, "mcp.json")
        });
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("discoverConfiguredGameMakerCliMcpServer resolves to null when every .mcp.json is malformed", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-mcp-all-malformed-"));

    try {
        await writeFile(path.join(projectRoot, ".mcp.json"), "{", "utf8");
        await writeFile(path.join(projectRoot, "mcp.json"), "not json at all", "utf8");

        const configuredServer = await discoverConfiguredGameMakerCliMcpServer(projectRoot);

        assert.equal(configuredServer, null);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("discoverConfiguredGameMakerCliMcpServer resolves to null when .mcp.json is a non-object payload", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-mcp-non-object-"));

    try {
        // Valid JSON, but the top-level value is a string — the parser must
        // treat it as "no servers configured" rather than crashing or
        // returning a misleadingly shaped entry.
        await writeFile(path.join(projectRoot, ".mcp.json"), '"just a string"', "utf8");

        const configuredServer = await discoverConfiguredGameMakerCliMcpServer(projectRoot);

        assert.equal(configuredServer, null);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});
