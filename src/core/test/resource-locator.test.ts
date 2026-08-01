import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    __resolveBundledResourceBaseDirectoryForTests,
    resolveBundledResourcePath
} from "../src/resources/resource-locator.js";

function createTemporaryCoreWorkspaceFixture() {
    const fixtureRootPath = mkdtempSync(path.join(tmpdir(), "gmloop-core-resource-locator-"));
    const packageDirectoryPath = path.join(fixtureRootPath, "packages", "core");
    const nestedModuleDirectoryPath = path.join(packageDirectoryPath, "dist", "src", "resources");
    const repositoryResourceDirectoryPath = path.join(fixtureRootPath, "resources");

    mkdirSync(nestedModuleDirectoryPath, { recursive: true });
    mkdirSync(repositoryResourceDirectoryPath, { recursive: true });
    writeFileSync(path.join(packageDirectoryPath, "package.json"), JSON.stringify({ name: "@gmloop/core" }, null, 2));

    return {
        fixtureRootPath,
        nestedModuleDirectoryPath,
        packageDirectoryPath,
        repositoryResourceDirectoryPath
    };
}

void test("resolveBundledResourcePath locates bundled resources from the repository checkout", () => {
    const resourcePath = resolveBundledResourcePath("gml-identifiers.json");

    assert.match(resourcePath, /resources[\\/]gml-identifiers\.json$/u);
});

void test("resolveBundledResourcePath rejects parent-directory traversal", () => {
    assert.throws(
        () => resolveBundledResourcePath("../README.md"),
        /must resolve to a safe relative path within the bundled resources/u
    );
});

void test("resolveBundledResourcePath rejects URL-encoded parent-directory traversal", () => {
    assert.throws(
        () => resolveBundledResourcePath("%2e%2e/README.md"),
        /must resolve to a safe relative path within the bundled resources/u
    );
});

void test("resource locator ignores obsolete generated package manifest paths", () => {
    const fixture = createTemporaryCoreWorkspaceFixture();

    try {
        writeFileSync(
            path.join(fixture.packageDirectoryPath, "resource-directory.json"),
            JSON.stringify({ resourceDirectory: path.join(fixture.fixtureRootPath, "missing-resources") }, null, 2)
        );

        assert.equal(
            __resolveBundledResourceBaseDirectoryForTests(fixture.nestedModuleDirectoryPath),
            fixture.repositoryResourceDirectoryPath
        );
    } finally {
        rmSync(fixture.fixtureRootPath, { force: true, recursive: true });
    }
});

void test("resource locator falls back to the repository resources directory when no manifest exists", () => {
    const fixture = createTemporaryCoreWorkspaceFixture();

    try {
        assert.equal(
            __resolveBundledResourceBaseDirectoryForTests(fixture.nestedModuleDirectoryPath),
            fixture.repositoryResourceDirectoryPath
        );
    } finally {
        rmSync(fixture.fixtureRootPath, { force: true, recursive: true });
    }
});

void test("resource locator treats missing package.json as non-match (regression for existsSync removal)", () => {
    // After migrating `tryReadPackageName` away from `fs.existsSync` to a
    // try/catch around `readFileSync`, a directory without a package.json
    // must continue to look like a non-match so the upward walk keeps
    // moving toward the real core package directory. This test asserts
    // that a subtree with no package.json files still resolves through the
    // existing core workspace fixture.
    const fixture = createTemporaryCoreWorkspaceFixture();

    try {
        const intermediateDirectoryPath = path.join(fixture.packageDirectoryPath, "dist", "src");
        // The fixture creates only the nested module directory and the
        // core package.json. Everything between the leaf and the core
        // package is intentionally empty of package.json files, so the
        // locator must traverse them without raising.
        assert.doesNotThrow(() => __resolveBundledResourceBaseDirectoryForTests(intermediateDirectoryPath));
        assert.equal(
            __resolveBundledResourceBaseDirectoryForTests(intermediateDirectoryPath),
            fixture.repositoryResourceDirectoryPath
        );
    } finally {
        rmSync(fixture.fixtureRootPath, { force: true, recursive: true });
    }
});

void test("resource locator skips directories whose package.json names do not match", () => {
    // Mirrors the missing-file regression above, but verifies the
    // post-migration flow when a package.json is present yet irrelevant.
    // Reading still has to succeed (no `existsSync` race) and the
    // unrelated name must not derail the walk toward the core package.
    const fixture = createTemporaryCoreWorkspaceFixture();
    const unrelatedPackageDirectoryPath = path.join(fixture.fixtureRootPath, "packages", "unrelated");

    try {
        mkdirSync(unrelatedPackageDirectoryPath, { recursive: true });
        writeFileSync(
            path.join(unrelatedPackageDirectoryPath, "package.json"),
            JSON.stringify({ name: "not-the-core-package" }, null, 2)
        );

        assert.equal(
            __resolveBundledResourceBaseDirectoryForTests(fixture.nestedModuleDirectoryPath),
            fixture.repositoryResourceDirectoryPath
        );
    } finally {
        rmSync(fixture.fixtureRootPath, { force: true, recursive: true });
    }
});
