import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, test } from "node:test";

import { Core } from "@gmloop/core";

import { runCliTestCommand } from "../src/cli.js";
import { createResourceCommand } from "../src/commands/resource.js";
import { withSyntheticRefactorProject } from "./test-helpers/refactor-codemod-command-fixture.js";

void describe("Resource command", () => {
    void it("creates the resource command suite with resource mutation and read subcommands", () => {
        const command = createResourceCommand();

        assert.equal(command.name(), "resource");
        assert.deepEqual(command.commands.map((entry) => entry.name()).sort(), [
            "add",
            "audit",
            "dependents",
            "deps",
            "duplicate",
            "find",
            "inspect",
            "list",
            "move",
            "remove",
            "rename"
        ]);
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

        const manifestDocument = Core.parseProjectMetadataDocumentForMutation(
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

        const removedManifestDocument = Core.parseProjectMetadataDocumentForMutation(
            await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8"),
            path.join(projectRoot, "MyGame.yyp")
        ).document;
        assert.deepEqual(removedManifestDocument.resources, []);
        await assert.rejects(access(path.join(projectRoot, "scripts/scr_bootstrap")));
    });
});

void test("resource rename/duplicate/move execute project-resource mutations end-to-end", async () => {
    await withSyntheticRefactorProject({}, async (projectRoot) => {
        const addResult = await runCliTestCommand({
            argv: ["resource", "add", "script", "scr_base", "--write"],
            cwd: projectRoot
        });
        assert.equal(addResult.exitCode, 0);

        const renameDryRunResult = await runCliTestCommand({
            argv: ["resource", "rename", "script", "scr_base", "--new-name", "scr_renamed"],
            cwd: projectRoot
        });
        assert.equal(renameDryRunResult.exitCode, 0);
        assert.match(renameDryRunResult.stdout, /Action: rename/u);
        assert.match(renameDryRunResult.stdout, /Execution mode: dry-run \(default\)/u);
        await assert.doesNotReject(access(path.join(projectRoot, "scripts/scr_base/scr_base.yy")));

        const renameResult = await runCliTestCommand({
            argv: ["resource", "rename", "script", "scr_base", "--new-name", "scr_renamed", "--write"],
            cwd: projectRoot
        });
        assert.equal(renameResult.exitCode, 0);
        assert.match(renameResult.stdout, /Action: rename/u);
        await assert.doesNotReject(access(path.join(projectRoot, "scripts/scr_renamed/scr_renamed.yy")));

        const duplicateResult = await runCliTestCommand({
            argv: ["resource", "duplicate", "script", "scr_renamed", "--new-name", "scr_copy", "--write"],
            cwd: projectRoot
        });
        assert.equal(duplicateResult.exitCode, 0);
        assert.match(duplicateResult.stdout, /Action: duplicate/u);
        await assert.doesNotReject(access(path.join(projectRoot, "scripts/scr_copy/scr_copy.yy")));

        const moveResult = await runCliTestCommand({
            argv: [
                "resource",
                "move",
                "script",
                "scr_copy",
                "--destination-folder",
                "scripts/custom_folder",
                "--write"
            ],
            cwd: projectRoot
        });
        assert.equal(moveResult.exitCode, 0);
        assert.match(moveResult.stdout, /Action: move/u);
        await assert.doesNotReject(access(path.join(projectRoot, "scripts/custom_folder/scr_copy.yy")));

        const manifestDocument = Core.parseProjectMetadataDocumentForMutation(
            await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8"),
            path.join(projectRoot, "MyGame.yyp")
        ).document;
        const manifestResources = Array.isArray(manifestDocument.resources) ? manifestDocument.resources : [];
        const resourcePaths = manifestResources
            .map((entry) => {
                if (
                    entry &&
                    typeof entry === "object" &&
                    "id" in entry &&
                    entry.id &&
                    typeof entry.id === "object" &&
                    "path" in entry.id &&
                    typeof entry.id.path === "string"
                ) {
                    return entry.id.path;
                }

                return null;
            })
            .filter((resourcePath): resourcePath is string => resourcePath !== null)
            .toSorted();
        assert.deepEqual(resourcePaths, ["scripts/custom_folder/scr_copy.yy", "scripts/scr_renamed/scr_renamed.yy"]);
    });
});
