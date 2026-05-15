import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FSWatcher, type PathLike, promises as fs, type WatchListener, type WatchOptions } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __graphCommandTest__, createGraphCommand } from "../src/commands/graph.js";

const SKIP_CLI_ENV_VAR = "PRETTIER_PLUGIN_GML_SKIP_CLI_RUN";
const SKIP_CLI_ENV_VALUE = "1";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

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
    assert.ok(catalog.some((entry) => entry.displayName === "graph doctor"));
    assert.ok(catalog.some((entry) => entry.displayName === "graph visualize"));
    assert.ok(!catalog.some((entry) => entry.displayName === "graph symbol"));
    assert.ok(!catalog.some((entry) => entry.displayName === "graph context"));
    assert.ok(!catalog.some((entry) => entry.displayName === "graph neighbors"));
    assert.ok(!catalog.some((entry) => entry.displayName === "graph usages"));
    assert.ok(catalog.some((entry) => entry.displayName === "symbol inspect"));
    assert.ok(catalog.some((entry) => entry.displayName === "symbol context"));
    assert.ok(catalog.some((entry) => entry.displayName === "symbol neighbors"));
    assert.ok(catalog.some((entry) => entry.displayName === "symbol usages"));
    assert.ok(!catalog.some((entry) => entry.displayName === "performance"));
});

void test("graph command rejects removed symbol-centric subcommands", async () => {
    const cliModule = await loadCliModule();
    const result = await cliModule.runCliTestCommand({
        argv: ["graph", "symbol", "shared_toolset_fn", "--json"]
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /unknown command 'symbol'/iu);
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

void test("graph visualize builds a missing database before exporting an HTML+assets bundle", async () => {
    const cliModule = await loadCliModule();
    const fixture = await createDualRootFixture();

    try {
        const outputDirectory = path.join(fixture.projectRoot, ".gmloop", "graph-test");
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
                outputDirectory,
                "--no-open",
                "--json"
            ]
        });

        assert.equal(visualizeResult.exitCode, 0);
        const payload = JSON.parse(visualizeResult.stdout);
        assert.equal(payload.command, "graph visualize");
        assert.equal(payload.payload.outputDirectory, outputDirectory);
        assert.equal(payload.payload.entryHtmlPath, "index.html");
        await fs.access(databasePath);
        await fs.access(path.join(outputDirectory, "assets", "graph-visualization.css"));
        await fs.access(path.join(outputDirectory, "assets", "graph-visualization.js"));
        await fs.access(path.join(outputDirectory, "assets", "vendor", "d3.min.js"));
        await fs.access(path.join(outputDirectory, "assets", "vendor", "browser-fs-access.js"));
        const html = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");
        const script = await fs.readFile(path.join(outputDirectory, "assets", "graph-visualization.js"), "utf8");
        assert.match(script, /shared_toolset_fn/u);
        assert.match(script, /gmloop_format/u);
        assert.match(script, /Format GameMaker Language files using the prettier plugin\./u);
        assert.doesNotMatch(html, /id="regenerate"/u);
        assert.match(html, /assets\/graph-visualization\.js/u);
        assert.match(html, /assets\/graph-visualization\.css/u);
        assert.match(html, /assets\/vendor\/d3\.min\.js/u);
        assert.doesNotMatch(html, /cdn\./u);
    } finally {
        await fixture.cleanup();
    }
});

void test("graph visualize reuses an existing graph index instead of rebuilding it implicitly", async () => {
    const cliModule = await loadCliModule();
    const fixture = await createDualRootFixture();

    try {
        const outputDirectory = path.join(fixture.projectRoot, ".gmloop", "graph-existing-index");

        const initialIndexResult = await cliModule.runCliTestCommand({
            argv: ["graph", "index", "--path", fixture.projectRoot, "--toolset-root", fixture.toolsetRoot, "--json"]
        });
        assert.equal(initialIndexResult.exitCode, 0);

        await fs.writeFile(
            path.join(fixture.toolsetRoot, "scripts/shared_toolset_fn/shared_toolset_fn.gml"),
            ["function shared_toolset_fn() {", "    return 999;", "}", ""].join("\n"),
            "utf8"
        );

        const visualizeResult = await cliModule.runCliTestCommand({
            argv: [
                "graph",
                "visualize",
                "--path",
                fixture.projectRoot,
                "--toolset-root",
                fixture.toolsetRoot,
                "--output",
                outputDirectory,
                "--no-open",
                "--json"
            ]
        });

        assert.equal(visualizeResult.exitCode, 0);
        const script = await fs.readFile(path.join(outputDirectory, "assets", "graph-visualization.js"), "utf8");
        assert.match(script, /return 42;/u);
        assert.doesNotMatch(script, /return 999;/u);
    } finally {
        await fixture.cleanup();
    }
});

