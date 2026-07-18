import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    ProjectOperationConflictError,
    readProjectOperationState,
    resolveProjectOperationStatePath,
    runProjectOperation
} from "../src/modules/runtime/project-operation-state.js";

async function createTemporaryProject(): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), "gmloop-project-operation-state-"));
}

void test("project operations persist shared progress and recent completion", async (context) => {
    const projectRoot = await createTemporaryProject();
    context.after(async () => {
        await rm(projectRoot, { force: true, recursive: true });
    });

    await runProjectOperation(
        {
            command: "lint",
            kind: "lint",
            projectRoot
        },
        async (operation) => {
            const activeState = readProjectOperationState(projectRoot);
            assert.equal(activeState.active?.id, operation.id);
            assert.equal(activeState.active?.status, "running");

            operation.update("scanning", "Scanning project files.");
            console.log("Building shared semantic graph.");
            operation.appendMessage("Found 3 files to analyze.");
            await Promise.resolve();

            const progressState = readProjectOperationState(projectRoot);
            assert.equal(progressState.active?.phase, "scanning");
            assert.deepEqual(progressState.active?.messages.slice(-3), [
                "Scanning project files.",
                "Building shared semantic graph.",
                "Found 3 files to analyze."
            ]);
        }
    );

    const completedState = readProjectOperationState(projectRoot);
    assert.equal(completedState.active, null);
    assert.equal(completedState.recent[0]?.kind, "lint");
    assert.equal(completedState.recent[0]?.status, "succeeded");
    assert.equal(completedState.recent[0]?.completedAt !== null, true);
});

void test("project operation failures remain visible to other clients", async (context) => {
    const projectRoot = await createTemporaryProject();
    context.after(async () => {
        await rm(projectRoot, { force: true, recursive: true });
    });

    await assert.rejects(
        runProjectOperation(
            {
                command: "refactor",
                kind: "refactor",
                projectRoot
            },
            async (operation) => {
                operation.update("planning", "Planning codemod changes.");
                throw new Error("codemod failed");
            }
        ),
        /codemod failed/
    );

    const failedState = readProjectOperationState(projectRoot);
    assert.equal(failedState.active, null);
    assert.equal(failedState.recent[0]?.status, "failed");
    assert.equal(failedState.recent[0]?.phase, "failed");
    assert.match(failedState.recent[0]?.messages.at(-1) ?? "", /codemod failed/);
});

void test("a second process cannot start a project operation while the lock is live", async (context) => {
    const projectRoot = await createTemporaryProject();
    context.after(async () => {
        await rm(projectRoot, { force: true, recursive: true });
    });
    const operationId = "already-running-operation";
    const operationDirectory = path.join(projectRoot, ".gmloop");
    await mkdir(operationDirectory, { recursive: true });

    await writeFile(
        resolveProjectOperationStatePath(projectRoot),
        `${JSON.stringify(
            {
                active: {
                    command: "fix",
                    completedAt: null,
                    id: operationId,
                    kind: "fix",
                    messages: ["Fix is already running."],
                    phase: "linting",
                    pid: process.pid,
                    projectRoot,
                    startedAt: Date.now(),
                    status: "running",
                    updatedAt: Date.now()
                },
                recent: [],
                version: 1
            },
            null,
            2
        )}\n`,
        "utf8"
    );
    await writeFile(
        path.join(operationDirectory, "operation-state.lock"),
        `${JSON.stringify({ id: operationId, pid: process.pid })}\n`,
        "utf8"
    );

    await assert.rejects(
        runProjectOperation(
            {
                command: "fix",
                kind: "fix",
                projectRoot
            },
            async () => undefined
        ),
        (error: unknown) => {
            assert.equal(error instanceof ProjectOperationConflictError, true);
            assert.equal((error as ProjectOperationConflictError).activeOperation.id.includes("already-running"), true);
            return true;
        }
    );

    const lockContents = await readFile(path.join(operationDirectory, "operation-state.lock"), "utf8");
    assert.equal(lockContents.includes(operationId), true);
});

void test("concurrent operations in one MCP process still contend for the project lock", async (context) => {
    const projectRoot = await createTemporaryProject();
    context.after(async () => {
        await rm(projectRoot, { force: true, recursive: true });
    });
    let releaseFirstOperation = (): void => undefined;

    const firstOperation = runProjectOperation(
        {
            command: "lint",
            kind: "lint",
            projectRoot
        },
        async () =>
            new Promise<void>((resolve) => {
                releaseFirstOperation = resolve;
            })
    );

    await assert.rejects(
        runProjectOperation(
            {
                command: "fix",
                kind: "fix",
                projectRoot
            },
            async () => undefined
        ),
        ProjectOperationConflictError
    );

    releaseFirstOperation();
    await firstOperation;
});
