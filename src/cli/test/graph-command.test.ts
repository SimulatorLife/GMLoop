import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGraphCommand } from "../src/commands/graph.js";

const SKIP_CLI_ENV_VAR = "PRETTIER_PLUGIN_GML_SKIP_CLI_RUN";
const SKIP_CLI_ENV_VALUE = "1";

let cliModulePromise: Promise<typeof import("../src/cli.js")> | undefined;

async function loadCliModule() {
    if (cliModulePromise === undefined) {
        const previousValue = process.env[SKIP_CLI_ENV_VAR];
        process.env[SKIP_CLI_ENV_VAR] = SKIP_CLI_ENV_VALUE;

        cliModulePromise = import("../src/cli.js").finally(() => {
            if (previousValue === undefined) {
                delete process.env[SKIP_CLI_ENV_VAR];
            } else {
                process.env[SKIP_CLI_ENV_VAR] = previousValue;
            }
        });
    }

    return await cliModulePromise;
}

async function createDualRootFixture(): Promise<{
    cleanup: () => Promise<void>;
    projectRoot: string;
    toolsetRoot: string;
}> {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-project-"));
    const toolsetRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-toolset-"));

    const writeFile = async (rootPath: string, relativePath: string, contents: string): Promise<void> => {
        const filePath = path.join(rootPath, relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, contents, "utf8");
    };

    await writeFile(projectRoot, "Project.yyp", JSON.stringify({ name: "Project", resourceType: "GMProject" }));
    await writeFile(toolsetRoot, "Toolset.yyp", JSON.stringify({ name: "Toolset", resourceType: "GMProject" }));
    await writeFile(
        toolsetRoot,
        "scripts/shared_toolset_fn/shared_toolset_fn.yy",
        JSON.stringify({ name: "shared_toolset_fn", resourceType: "GMScript" })
    );
    await writeFile(
        toolsetRoot,
        "scripts/shared_toolset_fn/shared_toolset_fn.gml",
        ["function shared_toolset_fn() {", "    return 42;", "}", ""].join("\n")
    );
    await writeFile(
        projectRoot,
        "scripts/player_update/player_update.yy",
        JSON.stringify({ name: "player_update", resourceType: "GMScript" })
    );
    await writeFile(
        projectRoot,
        "scripts/player_update/player_update.gml",
        ["function player_update() {", "    return shared_toolset_fn();", "}", ""].join("\n")
    );

    return {
        cleanup: async () => {
            await fs.rm(projectRoot, { force: true, recursive: true });
            await fs.rm(toolsetRoot, { force: true, recursive: true });
        },
        projectRoot,
        toolsetRoot
    };
}

void test("CLI command catalog includes graph leaf commands", async () => {
    const cliModule = await loadCliModule();
    const catalog = cliModule.getCliCommandCatalog();

    assert.ok(catalog.some((entry) => entry.displayName === "graph index"));
    assert.ok(catalog.some((entry) => entry.displayName === "graph search"));
    assert.ok(catalog.some((entry) => entry.displayName === "graph context"));
    assert.ok(!catalog.some((entry) => entry.displayName === "performance"));
});

void test("graph index and graph search return stable JSON envelopes", async () => {
    const cliModule = await loadCliModule();
    const fixture = await createDualRootFixture();

    try {
        const indexResult = await cliModule.runCliTestCommand({
            argv: ["graph", "index", "--path", fixture.projectRoot, "--toolset-root", fixture.toolsetRoot, "--json"]
        });
        assert.equal(indexResult.exitCode, 0);
        const indexPayload = JSON.parse(indexResult.stdout);
        assert.equal(indexPayload.command, "graph index");
        assert.deepEqual(indexPayload.payload.graphIds, ["project", "toolset"]);

        const searchResult = await cliModule.runCliTestCommand({
            argv: [
                "graph",
                "search",
                "shared_toolset_fn",
                "--path",
                fixture.projectRoot,
                "--toolset-root",
                fixture.toolsetRoot,
                "--json"
            ]
        });
        assert.equal(searchResult.exitCode, 0);
        const searchPayload = JSON.parse(searchResult.stdout);
        assert.equal(searchPayload.command, "graph search");
        assert.equal(searchPayload.payload.query, "shared_toolset_fn");
        assert.ok(
            searchPayload.payload.results.some(
                (result: { id: string; name: string }) =>
                    result.name === "shared_toolset_fn" &&
                    (result.id === "toolset::gml/script/shared_toolset_fn" ||
                        result.id === "toolset::resource::scripts/shared_toolset_fn/shared_toolset_fn.yy")
            )
        );
    } finally {
        await fixture.cleanup();
    }
});

void test("graph search builds a missing database before querying", async () => {
    const cliModule = await loadCliModule();
    const fixture = await createDualRootFixture();

    try {
        const databasePath = path.join(fixture.projectRoot, ".gmloop", "graph-index.sqlite");

        const searchResult = await cliModule.runCliTestCommand({
            argv: [
                "graph",
                "search",
                "shared_toolset_fn",
                "--path",
                fixture.projectRoot,
                "--toolset-root",
                fixture.toolsetRoot,
                "--json"
            ]
        });

        assert.equal(searchResult.exitCode, 0);
        const payload = JSON.parse(searchResult.stdout);
        assert.ok(
            payload.payload.results.some(
                (result: { id: string; name: string }) =>
                    result.name === "shared_toolset_fn" &&
                    (result.id === "toolset::gml/script/shared_toolset_fn" ||
                        result.id === "toolset::resource::scripts/shared_toolset_fn/shared_toolset_fn.yy")
            )
        );
        await fs.access(databasePath);
    } finally {
        await fixture.cleanup();
    }
});

