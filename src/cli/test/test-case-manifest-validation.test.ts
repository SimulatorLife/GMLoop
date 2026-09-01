import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { __testCommandTestHelpers__ } from "../src/commands/test.js";

const { isValidTestCaseManifest, isValidTestCaseManifestEntry } = __testCommandTestHelpers__;

void describe("isValidTestCaseManifestEntry", () => {
    void it("accepts a minimal entry with only the required fields", () => {
        assert.equal(isValidTestCaseManifestEntry({ name: "case", target: "scr_demo" }), true);
    });

    void it("accepts an entry that also carries an expected string", () => {
        assert.equal(isValidTestCaseManifestEntry({ expected: "behaves", name: "case", target: "scr_demo" }), true);
    });

    void it("rejects entries with a non-string target or name", () => {
        assert.equal(isValidTestCaseManifestEntry({ name: "case", target: null }), false);
        assert.equal(isValidTestCaseManifestEntry({ name: 42, target: "scr_demo" }), false);
        assert.equal(isValidTestCaseManifestEntry({ name: "", target: "scr_demo" }), false);
    });

    void it("rejects entries whose expected field is not a string", () => {
        assert.equal(isValidTestCaseManifestEntry({ expected: 42, name: "case", target: "scr_demo" }), false);
    });

    void it("rejects non-object payloads including null and arrays", () => {
        assert.equal(isValidTestCaseManifestEntry(null), false);
        assert.equal(isValidTestCaseManifestEntry([]), false);
        assert.equal(isValidTestCaseManifestEntry("entry"), false);
    });
});

void describe("isValidTestCaseManifest", () => {
    void it('accepts a manifest whose version is "1" and whose cases are all valid', () => {
        assert.equal(
            isValidTestCaseManifest({
                cases: [{ name: "c1", target: "scr_demo" }],
                version: "1"
            }),
            true
        );
    });

    void it("rejects manifests whose version does not match the supported schema", () => {
        assert.equal(
            isValidTestCaseManifest({
                cases: [],
                version: "2"
            }),
            false
        );
    });

    void it("rejects manifests whose cases field is not an array", () => {
        assert.equal(
            isValidTestCaseManifest({
                cases: { name: "c1", target: "scr_demo" },
                version: "1"
            }),
            false
        );
    });

    void it("rejects manifests that contain at least one malformed entry", () => {
        // The malformed entry would have crashed `sortTestCaseEntries` because
        // the legacy `Array.isArray(manifest.cases)` check accepted the wrapper
        // without inspecting nested shapes; the schema guard now refuses the
        // payload so the caller can fall back to an empty manifest.
        assert.equal(
            isValidTestCaseManifest({
                cases: [null, { name: "c1", target: "scr_demo" }],
                version: "1"
            }),
            false
        );
    });

    void it("rejects non-object top-level payloads", () => {
        assert.equal(isValidTestCaseManifest(null), false);
        assert.equal(isValidTestCaseManifest([]), false);
        assert.equal(isValidTestCaseManifest("manifest"), false);
    });
});

void describe("test case manifest disk hardening", () => {
    void it("treats a missing cases.json file as an empty manifest", async () => {
        const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-test-case-missing-"));
        const projectPath = path.join(projectRoot, "Game.yyp");
        await writeFile(projectPath, "{}\n", "utf8");

        // No cases.json file has been written. The CLI should not crash and
        // should report the implicit empty manifest through the normal payload.
        const result = await runCliTestCommand({
            argv: ["test", "case", "create", "scr_demo", "case_a", "--path", projectPath, "--json"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as {
            payload: { changed: boolean; ok: boolean };
        };
        assert.equal(payload.payload.ok, true);
        assert.equal(payload.payload.changed, true);
    });

    void it("rejects malformed on-disk cases.json files instead of crashing", async () => {
        // Regression: the legacy reader accepted `{cases: [null]}` and only
        // verified the outer Array shape, which caused sortTestCaseEntries to
        // throw `TypeError: Cannot read properties of null` during subsequent
        // CLI invocations. The hardened reader now treats the file as if it
        // were absent and produces an empty manifest instead.
        const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-test-case-malformed-"));
        const projectPath = path.join(projectRoot, "Game.yyp");
        await writeFile(projectPath, "{}\n", "utf8");

        const artifactDirectory = path.join(projectRoot, ".gmloop", "test");
        await mkdir(artifactDirectory, { recursive: true });
        const manifestPath = path.join(artifactDirectory, "cases.json");
        await writeFile(
            manifestPath,
            JSON.stringify(
                {
                    cases: [null, { name: 42, target: null }],
                    version: "1"
                },
                null,
                2
            ),
            "utf8"
        );

        const result = await runCliTestCommand({
            argv: ["test", "case", "create", "scr_demo", "case_a", "--path", projectPath, "--json"],
            cwd: projectRoot
        });

        assert.equal(result.exitCode, 0, `CLI should not crash on malformed manifest. stderr=${result.stderr}`);
        const payload = JSON.parse(result.stdout) as {
            payload: { changed: boolean; ok: boolean };
        };
        assert.equal(payload.payload.ok, true);
        // The hardened reader normalizes the corrupted file to an empty
        // manifest, so a freshly created entry reports `changed: true`.
        assert.equal(payload.payload.changed, true);
    });

    void it("rejects manifest files with an unsupported version", async () => {
        const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-test-case-version-"));
        const projectPath = path.join(projectRoot, "Game.yyp");
        await writeFile(projectPath, "{}\n", "utf8");

        const artifactDirectory = path.join(projectRoot, ".gmloop", "test");
        await mkdir(artifactDirectory, { recursive: true });
        const manifestPath = path.join(artifactDirectory, "cases.json");
        await writeFile(
            manifestPath,
            JSON.stringify(
                {
                    cases: [{ name: "case_a", target: "scr_demo" }],
                    version: "2"
                },
                null,
                2
            ),
            "utf8"
        );

        const result = await runCliTestCommand({
            argv: ["test", "case", "update", "scr_demo", "case_a", "--path", projectPath, "--json"],
            cwd: projectRoot
        });

        // The hardened reader treats the unsupported version as missing, so
        // the update flow reports `ok: false` with `test_case_not_found`
        // instead of crashing or pretending the entry exists.
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { payload: { ok: boolean; reason: string } };
        assert.equal(payload.payload.ok, false);
        assert.equal(payload.payload.reason, "test_case_not_found");
    });
});
