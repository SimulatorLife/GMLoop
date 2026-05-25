import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { type AddressInfo, createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { FixtureRunner, type ProjectChangeSummary, type ProjectFingerprint } from "@gmloop/fixture-runner";
import { RuntimeWrapper } from "@gmloop/runtime-wrapper";
import { WebSocket } from "ws";

const execFileAsync = promisify(execFile);

const REPO_ROOT = process.cwd();
const VENDOR_3DSPIDER_PROJECT_PATH = path.join(REPO_ROOT, "vendor", "3DSpider");
const CLI_ENTRYPOINT_PATH = path.join(REPO_ROOT, "src", "cli", "dist", "index.js");
const COMMAND_TIMEOUT_MS = 120_000;
const WATCH_TIMEOUT_MS = 60_000;

type CliRunResult = Readonly<{
    stdout: string;
    stderr: string;
}>;

type ResourceSearchPayload = Readonly<{
    ok?: unknown;
    payload?: {
        results?: ReadonlyArray<Readonly<{ name?: unknown; id?: unknown; kind?: unknown }>>;
    };
}>;

type ResourceAuditPayload = Readonly<{
    ok?: unknown;
    payload?: {
        kindCounts?: Record<string, number>;
        total?: unknown;
    };
}>;

type StatusPayload = Readonly<{
    totalPatchCount?: number;
    patchCount?: number;
    recentPatches?: ReadonlyArray<Readonly<{ filePath?: unknown; id?: unknown }>>;
    scanComplete?: boolean;
}>;

type HotReloadPatch = Readonly<{
    kind: "script" | "event";
    id: string;
    js_body: string;
    runtimeId?: string;
    metadata?: {
        sourcePath?: string;
        dependencies?: ReadonlyArray<string>;
    };
}>;

function assertObject(value: unknown, context: string): Record<string, unknown> {
    assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true, context);
    return value as Record<string, unknown>;
}

function assertString(value: unknown, context: string): string {
    assert.equal(typeof value, "string", context);
    return value as string;
}

function assertHotReloadPatch(value: unknown): HotReloadPatch {
    const object = assertObject(value, "Hot-reload message must be an object.");
    const kind = object.kind;
    if (kind !== "script" && kind !== "event") {
        throw new Error("Hot-reload patch must be a script or event patch.");
    }
    const id = assertString(object.id, "Hot-reload patch must include an id.");
    const jsBody = assertString(object.js_body, "Hot-reload patch must include js_body.");
    const runtimeId = typeof object.runtimeId === "string" ? object.runtimeId : undefined;
    const metadata =
        object.metadata && typeof object.metadata === "object" && !Array.isArray(object.metadata)
            ? {
                  sourcePath:
                      typeof (object.metadata as { sourcePath?: unknown }).sourcePath === "string"
                          ? (object.metadata as { sourcePath: string }).sourcePath
                          : undefined,
                  dependencies: Array.isArray((object.metadata as { dependencies?: unknown }).dependencies)
                      ? (object.metadata as { dependencies: ReadonlyArray<string> }).dependencies.filter(
                            (entry) => typeof entry === "string"
                        )
                      : undefined
              }
            : undefined;

    return {
        kind,
        id,
        js_body: jsBody,
        ...(runtimeId === undefined ? {} : { runtimeId }),
        ...(metadata === undefined ? {} : { metadata })
    };
}

function collectPatchesFromMessage(value: unknown): ReadonlyArray<HotReloadPatch> {
    if (Array.isArray(value)) {
        return value.map(assertHotReloadPatch);
    }

    return [assertHotReloadPatch(value)];
}

async function runCliCommand(args: ReadonlyArray<string>, cwd = REPO_ROOT): Promise<CliRunResult> {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_ENTRYPOINT_PATH, ...args], {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        env: {
            ...process.env,
            NO_COLOR: "1"
        }
    });

    return {
        stdout,
        stderr
    };
}

async function createAvailablePortServer(): Promise<ReturnType<typeof createServer>> {
    return new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
        const server = createServer();

        server.once("error", (error) => {
            reject(error);
        });
        server.listen(0, "127.0.0.1", () => {
            resolve(server);
        });
    });
}

async function closeAvailablePortServer(server: ReturnType<typeof createServer>): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(new Error(`Failed to close temporary port server: ${error.message}`, { cause: error }));
                return;
            }

            resolve();
        });
    });
}

