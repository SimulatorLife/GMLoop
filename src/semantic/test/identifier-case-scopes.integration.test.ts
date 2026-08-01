import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildProjectIndex } from "../src/project-index/index.js";
import { resolveIdentifierCaseFixturesDirectory } from "./identifier-case-test-helpers.js";
import { createTempProjectWorkspace, recordValues } from "./test-project-helpers.js";

type IdentifierIndexEntry = {
    identifierId?: string;
    name?: string;
    declarations?: unknown[];
};

type IdentifierCollections = {
    enums: Record<string, IdentifierIndexEntry>;
    enumMembers: Record<string, IdentifierIndexEntry>;
    globalVariables: Record<string, IdentifierIndexEntry>;
    macros: Record<string, IdentifierIndexEntry>;
    scripts: Record<string, IdentifierIndexEntry>;
};

type ProjectIndexSnapshot = { identifiers: IdentifierCollections };

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const fixturesDirectory = resolveIdentifierCaseFixturesDirectory(currentDirectory);
const scopeFixturePath = path.join(fixturesDirectory, "scope-collisions.gml");

async function createScopeFixtureProject() {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace("gml-scope-tests-");

    await writeProjectFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));

    await writeProjectFile(
        "scripts/scopeTester/scopeTester.yy",
        JSON.stringify({ resourceType: "GMScript", name: "scopeTester" })
    );

    const fixtureSource = await fs.readFile(scopeFixturePath, "utf8");
    await writeProjectFile("scripts/scopeTester/scopeTester.gml", fixtureSource);

    return { projectRoot, fixtureSource, cleanup };
}

void describe("project index scope tracking", () => {
    void it("collects identifiers across macros, enums, and globals", async () => {
        const { projectRoot, cleanup } = await createScopeFixtureProject();

        try {
            const index = (await buildProjectIndex(projectRoot)) as ProjectIndexSnapshot;

            const macros = index.identifiers.macros;
            assert.ok(macros.MAX_COUNT, "expected MAX_COUNT macro to be indexed");
            assert.ok(macros.max_count, "expected max_count macro to be indexed");
            assert.equal(macros.MAX_COUNT.declarations.length, 1);
            assert.equal(macros.max_count.declarations.length, 1);

            const globalVars = index.identifiers.globalVariables;
            assert.ok(globalVars.global_score, "expected global_score declaration to be tracked");
            assert.ok(globalVars.GLOBAL_SCORE, "expected GLOBAL_SCORE declaration to be tracked");

            const enumEntries = recordValues<IdentifierIndexEntry>(index.identifiers.enums);
            const difficultyEnum = enumEntries.find((entry) => entry.name === "Difficulty");
            const difficultyCopyEnum = enumEntries.find((entry) => entry.name === "DifficultyCopy");
            assert.ok(difficultyEnum, "expected Difficulty enum to be present");
            assert.ok(difficultyCopyEnum, "expected DifficultyCopy enum to be present");

            const enumMembers = recordValues<IdentifierIndexEntry>(index.identifiers.enumMembers);
            const hasEasyMember = enumMembers.filter((entry) => entry.name === "Easy");
            assert.ok(hasEasyMember.length >= 2, "expected both Easy members to be tracked");

            const scriptEntry = index.identifiers.scripts["scope:script:scopeTester"];
            assert.ok(scriptEntry, "expected script entry for scopeTester");
            assert.equal(scriptEntry.declarations.length > 0, true);
        } finally {
            await cleanup();
        }
    });
});
