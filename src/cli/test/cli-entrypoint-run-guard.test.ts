import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

import { __test__ } from "../src/cli.js";

const { isCliEntrypointModule, isNodeTestRunnerProcess, shouldAutoRunCliProcess } = __test__;

void test("compiled CLI package entrypoint is executable for direct gmloop invocation", async () => {
    const indexPathJs = new URL("../index.js", import.meta.url).pathname;
    const stats = await stat(indexPathJs);

    assert.notEqual(stats.mode & 0o111, 0);
});

void test("isNodeTestRunnerProcess identifies node --test execution flags", () => {
    assert.equal(isNodeTestRunnerProcess(["--test"]), true);
    assert.equal(isNodeTestRunnerProcess(["--test-reporter=tap"]), true);
    assert.equal(isNodeTestRunnerProcess(["--test-reporter=spec"]), true);
    assert.equal(isNodeTestRunnerProcess(["--test-reporter=json"]), true);
    assert.equal(isNodeTestRunnerProcess(["--inspect", "--test"]), true);
    assert.equal(isNodeTestRunnerProcess(["--test=src/cli/test/cli-entrypoint-run-guard.test.ts"]), true);
    assert.equal(isNodeTestRunnerProcess(["--inspect"]), false);
});

void test("isCliEntrypointModule only accepts the active module file or its package entrypoint as the entrypoint", () => {
    const moduleUrl = new URL("../src/cli.ts", import.meta.url).href;
    const modulePath = new URL("../src/cli.ts", import.meta.url).pathname;
    const indexPathJs = new URL("../index.js", import.meta.url).pathname;
    const indexPathTs = new URL("../index.ts", import.meta.url).pathname;

    assert.equal(isCliEntrypointModule(modulePath, moduleUrl), true);
    assert.equal(isCliEntrypointModule(indexPathJs, moduleUrl), true);
    assert.equal(isCliEntrypointModule(indexPathTs, moduleUrl), true);
    assert.equal(isCliEntrypointModule("/tmp/other-entrypoint.js", moduleUrl), false);
    assert.equal(isCliEntrypointModule(undefined, moduleUrl), false);
});

void test("shouldAutoRunCliProcess blocks CLI autorun when skip env flag is set", () => {
    const moduleUrl = new URL("../src/cli.ts", import.meta.url).href;
    const modulePath = new URL("../src/cli.ts", import.meta.url).pathname;

    assert.equal(
        shouldAutoRunCliProcess(
            {
                PRETTIER_PLUGIN_GML_SKIP_CLI_RUN: "1"
            },
            [],
            modulePath,
            moduleUrl
        ),
        false
    );
});

void test("shouldAutoRunCliProcess only treats skip env value '1' as active", () => {
    assert.equal(
        shouldAutoRunCliProcess(
            {
                PRETTIER_PLUGIN_GML_SKIP_CLI_RUN: "true"
            },
            [],
            new URL("../src/cli.ts", import.meta.url).pathname,
            new URL("../src/cli.ts", import.meta.url).href
        ),
        true
    );
    assert.equal(
        shouldAutoRunCliProcess(
            {
                PRETTIER_PLUGIN_GML_SKIP_CLI_RUN: "yes"
            },
            [],
            new URL("../src/cli.ts", import.meta.url).pathname,
            new URL("../src/cli.ts", import.meta.url).href
        ),
        true
    );
    assert.equal(
        shouldAutoRunCliProcess(
            {
                PRETTIER_PLUGIN_GML_SKIP_CLI_RUN: "0"
            },
            [],
            new URL("../src/cli.ts", import.meta.url).pathname,
            new URL("../src/cli.ts", import.meta.url).href
        ),
        true
    );
    assert.equal(
        shouldAutoRunCliProcess(
            {
                PRETTIER_PLUGIN_GML_SKIP_CLI_RUN: ""
            },
            [],
            new URL("../src/cli.ts", import.meta.url).pathname,
            new URL("../src/cli.ts", import.meta.url).href
        ),
        true
    );
});

void test("shouldAutoRunCliProcess blocks CLI autorun in node test runner processes", () => {
    assert.equal(
        shouldAutoRunCliProcess(
            {},
            ["--test"],
            new URL("../src/cli.ts", import.meta.url).pathname,
            new URL("../src/cli.ts", import.meta.url).href
        ),
        false
    );
});

void test("shouldAutoRunCliProcess blocks CLI autorun when skip flag and test runner flags are both present", () => {
    assert.equal(
        shouldAutoRunCliProcess(
            {
                PRETTIER_PLUGIN_GML_SKIP_CLI_RUN: "1"
            },
            ["--test"],
            new URL("../src/cli.ts", import.meta.url).pathname,
            new URL("../src/cli.ts", import.meta.url).href
        ),
        false
    );
});

void test("shouldAutoRunCliProcess allows autorun outside test and without skip flag", () => {
    assert.equal(
        shouldAutoRunCliProcess(
            {},
            ["--inspect"],
            new URL("../src/cli.ts", import.meta.url).pathname,
            new URL("../src/cli.ts", import.meta.url).href
        ),
        true
    );
});

void test("shouldAutoRunCliProcess blocks autorun when cli is imported by another entrypoint", () => {
    assert.equal(
        shouldAutoRunCliProcess(
            {},
            [],
            "/workspace/GMLoop/src/mcp/dist/main.js",
            new URL("../src/cli.ts", import.meta.url).href
        ),
        false
    );
});
