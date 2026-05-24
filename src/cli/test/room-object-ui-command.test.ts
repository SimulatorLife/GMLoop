import assert from "node:assert/strict";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { createRoomCommand } from "../src/commands/room.js";

void test("room command keeps inspection leaves and drops bespoke mutation leaves", () => {
    const command = createRoomCommand();
    const commandNames = command.commands.map((entry) => entry.name()).sort();

    assert.deepEqual(
        commandNames,
        [
            "camera",
            "inspect",
            "instance",
            "layer",
            "preview",
            "query",
            "repair",
            "summary",
            "update",
            "validate",
            "list"
        ].sort()
    );
});

void test("object planned leaves emit concrete non-stub payloads", async () => {
    const updateResult = await runCliTestCommand({
        argv: ["object", "update", "obj_player", "--json"]
    });

    assert.equal(updateResult.exitCode, 0);
    const updatePayload = JSON.parse(updateResult.stdout) as {
        command: string;
        ok: boolean;
        payload: {
            capability: string;
            details: { object: string };
            state: string;
        };
    };

    assert.equal(updatePayload.command, "object update");
    assert.equal(updatePayload.ok, true);
    assert.equal(updatePayload.payload.state, "not_available");
    assert.equal(updatePayload.payload.details.object, "obj_player");

    const eventListResult = await runCliTestCommand({
        argv: ["object", "event", "list", "--json"]
    });
    assert.equal(eventListResult.exitCode, 0);
    const eventListPayload = JSON.parse(eventListResult.stdout) as {
        command: string;
        payload: { state: string };
    };
    assert.equal(eventListPayload.command, "object event list");
    assert.equal(eventListPayload.payload.state, "not_available");

    const eventUpdateResult = await runCliTestCommand({
        argv: ["object", "event", "update", "--json", "--write"]
    });
    assert.equal(eventUpdateResult.exitCode, 0);
    const eventUpdatePayload = JSON.parse(eventUpdateResult.stdout) as {
        command: string;
        payload: {
            mode: string;
            state: string;
        };
    };
    assert.equal(eventUpdatePayload.command, "object event update");
    assert.equal(eventUpdatePayload.payload.mode, "apply");
    assert.equal(eventUpdatePayload.payload.state, "not_available");
});

void test("ui planned leaves emit concrete payloads without unsupported backend state", async () => {
    const previewResult = await runCliTestCommand({
        argv: ["ui", "preview", "--json"]
    });

    assert.equal(previewResult.exitCode, 0);
    const previewPayload = JSON.parse(previewResult.stdout) as {
        command: string;
        ok: boolean;
        payload: {
            capability: string;
            state: string;
        };
    };

    assert.equal(previewPayload.command, "ui preview");
    assert.equal(previewPayload.ok, true);
    assert.equal(previewPayload.payload.state, "not_available");

    const scaffoldResult = await runCliTestCommand({
        argv: ["ui", "scaffold", "--json"]
    });

    assert.equal(scaffoldResult.exitCode, 0);
    const scaffoldPayload = JSON.parse(scaffoldResult.stdout) as {
        command: string;
        payload: {
            state: string;
        };
    };

    assert.equal(scaffoldPayload.command, "ui scaffold");
    assert.equal(scaffoldPayload.payload.state, "not_available");
});
