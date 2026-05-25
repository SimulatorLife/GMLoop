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

void test("resource locator prefers the generated package manifest when present", () => {
    const fixture = createTemporaryCoreWorkspaceFixture();

    try {
        const configuredResourceDirectoryPath = path.join(fixture.fixtureRootPath, "installed-resources");
        mkdirSync(configuredResourceDirectoryPath, { recursive: true });
        writeFileSync(
            path.join(fixture.packageDirectoryPath, "resource-directory.json"),
            JSON.stringify({ resourceDirectory: configuredResourceDirectoryPath }, null, 2)
        );

        assert.equal(
            __resolveBundledResourceBaseDirectoryForTests(fixture.nestedModuleDirectoryPath),
            configuredResourceDirectoryPath
        );
    } finally {
        rmSync(fixture.fixtureRootPath, { force: true, recursive: true });
    }
});

void test("resource locator ignores stale generated package manifest paths", () => {
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
