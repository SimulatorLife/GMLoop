import assert from "node:assert/strict";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

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

void test("runtime set/get round-trips values", async () => {
    const setResult = await runCliTestCommand({
        argv: ["runtime", "set", "--path", "hp", "--value", "42", "--scope", "global", "--json"]
    });
    assert.equal(setResult.exitCode, 0);
    const setPayload = JSON.parse(setResult.stdout) as { payload: { ok: boolean; value: number } };
    assert.equal(setPayload.payload.ok, true);
    assert.equal(setPayload.payload.value, 42);

    const getResult = await runCliTestCommand({
        argv: ["runtime", "get", "--path", "hp", "--scope", "global", "--json"]
    });
    assert.equal(getResult.exitCode, 0);
    const getPayload = JSON.parse(getResult.stdout) as { payload: { ok: boolean; value: number } };
    assert.equal(getPayload.payload.ok, true);
    assert.equal(getPayload.payload.value, 42);
});

void test("runtime call/logs produce structured output", async () => {
    const callResult = await runCliTestCommand({
        argv: ["runtime", "call", "--method", "scr_boot", "--args", "[1,true]", "--json"]
    });
    assert.equal(callResult.exitCode, 0);
    const callPayload = JSON.parse(callResult.stdout) as { command: string; payload: { ok: boolean; method: string } };
    assert.equal(callPayload.command, "runtime call");
    assert.equal(callPayload.payload.ok, true);
    assert.equal(callPayload.payload.method, "scr_boot");

    const logsResult = await runCliTestCommand({
        argv: ["runtime", "logs", "--json"]
    });
    assert.equal(logsResult.exitCode, 0);
    const logsPayload = JSON.parse(logsResult.stdout) as { payload: { ok: boolean; payload: Array<unknown> } };
    assert.equal(logsPayload.payload.ok, true);
    assert.ok(Array.isArray(logsPayload.payload.payload));
});
