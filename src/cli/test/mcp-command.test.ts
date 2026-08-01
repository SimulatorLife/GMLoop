import assert from "node:assert/strict";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

void test("mcp --help documents MCP stdio startup usage", async () => {
    const result = await runCliTestCommand({
        argv: ["mcp", "--help"]
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Start the GMLoop MCP stdio server\./u);
    assert.match(result.stdout, /gmloop mcp/u);
});

void test("mcp command refuses captured CLI execution contexts", async () => {
    const result = await runCliTestCommand({
        argv: ["mcp"]
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /cannot run inside captured CLI execution contexts/u);
});
