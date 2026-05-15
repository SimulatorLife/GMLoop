import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    createGameMakerCliInvocationPlan,
    loadGameMakerCliCompanionCatalog
} from "../src/modules/game-maker-cli/index.js";

void test("createGameMakerCliInvocationPlan falls back to npx latest when no explicit tool path is configured", () => {
    const plan = createGameMakerCliInvocationPlan(null, ["--help"]);

    assert.deepEqual(plan, [
        {
            args: ["--help"],
            command: "gm-cli",
            displayName: "gm-cli"
        },
        {
            args: ["--yes", "@gamemaker/gm-cli@latest", "--help"],
            command: "npx",
            displayName: "npx @gamemaker/gm-cli@latest"
        }
    ]);
});

void test("loadGameMakerCliCompanionCatalog parses live help output and MCP tools from injected sources", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-gm-cli-catalog-"));
    await writeFile(path.join(projectRoot, "Game.yyp"), "{}\n", "utf8");

    const helpByDisplayName = new Map<string, string>([
        ["npx --yes @gamemaker/gm-cli@latest --version", "1.3.0\n"],
        [
            "npx --yes @gamemaker/gm-cli@latest --help",
            [
                "USAGE",
                "  gm-cli manual",
                "  gm-cli resourcetool",
                "",
                "The GameMaker command-line interface",
                "",
                "COMMANDS",
                "  manual        Use the GameMaker manual",
                "  resourcetool  Programmatically read and manipulate project resources"
            ].join("\n")
        ],
        [
            "npx --yes @gamemaker/gm-cli@latest manual --help",
            [
                "USAGE",
                "  gm-cli manual read|open ...",
                "",
                "Use the GameMaker manual",
                "",
                "COMMANDS",
                "  read  Query the GameMaker manual",
                "  open  Open a manual page in the browser"
            ].join("\n")
        ],
        [
            "npx --yes @gamemaker/gm-cli@latest manual read --help",
            [
                "USAGE",
                "  gm-cli manual read <query>",
                "",
                "Query the GameMaker manual",
                "",
                "FLAGS",
                "     [--language]  Use the manual in the specified language [en|es]",
                "  -h  --help       Print help information and exit",
                "",
                "ARGUMENTS",
                "  query  Query"
            ].join("\n")
        ],
        [
            "npx --yes @gamemaker/gm-cli@latest manual open --help",
            [
                "USAGE",
                "  gm-cli manual open <query>",
                "",
                "Open the GameMaker manual in a browser",
                "",
                "ARGUMENTS",
                "  query  Query"
            ].join("\n")
        ],
        [
            "npx --yes @gamemaker/gm-cli@latest resourcetool --help",
            [
                "USAGE",
                "  gm-cli resourcetool mcp|eval|repl|script ...",
                "",
                "Programmatically read and manipulate project resources",
                "",
                "COMMANDS",
                "  mcp     Run as Model Context Protocol server",
                "  eval    Evaluate a ResourceTool command",
                "  repl    Run an interactive session",
                "  script  Run a script file"
            ].join("\n")
        ],
        [
            "npx --yes @gamemaker/gm-cli@latest resourcetool mcp --help",
            [
                "USAGE",
                "  gm-cli resourcetool mcp",
                "",
                "Run as Model Context Protocol server",
                "",
                "ARGUMENTS",
                "  [project]  Path to the project .yyp file"
            ].join("\n")
        ],
        [
            "npx --yes @gamemaker/gm-cli@latest resourcetool eval --help",
            [
                "USAGE",
                "  gm-cli resourcetool eval <command>",
                "",
                "Evaluate a ResourceTool command",
                "",
                "ARGUMENTS",
                "  command    Command to evaluate",
                "  [project]  Path to the project .yyp file"
            ].join("\n")
        ],
        [
            "npx --yes @gamemaker/gm-cli@latest resourcetool repl --help",
            [
                "USAGE",
                "  gm-cli resourcetool repl",
                "",
                "Run an interactive session",
                "",
                "ARGUMENTS",
                "  [project]  Path to the project .yyp file"
            ].join("\n")
        ],
        [
            "npx --yes @gamemaker/gm-cli@latest resourcetool script --help",
            [
                "USAGE",
                "  gm-cli resourcetool script <file>",
                "",
                "Run a script file",
                "",
                "ARGUMENTS",
                "   file      Path to the script file",
                "  [project]  Path to the project .yyp file"
            ].join("\n")
        ]
    ]);

    try {
        const catalog = await loadGameMakerCliCompanionCatalog(
            {
                projectRoot
            },
            {
                executeCommand: async (invocation) => {
                    if (invocation.command === "gm-cli") {
                        const error = new Error("missing gm-cli") as NodeJS.ErrnoException;
                        error.code = "ENOENT";
                        throw error;
                    }

                    const key = `${invocation.command} ${invocation.args.join(" ")}`.trim();
                    const stdout = helpByDisplayName.get(key);
                    if (stdout === undefined) {
                        throw new Error(`Unexpected gm-cli command: ${key}`);
                    }

                    return {
                        exitCode: 0,
                        stderr: "",
                        stdout
                    };
                },
                probeMcpServer: async () => ({
                    serverName: "ResourceTool",
                    serverVersion: "2024.14.15",
                    tools: [
                        {
                            description: "Checks the Status of the current Project",
                            inputSchema: {
                                properties: {
                                    verbose: {
                                        description: "Emit verbose output",
                                        type: "boolean"
                                    }
                                },
                                required: [],
                                type: "object"
                            },
                            name: "status"
                        }
                    ]
                })
            }
        );

        assert.equal(catalog.available, true);
        assert.equal(catalog.invocation, "npx @gamemaker/gm-cli@latest");
        assert.equal(catalog.version, "1.3.0");
        assert.deepEqual(
            catalog.cliCommands.map((entry) => entry.displayName),
            [
                "manual open",
                "manual read",
                "resourcetool eval",
                "resourcetool mcp",
                "resourcetool repl",
                "resourcetool script"
            ]
        );
        assert.equal(
            catalog.cliCommands.find((entry) => entry.displayName === "manual read")?.parameters[0]?.name,
            "language"
        );
        assert.equal(
            catalog.cliCommands.find((entry) => entry.displayName === "manual read")?.parameters[1]?.name,
            "help"
        );
        assert.equal(
            catalog.cliCommands.find((entry) => entry.displayName === "manual read")?.parameters[2]?.name,
            "query"
        );
        assert.equal(catalog.mcpServer.available, true);
        assert.equal(catalog.mcpServer.projectPath, path.join(projectRoot, "Game.yyp"));
        assert.equal(catalog.mcpTools.length, 1);
        assert.equal(catalog.mcpTools[0]?.name, "status");
        assert.equal(catalog.mcpTools[0]?.fields[0]?.valueType, "boolean");
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});