void test("graph visualize --serve boots without a project path and waits for UI-driven loading", async () => {
    const emptyWorkingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-serve-empty-"));
    let serveProcess: ReturnType<typeof spawn> | null = null;

    try {
        serveProcess = spawn(
            process.execPath,
            [path.resolve(REPO_ROOT, "src/cli/dist/index.js"), "graph", "visualize", "--serve", "--json", "--no-open"],
            {
                cwd: emptyWorkingDirectory,
                stdio: ["ignore", "pipe", "pipe"]
            }
        );

        const stdoutChunks: Array<string> = [];
        const stderrChunks: Array<string> = [];
        if (serveProcess.stdout) {
            serveProcess.stdout.on("data", (chunk: Buffer | string) => {
                stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
            });
        }
        if (serveProcess.stderr) {
            serveProcess.stderr.on("data", (chunk: Buffer | string) => {
                stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
            });
        }

        const outputPayload = await new Promise<
            { databasePath: string; payload: { url: string }; projectRoot: string } | { skipped: true }
        >((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(
                    new Error(
                        `Timed out waiting for serve startup.\nSTDOUT:\n${stdoutChunks.join("")}\nSTDERR:\n${stderrChunks.join("")}`
                    )
                );
            }, 5000);

            const maybeResolve = (): void => {
                const stdoutText = stdoutChunks.join("");
                const startIndex = stdoutText.indexOf("{");
                if (startIndex === -1) {
                    return;
                }

                try {
                    const parsed = JSON.parse(stdoutText.slice(startIndex)) as {
                        databasePath: string;
                        payload: { url: string };
                        projectRoot: string;
                    };
                    clearTimeout(timeout);
                    resolve(parsed);
                } catch {
                    // Wait for more stdout if the JSON is incomplete.
                }
            };

            serveProcess.on("error", (error) => {
                clearTimeout(timeout);
                reject(error);
            });
            serveProcess.on("exit", (code) => {
                clearTimeout(timeout);
                const stderrText = stderrChunks.join("");
                if (stderrText.includes("listen EPERM")) {
                    resolve({ skipped: true });
                    return;
                }
                reject(
                    new Error(
                        `Serve process exited before startup with code ${String(code)}.\nSTDOUT:\n${stdoutChunks.join("")}\nSTDERR:\n${stderrText}`
                    )
                );
            });
            serveProcess.stdout?.on("data", maybeResolve);
        });

        if ("skipped" in outputPayload) {
            return;
        }

        assert.equal(outputPayload.projectRoot, "");
        assert.equal(outputPayload.databasePath, "");
        assert.match(outputPayload.payload.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
    } finally {
        serveProcess?.kill("SIGTERM");
        await fs.rm(emptyWorkingDirectory, { force: true, recursive: true });
    }
});

void test("graph visualize UI source reload candidate includes template html assets", () => {
    assert.equal(
        __graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate("graph-visualization-template.ts"),
        true
    );
    assert.equal(
        __graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate("graph-visualization-template.css"),
        true
    );
    assert.equal(
        __graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate("graph-visualization-template.html"),
        true
    );
    assert.equal(
        __graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate("graph-visualization-template.gml"),
        false
    );
    assert.equal(__graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate(null), false);
});

void test("graph visualize UI source watcher is disabled outside the repository source tree", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-ui-watch-root-"));
    const previousWorkingDirectory = process.cwd();

    try {
        process.chdir(temporaryDirectory);
        assert.equal(__graphCommandTest__.resolveGraphVisualizationUiSourceWatchRoot(), null);
    } finally {
        process.chdir(previousWorkingDirectory);
        await fs.rm(temporaryDirectory, { force: true, recursive: true });
    }
});

