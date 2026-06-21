import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { type FixtureAdapter, type FixtureCaseResult, type FixtureKind, FixtureRunner } from "@gmloop/fixture-runner";

const testAdapter: FixtureAdapter = Object.freeze({
    workspaceName: "fixture-runner",
    suiteName: "fixture-suite-definition",
    supports(_kind: FixtureKind): boolean {
        return true;
    },
    async run(): Promise<FixtureCaseResult> {
        throw new Error("Not implemented for suite-definition unit tests.");
    }
});

void test("createFixtureSuiteDefinition resolves fixture root for source test execution", () => {
    const suiteDefinition = FixtureRunner.createFixtureSuiteDefinition({
        workspaceName: "format",
        suiteName: "formatter fixtures",
        compiledWorkspaceTestFilePath: "src/format/dist/test/formatter-fixtures.test.js",
        moduleUrl: "file:///workspace/GMLoop/src/format/test/fixture-adapter.ts",
        sourceRelativeSegments: ["fixtures"],
        distRelativeSegments: ["..", "..", "test", "fixtures"],
        adapter: testAdapter
    });

    assert.equal(suiteDefinition.fixtureRoot, path.resolve("/workspace/GMLoop/src/format/test/fixtures"));
});

void test("createFixtureSuiteDefinition resolves fixture root for dist test execution", () => {
    const suiteDefinition = FixtureRunner.createFixtureSuiteDefinition({
        workspaceName: "format",
        suiteName: "formatter fixtures",
        compiledWorkspaceTestFilePath: "src/format/dist/test/formatter-fixtures.test.js",
        moduleUrl: "file:///workspace/GMLoop/src/format/dist/test/fixture-adapter.js",
        sourceRelativeSegments: ["fixtures"],
        distRelativeSegments: ["..", "..", "test", "fixtures"],
        adapter: testAdapter
    });

    assert.equal(suiteDefinition.fixtureRoot, path.resolve("/workspace/GMLoop/src/format/test/fixtures"));
});