void test("graph search --force regenerates an existing database before querying", async () => {
    const cliModule = await loadCliModule();
    const fixture = await createDualRootFixture();

    try {
        const databasePath = path.join(fixture.projectRoot, ".gmloop", "graph-index.sqlite");

        const initialIndexResult = await cliModule.runCliTestCommand({
            argv: ["graph", "index", "--path", fixture.projectRoot, "--toolset-root", fixture.toolsetRoot, "--json"]
        });
        assert.equal(initialIndexResult.exitCode, 0);

        await fs.mkdir(path.join(fixture.toolsetRoot, "scripts/added_after_index"), { recursive: true });
        await fs.writeFile(
            path.join(fixture.toolsetRoot, "scripts/added_after_index/added_after_index.yy"),
            JSON.stringify({ name: "added_after_index", resourceType: "GMScript" }),
            "utf8"
        );
        await fs.writeFile(
            path.join(fixture.toolsetRoot, "scripts/added_after_index/added_after_index.gml"),
            ["function added_after_index() {", "    return 99;", "}", ""].join("\n"),
            "utf8"
        );

        const forcedSearchResult = await cliModule.runCliTestCommand({
            argv: [
                "graph",
                "search",
                "added_after_index",
                "--path",
                fixture.projectRoot,
                "--toolset-root",
                fixture.toolsetRoot,
                "--force",
                "--json"
            ]
        });

        assert.equal(forcedSearchResult.exitCode, 0);
        const payload = JSON.parse(forcedSearchResult.stdout);
        assert.ok(
            payload.payload.results.some(
                (result: { id: string; name: string }) =>
                    result.name === "added_after_index" &&
                    (result.id === "toolset::gml/script/added_after_index" ||
                        result.id === "toolset::resource::scripts/added_after_index/added_after_index.yy")
            )
        );
        await fs.access(databasePath);
    } finally {
        await fixture.cleanup();
    }
});

void test("graph visualize builds a missing database before exporting HTML", async () => {
    const cliModule = await loadCliModule();
    const fixture = await createDualRootFixture();

    try {
        const outputPath = path.join(fixture.projectRoot, ".gmloop", "graph-test.html");
        const databasePath = path.join(fixture.projectRoot, ".gmloop", "graph-index.sqlite");

        const visualizeResult = await cliModule.runCliTestCommand({
            argv: [
                "graph",
                "visualize",
                "--path",
                fixture.projectRoot,
                "--toolset-root",
                fixture.toolsetRoot,
                "--output",
                outputPath,
                "--no-open",
                "--json"
            ]
        });

        assert.equal(visualizeResult.exitCode, 0);
        const payload = JSON.parse(visualizeResult.stdout);
        assert.equal(payload.command, "graph visualize");
        assert.equal(payload.payload.outputPath, outputPath);
        await fs.access(databasePath);
        const html = await fs.readFile(outputPath, "utf8");
        assert.match(html, /shared_toolset_fn/u);
        assert.doesNotMatch(html, /id="regenerate"/u);
        assert.doesNotMatch(html, /id="load-directory"/u);
        assert.doesNotMatch(html, /id="load-files"/u);
    } finally {
        await fixture.cleanup();
    }
});

void test("graph command options validate minimum values for depth and limit", async () => {
    const cliModule = await loadCliModule();
    const fixture = await createDualRootFixture();

    try {
        const invalidDepthResult = await cliModule.runCliTestCommand({
            argv: [
                "graph",
                "neighbors",
                "project::gml/script/player_update",
                "--path",
                fixture.projectRoot,
                "--depth",
                "0"
            ]
        });
        assert.equal(invalidDepthResult.exitCode, 1);
        assert.match(invalidDepthResult.stderr, /Depth must be at least 1/);

        const invalidLimitResult = await cliModule.runCliTestCommand({
            argv: ["graph", "search", "shared_toolset_fn", "--path", fixture.projectRoot, "--limit", "0"]
        });
        assert.equal(invalidLimitResult.exitCode, 1);
        assert.match(invalidLimitResult.stderr, /Limit must be at least 1/);
    } finally {
        await fixture.cleanup();
    }
});

void test("graph subcommands expose the force flag consistently", async () => {
    const command = createGraphCommand();
    const subcommandNames = ["index", "search", "symbol", "context", "neighbors", "usages", "visualize"] as const;

    for (const subcommandName of subcommandNames) {
        const subcommand = command.commands.find((entry) => entry.name() === subcommandName);
        assert.ok(subcommand, `Expected graph ${subcommandName} subcommand to exist.`);
        const longOptionFlags = new Set(subcommand.options.flatMap((option) => option.long ?? []));
        assert.ok(longOptionFlags.has("--force"), `Expected graph ${subcommandName} to expose the --force option.`);
        assert.ok(
            !longOptionFlags.has("--rebuild"),
            `Expected graph ${subcommandName} to stop exposing the legacy --rebuild option.`
        );
    }

    const doctorCommand = command.commands.find((entry) => entry.name() === "doctor");
    assert.ok(doctorCommand);
    const doctorOptionFlags = new Set(doctorCommand.options.flatMap((option) => option.long ?? []));
    assert.ok(!doctorOptionFlags.has("--force"));
});