void test("graph visualize UI source watcher reports watcher errors without throwing", () => {
    let closeCount = 0;
    const receivedErrors: Array<string> = [];
    let errorListener: ((error: Error) => void) | null = null;
    const fakeWatcher = {
        close() {
            closeCount += 1;
        },
        on(eventName: string, listener: (error: Error) => void) {
            if (eventName === "error") {
                errorListener = listener;
            }
            return fakeWatcher;
        },
        ref() {
            return fakeWatcher;
        },
        unref() {
            return fakeWatcher;
        }
    } as unknown as FSWatcher;

    const watchFactory = (
        _path: PathLike,
        _options?: WatchOptions | BufferEncoding | "buffer",
        _listener?: WatchListener<string>
    ): FSWatcher => {
        void _path;
        void _options;
        void _listener;
        return fakeWatcher;
    };

    const watcher = __graphCommandTest__.startGraphVisualizationUiSourceWatcher({
        onError: (error: unknown) => {
            receivedErrors.push(error instanceof Error ? error.message : "Unknown watcher error");
        },
        onReloadCandidate: () => {},
        watchFactory,
        watchRoot: REPO_ROOT
    });

    assert.equal(watcher, fakeWatcher);
    errorListener?.(new Error("synthetic watcher failure"));

    assert.deepEqual(receivedErrors, ["synthetic watcher failure"]);
    assert.equal(closeCount, 1);
});

void test("graph visualize live-reload startup options default to GameMaker temp-root autodetection", () => {
    const startupOptions = __graphCommandTest__.resolveGraphVisualizationLiveReloadStartupOptions("/tmp/project", {});

    assert.equal(startupOptions.hasBuildConfiguration, false);
    assert.equal(startupOptions.html5OutputRoot, null);
    assert.equal(startupOptions.gmTempRoot, "/private/tmp/GameMakerStudio2/GMS2TEMP");
});

void test("graph visualize live-reload startup options honor runtime.liveReload config", () => {
    const startupOptions = __graphCommandTest__.resolveGraphVisualizationLiveReloadStartupOptions("/tmp/project", {
        runtime: {
            liveReload: {
                build: {
                    backend: "igor"
                },
                gmTempRoot: ".gm-temp/html5",
                html5Output: "dist/html5"
            }
        }
    });

    assert.equal(startupOptions.hasBuildConfiguration, true);
    assert.equal(startupOptions.html5OutputRoot, path.resolve("/tmp/project", "dist/html5"));
    assert.equal(startupOptions.gmTempRoot, path.resolve("/tmp/project", ".gm-temp/html5"));
});

void test("graph visualize live-reload startup timeout allows long build-first startup", () => {
    assert.equal(__graphCommandTest__.GRAPH_VISUALIZATION_LIVE_RELOAD_START_TIMEOUT_MS, 600_000);
});

void test("graph visualize live-reload dev args include configured startup paths", () => {
    const args = __graphCommandTest__.createGraphVisualizationLiveReloadDevCommandArgs("/tmp/project", {
        gmTempRoot: "/tmp/project/.gm-temp/html5",
        hasBuildConfiguration: true,
        html5OutputRoot: "/tmp/project/dist/html5"
    });

    assert.deepEqual(args, [
        "live-reload",
        "dev",
        "/tmp/project",
        "--html5-output",
        "/tmp/project/dist/html5",
        "--gm-temp-root",
        "/tmp/project/.gm-temp/html5",
        "--quiet"
    ]);
});

void test("graph visualize serve defaults to the bundled 3DSpider demo from the repository root", () => {
    const demoProjectRoot = __graphCommandTest__.resolveDefaultGraphVisualizationServeTargetPath(REPO_ROOT);

    assert.equal(demoProjectRoot, path.join(REPO_ROOT, "vendor", "3DSpider"));
});

void test("graph visualize serve has no bundled demo fallback outside the repository tree", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-demo-fallback-"));

    try {
        assert.equal(__graphCommandTest__.resolveDefaultGraphVisualizationServeTargetPath(temporaryDirectory), null);
    } finally {
        await fs.rm(temporaryDirectory, { force: true, recursive: true });
    }
});

void test("graph command options validate minimum values for depth and limit", async () => {
    const cliModule = await loadCliModule();
    const fixture = await createDualRootFixture();

    try {
        const invalidDepthResult = await cliModule.runCliTestCommand({
            argv: [
                "graph",
                "search",
                "project::gml/script/player_update",
                "--path",
                fixture.projectRoot,
                "--limit",
                "0"
            ]
        });
        assert.equal(invalidDepthResult.exitCode, 1);
        assert.match(invalidDepthResult.stderr, /Limit must be at least 1/);
    } finally {
        await fixture.cleanup();
    }
});

void test("graph subcommands expose the force flag consistently", async () => {
    const command = createGraphCommand();
    const subcommandNames = ["index", "search", "visualize"] as const;

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
