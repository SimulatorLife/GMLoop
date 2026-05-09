import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Format } from "@gmloop/format";
import { Semantic } from "@gmloop/semantic";

const FIXTURES_DIRECTORY = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/semantic/test/identifier-case-fixtures"
);

async function createTempProjectWorkspace(prefix: string) {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

    const writeFile = async (relativePath: string, contents: string) => {
        const absolutePath = path.join(projectRoot, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, contents, "utf8");
        return absolutePath;
    };

    return { projectRoot, writeFile };
}

async function createIdentifierCaseProject(fixtureFileName = "locals.gml") {
    const { projectRoot, writeFile } = await createTempProjectWorkspace("gml-identifier-case-autodiscovery-");

    await writeFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));
    await writeFile("scripts/demo/demo.yy", JSON.stringify({ resourceType: "GMScript", name: "demo" }));

    const fixturePath = path.join(FIXTURES_DIRECTORY, fixtureFileName);
    const fixtureSource = await fs.readFile(fixturePath, "utf8");
    const gmlPath = await writeFile("scripts/demo/demo.gml", fixtureSource);

    await Semantic.buildProjectIndex(projectRoot);

    return { projectRoot, fixtureSource, gmlPath };
}

async function fileExists(filePath: string) {
    try {
        await fs.stat(filePath);
        return true;
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return false;
        }

        throw error;
    }
}

void describe("identifier case project index bootstrap", () => {
    void it("does not apply identifier-case rewrites via formatter autodiscovery", async () => {
        const { projectRoot, fixtureSource, gmlPath } = await createIdentifierCaseProject();

        try {
            const baseOptions = {
                filepath: gmlPath,
                gmlIdentifierCase: "camel",
                gmlIdentifierCaseLocals: "camel",
                gmlIdentifierCaseFunctions: "off",
                gmlIdentifierCaseStructs: "off",
                gmlIdentifierCaseMacros: "off",
                gmlIdentifierCaseInstance: "off",
                gmlIdentifierCaseGlobals: "off",
                gmlIdentifierCaseAssets: "off",
                identifierCaseDryRun: false,
                __identifierCaseDryRun: false
            };

            const firstOutput = await Format.format(fixtureSource, { ...baseOptions });
            assert.ok(firstOutput.includes("counter_value"));

            const cacheFilePath = path.join(projectRoot, ".gmloop", "project-index-cache.json");
            assert.equal(await fileExists(cacheFilePath), false);

            const secondOutput = await Format.format(firstOutput, { ...baseOptions });
            assert.ok(secondOutput.includes("counter_value"));
        } finally {
            Semantic.clearIdentifierCaseOptionStore(gmlPath);
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });

    void it("keeps identifier-case rewrites disabled when discovery cannot run", async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gml-identifier-case-autodiscovery-miss-"));

        let manifestStoreKey: string | null = null;

        try {
            const fixturePath = path.join(FIXTURES_DIRECTORY, "locals.gml");
            const fixtureSource = await fs.readFile(fixturePath, "utf8");
            const gmlPath = path.join(tempRoot, "scripts/demo.gml");
            manifestStoreKey = gmlPath;
            await fs.mkdir(path.dirname(gmlPath), { recursive: true });
            await fs.writeFile(gmlPath, fixtureSource, "utf8");

            const optionsWithoutManifest = {
                filepath: gmlPath,
                gmlIdentifierCase: "camel",
                gmlIdentifierCaseLocals: "camel",
                gmlIdentifierCaseFunctions: "off",
                gmlIdentifierCaseStructs: "off",
                gmlIdentifierCaseMacros: "off",
                gmlIdentifierCaseInstance: "off",
                gmlIdentifierCaseGlobals: "off",
                gmlIdentifierCaseAssets: "off",
                identifierCaseDryRun: false,
                __identifierCaseDryRun: false
            };

            const formattedWithoutManifest = await Format.format(fixtureSource, optionsWithoutManifest);
            assert.ok(
                formattedWithoutManifest.includes("counter_value"),
                "Expected renames to be skipped when no project root is found"
            );
            const missingStore = Semantic.getIdentifierCaseOptionStore(manifestStoreKey);
            assert.equal(missingStore?.__identifierCaseProjectIndexBootstrap ?? null, null);

            const {
                projectRoot,
                gmlPath: discoveredPath,
                fixtureSource: discoveredSource
            } = await createIdentifierCaseProject();

            try {
                const disabledOptions = {
                    filepath: discoveredPath,
                    gmlIdentifierCase: "camel",
                    gmlIdentifierCaseLocals: "camel",
                    gmlIdentifierCaseFunctions: "off",
                    gmlIdentifierCaseStructs: "off",
                    gmlIdentifierCaseMacros: "off",
                    gmlIdentifierCaseInstance: "off",
                    gmlIdentifierCaseGlobals: "off",
                    gmlIdentifierCaseAssets: "off",
                    gmlIdentifierCaseDiscoverProject: false,
                    identifierCaseDryRun: false,
                    __identifierCaseDryRun: false
                };

                const formattedDisabled = await Format.format(discoveredSource, disabledOptions);
                assert.ok(
                    formattedDisabled.includes("counter_value"),
                    "Expected renames to be disabled when discovery is turned off"
                );
                const disabledStore = Semantic.getIdentifierCaseOptionStore(discoveredPath);
                assert.equal(disabledStore?.__identifierCaseProjectIndexBootstrap ?? null, null);
            } finally {
                Semantic.clearIdentifierCaseOptionStore(discoveredPath);
                await fs.rm(projectRoot, { recursive: true, force: true });
            }
        } finally {
            Semantic.clearIdentifierCaseOptionStore(manifestStoreKey);
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });
});
