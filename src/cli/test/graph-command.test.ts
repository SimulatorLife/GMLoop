import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
        assert.deepEqual(indexPayload.graphIds, ["project", "toolset"]);

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
        assert.equal(searchPayload.query, "shared_toolset_fn");
        assert.equal(searchPayload.results[0].id, "toolset::gml/script/shared_toolset_fn");
    } finally {
        await fixture.cleanup();
    }
});
