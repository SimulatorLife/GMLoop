import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Core } from "@gmloop/core";

import {
    describeManualSource,
    getManualRootMetadataPath,
    readManualJson,
    readManualText,
    resolveManualSource,
    resolveManualSourceCommitHash
} from "../src/modules/manual/source.js";
import { resolveFromRepoRoot } from "../src/shared/workspace-paths.js";

function runGit(args: Array<string>, cwd: string) {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    }).trim();
}

void test("resolveManualSource returns explicit manual root", async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "manual-root-"));
    t.after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    const result = await resolveManualSource({ manualRoot: tempDir });

    assert.equal(result.root, tempDir);
    assert.equal(result.packageName, null);
    assert.equal(result.packageJson, null);
});

void test("resolveManualSource defaults to vendor submodule", async () => {
    const result = await resolveManualSource();
    const expectedRoot = resolveFromRepoRoot("vendor", "GameMaker-Manual");

    assert.equal(result.root, expectedRoot);
});

void test("resolveManualSource rejects missing manual root", async () => {
    const missingRoot = path.join(os.tmpdir(), `missing-manual-${Date.now()}`);

    await assert.rejects(() => resolveManualSource({ manualRoot: missingRoot }), /Manual root '.*' is unavailable/);
});

void test("readManualText returns manual asset contents", async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "manual-read-"));
    const relativePath = path.join("Manual", "contents", "sample.txt");
    const absolutePath = path.join(tempDir, relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "hello world", "utf8");

    t.after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    const contents = await readManualText(tempDir, path.join("Manual", "contents", "sample.txt"));
    assert.equal(contents, "hello world");
});

void test("readManualJson wraps parse failures with manual asset context", async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "manual-read-json-"));
    const relativePath = path.join("Manual", "contents", "broken.json");
    const absolutePath = path.join(tempDir, relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "{ invalid", "utf8");

    t.after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    await assert.rejects(
        () => readManualJson(tempDir, relativePath),
        (error: unknown) =>
            error instanceof Error &&
            error.message.includes("Manual asset 'Manual/contents/broken.json' did not contain valid JSON.") &&
            error.message.includes("Failed to parse manual asset from Manual/contents/broken.json")
    );
});

void test("describeManualSource includes package version", () => {
    const description = describeManualSource({
        root: "/tmp/manual",
        packageName: "fake-manual",
        packageJson: { version: "1.2.3" }
    });

    assert.equal(description, "fake-manual@1.2.3");
});

void test("describeManualSource falls back to manual root", () => {
    const description = describeManualSource({
        root: "/tmp/manual",
        packageName: null,
        packageJson: null
    });

    assert.equal(description, "/tmp/manual");
});

void test("getManualRootMetadataPath returns repo-relative path", () => {
    const manualSource = {
        root: resolveFromRepoRoot("vendor", "GameMaker-Manual"),
        packageName: null,
        packageJson: null
    };

    assert.equal(getManualRootMetadataPath(manualSource), "vendor/GameMaker-Manual");
});

void test("getManualRootMetadataPath falls back to external roots", () => {
    const externalRoot = path.join(os.tmpdir(), "manual-metadata-test");
    const manualSource = {
        root: externalRoot,
        packageName: null,
        packageJson: null
    };

    assert.equal(getManualRootMetadataPath(manualSource), Core.toPosixPath(externalRoot));
});

void test("resolveManualSourceCommitHash reads the git commit from manual root", async (t) => {
    const manualRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manual-git-root-"));
    t.after(async () => {
        await fs.rm(manualRoot, { recursive: true, force: true });
    });

    runGit(["init"], manualRoot);
    runGit(["config", "user.email", "manual-test@example.com"], manualRoot);
    runGit(["config", "user.name", "Manual Test"], manualRoot);
    await fs.writeFile(path.join(manualRoot, "README.md"), "manual\n", "utf8");
    runGit(["add", "README.md"], manualRoot);
    runGit(["commit", "-m", "seed manual repo"], manualRoot);

    const expectedHash = runGit(["rev-parse", "HEAD"], manualRoot).toLowerCase();
    const hash = resolveManualSourceCommitHash({
        root: manualRoot,
        packageName: null,
        packageJson: null
    });

    assert.equal(hash, expectedHash);
});

void test("resolveManualSourceCommitHash falls back to package gitHead when root is not a git repo", async (t) => {
    const manualRoot = await fs.mkdtemp(path.join(os.tmpdir(), "manual-package-root-"));
    t.after(async () => {
        await fs.rm(manualRoot, { recursive: true, force: true });
    });

    const gitHead = "8f6d4f0112a8fa5d36f73fe6766f9af087c2add4";
    const hash = resolveManualSourceCommitHash({
        root: manualRoot,
        packageName: "manual-package",
        packageJson: { gitHead }
    });

    assert.equal(hash, gitHead);
});
