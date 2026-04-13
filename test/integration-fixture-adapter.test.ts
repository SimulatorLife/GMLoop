import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FixtureRunner } from "@gmloop/fixture-runner";

import { createIntegrationFixtureAdapter } from "./integration-fixture-adapter.js";

async function createIntegrationFixtureCase(parameters: {
    rootPath: string;
    caseId: string;
    config: Record<string, unknown>;
    inputText: string;
    expectedText: string;
}): Promise<void> {
    const casePath = path.join(parameters.rootPath, parameters.caseId);
    await mkdir(casePath, { recursive: true });
    await writeFile(path.join(casePath, "gmloop.json"), `${JSON.stringify(parameters.config, null, 2)}\n`, "utf8");
    await writeFile(path.join(casePath, "input.gml"), parameters.inputText, "utf8");
    await writeFile(path.join(casePath, "expected.gml"), parameters.expectedText, "utf8");
}

void test("integration fixture adapter runs the real refactor -> lint -> format pipeline", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "integration-fixture-adapter-"));

    try {
        await createIntegrationFixtureCase({
            rootPath,
            caseId: "pipeline-order",
            config: {
                refactor: {
                    codemods: {
                        loopLengthHoisting: false
                    }
                },
                lintRules: {},
                fixture: {
                    kind: "integration",
                    assertion: "transform",
                    comparison: "exact"
                }
            },
            inputText: "var value = 1\n",
            expectedText: "var value = 1;\n"
        });

        const collector = FixtureRunner.createProfileCollector();
        const result = await FixtureRunner.runFixtureSuite({
            fixtureRoot: rootPath,
            adapter: createIntegrationFixtureAdapter(),
            profileCollector: collector
        });

        assert.equal(result.executionResults.length, 1);
        assert.deepEqual(result.failures, []);

        const report = collector.createReport();
        const stageNames = report.entries[0]?.stages.map((stage) => stage.stageName);
        assert.deepEqual(stageNames, ["load", "refactor", "lint", "format", "compare", "total"]);
        assert.equal(typeof report.entries[0]?.memorySummary.totalHeapUsedDeltaBytes, "number");
        assert.equal(typeof report.entries[0]?.memorySummary.peakStageHeapUsedDeltaBytes, "number");
        assert.deepEqual(report.stageAggregates.map((aggregate) => aggregate.stageName).sort(), [
            "compare",
            "format",
            "lint",
            "load",
            "refactor",
            "total"
        ]);
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});

void test("integration fixture adapter supports lintRuleset presets from gmloop.json", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "integration-fixture-adapter-ruleset-"));

    try {
        await createIntegrationFixtureCase({
            rootPath,
            caseId: "lint-ruleset-preset",
            config: {
                lintRuleset: "recommended",
                fixture: {
                    kind: "integration",
                    assertion: "transform",
                    comparison: "exact"
                }
            },
            inputText: "var a = 1e3\n",
            expectedText: "var a = 1000;\n"
        });

        const result = await FixtureRunner.runFixtureSuite({
            fixtureRoot: rootPath,
            adapter: createIntegrationFixtureAdapter(),
            profileCollector: FixtureRunner.createProfileCollector()
        });

        assert.equal(result.executionResults.length, 1);
        assert.deepEqual(result.failures, []);
    } finally {
        await rm(rootPath, { recursive: true, force: true });
    }
});