async function findAvailableStatusAndWebSocketPorts(): Promise<{ statusPort: number; websocketPort: number }> {
    const servers = await Promise.all([createAvailablePortServer(), createAvailablePortServer()]);
    const ports = servers.map((server) => {
        const address = server.address();
        assert.equal(typeof address, "object");
        assert.notEqual(address, null);
        return (address as AddressInfo).port;
    });

    await Promise.all(servers.map((server) => closeAvailablePortServer(server)));

    const [statusPort, websocketPort] = ports;
    assert.notEqual(statusPort, undefined);
    assert.notEqual(websocketPort, undefined);
    assert.notEqual(statusPort, websocketPort);

    return {
        statusPort,
        websocketPort
    };
}

async function delay(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function fetchStatusPayload(statusPort: number): Promise<StatusPayload> {
    const response = await fetch(`http://127.0.0.1:${statusPort}/status`);
    assert.equal(response.ok, true, `Expected watch status endpoint to be available, got ${response.status}.`);
    return (await response.json()) as StatusPayload;
}

function getPatchCount(payload: StatusPayload): number {
    return payload.totalPatchCount ?? payload.patchCount ?? 0;
}

async function waitForStatus(
    statusPort: number,
    predicate: (payload: StatusPayload) => boolean,
    timeoutMs = WATCH_TIMEOUT_MS
): Promise<StatusPayload> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const payload = await fetchStatusPayload(statusPort);
            if (predicate(payload)) {
                return payload;
            }
        } catch {
            // The status server may not be listening yet.
        }

        await delay(100);
    }

    throw new Error("Timed out waiting for 3DSpider watch status.");
}

function startWatchProcess(
    projectRoot: string,
    statusPort: number,
    websocketPort: number
): ChildProcessWithoutNullStreams {
    return spawn(
        process.execPath,
        [
            CLI_ENTRYPOINT_PATH,
            "watch",
            projectRoot,
            "--no-runtime-server",
            "--status-port",
            String(statusPort),
            "--websocket-port",
            String(websocketPort),
            "--debounce-delay",
            "0",
            "--polling",
            "--polling-interval",
            "100",
            "--quiet"
        ],
        {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                NO_COLOR: "1"
            }
        }
    );
}

async function stopWatchProcess(childProcess: ChildProcessWithoutNullStreams): Promise<void> {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
        return;
    }

    childProcess.kill("SIGTERM");

    await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
            childProcess.kill("SIGKILL");
            resolve();
        }, 5000);

        childProcess.once("exit", () => {
            clearTimeout(timeout);
            resolve();
        });
    });
}

async function collectReplayPatches(websocketPort: number): Promise<ReadonlyArray<HotReloadPatch>> {
    return new Promise<ReadonlyArray<HotReloadPatch>>((resolve, reject) => {
        const websocket = new WebSocket(`ws://127.0.0.1:${websocketPort}`);
        const timeout = setTimeout(() => {
            websocket.close();
            reject(new Error("Timed out waiting for hot-reload WebSocket replay patches."));
        }, WATCH_TIMEOUT_MS);

        websocket.once("error", (error) => {
            clearTimeout(timeout);
            reject(new Error(`Hot-reload WebSocket failed: ${error.message}`, { cause: error }));
        });
        websocket.once("message", (data) => {
            clearTimeout(timeout);
            try {
                const text = typeof data === "string" ? data : data.toString();
                const patches = collectPatchesFromMessage(JSON.parse(text) as unknown);
                websocket.close();
                resolve(patches);
            } catch (error) {
                websocket.close();
                reject(new Error("Failed to parse hot-reload WebSocket replay payload.", { cause: error }));
            }
        });
    });
}

function assertNoProjectChanges(summary: ProjectChangeSummary, context: string): void {
    assert.deepEqual(summary, { added: [], modified: [], removed: [] }, context);
}

async function assertVendorProjectUnchanged(before: ProjectFingerprint): Promise<void> {
    const after = await FixtureRunner.createProjectFingerprint(VENDOR_3DSPIDER_PROJECT_PATH);
    assert.equal(
        after.digest,
        before.digest,
        `Vendor 3DSpider project must not be modified by integration tests: ${FixtureRunner.formatProjectChangeSummary(
            FixtureRunner.collectProjectChangeSummary(before, after)
        )}`
    );
}

