import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, test } from "node:test";

import { Semantic } from "@gmloop/semantic";

import { runCliTestCommand } from "../src/cli.js";
import { createResourceCommand } from "../src/commands/resource.js";
import { withSyntheticRefactorProject } from "./test-helpers/refactor-codemod-command-fixture.js";

void describe("Resource command", () => {
    void it("creates the resource command suite with add and remove subcommands", () => {
        const command = createResourceCommand();

        assert.equal(command.name(), "resource");
        assert.deepEqual(command.commands.map((entry) => entry.name()).sort(), ["add", "remove"]);
    });

    void it("limits resource kinds to the supported create/remove surface", () => {
        const command = createResourceCommand();
        const addCommand = command.commands.find((entry) => entry.name() === "add");
        assert.ok(addCommand);

        const kindArgument = addCommand.registeredArguments[0];
        assert.ok(kindArgument);
        assert.deepEqual([...(kindArgument.argChoices ?? [])].sort(), ["font", "object", "room", "script", "sprite"]);
    });
});

void test("resource add script creates files and resource remove deletes them", async () => {
    await withSyntheticRefactorProject({}, async (projectRoot) => {
        const addResult = await runCliTestCommand({
            argv: ["resource", "add", "script", "scr_bootstrap", "--write"],
            cwd: projectRoot
        });

        assert.equal(addResult.exitCode, 0);
        assert.match(addResult.stdout, /Action: add/u);
        assert.match(addResult.stdout, /scr_bootstrap/u);

        const manifestDocument = Semantic.parseProjectMetadataDocumentForMutation(
            await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8"),
            path.join(projectRoot, "MyGame.yyp")
        ).document;
        assert.equal(manifestDocument.resources[0].id.path, "scripts/scr_bootstrap/scr_bootstrap.yy");
        await assert.doesNotReject(access(path.join(projectRoot, "scripts/scr_bootstrap/scr_bootstrap.gml")));

        const removeResult = await runCliTestCommand({
            argv: ["resource", "remove", "script", "scr_bootstrap", "--write"],
            cwd: projectRoot
        });

        assert.equal(removeResult.exitCode, 0);
        assert.match(removeResult.stdout, /Action: remove/u);

        const removedManifestDocument = Semantic.parseProjectMetadataDocumentForMutation(
            await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8"),
            path.join(projectRoot, "MyGame.yyp")
        ).document;
        assert.deepEqual(removedManifestDocument.resources, []);
        await assert.rejects(access(path.join(projectRoot, "scripts/scr_bootstrap")));
    });
});
