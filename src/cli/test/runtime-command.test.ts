import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

async function withTempProject(testName: string, run: (projectRoot: string) => Promise<void>): Promise<void> {
    const projectRoot = await mkdtemp(path.join(tmpdir(), `gmloop-${testName}-`));
    await writeFile(path.join(projectRoot, "gmloop.json"), "{}\n", "utf8");
    try {
        await run(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
}

void test("runtime command catalog includes expected leaves", async () => {
    const { getCliCommandCatalog } = await import("../src/cli.js");
    const catalog = getCliCommandCatalog();
    const leaves = new Set(catalog.map((entry) => entry.displayName));
    assert.ok(leaves.has("runtime instances"));
    assert.ok(leaves.has("runtime inspect"));
    assert.ok(leaves.has("runtime get"));
    assert.ok(leaves.has("runtime set"));
    assert.ok(leaves.has("runtime call"));
    assert.ok(leaves.has("runtime watch"));
    assert.ok(leaves.has("runtime state"));
    assert.ok(leaves.has("runtime logs"));
});

void test("runtime set/get round-trips persisted values", async () => {
    await withTempProject("runtime-set-get", async (projectRoot) => {
        const setResult = await runCliTestCommand({
            argv: [
                "runtime",
                "set",
                "--project",
                projectRoot,
                "--path",
                "hp",
                "--value",
                "42",
                "--scope",
                "global",
                "--json"
            ]
        });
        assert.equal(setResult.exitCode, 0);
        const setPayload = JSON.parse(setResult.stdout) as { payload: { ok: boolean; value: number } };
        assert.equal(setPayload.payload.ok, true);
        assert.equal(setPayload.payload.value, 42);

        const getResult = await runCliTestCommand({
            argv: ["runtime", "get", "--project", projectRoot, "--path", "hp", "--scope", "global", "--json"]
        });
        assert.equal(getResult.exitCode, 0);
        const getPayload = JSON.parse(getResult.stdout) as { payload: { ok: boolean; value: number } };
        assert.equal(getPayload.payload.ok, true);
        assert.equal(getPayload.payload.value, 42);
    });
});

void test("runtime call/logs produce structured output and include runner logs", async () => {
    await withTempProject("runtime-call-logs", async (projectRoot) => {
        const startRunner = await runCliTestCommand({
            argv: ["runner", "start", "--project", projectRoot, "--json"],
            env: {
                ...process.env,
                GMLOOP_RUNNER_COMMAND: "node",
                GMLOOP_RUNNER_ARGS: '["-e","setInterval(() => {}, 1000)"]'
            }
        });
        assert.equal(startRunner.exitCode, 0);

        const callResult = await runCliTestCommand({
            argv: ["runtime", "call", "--project", projectRoot, "--method", "scr_boot", "--args", "[1,true]", "--json"]
        });
        assert.equal(callResult.exitCode, 0);
        const callPayload = JSON.parse(callResult.stdout) as {
            command: string;
            payload: { ok: boolean; method: string };
        };
        assert.equal(callPayload.command, "runtime call");
        assert.equal(callPayload.payload.ok, true);
        assert.equal(callPayload.payload.method, "scr_boot");

        const logsResult = await runCliTestCommand({
            argv: ["runtime", "logs", "--project", projectRoot, "--json"]
        });
        assert.equal(logsResult.exitCode, 0);
        const logsPayload = JSON.parse(logsResult.stdout) as {
            payload: { ok: boolean; payload: Array<{ message: string }> };
        };
        assert.equal(logsPayload.payload.ok, true);
        assert.ok(Array.isArray(logsPayload.payload.payload));
        assert.ok(logsPayload.payload.payload.some((entry) => entry.message.includes("Runner started")));

        const stopRunner = await runCliTestCommand({
            argv: ["runner", "stop", "--project", projectRoot, "--json"]
        });
        assert.equal(stopRunner.exitCode, 0);
    });
});
