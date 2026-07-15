import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FSWatcher, type PathLike, promises as fs, type WatchListener, type WatchOptions } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import { writeGameMakerCliActiveProjectState } from "../src/commands/game-maker-cli.js";
import { __graphCommandTest__, createGraphCommand } from "../src/commands/graph.js";
import type { LiveReloadRegisteredSession } from "../src/modules/live-reload/session-registry.js";

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

async function waitForCondition(predicate: () => boolean, failureMessage: string): Promise<void> {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.fail(failureMessage);
}

function createLiveReloadStatusPayload(runtimeUrl: string | null): Record<string, unknown> {
    return {
        errorCount: 0,
        liveReloadSession: { sessionId: "graph-test-session" },
        patchCount: 0,
        runtimeUrl,
        scanComplete: true,
        totalPatchCount: 0,
        uptime: 10,
        websocketClients: 0
    };
}

type LiveReloadSessionEndpointOverrides = Readonly<{
    projectRoot?: string;
    runtimeUrl?: string | null;
    sessionId?: string;
    statusPort?: number;
    watchedRoot?: string;
    websocketPort?: number;
}>;

function createRegisteredLiveReloadSession(
    overrides: LiveReloadSessionEndpointOverrides = {}
): LiveReloadRegisteredSession {
    return {
        lastHeartbeatAt: Date.now(),
        processId: 12_345,
        projectRoot: "/tmp/graph-live-reload-project",
        runtimeUrl: "http://127.0.0.1:61003/",
        startSource: "ui",
        status: "running",
        statusHost: "127.0.0.1",
        statusPort: 61_001,
        statusUrl: "http://127.0.0.1:61001/status",
        sessionId: "graph-test-session",
        watchedRoot: "/tmp/graph-live-reload-project",
        websocketHost: "127.0.0.1",
        websocketPort: 61_002,
        websocketUrl: "ws://127.0.0.1:61002",
        yypPath: "/tmp/graph-live-reload-project/Project.yyp",
        ...overrides
    };
}

/**
 * Parsed JSON payload emitted by `graph visualize --serve` once the dev
 * server has finished bootstrapping. Reused by the two serve-startup
 * integration tests below so the JSON-extraction logic lives in exactly
 * one place (and ESLint's `sonarjs/no-identical-functions` rule stays
 * satisfied).
 */
type GraphServeStartupPayload = {
    databasePath: string;
    payload: { url: string };
    projectRoot: string;
};

/**
 * Returns a callback that drains the buffered stdout of a serve-startup
 * child process, attempts to parse the first JSON object it contains, and
 * resolves the surrounding promise once a complete payload is observed.
 *
 * The callback is intentionally tolerant of partial JSON: each `data`
 * event joins the existing chunks and re-attempts the parse, only
 * resolving once `JSON.parse` succeeds. The caller is responsible for
 * wiring up the matching `error` and `exit` listeners that drive the
 * `resolve({ skipped: true })` and rejection paths.
 */
function createServeStartupJsonResolver(
    stdoutChunks: ReadonlyArray<string>,
    timeout: ReturnType<typeof setTimeout>,
    resolve: (value: GraphServeStartupPayload) => void
): () => void {
    return () => {
        const stdoutText = stdoutChunks.join("");
        const startIndex = stdoutText.indexOf("{");
        if (startIndex === -1) {
            return;
        }

        try {
            const parsed = JSON.parse(stdoutText.slice(startIndex)) as GraphServeStartupPayload;
            clearTimeout(timeout);
            resolve(parsed);
        } catch {
            // Wait for more stdout if the JSON is incomplete.
        }
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
        const assetNames = await fs.readdir(path.join(outputDirectory, "assets"));
        const scriptAsset = assetNames.find((assetName) => assetName.endsWith(".js"));
        const styleAsset = assetNames.find((assetName) => assetName.endsWith(".css"));
        assert.ok(scriptAsset);
        assert.ok(styleAsset);
        const html = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");
        const script = await fs.readFile(path.join(outputDirectory, "assets", scriptAsset), "utf8");
        assert.match(script, /gm-app-shell/u);
        assert.match(html, /shared_toolset_fn/u);
        assert.match(html, /gmloop_format/u);
        assert.match(html, /Format GameMaker Language files using the prettier plugin\./u);
        assert.doesNotMatch(html, /id="regenerate"/u);
        assert.match(html, /assets\/.+\.js/u);
        assert.match(html, /assets\/.+\.css/u);
        assert.doesNotMatch(html, /assets\/vendor\//u);
        assert.doesNotMatch(html, /cdn\./u);
    } finally {
        await fixture.cleanup();
    }
});

