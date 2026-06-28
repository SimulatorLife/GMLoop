import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Refactor } from "@gmloop/refactor";

import { runCliTestCommand } from "../src/cli.js";
import * as AgentPack from "../src/modules/auto-game-agent-pack/index.js";
import { resolveArtifactDirectory, writeArtifactJson } from "../src/modules/runtime/index.js";

async function createReadinessProject(includeConfig: boolean): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-readiness-"));
    await writeFile(
        path.join(projectRoot, "Game.yyp"),
        `${JSON.stringify({ name: "Game", resourceType: "GMProject", resources: [] }, null, 4)}\n`,
        "utf8"
    );
    if (includeConfig) {
        await writeFile(path.join(projectRoot, "gmloop.json"), "{}\n", "utf8");
    }
    await Refactor.addProjectResource({
        dryRun: false,
        projectRoot,
        resourceKind: "script",
        resourceName: "scr_score"
    });
    await writeFile(
        path.join(projectRoot, "scripts/scr_score/scr_score.gml"),
        "function scr_score() {\n    return 1;\n}\n",
        "utf8"
    );
    return projectRoot;
}

void test("project inspect reports readiness state and companion tool availability", async () => {
    const projectRoot = await createReadinessProject(true);

    try {
        await AgentPack.initializeAgentPack(projectRoot, { includeGitIgnore: false });
        const result = await runCliTestCommand({
            argv: ["project", "inspect", "--path", path.join(projectRoot, "Game.yyp"), "--json"]
        });

        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as {
            command: string;
            ok: boolean;
            payload: {
                agentPack: { status: string };
                gmCli: { available: boolean };
                gmloopConfig: { present: boolean };
                graph: { ok: boolean };
                recommendedNextActions: Array<string>;
                resources: { count: number; resourceKinds: Record<string, number> };
                skills: Array<{ name: string; status: string }>;
                yypPath: string;
            };
        };

        assert.equal(payload.command, "project inspect");
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.agentPack.status, "current");
        assert.equal(payload.payload.gmCli.available, false);
        assert.equal(payload.payload.gmloopConfig.present, true);
        assert.equal(payload.payload.graph.ok, true);
        assert.equal(payload.payload.resources.count, 1);
        assert.equal(payload.payload.resources.resourceKinds.scripts, 1);
        assert.ok(payload.payload.skills.some((skill) => skill.name === "gmloop-tooling"));
        assert.equal(payload.payload.yypPath, path.join(projectRoot, "Game.yyp"));
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("project validate emits deterministic evidence and tolerates missing optional setup", async () => {
    const projectRoot = await createReadinessProject(false);
    const testArtifactPath = path.join(resolveArtifactDirectory(projectRoot, "test"), "latest.json");

    try {
        await mkdir(path.dirname(testArtifactPath), { recursive: true });
        await writeArtifactJson(testArtifactPath, {
            exitCode: 0,
            failed: 0,
            passed: 2,
            skipped: 0
        });

        const result = await runCliTestCommand({
            argv: ["project", "validate", "--path", projectRoot, "--json"]
        });

        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as {
            command: string;
            ok: boolean;
            payload: {
                evidence: Array<{
                    artifacts: Array<string>;
                    diagnostics: Array<string>;
                    kind: string;
                    nextActions: Array<string>;
                    source: string;
                    status: string;
                    summary: string;
                }>;
                summary: { failed: number; passed: number; unknown: number; warnings: number };
            };
        };

        assert.equal(payload.command, "project validate");
        assert.equal(payload.ok, true);
        assert.deepEqual(
            payload.payload.evidence.map((entry) => entry.kind),
            [
                "agent-pack",
                "gmloop-config",
                "graph-index",
                "official-gm-cli",
                "official-resourcetool-mcp",
                "parse",
                "resource-inventory",
                "runner-state",
                "test-results"
            ]
        );
        const configEvidence = payload.payload.evidence.find((entry) => entry.kind === "gmloop-config");
        assert.equal(configEvidence?.status, "warn");
        const testEvidence = payload.payload.evidence.find((entry) => entry.kind === "test-results");
        assert.equal(testEvidence?.status, "pass");
        assert.equal(payload.payload.summary.failed, 0);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("project inspect rejects directories without a GameMaker manifest", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-readiness-invalid-"));

    try {
        const result = await runCliTestCommand({
            argv: ["project", "inspect", "--path", projectRoot, "--json"]
        });
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /Could not locate a \.yyp manifest/u);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
