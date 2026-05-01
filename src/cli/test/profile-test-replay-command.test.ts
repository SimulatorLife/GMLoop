import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

async function createTemporaryProjectRoot(prefix: string): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
    await writeFile(path.join(projectRoot, "stub.yyp"), "{}\n", "utf8");
    return projectRoot;
}

void test("profile start/stop/snapshot/compare/report persist snapshots in .gmloop", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-profile-");
    await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
    await writeFile(path.join(projectRoot, "scripts", "sample.gml"), "var x = 1;\n", "utf8");

    const startResult = await runCliTestCommand({
        argv: ["profile", "start", "--json", "--path", projectRoot]
    });
    assert.equal(startResult.exitCode, 0);

    const snapshotResult = await runCliTestCommand({
        argv: ["profile", "snapshot", "--json", "--path", projectRoot]
    });
    assert.equal(snapshotResult.exitCode, 0);

    const stopResult = await runCliTestCommand({
        argv: ["profile", "stop", "--json", "--path", projectRoot]
    });
    assert.equal(stopResult.exitCode, 0);

    const compareResult = await runCliTestCommand({
        argv: ["profile", "compare", "--json", "--path", projectRoot]
    });
    assert.equal(compareResult.exitCode, 0);
    const comparePayload = JSON.parse(compareResult.stdout) as { payload: { ok: boolean } };
    assert.equal(comparePayload.payload.ok, true);

    const reportResult = await runCliTestCommand({
        argv: ["profile", "report", "--json", "--path", projectRoot]
    });
    assert.equal(reportResult.exitCode, 0);
    const reportPayload = JSON.parse(reportResult.stdout) as {
        payload: { latestSnapshotId: string | null; ok: boolean; snapshotCount: number };
    };
    assert.equal(reportPayload.payload.ok, true);
    assert.ok(reportPayload.payload.snapshotCount >= 2);
    assert.equal(typeof reportPayload.payload.latestSnapshotId, "string");

    const sessionPath = path.join(projectRoot, ".gmloop", "profile", "session.json");
    const sessionRaw = await readFile(sessionPath, "utf8");
    const session = JSON.parse(sessionRaw) as { active: boolean };
    assert.equal(session.active, false);
});

void test("test list/run/results execute and persist machine-readable output", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-test-");
    await mkdir(path.join(projectRoot, "tests"), { recursive: true });
    await writeFile(
        path.join(projectRoot, "tests", "sample.test.js"),
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('ok', () => { assert.equal(1, 1); });\n",
        "utf8"
    );

    const listResult = await runCliTestCommand({
        argv: ["test", "list", "--json", "--path", projectRoot]
    });
    assert.equal(listResult.exitCode, 0);
    const listPayload = JSON.parse(listResult.stdout) as { payload: { count: number; files: Array<string> } };
    assert.equal(listPayload.payload.count, 1);
    assert.equal(listPayload.payload.files[0], "tests/sample.test.js");

    const runResult = await runCliTestCommand({
        argv: ["test", "run", "--json", "--path", projectRoot]
    });
    assert.equal(runResult.exitCode, 0);
    const runPayload = JSON.parse(runResult.stdout) as { payload: { run: { exitCode: number } } };
    assert.equal(runPayload.payload.run.exitCode, 0);

    const resultsResult = await runCliTestCommand({
        argv: ["test", "results", "--json", "--path", projectRoot]
    });
    assert.equal(resultsResult.exitCode, 0);
    const resultsPayload = JSON.parse(resultsResult.stdout) as { payload: { ok: boolean; run: { passed: number } } };
    assert.equal(resultsPayload.payload.ok, true);
    assert.equal(resultsPayload.payload.run.passed, 1);
});

void test("replay record/run/compare/assert produce durable deterministic artifacts", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-");

    const firstRecord = await runCliTestCommand({
        argv: ["replay", "record", "--json", "--path", projectRoot, "--name", "smoke", "--input", "alpha"]
    });
    assert.equal(firstRecord.exitCode, 0);
    const firstPayload = JSON.parse(firstRecord.stdout) as {
        payload: { artifact: { artifactId: string; checksum: string } };
    };

    const secondRecord = await runCliTestCommand({
        argv: ["replay", "record", "--json", "--path", projectRoot, "--name", "smoke", "--input", "beta"]
    });
    assert.equal(secondRecord.exitCode, 0);
    const secondPayload = JSON.parse(secondRecord.stdout) as {
        payload: { artifact: { artifactId: string; checksum: string } };
    };

    const runResult = await runCliTestCommand({
        argv: ["replay", "run", "--json", "--path", projectRoot, "--id", firstPayload.payload.artifact.artifactId]
    });
    assert.equal(runResult.exitCode, 0);
    const runPayload = JSON.parse(runResult.stdout) as { payload: { ok: boolean } };
    assert.equal(runPayload.payload.ok, true);

    const compareResult = await runCliTestCommand({
        argv: [
            "replay",
            "compare",
            "--json",
            "--path",
            projectRoot,
            "--baseline",
            firstPayload.payload.artifact.artifactId,
            "--candidate",
            secondPayload.payload.artifact.artifactId
        ]
    });
    assert.equal(compareResult.exitCode, 0);
    const comparePayload = JSON.parse(compareResult.stdout) as {
        payload: { diff: { checksumChanged: boolean }; ok: boolean };
    };
    assert.equal(comparePayload.payload.ok, true);
    assert.equal(comparePayload.payload.diff.checksumChanged, true);

    const assertResult = await runCliTestCommand({
        argv: ["replay", "assert", "--json", "--path", projectRoot, "--id", secondPayload.payload.artifact.artifactId]
    });
    assert.equal(assertResult.exitCode, 0);
    const assertPayload = JSON.parse(assertResult.stdout) as { payload: { ok: boolean } };
    assert.equal(assertPayload.payload.ok, true);

    const latestPath = path.join(projectRoot, ".gmloop", "replay", "latest.json");
    const latest = JSON.parse(await readFile(latestPath, "utf8")) as { latestArtifactId: string };
    assert.equal(latest.latestArtifactId, secondPayload.payload.artifact.artifactId);
});