void test("graph visualize reconciles stale semantic records before exporting", async () => {
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
        const assetNames = await fs.readdir(path.join(outputDirectory, "assets"));
        const scriptAsset = assetNames.find((assetName) => assetName.endsWith(".js"));
        assert.ok(scriptAsset);
        const indexHtml = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");
        assert.match(indexHtml, /return 999;/u);
        assert.doesNotMatch(indexHtml, /return 42;/u);
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
            [
                "--disable-warning=ExperimentalWarning",
                path.resolve(REPO_ROOT, "src/cli/dist/index.js"),
                "graph",
                "visualize",
                "--serve",
                "--json",
                "--no-open"
            ],
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

            const maybeResolve = createServeStartupJsonResolver(stdoutChunks, timeout, resolve);

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

void test("graph visualize UI source reload candidate includes Lit web source assets", () => {
    assert.equal(__graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate("gm-graph-panel.ts"), true);
    assert.equal(__graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate("graph.css"), true);
    assert.equal(__graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate("index.html"), true);
    assert.equal(
        __graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate("graph-visualization-bundle.gml"),
        false
    );
    assert.equal(__graphCommandTest__.isGraphVisualizationUiSourceReloadCandidate(null), false);
});

void test("graph visualize UI source watcher resolves the repository source tree independently of cwd", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-ui-watch-root-"));
    const previousWorkingDirectory = process.cwd();

    try {
        process.chdir(temporaryDirectory);
        assert.equal(
            __graphCommandTest__.resolveGraphVisualizationUiSourceWatchRoot(),
            path.join(REPO_ROOT, "src", "ui", "src")
        );
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

void test("graph visualize active-project watcher opens current and changed gm-cli state paths", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-active-project-watch-"));
    const statePath = path.join(temporaryDirectory, "gm-cli-active-project.json");
    const initialProjectPath = path.join(temporaryDirectory, "Initial.yyp");
    const nextProjectPath = path.join(temporaryDirectory, "Next.yyp");
    const openedProjectPaths = new Array<string>();
    const observedErrors = new Array<string>();

    await fs.writeFile(statePath, `${JSON.stringify({ projectPath: initialProjectPath })}\n`, "utf8");

    const watcher = __graphCommandTest__.startGraphVisualizationActiveProjectStateWatcher({
        env: { GMLOOP_GM_CLI_PROJECT_STATE_PATH: statePath },
        intervalMs: 10,
        onError: (error) => {
            observedErrors.push(error instanceof Error ? error.message : "Unknown active-project watcher error");
        },
        onProjectPathChanged: (projectPath) => {
            openedProjectPaths.push(projectPath);
        }
    });

    try {
        await waitForCondition(
            () => openedProjectPaths.includes(initialProjectPath),
            "Expected active-project watcher to emit the current project path."
        );

        await fs.writeFile(statePath, `${JSON.stringify({ projectPath: nextProjectPath })}\n`, "utf8");
        await waitForCondition(
            () => openedProjectPaths.includes(nextProjectPath),
            "Expected active-project watcher to emit the changed project path."
        );
        assert.deepEqual(observedErrors, []);
    } finally {
        watcher.stop();
        await fs.rm(temporaryDirectory, { force: true, recursive: true });
    }
});

void test("graph visualize live-reload startup options default to GameMaker temp-root autodetection", () => {
    const startupOptions = __graphCommandTest__.resolveGraphVisualizationLiveReloadStartupOptions("/tmp/project", {});

    assert.equal(startupOptions.hasBuildConfiguration, false);
    assert.equal(startupOptions.html5OutputRoot, null);
    assert.equal(startupOptions.gmTempRoot, "/private/tmp/GameMakerStudio2/GMS2TEMP");
    assert.equal(startupOptions.statusHost, "127.0.0.1");
    assert.equal(startupOptions.statusPort, 17_891);
    assert.equal(startupOptions.websocketHost, "127.0.0.1");
    assert.equal(startupOptions.websocketPort, 17_890);
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
    assert.equal(startupOptions.statusHost, "127.0.0.1");
    assert.equal(startupOptions.statusPort, 17_891);
    assert.equal(startupOptions.websocketHost, "127.0.0.1");
    assert.equal(startupOptions.websocketPort, 17_890);
});

void test("graph visualize live-reload worker args include configured startup paths and UI ownership", () => {
    const args = __graphCommandTest__.createGraphVisualizationLiveReloadStartArguments({
        gmTempRoot: "/tmp/project/.gm-temp/html5",
        hasBuildConfiguration: true,
        html5OutputRoot: "/tmp/project/dist/html5",
        statusHost: "127.0.0.1",
        statusPort: 47_911,
        websocketHost: "127.0.0.1",
        websocketPort: 47_910
    });

    assert.deepEqual(args, [
        "--html5-output",
        "/tmp/project/dist/html5",
        "--gm-temp-root",
        "/tmp/project/.gm-temp/html5",
        "--websocket-port",
        "47910",
        "--websocket-host",
        "127.0.0.1",
        "--status-port",
        "47911",
        "--status-host",
        "127.0.0.1",
        "--start-source",
        "ui",
        "--quiet"
    ]);
});

void test("graph live-reload adoption preserves registry endpoints without allocating ports", async () => {
    const session = createRegisteredLiveReloadSession();
    let allocationCount = 0;
    let receivedStartArguments: ReadonlyArray<string> | null = null;
    const state = __graphCommandTest__.createGraphVisualizationLiveReloadSessionState();

    const model = await __graphCommandTest__.ensureGraphVisualizationLiveReloadSession(
        state,
        { projectConfig: {}, projectRoot: session.projectRoot, restart: false },
        {
            allocateEndpointOptions: async () => {
                allocationCount += 1;
                return {
                    statusHost: "127.0.0.1",
                    statusPort: 61_001,
                    websocketHost: "127.0.0.1",
                    websocketPort: 61_002
                };
            },
            discoverSession: async () => ({
                alive: true,
                registryPath: path.join(session.projectRoot, ".gmloop/live-reload-session.json"),
                session,
                status: createLiveReloadStatusPayload("http://127.0.0.1:61999/")
            }),
            manageSession: async (options) => {
                receivedStartArguments = options.startArguments;
                return { mode: "attached", session, status: createLiveReloadStatusPayload("http://127.0.0.1:61999/") };
            }
        }
    );

    assert.equal(allocationCount, 0);
    assert.deepEqual(receivedStartArguments, []);
    assert.deepEqual(model.endpoints, {
        runtimeUrl: session.runtimeUrl,
        statusUrl: session.statusUrl,
        websocketUrl: session.websocketUrl
    });
    assert.equal(state.ownedSession, null);
});

void test("graph live-reload startup allocates dynamic endpoints only for a new worker", async () => {
    const session = createRegisteredLiveReloadSession({
        runtimeUrl: "http://127.0.0.1:62003/",
        statusPort: 62_001,
        websocketPort: 62_002
    });
    let allocationCount = 0;
    let receivedStartArguments: ReadonlyArray<string> | null = null;
    const state = __graphCommandTest__.createGraphVisualizationLiveReloadSessionState();

    await __graphCommandTest__.ensureGraphVisualizationLiveReloadSession(
        state,
        { projectConfig: {}, projectRoot: session.projectRoot, restart: false },
        {
            allocateEndpointOptions: async () => {
                allocationCount += 1;
                return {
                    statusHost: "127.0.0.1",
                    statusPort: 62_001,
                    websocketHost: "127.0.0.1",
                    websocketPort: 62_002
                };
            },
            discoverSession: async () => ({
                alive: false,
                registryPath: path.join(session.projectRoot, ".gmloop/live-reload-session.json"),
                session: null,
                status: null
            }),
            manageSession: async (options) => {
                receivedStartArguments = options.startArguments;
                return { mode: "started", session, status: createLiveReloadStatusPayload(session.runtimeUrl) };
            }
        }
    );

    assert.equal(allocationCount, 1);
    assert.ok(receivedStartArguments?.includes("--start-source"));
    assert.ok(receivedStartArguments?.includes("ui"));
    assert.ok(receivedStartArguments?.includes("62001"));
    assert.ok(receivedStartArguments?.includes("62002"));
    assert.equal(state.ownedSession?.sessionId, session.sessionId);
});

void test("graph live-reload new sessions receive distinct dynamic status and websocket ports", async () => {
    const sessions = [
        createRegisteredLiveReloadSession({
            projectRoot: "/tmp/graph-live-reload-project-one",
            watchedRoot: "/tmp/graph-live-reload-project-one"
        }),
        createRegisteredLiveReloadSession({
            projectRoot: "/tmp/graph-live-reload-project-two",
            watchedRoot: "/tmp/graph-live-reload-project-two",
            sessionId: "graph-test-session-two"
        })
    ];
    const allocatedEndpoints: Array<{ statusPort: number; websocketPort: number }> = [];
    let nextPort = 62_100;

    for (const session of sessions) {
        const state = __graphCommandTest__.createGraphVisualizationLiveReloadSessionState();
        await __graphCommandTest__.ensureGraphVisualizationLiveReloadSession(
            state,
            { projectConfig: {}, projectRoot: session.projectRoot, restart: false },
            {
                allocateEndpointOptions: async () => {
                    const endpointOptions = {
                        statusHost: "127.0.0.1",
                        statusPort: nextPort,
                        websocketHost: "127.0.0.1",
                        websocketPort: nextPort + 1
                    };
                    nextPort += 2;
                    allocatedEndpoints.push(endpointOptions);
                    return endpointOptions;
                },
                discoverSession: async (targetPath) => ({
                    alive: false,
                    registryPath: path.join(targetPath, ".gmloop/live-reload-session.json"),
                    session: null,
                    status: null
                }),
                manageSession: async (options) => {
                    assert.ok(options.startArguments.includes("--start-source"));
                    assert.ok(options.startArguments.includes("ui"));
                    const registeredSession = sessions.find(({ projectRoot }) => projectRoot === options.targetPath);
                    assert.ok(registeredSession);
                    return {
                        mode: "started",
                        session: registeredSession,
                        status: createLiveReloadStatusPayload(registeredSession.runtimeUrl)
                    };
                }
            }
        );
    }

    const firstEndpoints = allocatedEndpoints[0];
    const secondEndpoints = allocatedEndpoints[1];
    assert.ok(firstEndpoints);
    assert.ok(secondEndpoints);
    assert.notEqual(firstEndpoints.statusPort, secondEndpoints.statusPort);
    assert.notEqual(firstEndpoints.websocketPort, secondEndpoints.websocketPort);
});

void test("graph host shutdown does not stop a session owned outside the graph host", async () => {
    const session = createRegisteredLiveReloadSession();
    const state = __graphCommandTest__.createGraphVisualizationLiveReloadSessionState();
    state.model = __graphCommandTest__.createGraphVisualizationLiveReloadModelFromSession(session, null);
    let stopCallCount = 0;

    await __graphCommandTest__.stopOwnedGraphVisualizationLiveReloadSession(
        state,
        session.projectRoot,
        async () => {
            stopCallCount += 1;
            return { mode: "stopped", session: null, status: null };
        },
        async () => ({
            alive: true,
            registryPath: path.join(session.projectRoot, ".gmloop/live-reload-session.json"),
            session,
            status: null
        })
    );

    assert.equal(stopCallCount, 0);
    assert.equal(state.model, null);
});

void test("graph live-reload stop leaves an externally owned session running", async () => {
    const state = __graphCommandTest__.createGraphVisualizationLiveReloadSessionState();
    const externalSession = createRegisteredLiveReloadSession();
    state.model = __graphCommandTest__.createGraphVisualizationLiveReloadModelFromSession(
        externalSession,
        createLiveReloadStatusPayload(externalSession.runtimeUrl)
    );
    let stopCalls = 0;

    await __graphCommandTest__.stopOwnedGraphVisualizationLiveReloadSession(
        state,
        externalSession.projectRoot,
        async () => {
            stopCalls += 1;
            return { mode: "stopped", session: null, status: null };
        },
        async () => ({
            alive: true,
            registryPath: path.join(externalSession.projectRoot, ".gmloop/live-reload-session.json"),
            session: externalSession,
            status: createLiveReloadStatusPayload(externalSession.runtimeUrl)
        })
    );

    assert.equal(stopCalls, 0);
    assert.equal(state.model, null);
});

void test("graph live-reload project switching stops only the previously owned matching session", async () => {
    const state = __graphCommandTest__.createGraphVisualizationLiveReloadSessionState();
    const ownedSession = createRegisteredLiveReloadSession();
    state.ownedSession = ownedSession;
    let stopTargetPath = "";

    await __graphCommandTest__.stopOwnedGraphVisualizationLiveReloadSession(
        state,
        ownedSession.projectRoot,
        async (options) => {
            stopTargetPath = options.targetPath;
            return { mode: "stopped", session: null, status: null };
        },
        async () => ({
            alive: true,
            registryPath: path.join(ownedSession.projectRoot, ".gmloop/live-reload-session.json"),
            session: ownedSession,
            status: createLiveReloadStatusPayload(ownedSession.runtimeUrl)
        })
    );

    assert.equal(stopTargetPath, ownedSession.projectRoot);
    assert.equal(state.ownedSession, null);
    assert.equal(state.model, null);
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

void test("resolveGraphVisualizationServeStartupState reads active project path from projectState state file", async () => {
    const fixture = await createDualRootFixture();
    const tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-state-"));
    const statePath = path.join(tempStateDir, "gm-cli-active-project.json");

    try {
        await writeGameMakerCliActiveProjectState({
            env: {},
            projectPath: fixture.projectRoot,
            statePathOption: statePath
        });

        const startupState = await __graphCommandTest__.resolveGraphVisualizationServeStartupState(
            {
                projectState: statePath
            },
            null
        );

        assert.equal(startupState.source, "active-project-state");
        assert.equal(startupState.selectedPaths.length, 1);
        assert.equal(path.resolve(startupState.selectedPaths[0]), path.resolve(fixture.projectRoot, "Project.yyp"));
        assert.notEqual(startupState.context, null);
        assert.equal(startupState.context?.projectRoot, fixture.projectRoot);
    } finally {
        await fixture.cleanup();
        await fs.rm(tempStateDir, { force: true, recursive: true });
    }
});

void test("graph visualize --serve writes active project path to projectState file when a project is opened in the UI", async () => {
    const fixture = await createDualRootFixture();
    const tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-graph-state-serve-"));
    const statePath = path.join(tempStateDir, "gm-cli-active-project.json");
    let serveProcess: ReturnType<typeof spawn> | null = null;

    try {
        serveProcess = spawn(
            process.execPath,
            [
                "--disable-warning=ExperimentalWarning",
                path.resolve(REPO_ROOT, "src/cli/dist/index.js"),
                "graph",
                "visualize",
                "--serve",
                "--json",
                "--no-open",
                "--project-state",
                statePath
            ],
            {
                cwd: fixture.projectRoot,
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
            }, 10_000);

            const maybeResolve = createServeStartupJsonResolver(stdoutChunks, timeout, resolve);

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

        const serverUrl = outputPayload.payload.url;

        const response = await fetch(`${serverUrl}/api/open`, {
            method: "POST",
            body: JSON.stringify({ path: fixture.projectRoot }),
            headers: {
                "Content-Type": "application/json"
            }
        });

        assert.equal(response.status, 200);
        const result = (await response.json()) as { ok: boolean };
        assert.equal(result.ok, true);

        const stateContents = await fs.readFile(statePath, "utf8");
        const parsedState = JSON.parse(stateContents) as { projectPath: string };
        assert.equal(path.resolve(parsedState.projectPath), path.resolve(fixture.projectRoot, "Project.yyp"));
    } finally {
        serveProcess?.kill("SIGTERM");
        await fixture.cleanup();
        await fs.rm(tempStateDir, { force: true, recursive: true });
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

void test("streamProcessOutputByLine removes all listeners from stream after settling", async () => {
    const emittedLines = new Array<string>();

    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    const mockStream = {
        setEncoding(_encoding: BufferEncoding): void {},
        on(event: string, handler: (...args: unknown[]) => void): typeof mockStream {
            const bucket = listeners.get(event) ?? [];
            bucket.push(handler);
            listeners.set(event, bucket);
            return mockStream;
        },
        removeListener(event: string, handler: (...args: unknown[]) => void): typeof mockStream {
            const bucket = listeners.get(event) ?? [];
            listeners.set(
                event,
                bucket.filter((h) => h !== handler)
            );
            return mockStream;
        },
        emit(event: string, ...args: unknown[]): void {
            const bucket = listeners.get(event) ?? [];
            for (const h of bucket) {
                h(...args);
            }
        },
        listenerCount(event: string): number {
            return (listeners.get(event) ?? []).length;
        }
    } as unknown as NodeJS.ReadableStream;

    void __graphCommandTest__.streamProcessOutputByLine(mockStream, (line) => {
        emittedLines.push(line);
    });

    assert.equal(mockStream.listenerCount("data"), 1, "Expected exactly one 'data' listener before completion.");

    mockStream.emit("data", "line one\n");
    mockStream.emit("end");

    assert.equal(
        mockStream.listenerCount("data"),
        0,
        "Expected zero 'data' listeners after stream ends (listener leak — removeListener not called)."
    );
    assert.equal(mockStream.listenerCount("error"), 0, "Expected zero 'error' listeners after stream ends.");
    assert.equal(mockStream.listenerCount("end"), 0, "Expected zero 'end' listeners after stream ends.");
    assert.deepEqual(emittedLines, ["line one"]);
});

void test("streamProcessOutputByLine removes all listeners on error", async () => {
    const error = new Error("stream error");

    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    const mockStream = {
        setEncoding(_encoding: BufferEncoding): void {},
        on(event: string, handler: (...args: unknown[]) => void): typeof mockStream {
            const bucket = listeners.get(event) ?? [];
            bucket.push(handler);
            listeners.set(event, bucket);
            return mockStream;
        },
        removeListener(event: string, handler: (...args: unknown[]) => void): typeof mockStream {
            const bucket = listeners.get(event) ?? [];
            listeners.set(
                event,
                bucket.filter((h) => h !== handler)
            );
            return mockStream;
        },
        emit(event: string, ...args: unknown[]): void {
            const bucket = listeners.get(event) ?? [];
            for (const h of bucket) {
                h(...args);
            }
        },
        listenerCount(event: string): number {
            return (listeners.get(event) ?? []).length;
        }
    } as unknown as NodeJS.ReadableStream;

    const promise = __graphCommandTest__.streamProcessOutputByLine(mockStream, () => {});

    assert.equal(mockStream.listenerCount("data"), 1, "Expected exactly one 'data' listener before error.");

    mockStream.emit("error", error);

    let caughtError: unknown;
    try {
        await promise;
    } catch (error_) {
        caughtError = error_;
    }

    assert.ok(caughtError instanceof Error);
    assert.equal(
        mockStream.listenerCount("data"),
        0,
        "Expected zero 'data' listeners after error (listener leak — removeListener not called)."
    );
    assert.equal(mockStream.listenerCount("error"), 0, "Expected zero 'error' listeners after error.");
    assert.equal(mockStream.listenerCount("end"), 0, "Expected zero 'end' listeners after error.");
});

void test("graph visualize feather metadata watcher only calls onChanged if content hash changes", async () => {
    let watchListener: (event: string) => void = () => {};
    let closeCount = 0;
    const fakeWatcher = {
        close() {
            closeCount++;
        },
        on(eventName: string, listener: () => void) {
            void eventName;
            void listener;
            return fakeWatcher;
        }
    } as unknown as FSWatcher;

    const watchFactory = (_path: string, listener?: WatchListener<string>): FSWatcher => {
        if (listener) {
            watchListener = listener as any;
        }
        return fakeWatcher;
    };

    let readCount = 0;
    const fileContents = [
        "initial content", // initial load
        "initial content", // first change (same content)
        "different content", // second change (different content)
        "different content" // third change (same content)
    ];

    const readFileFn = async (_path: string, _options: "utf8"): Promise<string> => {
        const content = fileContents[readCount];
        readCount = Math.min(readCount + 1, fileContents.length - 1);
        return content;
    };

    let changedCount = 0;
    let resolveChanged: (() => void) | null = null;

    const watcher = __graphCommandTest__.startGraphVisualizationFeatherMetadataWatcher({
        featherMetadataPath: "feather-metadata.json",
        onChanged: () => {
            changedCount++;
            if (resolveChanged) {
                resolveChanged();
            }
        },
        onError: (err) => {
            assert.fail(`Should not trigger error: ${Core.getErrorMessage(err)}`);
        },
        watchFactory,
        readFileFn
    });

    // Wait for the initialization promise to finish
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Initially readCount is 1 (read once on initialization), changedCount is 0
    assert.equal(changedCount, 0);

    // Fire watch callback - content is still "initial content"
    watchListener("change");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(changedCount, 0); // content hash did not change

    // Fire watch callback - content is now "different content"
    const changedPromise = new Promise<void>((resolve) => {
        resolveChanged = resolve;
    });
    watchListener("change");
    await changedPromise;
    assert.equal(changedCount, 1); // content hash changed, onChanged called!

    // Fire watch callback - content is still "different content"
    watchListener("change");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(changedCount, 1); // content hash did not change

    // Close watcher
    watcher.close();
    assert.equal(closeCount, 1);
});

void test("graph visualize feather metadata watcher routes errors to onError", async () => {
    let errorListener: ((err: Error) => void) | null = null;
    const fakeWatcher = {
        close() {},
        on(eventName: string, listener: (err: Error) => void) {
            if (eventName === "error") {
                errorListener = listener;
            }
            return fakeWatcher;
        }
    } as unknown as FSWatcher;

    const watchFactory = (_path: string, _listener?: WatchListener<string>): FSWatcher => {
        return fakeWatcher;
    };

    const errors: Array<unknown> = [];
    const watcher = __graphCommandTest__.startGraphVisualizationFeatherMetadataWatcher({
        featherMetadataPath: "feather-metadata.json",
        onChanged: () => {},
        onError: (err) => {
            errors.push(err);
        },
        watchFactory,
        readFileFn: async () => {
            throw new Error("synthetic read error");
        }
    });

    // Wait for init (errors during initial read are ignored)
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(errors, []);

    // Trigger synthetic watcher error
    errorListener?.(new Error("synthetic watcher error"));
    assert.equal(errors.length, 1);
    assert.match((errors[0] as Error).message, /synthetic watcher error/);

    watcher.close();
});
