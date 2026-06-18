import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as AgentPack from "../src/modules/auto-game-agent-pack/index.js";

type AgentPackReceiptFixture = Readonly<{
    conflicts: ReadonlyArray<string>;
    files: Readonly<Record<string, string>>;
    package: string;
    version: string;
}>;

async function createGameProjectFixture(): Promise<Readonly<{ cleanup: () => Promise<void>; projectRoot: string }>> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-agent-pack-"));
    await writeFile(path.join(projectRoot, "Fixture.yyp"), '{"resourceType":"GMProject"}\n', "utf8");
    return Object.freeze({
        cleanup: () => rm(projectRoot, { force: true, recursive: true }),
        projectRoot
    });
}

async function readReceipt(projectRoot: string): Promise<AgentPackReceiptFixture> {
    return JSON.parse(
        await readFile(path.join(projectRoot, ".gmloop", "agent-pack.json"), "utf8")
    ) as AgentPackReceiptFixture;
}

function hashText(source: string): string {
    return createHash("sha256").update(source).digest("hex");
}

void test("agent pack exposes a deterministic raw skill collection", async () => {
    const names = await AgentPack.discoverPackagedSkillNames();
    assert.ok(names.length > 0);
    assert.deepEqual(names, [...names].sort());
    assert.equal(new Set(names).size, names.length);
});

void test("agent pack initialization installs skills, project guidance, and a version receipt", async () => {
    const fixture = await createGameProjectFixture();
    try {
        const result = await AgentPack.initializeAgentPack(fixture.projectRoot);
        const names = await AgentPack.discoverPackagedSkillNames();
        assert.deepEqual(
            result.added.filter((relativePath) => relativePath.endsWith("/SKILL.md")),
            names.map((name) => `.agents/skills/${name}/SKILL.md`)
        );
        assert.ok(result.added.includes("AGENTS.md"));
        assert.match(
            await readFile(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"),
            /project-scoped Agent Skills/u
        );

        const receipt = await readReceipt(fixture.projectRoot);
        assert.equal(receipt.package, "@gmloop/agent-pack");
        assert.equal(receipt.version, await AgentPack.readAgentPackVersion());
        assert.deepEqual(receipt.conflicts, []);
        const status = await AgentPack.readAgentPackProjectStatus(fixture.projectRoot);
        assert.equal(status.status, "current");
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack initialization is idempotent and preserves project-owned files", async () => {
    const fixture = await createGameProjectFixture();
    try {
        const projectGuidance = "# Project-owned instructions\n";
        await writeFile(path.join(fixture.projectRoot, "AGENTS.md"), projectGuidance, "utf8");
        const first = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.equal(first.changed, true);
        assert.deepEqual(first.conflicts, ["AGENTS.md"]);
        assert.equal(await readFile(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"), projectGuidance);

        const second = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.equal(second.changed, false);
        assert.deepEqual(second.added, []);
        assert.deepEqual(second.updated, []);
        assert.deepEqual(second.conflicts, ["AGENTS.md"]);
        assert.equal(await readFile(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"), projectGuidance);
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack reports a change when initialization adds only the missing version receipt", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await AgentPack.initializeAgentPack(fixture.projectRoot);
        await rm(path.join(fixture.projectRoot, ".gmloop", "agent-pack.json"));

        const result = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.equal(result.changed, true);
        assert.deepEqual(result.added, []);
        assert.deepEqual(result.updated, []);
        const status = await AgentPack.readAgentPackProjectStatus(fixture.projectRoot);
        assert.equal(status.status, "current");
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack update replaces only content matching the previously installed source", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await AgentPack.initializeAgentPack(fixture.projectRoot);
        const receipt = await readReceipt(fixture.projectRoot);
        const managedPath = Object.keys(receipt.files).find((relativePath) => relativePath.endsWith("/SKILL.md"));
        assert.ok(managedPath);
        const simulatedOldSource = "previous packaged content\n";
        await writeFile(path.join(fixture.projectRoot, ...managedPath.split("/")), simulatedOldSource, "utf8");
        await writeFile(
            path.join(fixture.projectRoot, ".gmloop", "agent-pack.json"),
            `${JSON.stringify({ ...receipt, files: { ...receipt.files, [managedPath]: hashText(simulatedOldSource) }, version: "0.0.0" }, null, 2)}\n`,
            "utf8"
        );

        const beforeUpdate = await AgentPack.readAgentPackProjectStatus(fixture.projectRoot);
        assert.equal(beforeUpdate.status, "update-available");
        const update = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.deepEqual(update.updated, [managedPath]);
        assert.notEqual(
            await readFile(path.join(fixture.projectRoot, ...managedPath.split("/")), "utf8"),
            simulatedOldSource
        );
        const afterUpdate = await AgentPack.readAgentPackProjectStatus(fixture.projectRoot);
        assert.equal(afterUpdate.status, "current");
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack rejects projects without a yyp and unsafe receipt paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gmloop-agent-pack-invalid-"));
    try {
        await assert.rejects(() => AgentPack.initializeAgentPack(directory), /containing a \.yyp file/u);
        await writeFile(path.join(directory, "Fixture.yyp"), "{}\n", "utf8");
        await mkdir(path.join(directory, ".gmloop"), { recursive: true });
        await writeFile(
            path.join(directory, ".gmloop", "agent-pack.json"),
            `${JSON.stringify({ conflicts: [], files: { "../../outside": "hash" }, package: "@gmloop/agent-pack", version: "0.0.0" })}\n`,
            "utf8"
        );
        await assert.rejects(() => AgentPack.initializeAgentPack(directory), /safe project-relative paths/u);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});