async function withCopied3DSpiderProject<T>(operation: (projectRoot: string) => Promise<T>): Promise<T> {
    const vendorFingerprint = await FixtureRunner.createProjectFingerprint(VENDOR_3DSPIDER_PROJECT_PATH);
    const copiedProject = await FixtureRunner.copyExternalProjectFixture({
        sourceProjectPath: VENDOR_3DSPIDER_PROJECT_PATH
    });

    try {
        return await operation(copiedProject.workingProjectDirectoryPath);
    } finally {
        await copiedProject.dispose();
        await assertVendorProjectUnchanged(vendorFingerprint);
    }
}

function getPayloadResults(payload: ResourceSearchPayload): ReadonlyArray<Readonly<{ name?: unknown; id?: unknown }>> {
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.payload?.results), "Resource search payload must include results.");
    return payload.payload.results;
}

function assertResourceSearchIncludes(stdout: string, expectedText: string): void {
    const payload = FixtureRunner.assertJsonCliPayload(stdout) as ResourceSearchPayload;
    const results = getPayloadResults(payload);
    assert.ok(
        results.some((entry) => {
            const searchableText =
                typeof entry.name === "string" ? entry.name : typeof entry.id === "string" ? entry.id : "";
            return searchableText.includes(expectedText);
        }),
        `Expected resource search results to include ${expectedText}.`
    );
}

async function runProjectWorkflowTwice(
    projectRoot: string,
    args: ReadonlyArray<string>
): Promise<ProjectChangeSummary> {
    await runCliCommand([...args, "--path", projectRoot]);
    const afterFirstRun = await FixtureRunner.createProjectFingerprint(projectRoot);
    await runCliCommand([...args, "--path", projectRoot]);
    const afterSecondRun = await FixtureRunner.createProjectFingerprint(projectRoot);
    const secondRunSummary = FixtureRunner.collectProjectChangeSummary(afterFirstRun, afterSecondRun);

    assert.equal(
        afterSecondRun.digest,
        afterFirstRun.digest,
        "Whole-project workflow must be idempotent on repeat run."
    );
    assertNoProjectChanges(secondRunSummary, "Second whole-project workflow run must not change files.");
    return secondRunSummary;
}

function selectRuntimeApplicablePatch(patches: ReadonlyArray<HotReloadPatch>): HotReloadPatch {
    const eventPatch = patches.find((patch) => patch.kind === "event");
    if (eventPatch) {
        return eventPatch;
    }

    const scriptPatch = patches.find((patch) => patch.kind === "script");
    assert.ok(scriptPatch, "Expected at least one script or event patch.");
    return scriptPatch;
}

void test("3DSpider resource CLI tools inspect the real whole project", async () => {
    await withCopied3DSpiderProject(async (projectRoot) => {
        const listResult = await runCliCommand(["resource", "list", "--json", "--path", projectRoot]);
        const listPayload = FixtureRunner.assertJsonCliPayload(listResult.stdout) as ResourceSearchPayload;
        assert.equal(listPayload.ok, true);
        assert.ok(Array.isArray(listPayload.payload), "Resource list payload must be an array.");

        const spiderSearch = await runCliCommand(["resource", "find", "oSpider", "--json", "--path", projectRoot]);
        assertResourceSearchIncludes(spiderSearch.stdout, "oSpider");
        const inverseKinematicsSearch = await runCliCommand([
            "resource",
            "find",
            "InverseKinematics",
            "--json",
            "--path",
            projectRoot
        ]);
        assertResourceSearchIncludes(inverseKinematicsSearch.stdout, "InverseKinematics");

        const inspectResult = await runCliCommand(["resource", "inspect", "oSpider", "--json", "--path", projectRoot]);
        const inspectPayload = FixtureRunner.assertJsonCliPayload(inspectResult.stdout);
        assert.equal(inspectPayload.ok, true);

        const depsResult = await runCliCommand(["resource", "deps", "oSpider", "--json", "--path", projectRoot]);
        const depsPayload = FixtureRunner.assertJsonCliPayload(depsResult.stdout);
        assert.equal(depsPayload.ok, true);

        const auditResult = await runCliCommand(["resource", "audit", "--json", "--path", projectRoot]);
        const auditPayload = FixtureRunner.assertJsonCliPayload(auditResult.stdout) as ResourceAuditPayload;
        assert.equal(auditPayload.ok, true);
        assert.equal(typeof auditPayload.payload?.total, "number");
        assert.ok(Number(auditPayload.payload?.total) > 0, "Resource audit must count real graph entries.");
        assert.ok(
            Object.keys(auditPayload.payload?.kindCounts ?? {}).length > 0,
            "Resource audit must include kind counts."
        );
    });
});

