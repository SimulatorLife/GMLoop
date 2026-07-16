import assert from "node:assert/strict";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

void test("lsp --help documents LSP stdio startup usage", async () => {
    const result = await runCliTestCommand({
        argv: ["lsp", "--help"]
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Start the GMLoop GML language server \(LSP\)\./u);
    assert.match(result.stdout, /gmloop lsp/u);
});

void test("lsp command refuses captured CLI execution contexts", async () => {
    const result = await runCliTestCommand({
        argv: ["lsp"]
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /cannot run inside captured CLI execution contexts/u);
});

void test("lsp command accepts --stdio option", async () => {
    const result = await runCliTestCommand({
        argv: ["lsp", "--stdio"]
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /cannot run inside captured CLI execution contexts/u);
    assert.doesNotMatch(result.stderr, /unknown option/u);
});

void test("lsp command accepts the client process id supplied by VSCode", async () => {
    const result = await runCliTestCommand({
        argv: ["lsp", "--clientProcessId=49606"]
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /cannot run inside captured CLI execution contexts/u);
    assert.doesNotMatch(result.stderr, /unknown option/u);
});
