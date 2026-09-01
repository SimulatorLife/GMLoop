import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { FixtureRunner } from "@gmloop/fixture-runner";

import { createIntegrationFixtureSuiteDefinition } from "./integration-fixture-suite-definition.js";

const execFileAsync = promisify(execFile);
const fixtureSuite = createIntegrationFixtureSuiteDefinition();

// Each batch runs in its own process (see integration-fixture-batch-runner.ts
// for why): keeping this comfortably below the ~16-parse point where the
// shared GML grammar automaton periodically resets its prediction caches
// (src/parser/src/gml-parser.ts) avoids paying that reset's cold-cache
// penalty mid-batch.
const FIXTURE_BATCH_SIZE = 4;
const BATCH_RUNNER_MODULE_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "integration-fixture-batch-runner.js"
);

function chunkCaseIds(caseIds: ReadonlyArray<string>, chunkSize: number): Array<ReadonlyArray<string>> {
    const chunks: Array<ReadonlyArray<string>> = [];
    for (let index = 0; index < caseIds.length; index += chunkSize) {
        chunks.push(caseIds.slice(index, index + chunkSize));
    }

    return chunks;
}

async function runFixtureCaseBatch(caseIds: ReadonlyArray<string>): Promise<void> {
    await execFileAsync(process.execPath, ["--disable-warning=ExperimentalWarning", BATCH_RUNNER_MODULE_PATH], {
        env: {
            ...process.env,
            GMLOOP_INTEGRATION_FIXTURE_BATCH_CASE_IDS_JSON: JSON.stringify(caseIds)
        },
        timeout: 60_000
    });
}

void test("cross-module integration fixtures discovers fixture cases", async () => {
    const fixtureCases = await FixtureRunner.discoverFixtureCases(fixtureSuite.fixtureRoot);
    const runnableCaseIds = fixtureCases.map((fixtureCase) => fixtureCase.caseId);

    assert.equal(runnableCaseIds.length > 0, true, "Expected at least one integration fixture case.");
});

void test(
    "cross-module integration fixtures run successfully",
    {
        timeout: 120_000
    },
    async () => {
        const fixtureCases = await FixtureRunner.discoverFixtureCases(fixtureSuite.fixtureRoot);
        const runnableCaseIds = fixtureCases.map((fixtureCase) => fixtureCase.caseId);
        const batches = chunkCaseIds(runnableCaseIds, FIXTURE_BATCH_SIZE);

        await Promise.all(batches.map((batch) => runFixtureCaseBatch(batch)));
    }
);