void test("3DSpider format workflow is whole-project deterministic", async () => {
    await withCopied3DSpiderProject(async (projectRoot) => {
        await runProjectWorkflowTwice(projectRoot, ["format", "--write", "--on-parse-error", "skip"]);
    });
});

void test("3DSpider lint and fix workflows complete at whole-project scope", async () => {
    await withCopied3DSpiderProject(async (projectRoot) => {
        await runProjectWorkflowTwice(projectRoot, ["lint", "--write"]);

        const beforeFix = await FixtureRunner.createProjectFingerprint(projectRoot);
        await runCliCommand(["fix", "--write", "--path", projectRoot]);
        const afterFix = await FixtureRunner.createProjectFingerprint(projectRoot);
        const fixSummary = FixtureRunner.collectProjectChangeSummary(beforeFix, afterFix);

        assert.ok(afterFix.fileCount > 0, "Fix workflow must leave a non-empty project tree.");
        assert.ok(
            fixSummary.added.every((relativePath) => !relativePath.includes("dist/")),
            FixtureRunner.formatProjectChangeSummary(fixSummary)
        );

        await runCliCommand(["fix", "--write", "--path", projectRoot]);
        const afterSecondFix = await FixtureRunner.createProjectFingerprint(projectRoot);
        assert.equal(afterSecondFix.digest, afterFix.digest, "Whole-project fix workflow must be idempotent.");
    });
});

void test("3DSpider watch streams real hot-reload patches and runtime wrapper applies one", async () => {
    await withCopied3DSpiderProject(async (projectRoot) => {
        const { statusPort, websocketPort } = await findAvailableStatusAndWebSocketPorts();
        const watchProcess = startWatchProcess(projectRoot, statusPort, websocketPort);
        let stderr = "";
        watchProcess.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });

        try {
            const initialStatus = await waitForStatus(statusPort, (payload) => payload.scanComplete === true);
            const initialPatchCount = getPatchCount(initialStatus);

            await runCliCommand(["fix", "--write", "--path", projectRoot]);

            const updatedStatus = await waitForStatus(
                statusPort,
                (payload) =>
                    getPatchCount(payload) > initialPatchCount &&
                    (payload.recentPatches ?? []).some(
                        (patch) => typeof patch.filePath === "string" && patch.filePath.endsWith(".gml")
                    )
            );
            assert.ok(getPatchCount(updatedStatus) > initialPatchCount, "Expected fix workflow to produce patches.");

            const replayPatches = await collectReplayPatches(websocketPort);
            const projectPatches = replayPatches.filter((patch) => patch.metadata?.sourcePath?.endsWith(".gml"));
            assert.ok(projectPatches.length > 0, "Expected WebSocket replay to include real 3DSpider project patches.");

            const patch = selectRuntimeApplicablePatch(projectPatches);
            const dependencyStubs = Object.fromEntries(
                (patch.metadata?.dependencies ?? []).map((dependencyId) => [dependencyId, () => undefined])
            );
            const wrapper = RuntimeWrapper.createRuntimeWrapper({
                registry: {
                    scripts: dependencyStubs,
                    events: dependencyStubs
                }
            });
            const beforeVersion = wrapper.getVersion();
            const result = wrapper.applyPatch(patch);
            const afterVersion = wrapper.getVersion();

            assert.equal(result.success, true);
            assert.equal(afterVersion, beforeVersion + 1);
            if (patch.kind === "event") {
                assert.equal(typeof wrapper.getEvent(patch.id), "function");
            } else {
                assert.equal(typeof wrapper.getScript(patch.id), "function");
            }
        } finally {
            await stopWatchProcess(watchProcess);
            assert.equal(watchProcess.exitCode === 0 || watchProcess.signalCode !== null, true, stderr);
        }
    });
});
