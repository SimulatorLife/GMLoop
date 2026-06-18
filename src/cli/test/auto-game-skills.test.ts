import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeCommandLineArguments } from "../src/cli-core/cli-argument-normalization.js";
import { createAgentPackCommand, runAgentPackInit } from "../src/commands/agent-pack.js";
import * as AgentPack from "../src/modules/auto-game-agent-pack/index.js";
import {
    discoverAutoGameProjectSkills,
    setAutoGameProjectSkillEnabled
} from "../src/modules/auto-game-skills/index.js";

async function createGameProjectFixture(): Promise<Readonly<{ cleanup: () => Promise<void>; projectRoot: string }>> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-auto-game-skills-"));
    await writeFile(path.join(projectRoot, "Fixture.yyp"), '{"resourceType":"GMProject"}\n', "utf8");
    return Object.freeze({
        cleanup: () => rm(projectRoot, { force: true, recursive: true }),
        projectRoot
    });
}

async function writeSkill(projectRoot: string, directoryName: string, contents: string): Promise<void> {
    const skillDirectory = path.join(projectRoot, ".agents", "skills", directoryName);
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "SKILL.md"), contents, "utf8");
}

void test("Auto-Game discovery reads only the supplied GameMaker project skill root", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await writeSkill(
            fixture.projectRoot,
            "game-design",
            "---\nname: game-design\ndescription: Design this game.\n---\n\n# Instructions\n"
        );
        const skills = await discoverAutoGameProjectSkills(fixture.projectRoot, {});
        assert.deepEqual(
            skills.map((skill) => skill.name),
            ["game-design"]
        );
        assert.equal(
            skills.some((skill) => skill.name === "cli-command-architecture"),
            false
        );
        assert.equal(skills[0]?.enabled, true);
        assert.equal(skills[0]?.sourcePath, ".agents/skills/game-design/SKILL.md");
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game discovery does not implement custom Agent Skills conformance validation", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await writeSkill(fixture.projectRoot, "broken-skill", "# Missing frontmatter\n");
        const skills = await discoverAutoGameProjectSkills(fixture.projectRoot, {});
        assert.equal(skills[0]?.status, "available");
        assert.equal(skills[0]?.enabled, true);
        assert.equal(skills[0]?.diagnostic, null);
        assert.match(skills[0]?.description ?? "", /No description/u);
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game discovery keeps unreadable skill metadata visible, enabled, and toggleable", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await writeSkill(fixture.projectRoot, "unreadable-skill", "---\nname: [\n---\n");
        const skills = await discoverAutoGameProjectSkills(fixture.projectRoot, {});
        assert.equal(skills[0]?.status, "unreadable");
        assert.equal(skills[0]?.enabled, true);
        assert.match(skills[0]?.diagnostic ?? "", /Could not parse/u);

        await setAutoGameProjectSkillEnabled(fixture.projectRoot, "unreadable-skill", false);
        const config = JSON.parse(await readFile(path.join(fixture.projectRoot, "gmloop.json"), "utf8")) as {
            autoGame: { disabledSkills: Array<string> };
        };
        const disabledSkills = await discoverAutoGameProjectSkills(fixture.projectRoot, config);
        assert.equal(disabledSkills[0]?.enabled, false);
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game skill toggles persist sorted disabled exceptions and preserve unrelated config", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await writeSkill(
            fixture.projectRoot,
            "game-design",
            "---\nname: game-design\ndescription: Design this game.\n---\n\n# Instructions\n"
        );
        await writeFile(
            path.join(fixture.projectRoot, "gmloop.json"),
            `${JSON.stringify({ autoGame: { mode: "local" }, runtime: { enabled: true } }, null, 2)}\n`,
            "utf8"
        );

        await setAutoGameProjectSkillEnabled(fixture.projectRoot, "game-design", false);
        const disabledConfig = JSON.parse(await readFile(path.join(fixture.projectRoot, "gmloop.json"), "utf8")) as {
            autoGame: { disabledSkills: Array<string>; mode: string };
            runtime: { enabled: boolean };
        };
        assert.deepEqual(disabledConfig.autoGame.disabledSkills, ["game-design"]);
        assert.equal(disabledConfig.autoGame.mode, "local");
        assert.equal(disabledConfig.runtime.enabled, true);
        const disabledSkills = await discoverAutoGameProjectSkills(fixture.projectRoot, disabledConfig);
        assert.equal(disabledSkills[0]?.enabled, false);

        await setAutoGameProjectSkillEnabled(fixture.projectRoot, "game-design", true);
        const enabledConfig = JSON.parse(await readFile(path.join(fixture.projectRoot, "gmloop.json"), "utf8")) as {
            autoGame: { disabledSkills: Array<string> };
        };
        assert.deepEqual(enabledConfig.autoGame.disabledSkills, []);
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game skill operations reject directories without a root-level yyp", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gmloop-not-game-project-"));
    try {
        await assert.rejects(() => AgentPack.initializeAgentPack(directory), /containing a \.yyp file/u);
        await assert.rejects(() => discoverAutoGameProjectSkills(directory, {}), /containing a \.yyp file/u);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

void test("agent-pack init exposes the standard project path option", () => {
    const command = createAgentPackCommand();
    const init = command.commands.find((candidate) => candidate.name() === "init");
    assert.ok(init);
    assert.equal(
        init.options.some((option) => option.long === "--path"),
        true
    );
});

void test("agent-pack is recognized as an explicit universal CLI command", () => {
    assert.deepEqual(normalizeCommandLineArguments(["agent-pack", "--help"]), ["agent-pack", "--help"]);
});

void test("agent-pack init accepts an explicit yyp path and reports deterministic results", async (context) => {
    const fixture = await createGameProjectFixture();
    const output = new Array<string>();
    context.mock.method(console, "log", (value: string) => output.push(value));
    try {
        const packagedSkillNames = await AgentPack.discoverPackagedSkillNames();
        await runAgentPackInit({ path: path.join(fixture.projectRoot, "Fixture.yyp") });
        assert.equal(output.length, 1);
        const payload = JSON.parse(output[0] ?? "") as {
            command: string;
            payload: { added: Array<string>; conflicts: Array<string>; version: string };
            projectRoot: string;
        };
        assert.equal(payload.command, "agent-pack init");
        assert.equal(payload.projectRoot, fixture.projectRoot);
        assert.deepEqual(
            payload.payload.added.filter((relativePath) => relativePath.endsWith("/SKILL.md")),
            packagedSkillNames.map((name) => `.agents/skills/${name}/SKILL.md`)
        );
        assert.deepEqual(payload.payload.conflicts, []);
        assert.equal(payload.payload.version, await AgentPack.readAgentPackVersion());
    } finally {
        await fixture.cleanup();
    }
});
