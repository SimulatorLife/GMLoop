import assert from "node:assert/strict";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { withSyntheticRefactorProject } from "./test-helpers/refactor-codemod-command-fixture.js";

void test("room create routes through resource mutation backend with stable JSON payload", async () => {
    await withSyntheticRefactorProject({}, async (projectRoot) => {
        const createDryRunResult = await runCliTestCommand({
            argv: ["room", "create", "rm_test", "--json"],
            cwd: projectRoot
        });

        assert.equal(createDryRunResult.exitCode, 0);
        const dryRunPayload = JSON.parse(createDryRunResult.stdout) as {
            command: string;
            ok: boolean;
            payload: {
                action: string;
                dryRun: boolean;
                resourceKind: string;
                resourceName: string;
            };
        };

        assert.equal(dryRunPayload.command, "room create");
        assert.equal(dryRunPayload.ok, true);
        assert.equal(dryRunPayload.payload.action, "add");
        assert.equal(dryRunPayload.payload.resourceKind, "room");
        assert.equal(dryRunPayload.payload.resourceName, "rm_test");
        assert.equal(dryRunPayload.payload.dryRun, true);

        const createWriteResult = await runCliTestCommand({
            argv: ["room", "create", "rm_test", "--write", "--json"],
            cwd: projectRoot
        });
        assert.equal(createWriteResult.exitCode, 0);

        const listResult = await runCliTestCommand({
            argv: ["room", "list", "--json"],
            cwd: projectRoot
        });

        assert.equal(listResult.exitCode, 0);
        const listPayload = JSON.parse(listResult.stdout) as {
            command: string;
            ok: boolean;
            payload: Array<{ kind: string; name: string }>;
        };

        assert.equal(listPayload.command, "room list");
        assert.equal(listPayload.ok, true);
        assert.equal(
            listPayload.payload.some((entry) => entry.kind === "room" && entry.name === "rm_test"),
            true
        );
    });
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
