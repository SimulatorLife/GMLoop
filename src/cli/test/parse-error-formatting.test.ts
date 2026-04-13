/**
 * Tests that parse error messages are clean and user-friendly,
 * without overwhelming stack traces.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

void test("Parse error messages are user-friendly without stack traces", async () => {
    const testDir = await mkdtemp(path.join(os.tmpdir(), "parse-error-test-"));
    const badFile = path.join(testDir, "bad.gml");

    try {
        // Create a file with a syntax error (unclosed struct literal)
        await writeFile(
            badFile,
            `function broken() {
    var x = {
    // missing closing brace
`,
            "utf8"
        );

        const { exitCode, stderr } = await runCliTestCommand({
            argv: ["format", "--path", badFile, "--write"],
            cwd: testDir
        });

        // Should fail with non-zero exit code
        assert.notEqual(exitCode, 0, "Expected non-zero exit code for parse error");

        // Should contain the parse error message
        assert.match(
            stderr,
            /GameMakerSyntaxError.*Syntax Error/,
            "Expected error message to contain GameMakerSyntaxError and Syntax Error"
        );

        assert.match(stderr, /line 4, column 0/, "Expected error message to contain line and column information");

        assert.match(stderr, /unexpected end of file/, "Expected actionable error description");

        // Should NOT contain stack trace from ANTLR or parser internals
        assert.doesNotMatch(stderr, /at.*antlr4\.node\.mjs/, "Error output should not contain ANTLR stack traces");

        assert.doesNotMatch(
            stderr,
            /at GameMakerLanguageParser\./,
            "Error output should not contain parser stack traces"
        );

        // Should contain helpful summary
        assert.match(stderr, /Formatting failed for 1 file/, "Expected summary to indicate formatting failure");
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});

void test("format command ignores PRETTIER_PLUGIN_GML_ON_PARSE_ERROR fallback and still aborts by default", async () => {
    const testDir = await mkdtemp(path.join(os.tmpdir(), "parse-error-env-"));
    const badFile = path.join(testDir, "bad.gml");

    try {
        await writeFile(
            badFile,
            `function broken() {
    var value = {
`,
            "utf8"
        );

        const { exitCode, stderr } = await runCliTestCommand({
            argv: ["format", "--path", badFile, "--write"],
            cwd: testDir,
            env: {
                PRETTIER_PLUGIN_GML_ON_PARSE_ERROR: "skip"
            }
        });

        assert.notEqual(
            exitCode,
            0,
            "Expected parse failures to abort formatting even when PRETTIER_PLUGIN_GML_ON_PARSE_ERROR=skip is set"
        );
        assert.match(stderr, /Formatting failed for 1 file/, "Expected failure summary for parse-error abort mode");
    } finally {
        await rm(testDir, { recursive: true, force: true });
    }
});
