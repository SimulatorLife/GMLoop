import assert from "node:assert/strict";
import test from "node:test";

import { FixtureRunner } from "@gmloop/fixture-runner";

import { LEGACY_FIXTURE_CASE_IDS_BY_WORKSPACE } from "./fixture-legacy-case-ids.js";
import { createFixtureSuiteRegistry } from "./fixture-suite-registry.js";

const fixtureSuites = createFixtureSuiteRegistry();

await fixtureSuites.reduce<Promise<void>>(async (previous, fixtureSuite) => {
    await previous;

    const legacyCaseIds =
        LEGACY_FIXTURE_CASE_IDS_BY_WORKSPACE[
            fixtureSuite.workspaceName as keyof typeof LEGACY_FIXTURE_CASE_IDS_BY_WORKSPACE
        ] ?? [];

    if (legacyCaseIds.length === 0) {
        await FixtureRunner.registerNodeFixtureSuite({
            fixtureRoot: fixtureSuite.fixtureRoot,
            adapter: fixtureSuite.adapter
        });
        return;
    }

    const fixtureCases = await FixtureRunner.discoverFixtureCases(fixtureSuite.fixtureRoot);
    const runnableCaseIds = fixtureCases
        .map((fixtureCase) => fixtureCase.caseId)
        .filter((caseId) => !legacyCaseIds.includes(caseId));

    void test(`${fixtureSuite.suiteName} discovers non-legacy cases`, () => {
        assert.equal(
            runnableCaseIds.length > 0,
            true,
            `Expected at least one non-legacy fixture case for ${fixtureSuite.suiteName}.`
        );
    });

    void test(
        `${fixtureSuite.suiteName} runs with legacy expectations excluded`,
        {
            timeout: 120_000
        },
        async () => {
            const runResult = await FixtureRunner.runFixtureSuite({
                fixtureRoot: fixtureSuite.fixtureRoot,
                adapter: fixtureSuite.adapter,
                caseIds: runnableCaseIds
            });

            assert.equal(
                runResult.failures.length,
                0,
                `Non-legacy fixture cases should pass for ${fixtureSuite.suiteName}.`
            );
        }
    );
}, Promise.resolve());
