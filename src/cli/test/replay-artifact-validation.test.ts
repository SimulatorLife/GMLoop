/**
 * Regression coverage for the replay-artifact defensive hardening layer.
 *
 * These tests pin two related behaviors introduced to guard against
 * hand-edited, truncated, or version-mismatched `.gmloop/replay/artifacts/*.json`
 * files:
 *
 *   1. `readValidatedArtifactJson` (in `modules/runtime/artifact-store.ts`)
 *      wraps `readFile` + `JSON.parse` with a structural schema predicate so
 *      that malformed payloads resolve to `null` instead of being cast
 *      through `unknown` and silently typed as the destination type.
 *   2. The `replay run`, `replay assert`, and `replay compare` action handlers
 *      surface a structured `reason: "artifact_invalid"` (or a
 *      `baselineReason` / `candidateReason` for `compare`) whenever the
 *      structural guard rejects the on-disk payload, so callers get a
 *      machine-readable failure reason rather than an unhandled `TypeError`
 *      surfacing as `exitCode: 1` with a stack trace.
 *
 * The "before" behavior is captured by the integration tests, which
 * deliberately write a structurally invalid artifact file (an object that
 * parses as JSON but omits `trace.events`) and assert the guarded response.
 * Without the hardening layer, the underlying `readArtifactJson<ReplayArtifact>`
 * would return the malformed value as if it were a valid `ReplayArtifact`,
 * and the action handlers would crash on `artifact.trace.events.length`.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { readValidatedArtifactJson } from "../src/modules/runtime/artifact-store.js";

type ReplayEventShape = Readonly<{ payload: string; step: number; type: string }>;

type ReplayArtifactShape = Readonly<{
    artifactId: string;
    checksum: string;
    createdAt: string;
    input: string;
    name: string;
    projectRoot: string;
    trace: { events: ReadonlyArray<ReplayEventShape> };
}>;

async function createTemporaryProjectRoot(prefix: string): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
    await writeFile(path.join(projectRoot, "stub.yyp"), "{}\n", "utf8");
    return projectRoot;
}

async function recordReplayArtifact(projectRoot: string, name: string, input: string): Promise<{ artifactId: string }> {
    const recordResult = await runCliTestCommand({
        argv: ["replay", "record", "--json", "--path", projectRoot, "--name", name, "--input", input]
    });
    assert.equal(recordResult.exitCode, 0, `replay record should succeed: ${recordResult.stderr}`);
    const recordPayload = JSON.parse(recordResult.stdout) as {
        payload: { artifact: { artifactId: string } };
    };
    return recordPayload.payload.artifact;
}

function isReplayEventShape(value: unknown): value is ReplayEventShape {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        typeof record.payload === "string" &&
        typeof record.type === "string" &&
        typeof record.step === "number" &&
        Number.isFinite(record.step)
    );
}

function isReplayArtifactShape(value: unknown): value is ReplayArtifactShape {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    if (
        typeof record.artifactId !== "string" ||
        typeof record.checksum !== "string" ||
        typeof record.createdAt !== "string" ||
        typeof record.input !== "string" ||
        typeof record.name !== "string" ||
        typeof record.projectRoot !== "string"
    ) {
        return false;
    }
    const trace = record.trace;
    if (!trace || typeof trace !== "object" || !Array.isArray((trace as { events?: unknown }).events)) {
        return false;
    }
    return (trace as { events: Array<unknown> }).events.every(isReplayEventShape);
}

void test("readValidatedArtifactJson returns null when the file is missing", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-validation-");
    const missingPath = path.join(projectRoot, "does-not-exist.json");

    const result = await readValidatedArtifactJson<ReplayArtifactShape>(missingPath, {
        validate: isReplayArtifactShape
    });

    assert.equal(result, null);
});

void test("readValidatedArtifactJson returns null when the JSON cannot be parsed", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-validation-");
    const filePath = path.join(projectRoot, "broken.json");
    await writeFile(filePath, "{ this is not json", "utf8");

    const result = await readValidatedArtifactJson<ReplayArtifactShape>(filePath, {
        validate: isReplayArtifactShape
    });

    assert.equal(result, null);
});

void test("readValidatedArtifactJson rejects structurally invalid payloads", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-validation-");
    const filePath = path.join(projectRoot, "wrong-shape.json");
    // Valid JSON, wrong shape — would pass a bare `as T` cast and only crash
    // later when downstream code dereferences `trace.events.length`.
    await writeFile(filePath, JSON.stringify({ foo: "bar" }), "utf8");

    const result = await readValidatedArtifactJson<ReplayArtifactShape>(filePath, {
        validate: isReplayArtifactShape
    });

    assert.equal(result, null);
});

void test("readValidatedArtifactJson returns the parsed value when the schema matches", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-validation-");
    const { artifactId } = await recordReplayArtifact(projectRoot, "valid", "payload");
    const artifactPath = path.join(projectRoot, ".gmloop", "replay", "artifacts", `${artifactId}.json`);

    const result = await readValidatedArtifactJson<ReplayArtifactShape>(artifactPath, {
        validate: isReplayArtifactShape
    });

    assert.ok(result, "expected a validated artifact");
    assert.equal(result.artifactId, artifactId);
    assert.equal(Array.isArray(result.trace.events), true);
});

void test("replay run reports artifact_invalid for a structurally invalid artifact", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-run-invalid-");
    const { artifactId } = await recordReplayArtifact(projectRoot, "alpha", "first");

    // Corrupt the on-disk artifact so it parses as JSON but no longer matches
    // the ReplayArtifact shape. This is the exact "failure-before" condition
    // the hardening layer protects against.
    const artifactPath = path.join(projectRoot, ".gmloop", "replay", "artifacts", `${artifactId}.json`);
    await writeFile(artifactPath, JSON.stringify({ artifactId, broken: true }), "utf8");

    const runResult = await runCliTestCommand({
        argv: ["replay", "run", "--json", "--path", projectRoot, "--id", artifactId]
    });

    // Critical assertion: the action must NOT crash with a TypeError. The
    // guarded path resolves the failure as a structured payload with
    // exitCode 0, exactly like the existing "not found" branch.
    assert.equal(runResult.exitCode, 0, `expected guarded run, got stderr: ${runResult.stderr}`);
    const runPayload = JSON.parse(runResult.stdout) as {
        payload: { artifactId: string; ok: boolean; reason: string };
    };
    assert.equal(runPayload.payload.ok, false);
    assert.equal(runPayload.payload.artifactId, artifactId);
    assert.equal(runPayload.payload.reason, "artifact_invalid");
});

void test("replay assert reports artifact_invalid for a structurally invalid artifact", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-assert-invalid-");
    const { artifactId } = await recordReplayArtifact(projectRoot, "alpha", "first");

    const artifactPath = path.join(projectRoot, ".gmloop", "replay", "artifacts", `${artifactId}.json`);
    await writeFile(artifactPath, JSON.stringify({ artifactId, missing: "trace" }), "utf8");

    const assertResult = await runCliTestCommand({
        argv: ["replay", "assert", "--json", "--path", projectRoot, "--id", artifactId]
    });

    assert.equal(assertResult.exitCode, 0, `expected guarded assert, got stderr: ${assertResult.stderr}`);
    const assertPayload = JSON.parse(assertResult.stdout) as {
        payload: { artifactId: string; ok: boolean; reason: string };
    };
    assert.equal(assertPayload.payload.ok, false);
    assert.equal(assertPayload.payload.artifactId, artifactId);
    assert.equal(assertPayload.payload.reason, "artifact_invalid");
});

void test("replay compare reports the per-side reason when one artifact is invalid", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-compare-invalid-");
    const { artifactId: validId } = await recordReplayArtifact(projectRoot, "valid", "first");
    const { artifactId: corruptId } = await recordReplayArtifact(projectRoot, "broken", "second");

    const corruptPath = path.join(projectRoot, ".gmloop", "replay", "artifacts", `${corruptId}.json`);
    await writeFile(corruptPath, JSON.stringify({ artifactId: corruptId }), "utf8");

    const compareResult = await runCliTestCommand({
        argv: ["replay", "compare", "--json", "--path", projectRoot, "--baseline", validId, "--candidate", corruptId]
    });

    assert.equal(compareResult.exitCode, 0, `expected guarded compare, got stderr: ${compareResult.stderr}`);
    const comparePayload = JSON.parse(compareResult.stdout) as {
        payload: { baselineReason: string | null; candidateReason: string | null; ok: boolean; reason: string };
    };
    assert.equal(comparePayload.payload.ok, false);
    assert.equal(comparePayload.payload.reason, "missing_artifacts");
    assert.equal(comparePayload.payload.baselineReason, null);
    assert.equal(comparePayload.payload.candidateReason, "artifact_invalid");
});

void test("replay run still reports artifact_not_found for a missing artifact id", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-missing-");
    // Record at least one artifact so the on-disk directory exists; the lookup
    // id below is synthetic and has no corresponding file.
    await recordReplayArtifact(projectRoot, "alpha", "first");

    const runResult = await runCliTestCommand({
        argv: ["replay", "run", "--json", "--path", projectRoot, "--id", "definitely-not-a-real-artifact"]
    });

    assert.equal(runResult.exitCode, 0);
    const runPayload = JSON.parse(runResult.stdout) as {
        payload: { artifactId: string; ok: boolean; reason: string };
    };
    assert.equal(runPayload.payload.ok, false);
    assert.equal(runPayload.payload.artifactId, "definitely-not-a-real-artifact");
    assert.equal(runPayload.payload.reason, "artifact_not_found");
});

void test("replay run succeeds for a freshly recorded artifact (happy path)", async () => {
    const projectRoot = await createTemporaryProjectRoot("gmloop-cli-replay-happy-");
    const { artifactId } = await recordReplayArtifact(projectRoot, "happy", "path");

    // Sanity check: the existing happy path must still resolve the artifact,
    // demonstrating that the hardened path preserves the original API.
    const artifactsDir = path.join(projectRoot, ".gmloop", "replay", "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const raw = await readFile(path.join(artifactsDir, `${artifactId}.json`), "utf8");
    assert.match(raw, /"events"/);

    const runResult = await runCliTestCommand({
        argv: ["replay", "run", "--json", "--path", projectRoot, "--id", artifactId]
    });
    assert.equal(runResult.exitCode, 0);
    const runPayload = JSON.parse(runResult.stdout) as {
        payload: { artifact: { artifactId: string }; ok: boolean; output: { eventCount: number } };
    };
    assert.equal(runPayload.payload.ok, true);
    assert.equal(runPayload.payload.artifact.artifactId, artifactId);
    assert.equal(runPayload.payload.output.eventCount, 3);
});
