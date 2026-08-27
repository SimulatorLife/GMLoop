import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
    appendAutoMergeGitHubOutputs,
    readAutoMergeJsonArtifact,
    readOptionalAutoMergeJsonArtifact,
    writeAutoMergeJsonArtifact
} from "../src/commands/ci-automerge-artifacts.js";

const temporaryDirectories: Array<string> = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createTemporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gmloop-automerge-artifacts-"));
    temporaryDirectories.push(directory);
    return directory;
}

void test("auto-merge JSON artifacts retain their established serialization", () => {
    const filePath = path.join(createTemporaryDirectory(), "nested", "report.json");
    const artifact = { green: true, count: 3 };

    writeAutoMergeJsonArtifact(filePath, artifact);

    assert.equal(fs.readFileSync(filePath, "utf8"), '{\n  "green": true,\n  "count": 3\n}\n');
    assert.deepEqual(readAutoMergeJsonArtifact(filePath), artifact);
});

void test("optional auto-merge artifacts return null for missing and malformed JSON", () => {
    const directory = createTemporaryDirectory();
    const malformedPath = path.join(directory, "malformed.json");
    fs.writeFileSync(malformedPath, "not json", "utf8");

    assert.equal(readOptionalAutoMergeJsonArtifact(path.join(directory, "missing.json")), null);
    assert.equal(readOptionalAutoMergeJsonArtifact(malformedPath), null);
});

void test("GitHub outputs append strings, numbers, and booleans in line-oriented form", () => {
    const filePath = path.join(createTemporaryDirectory(), "github-output.txt");

    appendAutoMergeGitHubOutputs(undefined, { ignored: true });
    appendAutoMergeGitHubOutputs(filePath, { status: "clean", count: 2, green: true });
    appendAutoMergeGitHubOutputs(filePath, { reason: "complete" });

    assert.equal(fs.readFileSync(filePath, "utf8"), "status=clean\ncount=2\ngreen=true\nreason=complete\n");
});
