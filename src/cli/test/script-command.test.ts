import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Refactor } from "@gmloop/refactor";

import { runCliTestCommand } from "../src/cli.js";
import { createScriptCommand } from "../src/commands/script.js";

async function createTemporaryScriptCliProject(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-script-cli-"));
    await writeFile(
        path.join(projectRoot, "MyGame.yyp"),
        `${JSON.stringify({ name: "MyGame", resourceType: "GMProject", resources: [] }, null, 4)}\n`,
        "utf8"
    );
    await writeFile(path.join(projectRoot, "gmloop.json"), "{}\n", "utf8");
    await Refactor.addProjectResource({
        dryRun: false,
        projectRoot,
        resourceKind: "script",
        resourceName: "scr_demo"
    });
    await writeFile(
        path.join(projectRoot, "scripts/scr_demo/scr_demo.gml"),
        "/// script 'scr_demo'.\nfunction scr_demo() {\n    return 1;\n}\n",
        "utf8"
    );
    return projectRoot;
}

void test("Script command exposes the expected subcommand leaves", () => {
    const command = createScriptCommand();

    assert.equal(command.name(), "script");
    assert.deepEqual(command.commands.map((entry) => entry.name()).sort(), [
        "add",
        "duplicate",
        "inspect",
        "list",
        "remove",
        "rename",
        "update"
    ]);
});

void test("Script command marks the 'add' subcommand as the write-capable leaf", () => {
    const command = createScriptCommand();
    const addCommand = command.commands.find((entry) => entry.name() === "add");
    assert.ok(addCommand, "Expected 'add' subcommand to exist");

    const options = addCommand?.options ?? [];
    assert.ok(
        options.some((entry) => entry.attributeName() === "write"),
        "Expected 'add' to have a --write option"
    );
});

void test("Script command describes the command as covering script inspection and mutation", () => {
    const command = createScriptCommand();
    const helpText = command.description();

    assert.match(helpText, /script/iu);
    assert.match(helpText, /Inspect|mutate/iu);
});

void test("Script command exposes graph-query and json flags on the 'list' subcommand for parity with object/room", () => {
    const command = createScriptCommand();
    const listCommand = command.commands.find((entry) => entry.name() === "list");
    assert.ok(listCommand, "Expected 'list' subcommand to exist");

    const optionNames = (listCommand?.options ?? []).map((entry) => entry.attributeName()).sort();
    assert.deepEqual(optionNames, ["config", "databasePath", "force", "json", "path", "toolsetRoot"]);
});

void test("script list returns graph-indexed script resources, not the project config blob", async () => {
    const projectRoot = await createTemporaryScriptCliProject();

    try {
        const result = await runCliTestCommand({
            argv: ["script", "list", "--path", projectRoot, "--json"]
        });

        assert.equal(result.exitCode, 0);

        const payload = JSON.parse(result.stdout) as {
            command: string;
            ok: boolean;
            payload: Array<{ kind: string; name: string; id: string }>;
        };

        assert.equal(payload.command, "script list");
        assert.equal(payload.ok, true);
        assert.ok(Array.isArray(payload.payload), "Expected payload to be an array of graph search results");

        const scripts = payload.payload;
        assert.equal(scripts.length, 1, "Expected exactly one indexed script resource");
        assert.equal(scripts[0]?.kind, "script");
        assert.equal(scripts[0]?.name, "scr_demo");
        assert.match(scripts[0]?.id ?? "", /scr_demo\.yy/u);

        // The legacy behaviour dumped the full gmloop.json project config; the
        // fixed command must not surface those fields.
        const serialized = JSON.stringify(payload);
        assert.ok(!serialized.includes("lintRuleset"), "Payload must not include gmloop.json config keys");
        assert.ok(!serialized.includes("printWidth"), "Payload must not include gmloop.json config keys");
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("script list emits an empty array (not the project config) when no scripts are indexed", async () => {
    const emptyProjectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-script-cli-empty-"));

    try {
        await writeFile(
            path.join(emptyProjectRoot, "MyGame.yyp"),
            `${JSON.stringify({ name: "MyGame", resourceType: "GMProject", resources: [] }, null, 4)}\n`,
            "utf8"
        );
        await writeFile(path.join(emptyProjectRoot, "gmloop.json"), "{}\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["script", "list", "--path", emptyProjectRoot, "--json"]
        });

        assert.equal(result.exitCode, 0);

        const payload = JSON.parse(result.stdout) as { command: string; payload: unknown };
        assert.equal(payload.command, "script list");
        assert.deepEqual(payload.payload, []);
    } finally {
        await rm(emptyProjectRoot, { force: true, recursive: true });
    }
});
