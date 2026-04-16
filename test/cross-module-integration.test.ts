import assert from "node:assert/strict";
import test from "node:test";

import { FixtureRunner } from "@gmloop/fixture-runner";

import { INTEGRATION_LEGACY_CASE_IDS } from "./fixture-legacy-case-ids.js";
import { createIntegrationFixtureSuiteDefinition } from "./integration-fixture-suite-definition.js";

const fixtureSuite = createIntegrationFixtureSuiteDefinition();

void test("cross-module integration fixtures discovers non-legacy cases", async () => {
    const fixtureCases = await FixtureRunner.discoverFixtureCases(fixtureSuite.fixtureRoot);
    const runnableCaseIds = fixtureCases
        .map((fixtureCase) => fixtureCase.caseId)
        .filter((caseId) => !INTEGRATION_LEGACY_CASE_IDS.includes(caseId));

    assert.equal(runnableCaseIds.length > 0, true, "Expected at least one non-legacy integration fixture case.");
});

void test(
    "cross-module integration fixtures run with legacy expectations excluded",
    {
        timeout: 120_000
    },
    async () => {
        const fixtureCases = await FixtureRunner.discoverFixtureCases(fixtureSuite.fixtureRoot);
        const runnableCaseIds = fixtureCases
            .map((fixtureCase) => fixtureCase.caseId)
            .filter((caseId) => !INTEGRATION_LEGACY_CASE_IDS.includes(caseId));

        const runResult = await FixtureRunner.runFixtureSuite({
            fixtureRoot: fixtureSuite.fixtureRoot,
            adapter: fixtureSuite.adapter,
            caseIds: runnableCaseIds
        });

        assert.equal(runResult.failures.length, 0, "Non-legacy integration fixtures should pass.");
    }
);
