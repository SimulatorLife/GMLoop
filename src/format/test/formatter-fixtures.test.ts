import assert from "node:assert/strict";
import test from "node:test";

import { FixtureRunner } from "@gmloop/fixture-runner";

import { createFormatFixtureSuiteDefinition } from "./fixture-suite-definition.js";

const fixtureSuite = createFormatFixtureSuiteDefinition();

const fixtureCases = await FixtureRunner.discoverFixtureCases(fixtureSuite.fixtureRoot);
const runnableCaseIds = fixtureCases.map((fixtureCase) => fixtureCase.caseId);

void test("formatter fixtures are discovered", () => {
    assert.equal(runnableCaseIds.length > 0, true, "Expected at least one formatter fixture case.");
});

void test(
    "formatter fixtures run and pass",
    {
        timeout: 120_000
    },
    async () => {
        const runResult = await FixtureRunner.runFixtureSuite({
            fixtureRoot: fixtureSuite.fixtureRoot,
            adapter: fixtureSuite.adapter,
            caseIds: runnableCaseIds
        });

        assert.equal(runResult.failures.length, 0, "Formatter fixtures should pass.");
    }
);
