import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { createFixtureSuiteRegistry } from "./fixture-suite-registry.js";

type RootPackageManifest = {
    scripts: Record<string, string>;
};

function normalizePathSeparator(value: string): string {
    return value.split(path.sep).join("/");
}

async function readRootPackageManifest(): Promise<RootPackageManifest> {
    const packagePath = path.resolve(process.cwd(), "package.json");
    const packageSource = await readFile(packagePath, "utf8");
    return JSON.parse(packageSource) as RootPackageManifest;
}

async function collectDiscoveredCompiledTests(): Promise<ReadonlySet<string>> {
    const discoveredTests = new Set<string>();

    async function walkDirectory(currentDirectoryPath: string): Promise<void> {
        const directoryEntries = await readdir(currentDirectoryPath, {
            withFileTypes: true
        });

        await Promise.all(
            directoryEntries.map(async (directoryEntry) => {
                const entryPath = path.join(currentDirectoryPath, directoryEntry.name);

                if (directoryEntry.isDirectory()) {
                    if (directoryEntry.name === "node_modules") {
                        return;
                    }

                    await walkDirectory(entryPath);
                    return;
                }

                const relativeEntryPath = path.relative(process.cwd(), entryPath);
                const normalizedEntryPath = normalizePathSeparator(relativeEntryPath);
                const isWorkspaceCompiledTest = /\/dist\/test\/.+\.test\.js$/u.test(normalizedEntryPath);
                const isRootCompiledTest = /^test\/dist\/[^/]+\.test\.js$/u.test(normalizedEntryPath);

                if (isWorkspaceCompiledTest || isRootCompiledTest) {
                    discoveredTests.add(normalizedEntryPath);
                }
            })
        );
    }

    await Promise.all([
        walkDirectory(path.resolve(process.cwd(), "src")),
        walkDirectory(path.resolve(process.cwd(), "test"))
    ]);

    return discoveredTests;
}

void test("root test discovery includes formatter, lint, refactor, and cross-module integration suites", async () => {
    const discoveredTests = await collectDiscoveredCompiledTests();
    const requiredFixtureSuites = createFixtureSuiteRegistry().map(
        (fixtureSuite) => fixtureSuite.compiledWorkspaceTestFilePath
    );

    for (const requiredSuite of requiredFixtureSuites) {
        assert.equal(
            discoveredTests.has(requiredSuite),
            true,
            `Global test discovery is missing required fixture suite '${requiredSuite}'.`
        );
    }
});

void test("global test discovery includes the shared root fixture registry runner", async () => {
    const packageManifest = await readRootPackageManifest();

    // The test:fixtures script runs the fixture-suites.js file. This script exists
    // and is included in the test: CI pipeline (test: CI → test:compiled → test:fixtures).
    // The script references fixture-suites.js directly rather than through an
    // intermediate test:fixtures:files alias.
    assert.ok(
        typeof packageManifest.scripts["test:fixtures"] === "string" &&
            packageManifest.scripts["test:fixtures"].includes("fixture-suites.js"),
        "test:fixtures must run fixture-suites.js as the root fixture registry runner"
    );
    assert.match(
        packageManifest.scripts.test ?? "",
        /test:fixtures/u,
        "The main test pipeline must include test:fixtures for fixture runs"
    );
});

void test("fixture-only aggregate command points at the shared root registry runner", async () => {
    const packageManifest = await readRootPackageManifest();

    // The fixture-only test script is test:fixtures, which directly runs test/dist/fixture-suites.js.
    assert.ok(typeof packageManifest.scripts["test:fixtures"] === "string", "test:fixtures script must exist");
    assert.ok(
        packageManifest.scripts["test:fixtures"].includes("test/dist/fixture-suites.js"),
        "test:fixtures must target test/dist/fixture-suites.js as the root fixture registry runner"
    );
});
