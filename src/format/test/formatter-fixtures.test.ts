import assert from "node:assert/strict";
import test from "node:test";

import { FixtureRunner } from "@gmloop/fixture-runner";

import { createFormatFixtureSuiteDefinition } from "./fixture-suite-definition.js";

const fixtureSuite = createFormatFixtureSuiteDefinition();
const LEGACY_FORMAT_CASE_IDS = Object.freeze(["test-argument-docs", "test-banner", "test-preserve"]);

const fixtureCases = await FixtureRunner.discoverFixtureCases(fixtureSuite.fixtureRoot);
const runnableCaseIds = fixtureCases
    .map((fixtureCase) => fixtureCase.caseId)
    .filter((caseId) => !LEGACY_FORMAT_CASE_IDS.includes(caseId));

void test("formatter fixtures discovers non-legacy cases", () => {
    assert.equal(runnableCaseIds.length > 0, true, "Expected at least one non-legacy formatter fixture case.");
});

void test(
    "formatter fixtures run with legacy expectations excluded",
    {
        timeout: 120_000
    },
    async () => {
        const runResult = await FixtureRunner.runFixtureSuite({
            fixtureRoot: fixtureSuite.fixtureRoot,
            adapter: fixtureSuite.adapter,
            caseIds: runnableCaseIds
        });

        assert.equal(runResult.failures.length, 0, "Non-legacy formatter fixtures should pass.");
    }
);
